# Mask app — Midnight

Vite + React 19 + Tailwind v4, on the pinned midnight-js 4.1.1 stack.

```bash
npm install
npm run dev        # http://localhost:5175
```

Requires the devnet (`../devnet`) running, a deployed contract
(`node --experimental-strip-types ../devkit/src/deploy.ts`, which writes `.env.local`), and the
Lace wallet extension for anything that writes.

## Six Vite plugins, all required

The SDK is WASM-backed and built for Node. Dropping any of `wasm`, `topLevelAwait`,
`nodePolyfills`, `viteCommonjs`, `react` or `tailwindcss` produces a runtime failure rather than a
build error, which makes them easy to lose.

**`optimizeDeps.include`, never `exclude`.** Excluding the WASM packages serves them as raw ESM
while the rest of the SDK is pre-bundled, giving two instances of the same module — and
`instanceof ChargedState` then fails with *"expected instance of ChargedState"*. Same class of bug
as a duplicated `onchain-runtime-v3` in node_modules; different cause, identical symptom.

## Endpoints use `localhost`, not `127.0.0.1`

On Windows the browser runs outside WSL and reaches the devnet through WSL's localhost forwarding.
A literal `127.0.0.1` from the browser is the Windows loopback and is refused.

## Proving keys

`public/keys` and `public/zkir` are copied from `../contracts/build/mask_pay`. The browser fetches
them at call time via `FetchZkConfigProvider`.

They are **161 MB**. That is a real deployment consideration — a first-time payer downloads the
proving key for the circuit they are running. Not a problem on a devnet; it needs a CDN and
per-circuit lazy fetching before any public deployment.

Regenerate after any contract change:

```bash
cd ../contracts && npm run build
cp -r build/mask_pay/{keys,zkir,compiler} ../app/public/
```

Stale keys are the most likely cause of a proof server 400 on `/check`.

## Structure

| Path | |
|---|---|
| `src/lib/invoice.ts` | The client-side invoice vault and share-link encoding |
| `src/lib/contract.ts` | Compiled contract, witnesses, in-memory private state |
| `src/lib/useCircuit.ts` | Runs a circuit and reports the real stage it is in |
| `src/providers/MaskProvider.tsx` | Lace connection and provider assembly |
| `src/components/ProofProgress.tsx` | Staged progress for a 25–60 s proof |

## Why the progress UI exists

Measured proof times on the devnet: `create_invoice` ~25 s, `settle_invoice` ~30 s,
`settle_invoice_shielded` ~36–59 s. An indeterminate spinner for that long reads as a hang.

Stages are taken from the providers themselves — `proveTx`, `balanceTx` and `submitTx` each fire as
they are entered — so the UI shows the phase the transaction is genuinely in rather than a guess.

## Where invoice terms live

The chain stores a commitment. The terms that give it meaning live in `localStorage` on the
merchant's device and travel to the payer in a URL **fragment**, which browsers never send to a
server. No backend sees an amount at any point.

The consequence, stated in the UI rather than buried: clearing browser data loses the invoices, and
losing the merchant identity key means invoices created with it can no longer be proven as yours.
Settings offers an export for exactly this reason.
