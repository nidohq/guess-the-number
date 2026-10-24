import { expect, type BrowserContext, type Page } from "@playwright/test"
import {
	Account,
	Address,
	Contract,
	Networks,
	SorobanDataBuilder,
	StrKey,
	TransactionBuilder,
	nativeToScVal,
	xdr,
} from "@stellar/stellar-sdk"

// The real kit, module, popup transport, generated client and RPC parser run.
// Only the external wallet ceremony and network responses are fixtures.
export const account = StrKey.encodeContract(Buffer.alloc(32, 1))
export const source = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2))
export const hash = "ab".repeat(32)
// The hosted wallet (app-lib NIDO_BASE) and its account subdomains.
const nidoWallet = /https:\/\/([^/]+\.)?test\.nido\.fyi\//
const data = new SorobanDataBuilder().build().toXDR("base64")
const envelope = new TransactionBuilder(new Account(source, "0"), {
	fee: "100",
	networkPassphrase: Networks.TESTNET,
})
	.addOperation(new Contract(account).call("noop"))
	.setTimeout(30)
	.build()
	.toXDR()
const meta = new xdr.TransactionMeta(
	3,
	new xdr.TransactionMetaV3({
		ext: new xdr.ExtensionPoint(0),
		txChangesBefore: [],
		txChangesAfter: [],
		operations: [],
		sorobanMeta: new xdr.SorobanTransactionMeta({
			ext: new xdr.SorobanTransactionMetaExt(0),
			events: [],
			diagnosticEvents: [],
			returnValue: nativeToScVal(true),
		}),
	}),
).toXDR("base64")
const result = new xdr.TransactionResult({
	feeCharged: xdr.Int64.fromString("100"),
	result: xdr.TransactionResultResult.txSuccess([]),
	ext: new xdr.TransactionResultExt(0),
}).toXDR("base64")

/** What Nido's grant page does with the grant at `index`: the answer it
 * sends back (query or fragment, e.g. `?delegation=ok`) and whether the rule
 * landed on the account. */
export type GrantAnswer = (
	grant: URLSearchParams,
	index: number,
) => { answer: string; landed: boolean }

export const approveAll: GrantAnswer = () => ({
	answer: "?delegation=ok",
	landed: true,
})

/**
 * Mock the testnet RPC, Friendbot and Nido's pages for `context`. `auth`
 * gives the auth entries a simulated call asks the account for (by function
 * name and contract), `grantAnswer` plays the owner on Nido's grant page, and
 * `refuse` plays the account: an error it returns fails the enforced
 * simulation of a session call (e.g. `Error(Contract, #3221)` over a cap).
 */
export async function mockServices(
	context: BrowserContext,
	{
		signResult = `?nido_submitted=${hash}&kind=tx`,
		grantAnswer = approveAll,
		auth = () => [],
		refuse = () => undefined,
	}: {
		signResult?: string
		grantAnswer?: GrantAnswer
		auth?: (method: string, target: string) => xdr.SorobanAuthorizationEntry[]
		refuse?: () => string | undefined
	} = {},
) {
	const calls: string[] = []
	const grants: URLSearchParams[] = []
	const landed: URLSearchParams[] = []
	const sent: xdr.TransactionEnvelope[] = []
	const funded: string[] = []
	await context.route(
		"https://soroban-testnet.stellar.org/**",
		async (route) => {
			const body = route.request().postDataJSON() as {
				id: string
				method: string
				params: { transaction?: string }
			}
			calls.push(body.method)
			let response: unknown
			if (body.method === "simulateTransaction") {
				const tx = TransactionBuilder.fromXDR(
					body.params.transaction!,
					Networks.TESTNET,
				)
				if (!("operations" in tx)) throw new Error("Unexpected fee bump")
				const op = tx.operations[0]
				if (op?.type !== "invokeHostFunction")
					throw new Error("Unexpected operation")
				const call = op.func.invokeContract()
				const method = call.functionName().toString()
				const target = Address.fromScAddress(call.contractAddress()).toString()
				const enforced =
					(body.params as { authMode?: string }).authMode === "enforce"
				const refusal = enforced ? refuse() : undefined
				const retval =
					method === "balance"
						? nativeToScVal(125000000n, { type: "i128" })
						: method === "installed_rules"
							? installedRules(landed)
							: nativeToScVal(false)
				response = refusal
					? { latestLedger: 100, error: refusal }
					: {
							latestLedger: 100,
							minResourceFee: "100",
							transactionData: data,
							events: [],
							results: [
								{
									auth: auth(method, target).map((a) => a.toXDR("base64")),
									xdr: retval.toXDR("base64"),
								},
							],
						}
			} else if (body.method === "getTransaction") {
				response = {
					status: "SUCCESS",
					latestLedger: 102,
					ledger: 101,
					createdAt: 1,
					applicationOrder: 1,
					feeBump: false,
					envelopeXdr: envelope,
					resultXdr: result,
					resultMetaXdr: meta,
				}
			} else if (body.method === "getLedgerEntries") {
				// Only the session key's account is ever read this way.
				const keys = (body.params as unknown as { keys: string[] }).keys
				response = { latestLedger: 100, entries: keys.map(accountEntry) }
			} else if (body.method === "sendTransaction") {
				const tx = xdr.TransactionEnvelope.fromXDR(
					body.params.transaction!,
					"base64",
				)
				sent.push(tx)
				// A submitted `apply_doc` installs the grant it carries.
				const fn = tx.v1().tx().operations()[0]!.body().invokeHostFunctionOp()
				if (
					fn.hostFunction().invokeContract().functionName().toString() ===
					"apply_doc"
				)
					landed.push(grants.at(-1)!)
				response = { status: "PENDING", hash, latestLedger: 100 }
			} else throw new Error(`Unexpected RPC method: ${body.method}`)
			await route.fulfill({
				json: { jsonrpc: "2.0", id: body.id, result: response },
			})
		},
	)
	await context.route("https://friendbot.stellar.org/**", (route) => {
		funded.push(new URL(route.request().url()).searchParams.get("addr")!)
		return route.fulfill({ json: { successful: true } })
	})
	await context.route(nidoWallet, async (route) => {
		const url = new URL(route.request().url())
		if (url.pathname === "/security/delegate-doc/") {
			// The owner approves (or not) on Nido's page; it sends them back.
			grants.push(url.searchParams)
			const outcome = grantAnswer(url.searchParams, grants.length - 1)
			if (outcome.landed) landed.push(url.searchParams)
			const back = new URL(url.searchParams.get("return")!)
			const [query, fragment] = outcome.answer.split("#")
			back.search = query ?? ""
			if (fragment) back.hash = fragment
			return route.fulfill({
				status: 302,
				headers: { location: back.toString() },
			})
		}
		const search =
			url.pathname === "/connect/" ? `?nido_address=${account}` : signResult
		await route.fulfill({
			contentType: "text/html",
			body: `<!doctype html><title>Nido test ceremony</title><h1>Test wallet fixture</h1><button id="approve">Approve test request</button><script>document.querySelector('#approve').onclick = () => { opener.postMessage({source:'nido-wallet',search:${JSON.stringify(search)}}, ${JSON.stringify(url.searchParams.get("dapp"))}); window.close(); }</script>`,
		})
	})
	return { calls, grants, landed, sent, funded }
}

/** What the account reports after `grants` landed, as rules 2, 3, … */
function installedRules(grants: URLSearchParams[]) {
	return xdr.ScVal.scvVec(
		grants.map((grant, i) =>
			nativeToScVal(
				{
					context_type: xdr.ScVal.scvVec([
						xdr.ScVal.scvSymbol("CallContract"),
						new Address(grant.get("target")!).toScVal(),
					]),
					id: nativeToScVal(i + 2, { type: "u32" }),
					name: grant.get("label")!,
					signers: xdr.ScVal.scvVec([
						xdr.ScVal.scvVec([
							xdr.ScVal.scvSymbol("Delegated"),
							new Address(grant.get("signer")!).toScVal(),
						]),
					]),
					valid_until: nativeToScVal(1000, { type: "u32" }),
				},
				{ type: { id: ["symbol", null] } },
			),
		),
	)
}

/** A call into `contract`, with its own sub-calls. */
export function invocation(
	contract: string,
	fn: string,
	args: xdr.ScVal[],
	subInvocations: xdr.SorobanAuthorizedInvocation[] = [],
) {
	return new xdr.SorobanAuthorizedInvocation({
		function:
			xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
				new xdr.InvokeContractArgs({
					contractAddress: new Address(contract).toScAddress(),
					functionName: fn,
					args,
				}),
			),
		subInvocations,
	})
}

/** The account's unsigned auth entry for `root`, as simulation returns it. */
export function accountAuth(root: xdr.SorobanAuthorizedInvocation) {
	return new xdr.SorobanAuthorizationEntry({
		credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
			new xdr.SorobanAddressCredentials({
				address: new Address(account).toScAddress(),
				nonce: xdr.Int64.fromString("7"),
				signatureExpirationLedger: 0,
				signature: xdr.ScVal.scvVoid(),
			}),
		),
		rootInvocation: root,
	})
}

/** A funded classic account entry for the requested account key. */
function accountEntry(key: string) {
	const accountId = xdr.LedgerKey.fromXDR(key, "base64").account().accountId()
	const entry = new xdr.LedgerEntryData.account(
		new xdr.AccountEntry({
			accountId,
			balance: xdr.Int64.fromString("100000000000"),
			seqNum: xdr.SequenceNumber.fromString("1"),
			numSubEntries: 0,
			inflationDest: null,
			flags: 0,
			homeDomain: "",
			thresholds: Buffer.from([1, 0, 0, 0]),
			signers: [],
			ext: new xdr.AccountEntryExt(0),
		}),
	)
	return { key, xdr: entry.toXDR("base64"), lastModifiedLedgerSeq: 1 }
}

/** Connect the mocked Nido account through the real wallet picker. */
export async function connect(page: Page) {
	await page.goto("/")
	await page.getByRole("button", { name: "Connect", exact: true }).click()
	const popupPromise = page.waitForEvent("popup")
	await page.getByText("Nido", { exact: true }).click()
	const popup = await popupPromise
	await popup.getByRole("button", { name: "Approve test request" }).click()
	await expect(page.locator(".wallet-balance")).toContainText("12.5 XLM")
}
