// Read-only client generation. Never creates keys, funds, or deploys a contract.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { Contract, Networks, StrKey, rpc } from "@stellar/stellar-sdk"
import { parseDocument } from "yaml"
import { root, toolEnv } from "./tools.mjs"

export function validateMainnetId(id, testnetId) {
	if (!id || !StrKey.isValidContract(id))
		throw new Error(
			"Set MAINNET_GAME_ID to the reviewed mainnet Guess the Number deployment address.",
		)
	if (
		id === testnetId ||
		id === "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"
	)
		throw new Error(
			"MAINNET_GAME_ID must not be the testnet deployment or rehearsal placeholder.",
		)
	return id
}

export async function verifyMainnet(id, server) {
	const network = await server.getNetwork()
	if (network.passphrase !== Networks.PUBLIC)
		throw new Error("RPC network mismatch: expected Stellar mainnet.")
	const entries = await server.getLedgerEntries(new Contract(id).getFootprint())
	if (!entries.entries.length)
		throw new Error(
			"Mainnet game contract is absent or archived. Supply a live, reviewed deployment before building.",
		)
}

async function main() {
	const document = parseDocument(readFileSync(`${root}/scaffold.yml`, "utf8"))
	const config = document.toJS()
	const id = validateMainnetId(
		process.env.MAINNET_GAME_ID,
		config.contracts["guess-the-number"].networks.testnet.source,
	)
	await verifyMainnet(id, new rpc.Server(config.networks.mainnet["rpc-url"]))
	// Pin only after read-only verification. Preserve scaffold.yml's comments.
	document.setIn(["contracts", "guess-the-number", "networks", "mainnet"], {
		type: "contract",
		source: id,
	})
	writeFileSync(`${root}/scaffold.yml`, document.toString())
	execFileSync(
		process.execPath,
		[
			"scripts/stellar.mjs",
			"scaffold",
			"build",
			"--build-clients",
			"--network",
			"mainnet",
		],
		{
			cwd: root,
			stdio: "inherit",
			env: toolEnv(),
		},
	)
	execFileSync(process.execPath, ["scripts/link-clients.mjs"], {
		cwd: root,
		stdio: "inherit",
	})
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	main().catch((error) => {
		console.error(error.message)
		process.exitCode = 1
	})
