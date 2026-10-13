# Mask on Midnight — contract layer status

Phases 0–6. Everything below compiles, is tested, and where stated has been run against a real node.

## Contracts

| File | Circuits |
|---|---|
| `mask_pay.compact` | **12** — `create_invoice`, `settle_invoice`, `settle_invoice_shielded`, `settle_invoice_converted`, `settle_batch`, `close_invoice`, `cancel_invoice`, `attest_revenue_at_least`, `attestation_exists`, `invoice_exists`, `is_settled`, `receipt_exists` |
| `mask_token.compact` | 3 — `mint`, `transfer`, `token_color` |
| `mask_card.compact` | 5 — `create_credential`, `authorise`, `deactivate`, `credential_active`, `authorisation_used` |
| `mask_gift.compact` | 4 — `issue`, `void_card`, `card_issued`, `card_voided` |
| `mask_smoke.compact` | 3 — Phase 0 pipeline probe |
| `vendor/schnorr.compact` | Schnorr over Jubjub, vendored from midnightntwrk/example-zkloan (Apache-2.0) |

Toolchain pinned to compiler **0.31.1** / runtime **0.16.0** / midnight-js **4.1.1** / ledger **v8** /
proof server **8.1.0**. See `TOOLCHAIN-LOG.md` for why "latest" is the wrong choice here.

## Tests — 181 passing

130 contract tests, 32 backend, 19 in the Node SDK. Simulator-based, so they run offline in seconds
rather than the 24–60 s per call a real proof costs. Weighted toward failure states throughout.

| Area | What is covered |
|---|---|
| Commitment binding | amount, merchant, salt and token each change the commitment |
| Replay | same payer, different payer, index pinning for STANDARD |
| Wrong terms | wrong amount, salt, token, unknown invoice |
| Multipay / donation | many payers, same payer twice under one index, same payer under a new index |
| Authorisation | merchant-only close and cancel; cancel refused after any contribution |
| Escrow | under- and over-payment rejected on coin value |
| Oracle | correct signature accepted; impostor, tampered amount and expired quote rejected |
| Selective disclosure | seven forgery vectors, all rejected |
| Privacy | amount absent from ledger and from the public transcript |
| Batch settlement | four under one proof; atomic — a bad entry settles nothing |
| Reference tokens | mUSDC and mUSAD are distinct assets; unique nonces; no per-asset counter |
| Wrong asset | a coin of the right value in the wrong asset is refused, both directions |
| Colour derivation | the TypeScript derivation matches the compiled contract and a minted coin |
| Gift cards | bearer notes, double-spend refused, void, registry-only custody |

## Verified on chain

Against the local devnet, with real proofs and a real wallet:

| Operation | Time | Result |
|---|---|---|
| deploy | 22–24 s | |
| `create_invoice` | 23.7–29.2 s | commitment published, amount not |
| wrong amount | 0.6 s | rejected locally, nothing submitted |
| `settle_invoice` | 30.1 s | receipt published |
| replay | 0.3 s | rejected locally |
| `settle_invoice_shielded` | 35.8 s | **real shielded coin moved**; underpayment rejected by the coin-value check |
| `attest_revenue_at_least` | 53.2–54.5 s | four Merkle paths taken from the live ledger; threshold proven, total never disclosed |
| false attestation | 0.4 s | `revenue below threshold`, rejected before anything was published |
| `settle_batch` (four) | 59.9 s | one proof for four settlements |
| `mint` (mUSDC) | 22–25 s | real shielded coin, received by the wallet |
| mUSDC settlement | 35.8 s | invoice in mUSDC, settled with the minted coin |
| wrong asset | 0.3 s | `coin is not the invoice's asset` |

Privacy, measured over the whole public record — 486 blocks, 73 transactions, **4.0 million
characters** — for six values in 11 encodings each: **absent from all**. The search is proven sighted
first; see below.

## Findings

### 1. An additive commitment with a published salt leaks the amount

A commitment built as `H(merchant) + H(amount) + H(salt)`, with the salt revealed when the invoice is
settled, is broken. Addition is invertible, so `commitment − H(salt)` depends only on
`(merchant, amount)`: equal merchant/amount pairs are linkable with zero brute force, and the amount
is recoverable by dictionary once the merchant is known.

This contract is built to avoid it: one hash over a joint pre-image with a domain separator, and a
salt that is a witness the compiler forbids from reaching any public boundary.

### 2. Escrow does not leak the amount, despite requiring `disclose()`

`sendShielded` forces `disclose(coin.value)`, and in Compact `disclose()` means "permitted to become
public" — so this was genuinely open. Measured against the public transcript: absent. Zswap keeps
the value shielded. **Disclosure to a token operation is not disclosure to the transcript.**

### 3. A forgeable attestation, found by adversarial testing and fixed

The first selective-disclosure design verified Merkle paths against the tree but never bound a path
to the *claimed* payment, and took amounts as free witnesses. A merchant could have attested to any
revenue. Receipts are now derived from the amounts and each path is bound to the receipt it proves,
so claiming an amount requires a real payment of that amount.

### 4. Contract-mediated sends need receive-then-forward

`sendShielded` spends a coin the contract already owns; handing it a payer's wallet coin fails at
proving time with `invalid index into sparse merkle tree ... newContractOwned`. Escrow accepts the
payer's coin with `receiveShielded` and forwards it with `sendImmediateShielded` in the same
transaction, so the contract never custodies funds across blocks.

### 5. Per-asset mint counters leak the asset

Branching on the token to bump one of two public counters reveals which asset was minted, while
shielded coins otherwise hide token type. The compiler rejects it. Only an aggregate count exists.

### 6. Settlement checked the amount but not the asset

Found by reading `settle_invoice_shielded` rather than by a failing test, which is why it is worth
recording: every test passed while the defect was there.

A shielded coin carries a value and a colour, and settlement asserted only on the value:

```compact
assert(coin.value == invoice_amount() as Uint<128>, "coin value does not match invoice");
```

So a 100 mUSDC invoice was settleable with 100 tNIGHT. `settle_invoice_converted` was worse — the
oracle signs "X of A is worth Y of B", and nothing checked that the coin handed over was B at all, so
a quote priced in one asset could be paid in any other.

The invoice's declared token was already bound into the commitment, but a *declaration* is not a
*colour*: nothing connected `TokenKind.MUSDC` to the bytes a real mUSDC coin carries. The fix seals
both reference-token colours into the contract at construction, next to the oracle key, and checks
the coin against them. Sealed for the same reason: if they could be changed later, every invoice ever
denominated in mUSDC could be re-pointed at a worthless asset.

Refused on chain, not only in the simulator:

```
attempting to settle the mUSDC invoice with a NATIVE coin — must be refused
REFUSED (on asset): failed assert: coin is not the invoice's asset
```

Seven simulator tests cover the rest of the matrix — native for mUSDC, mUSAD for mUSDC, mUSDC for
native, an unknown asset, and the right asset in both directions.

### 7. Two privacy checks that passed while proving nothing

Both were mine, and both would have shipped a false claim.

The first searched only the contract's latest action while its comment claimed it searched "every
transaction the indexer holds". The query behind that claim passed a contract address where a
transaction hash belongs, failed, and had its failure swallowed by `.catch(() => null)`. It printed a
clean result over a haystack it never fetched.

The second was worse, because it looked rigorous. It searched four megabytes of real data for each
amount in nine encodings — every padded machine word from 8 to 64 bytes — and found nothing. But
Midnight serialises a ledger integer in the **fewest bytes that hold it**, not as a padded word. A
public `expires_at` of `1759296000123` sits in the state as `7b90369e9901` and matches none of those
nine needles. The check could not have found the amount if it had been published in the clear.

That is why `devkit/src/control-probe.ts` exists. It publishes a value deliberately, then requires the
search to find it before any absence is reported as privacy:

```
commitment visible          YES
public expiry visible       YES as LE      <- the search is sighted
private amount visible      NO
invoice salt visible        NO
merchant key visible        NO
verdict            PRIVACY VERIFIED
```

Without that line the two results are indistinguishable: "the amount is not there" and "I was looking
at the wrong bytes" print identically.

A third false alarm came from the opposite direction. Matching a decimal amount with a digit-only
boundary flagged `7500` inside `…d57d7500a126…` — a coincidence in a haystack that is almost entirely
hex. The boundary now excludes hex characters, and a real decimal in JSON is still bounded by a quote,
colon or comma.

### 8. The production build had never been run

The app worked in dev for weeks. `npx vite build` had never been run against it, and it failed three
times over — each failure hidden by the dev server doing something different:

1. **`Rollup failed to resolve "vite-plugin-node-polyfills/shims/buffer"`.** The compiled contract is
   imported from outside the app package, so Node resolves *its* dependencies from the devkit's
   module tree — and a backend tree has no reason to carry a frontend plugin. Vite serves those
   specifiers itself in dev, so only the build noticed.
2. **`[vite-plugin-top-level-await] missing field \`type\`` from SWC.** The plugin lowers top-level
   await for older targets and crashed doing it. Targeting `esnext` removes the need for the
   transform entirely; every browser that can run Lace supports TLA natively.
3. **`expected instance of Oi`** — `ChargedState` after minification, and the WASM duplication bug
   again. Two module trees meant two copies of `compact-runtime`, `ledger` and `onchain-runtime`,
   each with its own WASM instance, so a value made by one failed an `instanceof` against the other.
   Every chain read in the production bundle failed. `optimizeDeps.include` hides this in dev by
   pre-bundling one copy; the build has no equivalent, so `resolve.alias` pins them.

The third would have survived to deployment: the app loads, the UI renders, and every page that
touches the chain shows an error. `qa.sh` now runs the production build and counts the WASM copies
in the bundle, because "it works in dev" was never evidence that it ships.

### 9. A privacy control that failed for the wrong reason

The control probe passed on its own and failed inside a full QA run, reporting "the search is blind
to public values" — the strongest negative result the tooling can produce.

It was not blind. A node confirming a transaction and the indexer serving the block it landed in are
two different events, and the gap widens under load: the QA run had three other on-chain checks
competing for the same indexer. The probe wrote, read immediately, found nothing, and concluded the
search could not see.

Worth recording because of which direction the error ran. A flaky check that fails loudly is
survivable; the same race in a check that *passes* on missing data is how a privacy claim becomes
false. The fix is the rule from the QA guide — wait for the value, not for the clock:
`waitForIndexed` polls until the write is being served, and says so plainly if it never is, rather
than returning a verdict either way. The attestation and mUSDC runs use it too.

## Proof cost — the number that shapes the product

| Circuit | On-chain time |
|---|---|
| `create_invoice` | ~24–29 s |
| `settle_invoice` | ~24–30 s |
| `settle_invoice_shielded` | ~36–59 s |
| `attest_revenue_at_least` | ~53–55 s |
| `settle_batch` (four invoices) | ~60 s |

Circuit size drives latency directly, so payment UX is asynchronous by default and every extra proven
call per user action costs another half-minute.

### Does batching pay for itself?

One proof covering four settlements replaces four proofs of roughly 25 s each. That is only a win if
proving cost grows sub-linearly with circuit size, which is a question about PLONK and this circuit,
not something to read off the shape of the code. Measured on the devnet:

| | Time |
|---|---|
| four `settle_invoice` calls | 29.1 + 23.9 + 23.8 + 23.8 = **100.7 s** |
| one `settle_batch` of four | **59.9 s** |

**40% faster**, and one transaction instead of four. It scales sub-linearly, so batching earns its
place — for payroll and for any merchant settling a day's invoices at once.

That result is what justifies the `/batch` page in the app. Four payment links in, one proof out,
with the page refusing a batch before proving it if the four disagree on asset or type, or if the
same invoice appears twice — all of which the contract would reject after thirty seconds of work.

## Not yet done

Three things, and each is blocked on something only the operator holds.

- **A payment made through the browser UI with a real Lace wallet.** The path is built and the
  mechanism it depends on is proven on chain (see below), but connecting a wallet and spending from
  it belongs to whoever owns the wallet.
- **The Telegram bot, running.** Built and tested — 56 tests over the router, the notifier and the
  configuration, none of which need a token. Running it needs one from @BotFather. It refuses to
  start without it and names what is missing.
- **The assistant, answering.** Built and tested — 24 tests, including that a request carrying an
  amount is refused rather than stripped. Answering needs a `GOOGLE_API_KEY`. Without one the
  backend reports itself unconfigured and the app hides the chat box rather than offering one that
  errors.

Both of the last two are complete code paths: supply the key and they work. That claim is worth as
much as the tests behind it, which is why the tests exist and are counted above.

## Escrow from a browser

The Pay page can now move money, not just record that money moved. That took answering a question
first, because the answer decided whether the feature could exist at all.

The devkit escrows by reading an existing UTXO out of the wallet — nonce, colour, value — and handing
it to the circuit. A browser DApp cannot: the Lace connector exposes `getShieldedBalances` but no coin
list, so there is no existing nonce to name.

The alternative is to invent one and let the wallet fund it while balancing. The connector's
documentation says `balanceUnsealedTransaction` adds "necessary inputs and outputs to remove
imbalances", which reads as though it should work — but reading is not evidence. `fresh-coin-probe.ts`
settles an invoice on chain with a nonce that corresponds to nothing the wallet holds:

```
settling with a FRESH coin, nonce 17fe1fef5703c75d…
receipt 40e750e08e8b07df0c238898c6a6f2b0f2d62a7272bad360e14218732d47439d
ACCEPTED — the wallet funded a coin the DApp invented.
```

So the Pay page builds the coin and lets the wallet fund it. It offers escrow by default and falls
back to record-only when the payment link carries no payout address, or when the asset cannot be
identified — and says which, rather than failing half a minute into a proof.

The merchant's payout address travels in the payment link, never on chain. Publishing it beside a
merchant's invoices would let anyone group every invoice that merchant ever issued, which is most of
what this product exists to prevent.
