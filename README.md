# Guess the Number: the Nido scaffold example

**Live: <https://nidohq.github.io/guess-the-number/>** (Stellar testnet)

This is the app you get from the
[nidohq/scaffold-template](https://github.com/nidohq/scaffold-template), built
and published as it comes. People sign in with a passkey: a
[Nido](https://test.nido.fyi) smart account sits in the wallet picker. The app
makes a second passkey of its own, and the player approves it once, in one Nido
popup, to call `guess` and to pay the game up to 2 XLM a day. Each guess then
takes one device passkey prompt and no Nido page. A wrong guess costs 1 XLM, so
two go through and the account refuses the third before anything is sent. The
published site remains testnet; this source also supports a mainnet build.

> Until 2026-10-24 the site used Nido's preview of
> [nidohq/nido#318](https://github.com/nidohq/nido/pull/318); it now uses
> https://test.nido.fyi. A Nido account made on the preview does not open on
> test.nido.fyi (a Nido passkey belongs to its account's own host), so create a
> new one from the app's connect popup.

## How it was made

```sh
stellar scaffold init --template nidohq/scaffold-template nido-example --yes
cd nido-example
npm run tools:scaffold && npm ci && npm run doctor
npm run clients:testnet
```

That is template `main` at
[`6f41265`](https://github.com/nidohq/scaffold-template/commit/6f41265a4225703c057d6d04e07c3594a1a3972f)
([nidohq/scaffold-template#11](https://github.com/nidohq/scaffold-template/pull/11),
the passkey session), with stellar-scaffold 0.0.31 and the Stellar CLI 27.0.0.
In this repository's history, "Regenerate from nidohq/scaffold-template@6f41265"
is the template's files unchanged, and the commit after it carries everything
this example changes:

- the package name (`guess-the-number-example`), the page title, and this
  README;
- the dev port, `PORT=5542` in `.env.example`, which is the port
  `npm run new-app` gives an app named guess-the-number. Sessions live in the
  origin's storage, so the example doesn't share one with a fresh app on the
  template's 5173;
- `package-lock.json` as it is after `npm run clients:testnet`, so the quick
  start leaves the checkout clean;
- GitHub Pages: `BASE_PATH` sets Vite's `base`, the router takes the same base,
  the build copies `index.html` to `404.html` so a refresh on `/debug` still
  loads the app, and
  [`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds and
  deploys on every push to `main`.

Earlier commits are the same example made from template `1d01f65`, before the
app passkey, and from `478828a`, an earlier state of #11 before it merged. The
contract is the shared testnet sample deployment pinned under `testnet:` in
[`scaffold.yml`](scaffold.yml). Nothing here deploys a contract.

## Run it locally

You need Node 22.12+, Rust with the `wasm32v1-none` target and the
[Stellar CLI](https://developers.stellar.org/docs/tools/cli/install-cli).

```sh
cp .env.example .env
npm run tools:scaffold && npm ci && npm run doctor
npm run clients:testnet && npm run dev    # http://localhost:5542
```

Open it at `localhost`, not `127.0.0.1`: browsers refuse passkeys on an IP
address. To check the build that Pages serves, under the same path:

```sh
export BASE_PATH=/guess-the-number/   # `vite preview` serves under it too
npm run build
npm exec --workspace app -- vite preview   # http://localhost:5542/guess-the-number/
```

Press Connect and choose Nido. Without a Nido account yet, the popup sends you
to create one: one passkey, and it arrives with 5 test XLM. A first connect that
ends with "Wallet connection was cancelled or failed" after creating the account
is a known rough edge; press Connect again and pick the new account. Then make
the app's passkey, approve the session in Nido's popup (one confirmation), and
guess.

## Deploying to GitHub Pages

The repository's Pages source is "GitHub Actions". The workflow runs the quick
start above on a fresh runner (its `testnet-user` key is a throwaway that
Friendbot funds in that job), then lint, format check and unit tests, then
`npm run build` with `BASE_PATH` from `actions/configure-pages`, and deploys
`app/dist` with `actions/deploy-pages`.

Nido needs no configuration for a new origin. Its connect, signing and grant
pages accept any `https` app origin (plain `http` only on loopback) as long as
the return URL has the same origin. Two things to know about Pages, because
every `nidohq.github.io/<repo>/` site, Nido's own example included, shares the
origin `https://nidohq.github.io`:

- The app keeps its session in that origin's `localStorage`, so any other Pages
  site under nidohq can read it, and Nido's approval page names the origin, not
  the path.
- The app's passkey is made for the host `nidohq.github.io`, so the device's
  passkey list shows it under that name, next to passkeys other nidohq Pages
  sites make.

A custom domain gives the app an origin and a passkey host of its own.

## Building on it

- [`NIDO.md`](NIDO.md): the template's guide. The quick start, your own contract
  in five steps, the call pattern, the rules a Nido account follows, and what to
  do when Nido's relayer says no.
- [`AGENTS.md`](AGENTS.md): the same rules for coding agents.
- [`CONTRIBUTING.md`](CONTRIBUTING.md), `CHANGELOG.md`, `scripts/new-app.mjs`
  and `scripts/blank/` came with the template; they describe the template, not
  this app.

Nido is at <https://github.com/nidohq/nido>; the Perch policy language its
accounts enforce is at <https://github.com/stellar-registry/perch>.

The one secret key in the tree, in
[`.github/workflows/build.yml`](.github/workflows/build.yml), comes unchanged
from the public upstream
[stellar-scaffold/ui](https://github.com/stellar-scaffold/ui) workflow: it funds
a throwaway identity on the CI job's local quickstart network.

[License](LICENSE) · [Security](SECURITY.md) ·
[Code of conduct](CODE_OF_CONDUCT.md)

## Mainnet build and recording

Network selection is **per build**, from generated clients. The page and header
identify the selected network; there is no in-page switch. Mainnet uses
`https://nido.fyi`, `https://nido-mainnet.fly.dev`, and
`https://mainnet.sorobanrpc.com`. Testnet keeps its existing endpoints. Leave
`PUBLIC_NIDO_BASE` and `PUBLIC_NIDO_RELAYER` unset unless intentionally
overriding both for a deployment on the same network. Stale hosted testnet
overrides are rejected. Session approvals are isolated by network.

No mainnet game ID is shipped. Obtain a reviewed deployment of this contract
(including unconditional guesser auth and mainnet XLM binding), with a funded
pot, before building. Its admin must own the reset/refill workflow. The command
pins the verified address under `mainnet:` in `scaffold.yml`. Client preflight
verifies the RPC passphrase and live contract instance, **not** its code
identity or funding; those must be reviewed separately.

```sh
# Existing deployment only: no keys, Friendbot, upload, or deploy.
MAINNET_GAME_ID=<reviewed-contract-address> npm run clients:mainnet
npm run build
npm exec --workspace app -- vite preview --host localhost --port 5542
```

Do not run the default `npm run dev` after this command: its watcher follows
`STELLAR_NETWORK` (testnet by default) and would regenerate testnet clients.
Serve the build above, or explicitly use the mainnet network when regenerating.
The Pages workflow still publishes testnet; publishing a mainnet build is a
separate operator action.

For a no-funds layout rehearsal (no usable deployment or permission requests):

```sh
npm run prepare:prototype -- --mainnet
npm run build
npm exec --workspace app -- vite preview --host localhost --port 5542
```

The page explicitly labels this as a rehearsal and disables guesses and grants.
Use `npm run prepare:prototype` for the existing mocked testnet browser suite. A
live recording requires a funded mainnet wallet and funded game: connect,
approve `guess` plus XLM `transfer` restricted to the game (2 XLM/day, 24
hours), then confirm a guess. A loss costs 1 XLM; a win pays the available pot.
Show the result and **View transaction** link. Do not promise a win or ask a
player to reset the game: reset is admin-only.
