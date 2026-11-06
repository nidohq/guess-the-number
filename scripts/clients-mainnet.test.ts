import { describe, expect, it, vi } from "vitest"
import { Networks, StrKey } from "@stellar/stellar-sdk"
import { validateMainnetId, verifyMainnet } from "./clients-mainnet.mjs"

const id = StrKey.encodeContract(Buffer.alloc(32, 7))
describe("mainnet client preflight", () => {
	it("rejects absent, invalid, placeholder and testnet IDs", () => {
		for (const candidate of [
			undefined,
			"C...",
			id,
			"CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
		])
			expect(() => validateMainnetId(candidate, id)).toThrow()
		expect(validateMainnetId(id, "different")).toBe(id)
	})
	it("checks RPC network before querying deployment, without writes", async () => {
		const server = {
			getNetwork: vi.fn().mockResolvedValue({ passphrase: Networks.TESTNET }),
			getLedgerEntries: vi.fn(),
		}
		await expect(verifyMainnet(id, server)).rejects.toThrow("network mismatch")
		expect(server.getLedgerEntries).not.toHaveBeenCalled()
	})
	it("requires an existing mainnet contract instance", async () => {
		const server = {
			getNetwork: vi.fn().mockResolvedValue({ passphrase: Networks.PUBLIC }),
			getLedgerEntries: vi.fn().mockResolvedValue({ entries: [] }),
		}
		await expect(verifyMainnet(id, server)).rejects.toThrow(
			"absent or archived",
		)
		server.getLedgerEntries.mockResolvedValue({ entries: [{}] })
		await expect(verifyMainnet(id, server)).resolves.toBeUndefined()
	})
})
