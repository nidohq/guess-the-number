import { expect, it, vi } from "vitest"
vi.mock("./clients", () => ({
	options: {
		networkPassphrase: "Public Global Stellar Network ; September 2015",
		rpcUrl: "https://mainnet.sorobanrpc.com",
		allowHttp: false,
	},
}))
import { network, transactionUrl, labPrefix } from "./env"
import { getFriendbotUrl } from "./friendbot"
it("mainnet labels, explorers and faucet policy match the client", () => {
	expect(network.id).toBe("mainnet")
	expect(network.label).toBe("Mainnet")
	expect(transactionUrl("ab".repeat(32))).toBe(
		`https://stellar.expert/explorer/public/tx/${"ab".repeat(32)}`,
	)
	expect(labPrefix()).toContain("id=mainnet")
	expect(() => getFriendbotUrl("account")).toThrow("not available")
})
