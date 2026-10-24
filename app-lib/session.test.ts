import { afterEach, describe, expect, it, vi } from "vitest"
import {
	Address,
	Keypair,
	Networks,
	StrKey,
	SorobanDataBuilder,
	nativeToScVal,
	rpc,
	xdr,
} from "@stellar/stellar-sdk"
import {
	activeSession,
	authContexts,
	authPayload,
	checkSession,
	describe as explain,
	explainRefusal,
	grantUrl,
	isOverCap,
	loadSession,
	parseRules,
	requestSession,
	resumeSession,
	ruleIdsFor,
	sessionCovers,
	sessionStatus,
	type Grant,
	type InstalledRule,
	type Session,
} from "./session"

const account = StrKey.encodeContract(Buffer.alloc(32, 1))
const sac = StrKey.encodeContract(Buffer.alloc(32, 2))
const app = StrKey.encodeContract(Buffer.alloc(32, 3))
const signer = Keypair.random().publicKey()

const call = (
	contract: string,
	subInvocations: xdr.SorobanAuthorizedInvocation[] = [],
) =>
	new xdr.SorobanAuthorizedInvocation({
		function:
			xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
				new xdr.InvokeContractArgs({
					contractAddress: new Address(contract).toScAddress(),
					functionName: "f",
					args: [],
				}),
			),
		subInvocations,
	})

afterEach(() => {
	localStorage.clear()
	vi.unstubAllGlobals()
})

describe("session grants", () => {
	it("builds Nido's grant URL on the account's own subdomain", () => {
		const url = new URL(
			grantUrl({
				base: "https://test.nido.fyi",
				account,
				signer,
				grant: {
					target: sac,
					functions: ["transfer"],
					duration: "24h",
					limit: { amount: "2", period: "day" },
					label: "kudos",
				},
				returnUrl: "http://127.0.0.1:5180/board",
			}),
		)
		expect(url.host).toBe(`${account.toLowerCase()}.test.nido.fyi`)
		expect(url.pathname).toBe("/security/delegate-doc/")
		expect(Object.fromEntries(url.searchParams)).toEqual({
			origin: "http://127.0.0.1:5180",
			target: sac,
			signer,
			functions: "transfer",
			duration: "24h",
			limit: "2",
			limit_period: "day",
			label: "kudos",
			return: "http://127.0.0.1:5180/board",
		})
	})
	it("keeps a local wallet's scheme and refuses labels Perch would reject", () => {
		const grant = { target: sac, duration: "7d" as const, label: "x" }
		expect(
			grantUrl({
				base: "http://localhost:4321",
				account,
				signer,
				grant,
				returnUrl: "http://localhost:5180/",
			}),
		).toMatch(/^http:\/\/c[a-z0-9]+\.localhost:4321\//)
		expect(() =>
			grantUrl({
				base: "https://test.nido.fyi",
				account,
				signer,
				grant: { ...grant, label: "a label that is far too long" },
				returnUrl: "http://localhost:5180/",
			}),
		).toThrow(/20 bytes/)
	})
})

describe("session authorization", () => {
	const rules: InstalledRule[] = [
		{
			id: 0,
			name: "admin",
			contract: account,
			delegated: [],
			validUntil: undefined,
		},
		{ id: 3, name: "app", contract: app, delegated: [signer], validUntil: 900 },
		{
			id: 4,
			name: "spend",
			contract: sac,
			delegated: [signer],
			validUntil: 900,
		},
	]
	it("lists authorized contracts in the order __check_auth sees them", () => {
		expect(
			authContexts(call(app, [call(sac), call(app, [call(sac)])])),
		).toEqual([app, sac, app, sac])
	})
	it("selects the signer's unexpired rule for each context", () => {
		expect(ruleIdsFor([app, sac], rules, signer, 900)).toEqual([3, 4])
		expect(() => ruleIdsFor([sac], rules, signer, 901)).toThrow(/expired/)
		expect(() => ruleIdsFor([account], rules, signer, 1)).toThrow(account)
		const other = Keypair.random().publicKey()
		expect(() => ruleIdsFor([sac], rules, other, 1)).toThrow()
	})
	it("encodes the AuthPayload a Perch account expects", () => {
		const payload = authPayload([4], signer)
		const [ids, signers] = payload.map()!
		expect(ids?.key().sym().toString()).toBe("context_rule_ids")
		expect(
			ids
				?.val()
				.vec()
				?.map((v) => v.u32()),
		).toEqual([4])
		expect(signers?.key().sym().toString()).toBe("signers")
		const [entry] = signers!.val().map()!
		const [tag, address] = entry!.key().vec()!
		expect(tag?.sym().toString()).toBe("Delegated")
		expect(Address.fromScVal(address!).toString()).toBe(signer)
		expect(entry!.val().bytes().length).toBe(0)
		expect(xdr.ScVal.fromXDR(payload.toXDR()).toXDR("base64")).toBe(
			payload.toXDR("base64"),
		)
	})
	it("decodes installed_rules in either tuple-enum shape", () => {
		expect(
			parseRules([
				{
					id: 1,
					name: "probe",
					context_type: ["CallContract", sac],
					signers: [["Delegated", signer]],
					valid_until: 5342016,
				},
				{
					id: 0,
					name: "admin",
					context_type: { CallContract: account },
					signers: [{ External: ["C", new Uint8Array(65)] }],
					valid_until: null,
				},
			]),
		).toEqual([
			{
				id: 1,
				name: "probe",
				contract: sac,
				delegated: [signer],
				validUntil: 5342016,
			},
			{
				id: 0,
				name: "admin",
				contract: account,
				delegated: [],
				validUntil: undefined,
			},
		])
	})
	it("explains the refusals a person can act on", () => {
		expect(explainRefusal("HostError: Error(Contract, #3221)")).toMatch(
			/spending cap/,
		)
		expect(explainRefusal("Error(Contract, #3002)")).toMatch(/no approved rule/)
		expect(explainRefusal("network down")).toBe("network down")
	})
})

const hour = 3_600_000
const play: Grant = {
	target: app,
	functions: ["play"],
	duration: "24h",
	label: "play",
}
const spend: Grant = {
	target: sac,
	functions: ["transfer"],
	duration: "24h",
	limit: { amount: "3", period: "day" },
	label: "spend",
}
const key = Keypair.random()
const store = (grants: Session["grants"], extra: Partial<Session> = {}) =>
	localStorage.setItem(
		`scaffold:nido-session:${account}`,
		JSON.stringify({
			account,
			publicKey: key.publicKey(),
			secret: key.secret(),
			grants,
			...extra,
		}),
	)
const visit = (href: string) => {
	const assign = vi.fn()
	const replaceState = vi.fn()
	vi.stubGlobal("window", {
		location: { href, assign },
		history: { replaceState },
	})
	return { assign, replaceState }
}
const resume = (server = {} as rpc.Server) =>
	resumeSession({
		base: "https://test.nido.fyi",
		server,
		networkPassphrase: Networks.TESTNET,
	})

describe("session coverage", () => {
	it("needs the same target, functions and cap, unexpired", () => {
		const now = 1_000 * hour
		const session = {
			account,
			publicKey: signer,
			secret: "S",
			grants: [
				{ ...play, expiresAt: now + hour },
				{ ...spend, expiresAt: now + 2 * hour },
			],
		}
		expect(sessionCovers(session, [play, spend], now)).toMatchObject({
			ask: [],
			expiresAt: now + hour,
		})
		const moved = { ...play, target: sac }
		const wider = { ...play, functions: ["play", "reset"] }
		const capped = { ...spend, limit: { amount: "5", period: "day" as const } }
		expect(sessionCovers(session, [moved, wider, capped], now).ask).toEqual([
			moved,
			wider,
			capped,
		])
		expect(sessionCovers(session, [play], now + hour).expired).toEqual([play])
	})
	it("tells a gate whether to ask, wait, renew or go ahead", () => {
		const now = 1_000 * hour
		expect(sessionStatus(account, [play], now)).toEqual({
			state: "ask",
			ask: [play],
			reason: "new",
		})
		store([{ ...play, expiresAt: now + hour }, spend])
		expect(sessionStatus(account, [play], now).state).toBe("ready")
		expect(sessionStatus(account, [play, spend], now)).toMatchObject({
			state: "waiting",
			waiting: [spend],
		})
		store([{ ...play, expiresAt: now + hour }])
		expect(sessionStatus(account, [play, spend], now)).toMatchObject({
			state: "ask",
			ask: [spend],
			reason: "changed",
		})
		expect(sessionStatus(account, [play], now + hour)).toMatchObject({
			state: "ask",
			reason: "expired",
		})
		expect(activeSession(account, now)).toBeDefined()
		expect(activeSession(account, now + hour)).toBeUndefined()
	})
	it("treats sessions stored before expiry tracking as expired", () => {
		localStorage.setItem(
			`scaffold:nido-session:${account}`,
			JSON.stringify({
				account,
				publicKey: signer,
				secret: "S",
				grants: [play, spend],
				approved: 1,
			}),
		)
		expect(loadSession(account)?.grants).toEqual([
			{ ...play, expiresAt: 0 },
			spend,
		])
	})
})

describe("asking for and resuming a session", () => {
	it("reuses the app's key and replaces a grant asked for again", async () => {
		const friendbot = vi.fn()
		vi.stubGlobal("fetch", friendbot)
		store([{ ...play, expiresAt: 1 }])
		const { assign } = visit("http://127.0.0.1:5180/board?x=1#top")
		void requestSession({
			account,
			grants: [play, spend],
			base: "https://test.nido.fyi",
			friendbotUrl: (a) => a,
		})
		await vi.waitFor(() => expect(assign).toHaveBeenCalled())
		expect(friendbot).not.toHaveBeenCalled()
		const url = new URL(assign.mock.calls[0]![0] as string)
		expect(url.searchParams.get("signer")).toBe(key.publicKey())
		expect(url.searchParams.get("label")).toBe("play")
		expect(url.searchParams.get("return")).toBe("http://127.0.0.1:5180/board")
		expect(loadSession(account)?.grants).toEqual([play, spend])
	})
	it("funds a new key only for the first request", async () => {
		const friendbot = vi.fn().mockResolvedValue({ ok: true })
		vi.stubGlobal("fetch", friendbot)
		const { assign } = visit("http://127.0.0.1:5180/")
		void requestSession({
			account,
			grants: [play],
			base: "https://test.nido.fyi",
			friendbotUrl: (a) => `https://friendbot/?addr=${a}`,
		})
		await vi.waitFor(() => expect(assign).toHaveBeenCalled())
		const session = loadSession(account)!
		expect(friendbot).toHaveBeenCalledWith(
			`https://friendbot/?addr=${session.publicKey}`,
		)
	})
	it("records ok answers and moves on to the next grant", async () => {
		store([play, spend])
		localStorage.setItem("scaffold:nido-session:pending", account)
		const first = visit("http://127.0.0.1:5180/?delegation=ok")
		expect(await resume()).toEqual({ account, outcome: "next-grant" })
		expect(first.assign.mock.calls[0]?.[0]).toContain("label=spend")
		visit("http://127.0.0.1:5180/#delegation=ok")
		expect((await resume())?.outcome).toBe("approved")
		const [a, b] = loadSession(account)!.grants
		expect(a!.expiresAt! - Date.now()).toBeGreaterThan(23 * hour)
		expect(b!.expiresAt).toBeDefined()
		expect(await resume()).toBeNull()
	})
	it("keeps the key and approved grants when the owner cancels", async () => {
		store([{ ...play, expiresAt: Date.now() + hour }, spend])
		localStorage.setItem("scaffold:nido-session:pending", account)
		const { replaceState } = visit(
			"http://127.0.0.1:5180/?delegation=cancelled",
		)
		expect((await resume())?.outcome).toBe("cancelled")
		expect(loadSession(account)?.grants.map((g) => g.label)).toEqual(["play"])
		expect(String(replaceState.mock.calls.at(-1)?.[2])).not.toContain(
			"delegation",
		)
	})
	it("reports a relayer refusal and leaves the grant waiting", async () => {
		store([spend])
		localStorage.setItem("scaffold:nido-session:pending", account)
		visit("http://127.0.0.1:5180/?delegation=error&code=FEE_LIMIT_EXCEEDED")
		expect(await resume()).toMatchObject({
			outcome: "refused",
			message: expect.stringMatching(/budget is used up.*nothing was sent/),
		})
		expect(sessionStatus(account, [spend])).toMatchObject({
			state: "waiting",
			session: { refused: "FEE_LIMIT_EXCEEDED" },
		})
	})
})

describe("paying for a refused approval with the app's key", () => {
	const applyDoc = (target: string, by: string) => ({
		func: xdr.HostFunction.hostFunctionTypeInvokeContract(
			new xdr.InvokeContractArgs({
				contractAddress: new Address(target).toScAddress(),
				functionName: "apply_doc",
				args: [nativeToScVal("doc")],
			}),
		).toXDR("base64"),
		auth: [
			new xdr.SorobanAuthorizationEntry({
				credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
					new xdr.SorobanAddressCredentials({
						address: new Address(by).toScAddress(),
						nonce: xdr.Int64.fromString("1"),
						signatureExpirationLedger: 99,
						signature: nativeToScVal("passkey"),
					}),
				),
				rootInvocation: call(target),
			}).toXDR("base64"),
		],
	})
	const encode = (payload: object) =>
		Buffer.from(JSON.stringify(payload)).toString("base64url")
	const network = () => {
		const sent: string[] = []
		const server = {
			getAccount: vi.fn(async (id: string) => ({
				accountId: () => id,
				sequenceNumber: () => "1",
				incrementSequenceNumber: () => {},
			})),
			simulateTransaction: vi.fn(async () =>
				rpc.parseRawSimulation({
					id: "1",
					latestLedger: 10,
					minResourceFee: "100",
					transactionData: new SorobanDataBuilder().build().toXDR("base64"),
					results: [{ auth: [], xdr: nativeToScVal(null).toXDR("base64") }],
				} as unknown as rpc.Api.RawSimulateTransactionResponse),
			),
			sendTransaction: vi.fn(async (tx: { toXDR: () => string }) => {
				sent.push(tx.toXDR())
				return { status: "PENDING", hash: "cd".repeat(32) }
			}),
			pollTransaction: vi.fn(async () => ({ status: "SUCCESS" })),
		}
		return { server: server as unknown as rpc.Server, sent }
	}
	it("submits the passkey-signed call itself and approves the grant", async () => {
		store([spend])
		localStorage.setItem("scaffold:nido-session:pending", account)
		const { server, sent } = network()
		visit(
			`http://127.0.0.1:5180/?delegation=signed#payload=${encode(applyDoc(account, account))}`,
		)
		expect(await resume(server)).toEqual({
			account,
			outcome: "approved",
			hash: "cd".repeat(32),
		})
		const envelope = xdr.TransactionEnvelope.fromXDR(sent[0]!, "base64")
		const tx = envelope.v1().tx()
		expect(StrKey.encodeEd25519PublicKey(tx.sourceAccount().ed25519())).toBe(
			key.publicKey(),
		)
		const [entry] = tx.operations()[0]!.body().invokeHostFunctionOp().auth()
		expect(entry!.credentials().address().signature().str().toString()).toBe(
			"passkey",
		)
		expect(envelope.v1().signatures()).toHaveLength(1)
	})
	it("refuses a payload that is not a change to the pending account", async () => {
		for (const payload of [applyDoc(app, account), applyDoc(account, app)]) {
			store([spend])
			localStorage.setItem("scaffold:nido-session:pending", account)
			const { server, sent } = network()
			visit(
				`http://127.0.0.1:5180/?delegation=signed&payload=${encode(payload)}`,
			)
			expect(await resume(server)).toMatchObject({
				outcome: "refused",
				message: "Nido's signed approval is not a change to your account",
			})
			expect(sent).toHaveLength(0)
		}
	})
})

describe("checking the chain for what landed", () => {
	it("approves grants found on chain and drops replaced ones", async () => {
		store([{ ...play, expiresAt: Date.now() + hour }, spend])
		localStorage.setItem("scaffold:nido-session:pending", account)
		const rules = [
			// `play` now names another key: someone approved it again elsewhere
			{
				id: 2,
				name: "play",
				context_type: ["CallContract", app],
				signers: [["Delegated", signer]],
				valid_until: 2_000,
			},
			{
				id: 3,
				name: "spend",
				context_type: ["CallContract", sac],
				signers: [["Delegated", key.publicKey()]],
				valid_until: 1_720,
			},
		]
		const server = {
			getAccount: vi.fn(async (id: string) => ({
				accountId: () => id,
				sequenceNumber: () => "1",
				incrementSequenceNumber: () => {},
			})),
			simulateTransaction: vi.fn(async () => ({
				latestLedger: 1_000,
				transactionData: {},
				result: {
					retval: nativeToScVal(rules, {
						type: {
							id: ["symbol", "u32"],
							valid_until: ["symbol", "u32"],
						},
					}),
				},
			})),
		} as unknown as rpc.Server
		expect(await checkSession(account, server, Networks.TESTNET)).toEqual({
			approved: 1,
			waiting: 0,
		})
		const [grant] = loadSession(account)!.grants
		expect(grant!.label).toBe("spend")
		// 720 ledgers of five seconds is an hour
		expect(Math.round((grant!.expiresAt! - Date.now()) / 60_000)).toBe(60)
		expect(localStorage.getItem("scaffold:nido-session:pending")).toBeNull()
	})
})

describe("describing errors", () => {
	it("maps account refusals, relayer codes and the app's own errors", () => {
		const errors = { 4: { message: "Already claimed" }, 5: "Sold out" }
		expect(explain(new Error("Error(Contract, #3221)"))).toMatch(/cap/)
		// Still recognisable after submitWithSession has explained it
		expect(isOverCap(new Error(explainRefusal("Error(Contract, #3221)")))).toBe(
			true,
		)
		expect(isOverCap("Error(Contract, #3002)")).toBe(false)
		expect(explain("relay: FEE_LIMIT_EXCEEDED")).toMatch(/budget/)
		expect(explain("POOL_CAPACITY")).toMatch(/busy/)
		expect(explain("HostError: Error(Contract, #4)", errors)).toBe(
			"The contract refused: Already claimed",
		)
		expect(explain("Error(Contract, #5)", errors)).toMatch(/Sold out/)
		expect(
			explain("Error(Auth, InvalidAction) Error(Contract, #4)", errors),
		).not.toMatch(/Already claimed/)
		expect(explain("Error(Contract, #9)", errors)).toBe("Error(Contract, #9)")
	})
})
