import {
	activeSession,
	forgetSession,
	isSmartAccount,
} from "@stellar-scaffold/app-lib"
import { useSessionClock } from "../hooks/useSessionStatus"
import { useWallet } from "../hooks/useWallet"

const time = new Intl.DateTimeFormat(undefined, {
	weekday: "short",
	hour: "numeric",
	minute: "2-digit",
})

/** One line, once per page, while this app holds a session key for the
 * connected Nido account. */
export const SessionNote = () => {
	const { address } = useWallet()
	const now = useSessionClock()
	const session =
		address && isSmartAccount(address) ? activeSession(address, now) : undefined
	if (!address || !session) return null
	const until = Math.min(
		...session.grants.flatMap((g) =>
			g.expiresAt && g.expiresAt > now ? [g.expiresAt] : [],
		),
	)
	return (
		<p className="session-note">
			This app holds a session key for your account
			{until < Number.MAX_SAFE_INTEGER &&
				`, approved until ${time.format(until)}`}
			.{" "}
			<button
				type="button"
				title="Deletes this browser's copy of the key. The rules stay on your account until they expire; approving again replaces them."
				onClick={() => forgetSession(address)}
			>
				Forget it
			</button>
		</p>
	)
}
