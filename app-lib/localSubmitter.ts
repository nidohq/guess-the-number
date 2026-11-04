// Local-submitter mode: session calls never go to a relayer. A G keypair kept
// in this origin's localStorage, funded by testnet Friendbot, is the source
// and fee payer of each signed session call, which goes straight to RPC.
//
// It matches the Nido preview wallet this branch points at, which runs a
// separate testnet deployment (the M6 Perch stack) without Nido's shared
// relayer and submits its own transactions the same way. Testnet only:
// Friendbot has no mainnet equivalent. The key can pay fees and nothing
// else: the account's rules name the app's passkey, not this key.
import { Keypair, rpc, type Transaction } from "@stellar/stellar-sdk"

const STORAGE = "scaffold:nido-local-submitter"
const FRIENDBOT = "https://friendbot.stellar.org/?addr="

let submitter: Promise<Keypair> | undefined

async function fundedKeypair(server: rpc.Server): Promise<Keypair> {
	const stored = localStorage.getItem(STORAGE)
	const key = stored ? Keypair.fromSecret(stored) : Keypair.random()
	if (!stored) localStorage.setItem(STORAGE, key.secret())
	const exists = await server.getAccount(key.publicKey()).then(
		() => true,
		() => false,
	)
	if (!exists) {
		const response = await fetch(FRIENDBOT + key.publicKey())
		if (!response.ok)
			throw new Error(
				`Friendbot could not fund this browser's submitter (HTTP ${response.status})`,
			)
	}
	return key
}

/** This browser's submitter, made and funded once per page even when several
 * calls ask for it at the same time. */
export function localSubmitter(server: rpc.Server): Promise<Keypair> {
	submitter ??= fundedKeypair(server).catch((error: unknown) => {
		submitter = undefined
		throw error
	})
	return submitter
}

/** Sign `tx` (built with `key` as its source) with the resources and fee of
 * its enforcing simulation, send it, and return its hash. */
export async function submitLocally(
	tx: Transaction,
	simulation: rpc.Api.SimulateTransactionSuccessResponse,
	key: Keypair,
	server: rpc.Server,
): Promise<string> {
	const ready = rpc.assembleTransaction(tx, simulation).build()
	ready.sign(key)
	const sent = await server.sendTransaction(ready)
	if (sent.status === "ERROR")
		throw new Error(
			`The network refused the transaction: ${sent.errorResult?.result().switch().name ?? "no reason given"}`,
		)
	return sent.hash
}
