import {
	describe,
	isOverCap,
	submitCall,
	xlmTokenId,
	type Grant,
} from "@stellar-scaffold/app-lib"
import { guessTheNumber } from "@stellar-scaffold/app-lib/clients"
import { useState } from "react"
import { useWallet } from "../hooks/useWallet"
import { SessionGate } from "./SessionGate"

// A wrong guess calls `guess` and moves 1 XLM from the guesser, so a Nido
// account approves one rule for each contract the call touches. The XLM rule
// caps spending at 2 XLM a day: two wrong guesses go through without a prompt
// and the account refuses the third. The cap's day matches the session's 24
// hours, so it is also the most one approval can ever spend.
const dailyCap = 2
const grants: Grant[] = [
	{
		target: guessTheNumber.options.contractId,
		functions: ["guess"],
		duration: "24h",
		label: "guess",
	},
	{
		target: xlmTokenId,
		functions: ["transfer"],
		duration: "24h",
		limit: { amount: String(dailyCap), period: "day" },
		label: "guess-xlm",
	},
]

export const GuessTheNumber = () => {
	const { address, updateBalances } = useWallet()
	const [error, setError] = useState<string>()
	const [hash, setHash] = useState<string>()
	const [result, setResult] = useState<
		"idle" | "loading" | "success" | "failure"
	>("idle")

	const submitGuess = async (formData: FormData) => {
		const guess = formData.get("guess")
		if (!address || typeof guess != "string" || !guess) {
			setResult("failure")
			return
		}
		setResult("loading")
		setError(undefined)
		try {
			// No await before submitCall: Nido's popup needs the click's gesture
			const { result, hash } = await submitCall(address, (publicKey) =>
				guessTheNumber.guess(
					{ a_number: BigInt(guess), guesser: address },
					{ publicKey },
				),
			)
			setHash(hash)
			if (result.isErr()) {
				setError(result.unwrapErr().message)
				setResult("failure")
			} else {
				setResult(result.unwrap() ? "success" : "failure")
				await updateBalances()
			}
		} catch (e) {
			console.error(e)
			setError(
				isOverCap(e)
					? `That's the ${dailyCap} XLM a day you let this game spend, so your account stopped this guess before anything was sent. It cost nothing. Come back tomorrow for more guesses.`
					: describe(e),
			)
			setResult("failure")
		}
	}

	const reset = () => {
		setResult("idle")
		setError(undefined)
		setHash(undefined)
	}

	return (
		<div className="guess-the-number">
			<SessionGate
				grants={grants}
				explain={
					<p>
						Each wrong guess costs 1 XLM. Approve this game once and it can
						guess for you for 24 hours without asking again, spending at most{" "}
						{dailyCap} XLM a day from your account: {dailyCap} wrong guesses,
						then your account says no. Nido asks you to confirm two rules: the
						first allows only <code>guess</code>, without a cap; the second caps
						the XLM.
					</p>
				}
			>
				<form action={submitGuess}>
					<input
						placeholder="Guess a number from 1 to 10!"
						id="guess"
						name="guess"
						type="number"
						min="1"
						max="10"
						onChange={reset}
					/>
					<button type="submit" disabled={result === "loading"}>
						Submit
					</button>
				</form>
			</SessionGate>

			{result === "success" && (
				<div className="card guess-result guess-result--success">
					<p>
						You got it! Play again by calling <code>reset</code> in the Contract
						Explorer.
					</p>
				</div>
			)}
			{result === "failure" && (
				<div className="card guess-result guess-result--failure">
					{error ? (
						<p role="alert">{error}</p>
					) : !address ? (
						<p>Connect to your wallet in order to guess.</p>
					) : (
						<p>Incorrect guess: that cost 1 XLM. Try again!</p>
					)}
				</div>
			)}
			{hash && result !== "loading" && (
				<p className="session-note">
					Transaction <code>{hash}</code>
				</p>
			)}
		</div>
	)
}
