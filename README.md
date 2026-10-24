# Guess the Number: the Nido scaffold example

**Live: <https://nidohq.github.io/guess-the-number/>** (Stellar testnet)

This is the app you get from the
[nidohq/scaffold-template](https://github.com/nidohq/scaffold-template), built
and published as it comes. People sign in with a passkey: a
[Nido](https://test.nido.fyi) smart account sits in the wallet picker, the
player approves the game once, and then plays without prompts. Each wrong guess
costs 1 XLM, and the session the player approves caps the game at 2 XLM a day,
so two wrong guesses go through and the account refuses the third before
anything is sent. Testnet only.

## How it was made

```sh
stellar scaffold init --template nidohq/scaffold-template nido-example --yes
cd nido-example
npm run tools:scaffold && npm ci && npm run doctor
npm run clients:testnet
```

That is template commit
[`1d01f65`](https://github.com/nidohq/scaffold-template/commit/1d01f6593076e24e74e0b64f4392571e13392c1d)
with stellar-scaffold 0.0.31 and the Stellar CLI 27.0.0. The first commit in
this repository is that output unchanged. The commit after it carries everything
this example changes:

- the package name (`guess-the-number-example`), the page title, and this
  README;
- the dev port, `PORT=5542` in `.env.example`, which is the port
  `npm run new-app` gives an app named guess-the-number. A Nido session key
  lives in the origin's storage, so the example doesn't share one with a fresh
  app on the template's 5173;
- `package-lock.json` as it is after `npm run clients:testnet`, so the quick
  start leaves the checkout clean;
- GitHub Pages: `BASE_PATH` sets Vite's `base`, the router takes the same base,
  the build copies `index.html` to `404.html` so a refresh on `/debug` still
  loads the app, and
  [`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds and
  deploys on every push to `main`.

The contract is the shared testnet sample deployment pinned under `testnet:` in
[`scaffold.yml`](scaffold.yml). Nothing here deploys a contract.

## Run it locally

You need Node 22.12+, Rust with the `wasm32v1-none` target and the
[Stellar CLI](https://developers.stellar.org/docs/tools/cli/install-cli).

```sh
cp .env.example .env
npm run tools:scaffold && npm ci && npm run doctor
npm run clients:testnet && npm run dev    # http://localhost:5542
```

To check the build that Pages serves, under the same path:

```sh
export BASE_PATH=/guess-the-number/   # `vite preview` serves under it too
npm run build
npm exec --workspace app -- vite preview --host 127.0.0.1   # http://127.0.0.1:5542/guess-the-number/
```

Open the app, press Connect and choose Nido. Without a Nido account yet, the
popup sends you to create one on test.nido.fyi: one passkey, and it arrives with
5 test XLM. A first connect that ends with "Wallet connection was cancelled or
failed" after creating the account is a known rough edge; press Connect again
and pick the new account. Then approve the session (one passkey confirmation for
each of its two rules) and guess.

## Deploying to GitHub Pages

Set the repository's Pages source to "GitHub Actions". The workflow runs the
quick start above on a fresh runner (its `testnet-user` key is a throwaway that
Friendbot funds in that job), then lint, format check and unit tests, then
`npm run build` with `BASE_PATH` from `actions/configure-pages`, and deploys
`app/dist` with `actions/deploy-pages`.

Nido needs no configuration for a new origin. Its connect, signing and grant
pages accept any `https` dapp origin (plain `http` only on loopback) as long as
the return URL has the same origin, and the passkeys belong to Nido's own
account subdomains, not to the app. One thing to know about Pages: every
`nidohq.github.io/<repo>/` site shares the origin `https://nidohq.github.io`.
The app keeps its session key in that origin's `localStorage`, and Nido's
approval page names the origin, not the path, so any other Pages site under
nidohq could read this app's session key and would look the same on Nido's
approval page. A custom domain gives the app an origin of its own.

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
