import { expect, test } from "@playwright/test"
import {
	Address,
	Asset,
	Keypair,
	Networks,
	StrKey,
	nativeToScVal,
	xdr,
} from "@stellar/stellar-sdk"
import {
	account,
	accountAuth,
	connect,
	invocation,
	mockServices,
	type GrantAnswer,
} from "./mocks"

// The Guess the Number sample: a Nido account approves a session, then
// guesses without a prompt. `npm run new-app -- --blank` removes this file
// with the sample.

const sac = Asset.native().contractId(Networks.TESTNET)
const approve = "Approve with Nido (2 confirmations)"

/** The account's auth for a losing guess: `guess`, then 1 XLM to the game. */
const guessAuth = (method: string, game: string) => {
	if (method !== "guess") return []
	const me = new Address(account).toScVal()
	return [
		accountAuth(
			invocation(
				game,
				"guess",
				[nativeToScVal(3, { type: "u64" }), me],
				[
					invocation(sac, "transfer", [
						me,
						new Address(game).toScVal(),
						nativeToScVal(10_000_000n, { type: "i128" }),
					]),
				],
			),
		),
	]
}

/** A passkey-signed `apply_doc` on the account, as Nido would hand it back. */
const signedApproval = () =>
	Buffer.from(
		JSON.stringify({
			func: xdr.HostFunction.hostFunctionTypeInvokeContract(
				new xdr.InvokeContractArgs({
					contractAddress: new Address(account).toScAddress(),
					functionName: "apply_doc",
					args: [nativeToScVal("policy document")],
				}),
			).toXDR("base64"),
			auth: [accountAuth(invocation(account, "apply_doc", [])).toXDR("base64")],
		}),
	).toString("base64url")

async function guess(page: import("@playwright/test").Page) {
	await page.getByPlaceholder("Guess a number from 1 to 10!").fill("3")
	await page.getByRole("button", { name: "Submit", exact: true }).click()
	await expect(page.getByText("You got it!", { exact: false })).toBeVisible()
}

test("the guess form is on the home page", async ({ page }) => {
	await page.goto("/")
	await expect(
		page.getByPlaceholder("Guess a number from 1 to 10!"),
	).toBeVisible()
	await expect(page.getByRole("button", { name: "Submit" })).toBeVisible()
})

test("a Nido account approves a session once, then guesses without a popup", async ({
	page,
	context,
}) => {
	const { calls, grants, sent } = await mockServices(context, {
		auth: guessAuth,
	})
	await connect(page)
	await expect(
		page.getByPlaceholder("Guess a number from 1 to 10!"),
	).toHaveCount(0)
	await page.getByRole("button", { name: approve }).click()
	await expect(page.getByText("This app holds a session key")).toBeVisible()
	expect(page.url()).not.toContain("delegation")

	// One rule per contract a losing guess touches; only the XLM rule is capped
	const [game, xlm] = grants.map((g) => Object.fromEntries(g))
	const signer = game!.signer!
	expect(Keypair.fromPublicKey(signer).publicKey()).toBe(signer)
	expect(game).toMatchObject({
		functions: "guess",
		duration: "24h",
		label: "guess",
	})
	expect(game).not.toHaveProperty("limit")
	expect(xlm).toMatchObject({
		target: sac,
		signer,
		functions: "transfer",
		limit: "2",
		limit_period: "day",
	})

	let popups = 0
	page.on("popup", () => popups++)
	await guess(page)
	expect(popups).toBe(0)
	expect(calls).toContain("getTransaction")
	await expect(page.getByText(/^Transaction [0-9a-f]{64}$/)).toBeVisible()

	// The key signs inside the account's own entry (CAP-0071), naming the
	// approved rule for each authorized contract, in tree order.
	const op = sent[0]!.v1().tx().operations()[0]!
	const [entry] = op.body().invokeHostFunctionOp().auth()
	const creds = entry!.credentials()
	expect(creds.switch().name).toBe("sorobanCredentialsAddressWithDelegates")
	const delegates = creds.addressWithDelegates()
	const payload = delegates.addressCredentials().signature().map()!
	expect(
		payload[0]!
			.val()
			.vec()!
			.map((id) => id.u32()),
	).toEqual([2, 3])
	expect(
		Address.fromScAddress(delegates.delegates()[0]!.address()).toString(),
	).toBe(signer)
	await page.screenshot({
		path: "../screenshots/nido-session.png",
		fullPage: true,
	})
})

test("over the 2 XLM cap, the account refuses and the player is told why", async ({
	page,
	context,
}) => {
	let overCap = false
	await mockServices(context, {
		auth: guessAuth,
		refuse: () => (overCap ? "HostError: Error(Contract, #3221)" : undefined),
	})
	await connect(page)
	await page.getByRole("button", { name: approve }).click()
	await expect(page.getByText("This app holds a session key")).toBeVisible()
	await guess(page)

	overCap = true
	let popups = 0
	page.on("popup", () => popups++)
	await page.getByPlaceholder("Guess a number from 1 to 10!").fill("3")
	await page.getByRole("button", { name: "Submit", exact: true }).click()
	await expect(page.getByRole("alert")).toContainText(
		"the 2 XLM a day you let this game spend",
	)
	expect(popups).toBe(0)
})

test("a cancelled grant keeps the app's key for the next try", async ({
	page,
	context,
}) => {
	let cancel = true
	const { grants, funded } = await mockServices(context, {
		grantAnswer: () =>
			cancel
				? { answer: "?delegation=cancelled", landed: false }
				: { answer: "?delegation=ok", landed: true },
	})
	await connect(page)
	await page.getByRole("button", { name: approve }).click()
	await expect(
		page.getByText("The session request was cancelled"),
	).toBeVisible()
	cancel = false
	await page.getByRole("button", { name: approve }).click()
	await expect(page.getByText("This app holds a session key")).toBeVisible()
	// Friendbot funded one key, and every grant names it
	expect(funded).toHaveLength(1)
	expect(new Set(grants.map((g) => g.get("signer")))).toEqual(new Set(funded))
})

test("when Nido's relayer refuses, the app says so and can check the chain", async ({
	page,
	context,
}) => {
	// The second grant: Nido's page fails to confirm, but the rule landed
	// (a gateway timeout after submission).
	const grantAnswer: GrantAnswer = (_, i) =>
		i === 0
			? { answer: "?delegation=ok", landed: true }
			: { answer: "?delegation=error&code=FEE_LIMIT_EXCEEDED", landed: true }
	await mockServices(context, { grantAnswer })
	await connect(page)
	await page.getByRole("button", { name: approve }).click()
	await expect(page.getByRole("alert").first()).toContainText(
		"budget is used up",
	)
	await expect(page.getByText(/Nido has not confirmed/)).toContainText(
		"guess-xlm",
	)
	await page.getByRole("button", { name: "Check again" }).click()
	await expect(page.getByText("This app holds a session key")).toBeVisible()
	await expect(
		page.getByPlaceholder("Guess a number from 1 to 10!"),
	).toBeVisible()
})

test("an approval Nido couldn't relay is paid for by the app's own key", async ({
	page,
	context,
}) => {
	const grantAnswer: GrantAnswer = (_, i) =>
		i === 0
			? { answer: "?delegation=ok", landed: true }
			: {
					answer: `?delegation=signed#payload=${signedApproval()}`,
					landed: false,
				}
	const { sent, landed, funded } = await mockServices(context, {
		grantAnswer,
		auth: guessAuth,
	})
	await connect(page)
	await page.getByRole("button", { name: approve }).click()
	await expect(page.getByText(/this app's key paid/)).toBeVisible()
	expect(landed).toHaveLength(2)
	// Submitted and paid for by the session key Friendbot funded
	const tx = sent[0]!.v1().tx()
	expect(StrKey.encodeEd25519PublicKey(tx.sourceAccount().ed25519())).toBe(
		funded[0],
	)
	expect(page.url()).not.toContain("payload")
	await guess(page)
})
