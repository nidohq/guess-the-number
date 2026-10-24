import {
	checkAppSession,
	describe,
	forgetSession,
	requestAppSession,
	type Grant,
} from "@stellar-scaffold/app-lib"
import { useState, type ReactNode } from "react"
import { useNotification } from "../hooks/useNotification"
import { useSessionStatus } from "../hooks/useSessionStatus"
import { useWallet } from "../hooks/useWallet"

const confirmations = (n: number) =>
	`${n} ${n === 1 ? "confirmation" : "confirmations"}`

/**
 * A Nido account approves an app once, as a session: rules in the account's
 * own policy that let this app's key make the listed calls until they expire
 * (see app-lib/session.ts). Shows `children` for classic wallets and once the
 * account's approvals cover `grants`; until then it explains what will be
 * asked and sends the owner to Nido for the grants still missing, expired, or
 * waiting for an answer. With `actionsOnly`, `children` stay visible and only
 * their buttons and inputs are disabled.
 */
export const SessionGate = ({
	grants,
	explain,
	actionsOnly = false,
	children,
}: {
	grants: Grant[]
	explain: ReactNode
	actionsOnly?: boolean
	children: ReactNode
}) => {
	const { address } = useWallet()
	const { addNotification } = useNotification()
	const status = useSessionStatus(address, grants)
	const [busy, setBusy] = useState<string>()
	if (!address || !status || status.state === "ready") return children

	const fail = (error: unknown) => {
		setBusy(undefined)
		addNotification(describe(error), "error")
	}
	// Friendbot funds a new key first, which can take half a minute; keep the
	// button out of reach so a second click doesn't mint a second key.
	const ask = (toAsk: Grant[], message: string) => {
		setBusy(message)
		void requestAppSession(address, toAsk).catch(fail)
	}
	const check = async () => {
		setBusy("Checking your account on chain…")
		try {
			const { waiting } = await checkAppSession(address)
			setBusy(undefined)
			if (waiting)
				addNotification(
					"Nothing was applied yet, so it is safe to ask Nido again.",
					"warning",
				)
			else addNotification("Your account has the rules. Ready.", "success")
		} catch (error) {
			fail(error)
		}
	}

	let card: ReactNode
	if (status.state === "waiting") {
		const { waiting, session } = status
		card = (
			<>
				<p>
					Nido has not confirmed{" "}
					{waiting.map((g) => (
						<code key={g.label}>{g.label}</code>
					))}{" "}
					yet. If its page reported an error, check your account first: an
					approval can land even when the page says it couldn&apos;t confirm.
				</p>
				{session.refused && <p role="alert">{describe(session.refused)}</p>}
				<div className="session-actions">
					<button type="button" onClick={() => void check()}>
						Check again
					</button>
					<button type="button" onClick={() => ask(waiting, "Opening Nido…")}>
						Ask Nido again ({confirmations(waiting.length)})
					</button>
					<button type="button" onClick={() => forgetSession(address)}>
						Start over
					</button>
				</div>
			</>
		)
	} else
		card = (
			<>
				{status.reason === "expired" && (
					<p>This app&apos;s approval expired.</p>
				)}
				{status.reason === "changed" && (
					<p>This needs more than you approved for this app so far.</p>
				)}
				{explain}
				<button
					type="button"
					onClick={() =>
						ask(
							status.ask,
							status.reason === "new"
								? "Preparing a key for this app…"
								: "Opening Nido…",
						)
					}
				>
					{status.reason === "expired" ? "Renew" : "Approve"} with Nido (
					{confirmations(status.ask.length)})
				</button>
			</>
		)

	return (
		<>
			<div className="card session-gate" aria-busy={Boolean(busy)}>
				{busy ? <p role="status">{busy}</p> : card}
			</div>
			{actionsOnly && (
				<fieldset className="session-gated" disabled>
					{children}
				</fieldset>
			)}
		</>
	)
}
