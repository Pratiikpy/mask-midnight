# Mask

**Private checkout for businesses and AI agents on Midnight.** The payer, the payee and the amount
of an invoice are not on the chain, and a merchant can still prove to a bank, a landlord or a tax
office exactly what they need to, without handing over a ledger.

Licensed Apache-2.0. Built for the Midnight Buildathon.

**Video:** [Mask, recorded through a real Lace wallet on Midnight Preview](https://youtu.be/Oa36z4e-AyM). Gift cards and Mask Card are labelled demo mode in it.

## What the chain learns

| Public on the ledger | Private, held by the parties |
|---|---|
| That an invoice commitment exists, its kind, asset and expiry | Merchant identity, payer identity, amount, title, memo |
| Whether it is open, settled or cancelled, and how many have paid | Which payer settled which invoice. A receipt can be paired with the opaque commitment it settled |
| That a revenue attestation was published, and its threshold | The receipts and the revenue total behind it |
| A hash tag standing for the owner secret | The owner secret that authorises close and cancel |

The complete list, and what each privacy claim rests on, is in
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).

## Try it without a wallet

```bash
cd contracts && npm run build           # compile the contracts (about 5 minutes)
cd ../app && npm install && npm run build && npm run preview
```

Open the app and press **Try the demo**. The real compiled contract runs in the browser against a
simulated ledger, so every refusal you see is the contract's own message. No proof is generated and
nothing reaches a chain; the interface says so on every screen while it is on.

## Status

| | |
|---|---|
| Contract tests | 155 passing, simulator-based, weighted to refusals |
| End-to-end browser tests | 56 passing (28 on desktop, 28 on a phone viewport), console errors fail the run |
| Backend, bot, SDK tests | 56, 56 and 19 passing |
| Live app | https://mask-midnight.vercel.app, built for **Midnight Preview**, the network Lace's Testnet setting connects to. Reads use Preview's public indexer, so the Explorer works with no wallet |
| Public-network deployments | **Midnight Preview** (live app): `mask_pay` `8af45bb9a9016fcaa1b1d1cc70fee33822128cc75ae73ee44893a8d7b815b1d5`, `mask_token` `805e8e6c53ae8adbaae6fa8ad1e97dc4cfe1de806109d415bfb79c96a5e3d8b7`. **Midnight Preprod**: `mask_pay` `0e0e94bb654bb855d85e7428427ecf2d89ddde4d4d9f3737ccc9f1242d12ea29`, `mask_token` `91f9b035cf5d1bb70fcb15f259c782899553b168d635ac790f35e136b92dcdfd`. On both, all 13 `mask_pay` circuit keys are on chain and the same 7 end-to-end checks (create, settle, replay refused, non-owner cancel refused, owner cancel, settle-after-cancel refused) passed against the live network. Transaction ids are in `deployments/preview.evidence.json` and `deployments/preprod.evidence.json` |
| Browser wallet write path (Lace) | **Verified on Midnight Preview with the real Lace 2.4.2 extension, in one recorded 749 s session on the deployed app at https://mask-midnight.vercel.app:** connect, create an invoice (48 s), pay it with a shielded mUSDC coin (67 s), the same payment refused a second time, a refund with the payer's code (64 s), four invoices paid in one batch proof (100 s), a revenue proof over those four payments (122 s), an owner cancel (40 s) and a payment to the cancelled invoice refused by the contract. Cross-checked on the public indexer with the CLI (`mask stats`, `mask receipt`, `mask attestation`) and on the Verify page with no wallet. Evidence in `deployments/preview.lace-evidence.json`. **Not on Preview:** gift cards and Mask Card, whose contracts are not deployed there |

This table is regenerated from real runs. A row that cannot be backed by one is marked, not rounded
up.

## Where this comes from, and what is new

Mask began as [AleoZKPay](https://github.com/ashishexee/AleoZKPay), a private-invoice product built
on Aleo by the same team. That project is the source of the product's flows, page structure and
feature set. This repository is a separate Midnight implementation: the Compact contracts, the
circuits, the private-state design, the wallet and proving pipeline and the interface design are new
work on Midnight. Where Midnight changes the design (the commitment
scheme, the nullifier and receipt model, selective disclosure), it is documented in
[`docs/CONTRACT-STATUS.md`](docs/CONTRACT-STATUS.md).

This repository started on 2026-10-11 from an earlier private Midnight port by the same team. That
port is the starting point and is not presented as new. What was added here, each with the test that
proves it:

- **Expiry now works.** Expiries were written in milliseconds and the chain compares seconds, so no
  invoice ever expired and oracle quotes never went stale. `contracts/test/expiry.test.ts`.
- **A payment link can no longer cancel the invoice it pays.** Close and cancel are authorised by a
  per-invoice owner secret that is never in a link. `contracts/test/authority.test.ts`.
- **Refunds.** A new circuit returns a shielded coin to the payer in the same transaction, once per
  payment, authorised by the owner secret. `contracts/test/refund.test.ts`.
- **Privacy tests that can fail.** The earlier transcript tests searched an empty string. They now
  read each call's real public transcript and every ledger collection, and prove the search sighted
  first. `contracts/test/privacy-observer.test.ts`.
- **Revenue proofs work in the app.** The Prove revenue page used to end in a hard-coded error. It
  now reads the receipt tree from the ledger, takes each payer's payment code, runs
  `attest_revenue_at_least` and publishes the digest, and a verifier finds it on the Verify page.
  `app/e2e/demo-flow.spec.ts` covers a true claim, a claim above the real total, a code that is not a
  code and evidence that names a different payment, which the contract refuses in its own words.
- **The dashboard reads settlement from the chain.** A payer settles from another browser, so the
  merchant's local record stayed "open" and kept offering to cancel a paid invoice. It now reads the
  status back from the ledger, and the Prove revenue page does the same.
- **Payment codes.** A receipt, and each of the four receipts of a batch payment, comes with a code
  carrying the payer's key, the payment index and the receipt. A merchant needs it to refund a
  payment or to count it in a revenue proof; only the payer holds the key that names it.
- **Demo mode.** The real contract in the browser, no wallet. `app/e2e/demo-flow.spec.ts`.
- **A browser suite** over every route and the full payment, refund and cancel stories, on desktop
  and mobile.

```
contracts/   Compact contracts and their simulator test suites
devkit/      Headless harness: deploy, seed, end-to-end against a devnet
devnet/      Local node, indexer and proof server
app/         Merchant and payer app (Vite, React 19) and its Playwright suite
backend/     Checkout sessions, webhook delivery, the assistant
bot/         Telegram bot: reads public state, holds no secret
packages/    @mask/node, @mask/cli, @mask/mcp, mask-midnight (Python)
docs/        Threat model, contract status, toolchain log
qa.sh        Full-system check against a running devnet
```

## Quick start

```bash
cd contracts && npm run build && cd ..              # compile the four contracts
cd packages/mask-node && npm run build && cd ../..  # build the SDK the bot and checks import
docker compose -f devnet/devnet.yml up -d           # node, indexer, proof server
node --experimental-strip-types devkit/src/deploy.ts # deploy, writes app/.env.local
node --experimental-strip-types devkit/src/seed.ts   # put real invoices on chain
cd app && npm install && npm run dev                 # http://localhost:5175
bash qa.sh                                           # verify the whole thing
```

Optional, each needing a key only you can supply:

```bash
GOOGLE_API_KEY=... node --experimental-strip-types backend/src/server.ts   # enables the assistant
TELEGRAM_BOT_TOKEN=... MASK_CONTRACT_ADDRESS=... node --experimental-strip-types bot/src/index.ts
```

Without them the backend runs with the assistant switched off and the app hides the chat box; the
bot refuses to start and says which value is missing.

Node 24, Docker, and the Compact CLI in WSL if you are on Windows. Lace is required for anything
that writes to the chain; reading needs nothing.

Both build steps come first because their output is not in the repository. The proving and verifier
keys come to roughly 290 MB, generated deterministically from `contracts/src`; the app serves its own
copy from `app/public/keys`, which the same build produces. The SDK is compiled because `live-check`
and the bot import the built artifact rather than the source — the thing that actually ships.

## Pinned stack — do not bump piecemeal

| Component | Version |
|---|---|
| Compact compiler | **0.31.1** (language 0.23.0) |
| `@midnight-ntwrk/compact-runtime` | 0.16.0 |
| `midnight-js` | 4.1.1 |
| Ledger | v8 |
| Node image | 1.0.0 |
| Indexer image | 4.3.3 |
| Proof server image | 8.1.0 |

**Do not run `compact update`.** It installs compiler 0.34.0, which emits runtime 0.19.0 targeting
ledger v9 — output this stack cannot consume, failing much later as a confusing proof error.
Midnight's own flagship example (`example-bboard`) only compiles on 0.31.1. Always compile with the
explicit prefix: `compact compile +0.31.1 …`.

The alternative is `midnight-js` 5.0.0-beta plus a release-candidate ledger and proof server. Mask
does not ship on pre-release dependencies.

## Contracts

| File | Circuits |
|---|---|
| `mask_pay.compact` | **12** — `create_invoice`, `settle_invoice`, `settle_invoice_shielded`, `settle_invoice_converted`, `settle_batch`, `close_invoice`, `cancel_invoice`, `attest_revenue_at_least`, `attestation_exists`, `invoice_exists`, `is_settled`, `receipt_exists` |
| `mask_token.compact` | 3 — `mint`, `transfer`, `token_color` |
| `mask_card.compact` | 5 — two-factor card and burner credentials |
| `mask_gift.compact` | 4 — bearer gift cards: `issue`, `void_card`, `card_issued`, `card_voided` |
| `mask_smoke.compact` | 3 — pipeline probe |
| `vendor/schnorr.compact` | Schnorr over Jubjub, vendored from midnightntwrk/example-zkloan (Apache-2.0) |

### The design in one paragraph

The chain stores a commitment: one `persistentHash` over a joint pre-image with a domain separator,
binding merchant key, amount, terms and a 256-bit salt. The salt is a witness the compiler forbids
from reaching any public boundary. Paying means reproducing that commitment from the real terms,
which proves you know them without publishing any. A domain-separated nullifier makes replay
impossible, and value moves as a shielded coin, so sender, recipient and amount are all hidden.

## Verification

```bash
cd contracts && npx vitest run          # 155 contract tests, offline, a few seconds
cd ../app && npm run test:e2e           # 56 browser tests against a production build
bash qa.sh                              # every suite plus live checks; needs the devnet running
```

The privacy property is asserted at several levels rather than argued: the contract's public
transcript, indexer data, ledger state, session-store keys and webhook bodies.

## Measured proof cost

| Circuit | On-chain |
|---|---|
| deploy | ~22 s |
| `create_invoice` | ~24–29 s |
| `settle_invoice` | ~30 s |
| `settle_invoice_shielded` | ~36–59 s |
| rejected payment | **<1 s**, locally, nothing submitted |

Circuit size drives latency directly, so payment UX is asynchronous by default and every extra
proven call per user action costs another half-minute. The app shows real stages — taken from the
providers themselves — rather than an indeterminate spinner.

## Traps this stack sets

Each of these cost a debugging cycle and is documented where it bites:

1. **`compact update` puts you on an incompatible generation.** Pin 0.31.1.
2. **Duplicated WASM runtime.** Two copies of `onchain-runtime-v3` — from a stray direct
   dependency, from separate per-package installs, or from Vite's `optimizeDeps.exclude` — make
   `instanceof ChargedState` fail across the boundary. One module tree, `optimizeDeps.include`.
3. **`deployContract` rejects a raw `new Contract()`.** It needs
   `CompiledContract.make().pipe(withWitnesses, withCompiledFileAssets)`.
4. **`findDeployedContract` does not call `setContractAddress()`** on the private state provider;
   `deployContract` does. Writing private state without it throws.
5. **`sendShielded` spends a contract-owned coin.** A payer's wallet coin needs receive-then-forward.
6. **`additionalFeeOverhead` must be `500_000_000_000_000_000n` on `undeployed`**, not the `1_000n`
   that `midnight-local-dev` uses.
7. **Wait for `dust.availableCoins.length >= 1`**, not `balance > 0`, before submitting.
8. **The browser must use `localhost`, not `127.0.0.1`** on Windows — it lives outside WSL.
9. **Midnight's skill scripts ship CRLF** and die under WSL bash.
10. **The node reports healthy at genesis**, so the indexer races it and dies with
    `block number 1 not found`. Our compose healthcheck requires a block past genesis.

## Known limitations, stated plainly

- **Proving keys are 161 MB** in `app/public`. Fine on a devnet; a public deployment needs a CDN and
  per-circuit lazy fetching.
- **Gift cards and Mask Card are not deployed to Preview.** They run against the real contracts in demo mode, and the film labels those clips as demo mode. Everything else in the film was recorded through Lace on Preview.
- **Revenue attestation is fixed at 4 payments.** Circuits cannot loop over variable-length data.
  Larger batches mean compiling a wider variant.
- **The Python SDK cannot read chain state.** That needs Midnight's WASM ledger decoder; a
  hand-written Python reimplementation of consensus-critical parsing would be a liability. It does
  links, terms and webhooks, and says so.
- **No hosted prover.** A prover sees witness data, so Mask does not offer one.
- **The Telegram bot does little, on purpose.** It looks things up, watches for
  settlement and hands out links; it does not create invoices or take payments. Those need the
  amount, the salt and the merchant's identity key, and a bot holding those for every merchant would
  rebuild on one server the database this product exists to avoid — in a chat log Telegram can read.
  See `bot/README.md`.
- **The assistant is a third party.** It answers questions about the product, with only public
  context attached: the page you are on, how many invoices you have, whether a wallet is connected.
  The backend rejects a request carrying anything else rather than stripping it. What you type is
  yours to write and is sent as typed, which the panel says above the input every time.
- **Timing correlation is not solved.** On a quiet chain, a create followed closely by a settle
  links the two. That is mitigated by volume, not cryptography, and pretending otherwise would be
  dishonest.
- **An unmodified Chrome has not been tested against Lace's local proof server.** A hosted https page could not reach it in an unmodified Chromium test browser (the request failed and the app reported a timeout); the recording browser was started with Chromium's local-network checks off. Whether an interactive Chrome asks the user for permission instead is not verified. Running the real wallet found and fixed defects the simulators could not reach, the latest being the payer address format inside refund and payment codes (see the commit history). Lace's DUST balance appears only after the wallet finishes syncing, which took several minutes per launch in the automated runs, so let it sync before recording a demo.

## Documents

| | |
|---|---|
| `docs/pitch-deck.pdf` | The pitch deck, 14 slides |
| `docs/THREAT-MODEL.md` | What was attacked, what was found, what is still open |
| `docs/CONTRACT-STATUS.md` | Contract status and measured on-chain results |
| `docs/TOOLCHAIN-LOG.md` | Environment findings, verified by execution |
| `app/README.md` | App-specific setup and pitfalls |
