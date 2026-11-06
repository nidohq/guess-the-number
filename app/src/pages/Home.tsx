import { network } from "@stellar-scaffold/app-lib"
import { guessTheNumber } from "@stellar-scaffold/app-lib/clients"
import { GuessTheNumber } from "../components/GuessTheNumber"
import styles from "./Home.module.css"

export default function Home() {
	return (
		<div className={styles.Home}>
			<h1>Guess the Number</h1>
			<p>
				<strong>{network.label}</strong> ·{" "}
				{network.id === "mainnet"
					? "Real XLM. Each wrong guess costs 1 XLM."
					: "Test XLM only. Each wrong guess costs 1 XLM."}
			</p>
			<div className="card">
				<h2>Pick a number from 1 to 10</h2>
				<p>
					A correct guess wins the game’s available XLM pot. Connect your
					wallet, approve the game’s scoped permission, then confirm each guess
					with your device. A win is not guaranteed.
				</p>
				<GuessTheNumber />
			</div>
			<p className="session-note">
				Game contract:{" "}
				<code style={{ overflowWrap: "anywhere" }}>
					{guessTheNumber.options.contractId}
				</code>
			</p>
		</div>
	)
}
