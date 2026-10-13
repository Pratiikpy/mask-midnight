# Threat model

What Mask defends, against whom, what was found by attacking it, and what is still open.
Every status below names the test or measurement behind it. Nothing is marked fixed on the strength
of reading the code.

## Parties and what each is trusted with

| Party | Holds | Trusted to |
|---|---|---|
| Merchant | merchant key, invoice amounts and salts, per-invoice owner secrets | keep their vault; nothing else |
| Payer | the payment link (merchant key, amount, salt, optional payout key) for invoices they were sent | not publish the link |
| Chain observer | the public ledger and every transaction | nothing; assumed hostile and permanent |
| Node, indexer | the same public data | nothing about privacy; availability only |
| Proof server | witness data while proving | must run on the user's own machine, port 6300 |
| Oracle | a Jubjub key sealed into the contract | sign honest conversion quotes |
| Mask backend | checkout session ids and commitments | nothing private; it never receives an amount |

## Assets

1. Invoice amounts, merchant identity, payer identity, memos.
2. The link between a payment and the invoice it settled.
3. Funds in flight during a shielded settlement.
4. The right to close or cancel an invoice.

## Findings from attacking it

| # | Finding | Status | Evidence |
|---|---|---|---|
| F1 | **Expiry never fired.** Expiries were written in milliseconds; the chain compares seconds, so an expiry of "1 hour" was a date tens of thousands of years away. The same error disabled oracle quote expiry. | **Fixed** | `contracts/test/expiry.test.ts` (5 tests, including one that proves a millisecond value never expires); oracle and app changed to seconds; Playwright test asserts the stored value is within an hour of now in seconds |
| F2 | **Anyone holding a payment link could cancel the merchant's invoice, or close a multi-pay one.** Authority was "reproduce the commitment", and the payment link carries every input to it. | **Fixed** | `contracts/test/authority.test.ts`: a link holder is refused with `not the invoice owner`; the merchant, holding a separate per-invoice owner secret that is never in a link, succeeds. The ledger stores only a domain-separated hash of that secret |
| F3 | Settlement checked the coin's value but not its asset, so a 100 mUSDC invoice could be settled with 100 tNIGHT. | Fixed (before this wave) | wrong-asset tests in `mask-token.test.ts` and `escrow-privacy.test.ts` |
| F4 | The first selective-disclosure design let a merchant attest to revenue they never received. | Fixed (before this wave) | seven forgery tests in `selective-disclosure.test.ts` |
| F5 | **The privacy tests were vacuous.** The earlier "transcript" tests serialised a WebAssembly handle, which prints as `{"__wbg_ptr":N}`, and searched that for the amount. They would have passed if the amount leaked. | **Fixed** | `contracts/test/privacy-observer.test.ts` searches each call's real public transcript plus every ledger collection, and proves the search sighted first: a public expiry and the commitment are found and a planted amount is found, then the private amount, salt, merchant key and owner secret are shown absent. The old files were removed |
| F6 | **The payment link was built by spreading a whole vault record.** Copying a link from the dashboard put the merchant's private title and memo in it, and once owner secrets existed it would have put the authority to cancel the invoice in it too, quietly undoing F2. Found while building the dashboard, before release. | **Fixed** | `encodeTerms` takes an explicit field list. A browser test creates an invoice with a recognisable title, memo and owner secret and asserts none of them appear in the link shown after creating or the one copied from the dashboard |

## Open items

| # | Risk | Why it is open | Planned handling |
|---|---|---|---|
| O1 | **One merchant key across all of a merchant's invoices.** Every payer receives it in their link, so two payers who compare notes can see that two invoices share a merchant. | The key is part of the commitment pre-image, so it has to be in the link. | Derive a fresh per-invoice key from a master secret, so a link reveals nothing that links invoices. Needs a contract-compatible derivation and a migration path for existing invoices |
| O2 | **A payment link is a secret.** Anyone who sees it learns the amount and can pay the invoice, and it travels over whatever channel the merchant uses. | Inherent to out-of-band terms. | Say so in the interface at the point of copying; offer a one-time link that the payer's browser consumes |
| O3 | **Timing correlation on a quiet chain.** An invoice created and settled minutes apart, with little else happening, links the two. | Cryptography cannot hide timing; only volume does. | Stated plainly on the home page; measure again on a public network |
| O4 | **Oracle trust.** The oracle can sign any rate. The key is sealed at construction, so it cannot be swapped, but the oracle itself must be honest. | Intrinsic to oracle conversion. | Quotes expire (F1 fix made this real); document the bound |
| O5 | **Who may mint the reference tokens mUSDC and mUSAD.** | NOT VERIFIED. | Read the mint circuit's authority and test it before any claim is made |
| O6 | **Demo mode proves nothing about proving.** It runs the real contract but generates no zero-knowledge proof and touches no chain. | By design; every demo screen says so. | Public-network evidence is separate and labelled as such |
| O8 | **A receipt can be paired with the invoice it settled.** Settlement is one transaction that touches both the invoice commitment and the receipt, so anyone reading the transcript sees them together. The commitment is an opaque hash and reveals no amount, merchant or payer; the pairing is what is visible. Earlier copy claimed a receipt hid its invoice. That was wrong. It was measured, the copy was corrected everywhere, and `privacy-observer.test.ts` pins the behaviour. | Inherent to updating a per-invoice record in the same transaction that publishes a receipt. | Unlinkable settlement: replace the public per-invoice map with a commitment tree and publish only a nullifier and a new receipt, proving membership in zero knowledge. Public "is this invoice settled" checks then become private to the merchant. Wave 3 design item |
| O9 | **Anyone who holds the payment links of four payments can publish a revenue attestation for that merchant.** The attestation proves a true statement, but publishing it is the merchant's call, not the payer's. | Attestation authority is the merchant key, which every payment link carries. | Require the per-invoice owner secrets in the attestation, or a master secret that derives them |
| O7 | **Privacy measured only on a local devnet, and not yet re-run in this repository.** The August local run searched the whole public record (486 blocks, 73 transactions, 4.0 million characters, six values in eleven encodings) and found none, with the search proven sighted first. That result is recorded, not reproduced here. | Needs a re-run, and a public-network run. | Re-run `devkit/src/verify-privacy.ts` locally, then on Preview after deployment |

## What this model does not cover

- A compromised user machine (malware reading the vault).
- Loss of the vault: invoices become unmanageable, because the chain holds no recoverable terms.
- Wallet and proof-server implementation bugs.
- Anything not exercised by the tests named above.
