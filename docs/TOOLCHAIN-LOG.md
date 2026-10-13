# Phase 0 — foundations log

Verified facts only. Every line here was produced by running something, not by reading docs.

## Decisions in force

| # | Decision |
|---|---|
| D1 | Both rails — Mask mints `mUSDC` / `mUSAD` shielded reference tokens **and** supports native tNIGHT |
| D2 | **Local proof server only.** No hosted fallback |
| D3 | **PWA**, not a second mobile codebase |
| D4 | Repo stays **`mask`**; Midnight workspace at `mask/midnight/` |

## Host environment

The Compact CLI ships **no Windows binary** — release assets cover only
`x86_64/aarch64-apple-darwin` and `x86_64/aarch64-unknown-linux-musl`. Verified against
`midnightntwrk/compact` release `compact-v0.5.2`.

The toolchain therefore lives in **WSL Ubuntu-22.04** (x86_64, user `zkharsh`). Docker Desktop is
reachable from WSL. The frontend continues to build on Windows.

## Toolchain — installed and verified

| Component | Version | How verified |
|---|---|---|
| Compact CLI | 0.5.2 | `compact --version` |
| Compact compiler | 0.34.0 | `compact compile --version` |
| Compact language | 0.26.0 | `compact compile --language-version` |
| Ledger | 9.1.0.0-rc.3 | `compact compile -- --ledger-version` |
| Compact runtime (JS) | 0.19.0 | `compact compile -- --runtime-version` |
| Node (WSL) | v20.19.5 | `node -v` |
| Docker | 28.3.3 | `docker --version` |
| Docker Compose | v2.39.1 | `docker compose version` |

Install path: `curl ... compact-installer.sh | sh` → `~/.local/bin/compact`, then `compact update`
to fetch the compiler. `~/.local/bin` is **not** on WSL's non-interactive PATH, so scripts must
export it explicitly.

## THE STACK DECISION — compiler pinned to 0.31.1, not "latest"

This is the most important finding in Phase 0 and it changes what we build against.

There are **two incompatible generations** of the Midnight stack in circulation right now, and the
default install lands you on the pre-release one.

| | Ledger v8 generation (**stable**) | Ledger v9 generation (**pre-release**) |
|---|---|---|
| Compact compiler | **0.31.1** (language 0.23.0) | 0.34.0 (language 0.26.0) — the `compact update` default |
| Emitted `compact-runtime` | **0.16.0** | 0.19.0 |
| `midnight-js` line | **4.1.1 — stable** | 5.0.0-**beta**.7 |
| Ledger package | `ledger-v8` 8.1.0 | `ledger-v9` 1.0.0-**rc**.3 |
| Proof server | **8.1.0** | 9.0.0-**rc**.7 |
| Node / indexer | **1.0.0 / 4.3.3** | not yet pinned anywhere official |

Traced by reading published dependency trees:
`midnight-js-contracts@4.1.1` → `midnight-js-types@4.1.1` → `midnight-js-protocol@4.1.1` →
`compact-runtime 0.16.0` + `ledger-v8 8.1.0`. The 5.0.0-beta.7 line resolves to
`compact-runtime 0.19.0-rc.0` + `ledger-v9 1.0.0-rc.3`.

**Running `compact update` installs 0.34.0, which emits runtime 0.19.0 — output the entire stable
SDK and our proof server cannot consume.** Nothing warns you; it simply fails later.

**Proof, by execution:**

| Contract | compiler 0.34.0 | compiler 0.31.1 |
|---|---|---|
| `counter.compact` | compiles, runtime 0.19.0 | compiles, runtime **0.16.0** |
| `example-bboard/bboard.compact` | **FAILS** — `language version 0.26.0 mismatch` | **compiles** — 3 circuits (`post`, `takeDown`, `publicKey`) + prover/verifier keys |

Midnight's own flagship example only compiles on 0.31.1. That is the version the ecosystem is
actually on.

**Decision: Mask pins the Compact compiler to 0.31.1** and builds against `midnight-js` 4.1.1,
proof-server 8.1.0, node 1.0.0, indexer 4.3.3 — one coherent, fully-released stack. No betas, no
release candidates. A judge running our repo gets software that works.

Invoke explicitly as `compact compile +0.31.1 <src> <out>` so the build never depends on whatever
the machine's default happens to be. (`compact use` is not a subcommand; the `+VERSION` prefix is
the supported mechanism.)

## Compiler proven on real contracts

| Contract | Result |
|---|---|
| `counter.compact` | **Compiles.** 2 circuits. Emits `contract/index.js` + `.d.ts`, `compiler/contract-info.json`, `compiler/contract-manifest.json`, and per-circuit `keys/<circuit>.prover` / `.verifier` |
| `example-bboard/bboard.compact` | Fails — `language version 0.26.0 mismatch`. The example repo is pinned to an older language version |
| `ShieldedFungibleToken.compact` | Fails — `failed to locate file "./openzeppelin/ShieldedERC20.compact"`. Documented as requiring the OpenZeppelin `compact-contracts` package |

**Confirmed build output shape:** Compact source → ZK circuits → per-circuit prover/verifier keys →
a TypeScript contract module. This is what the frontend imports.

## Local devnet

Versions are pinned to the set published by `midnightntwrk/midnight-local-dev`, the official local
development environment:

| Service | Image | Port |
|---|---|---|
| Node | `midnightntwrk/midnight-node:1.0.0` | 9944 |
| Indexer | `midnightntwrk/indexer-standalone:4.3.3` | 8088 (`/api/v4/graphql`, ws at `/api/v4/graphql/ws`) |
| Proof server | `midnightntwrk/proof-server:8.1.0` | 6300 |

Network ID: `undeployed`.

Compose file: `mask/midnight/devnet/devnet.yml`, project name `mask-devnet`, container names
prefixed `mask-`.

**Why not the tooling skill's resolver:** `midnight-tooling:devnet`'s `resolve-versions.sh` returned
node `0.22.5` / indexer `4.2.1`, which are older than the official local-dev pin. The pinned set is
authoritative and is also the combination already run successfully on this machine.

**Two gotchas found the hard way:**

1. The skill's helper scripts and templates are checked out with **CRLF** line endings on Windows.
   Running them under WSL bash fails with `set: pipefail: invalid option name`. Strip with
   `sed 's/\r$//'` before running.
2. Pre-existing Midnight stacks are present on this machine — compose projects `scripts`
   (`downloads/mid/blank-statement`) and `mnapp-devnet` (`~/mnapp`), all containers **exited**.
   They reserve the container names `midnight-node`, `midnight-indexer`, `midnight-proof-server`.
   Mask's stack uses `mask-` prefixed names so the two never collide. **Nothing belonging to those
   projects was stopped, removed, or modified.**

## Mask's first Compact contract

`mask/midnight/contracts/src/mask_smoke.compact` — **compiles clean on the first attempt** under
compiler 0.31.1.

```
Compiling 3 circuits:
  runtime 0.16.0
  circuits: create_invoice, settle_invoice, is_settled
  keys: create_invoice.prover/.verifier  settle_invoice.prover/.verifier  is_settled.prover/.verifier
```

It is not the product — it is the smallest contract that exercises every primitive Phase 2 depends
on, so the design work stands on something verified:

- a private amount supplied by a `witness` that never reaches the ledger,
- a `persistentHash` commitment binding merchant + amount + salt,
- `Map<Bytes<32>, InvoiceStatus>` of open invoices keyed by commitment,
- a nullifier `Set<Bytes<32>>` making a second settlement impossible,
- `disclose()` at every public boundary, enforced by the compiler.

**This already satisfies the Buildathon technical gate** ("at least one Compact contract that
compiles successfully").

The generated TypeScript matches the design exactly — `Witnesses<PS>` requires `merchant_secret`,
`invoice_amount`, `invoice_salt`; `Ledger` exposes `invoices.member/lookup`, `spent.member`, and
`created`.

## Devkit

`mask/midnight/devkit/` — headless harness on the pinned stack. 379 packages, 32 `@midnight-ntwrk`
modules, Node 24.19.0 (example-bboard declares `node >=24.11.1`).

Providers assembled the same way the browser app will: `privateStateProvider` (LevelDB),
`publicDataProvider` (indexer + WS), `zkConfigProvider` (reads the compiler's `keys/` off disk),
`proofProvider` (HTTP to the local proof server), and one object serving as both `walletProvider`
and `midnightProvider`.

**Two more traps found:**

3. For network id `undeployed`, `additionalFeeOverhead` must be `500_000_000_000_000_000n`, not the
   `1_000n` that `midnight-local-dev` uses. With the small value local transactions run out of DUST.
   The correct value is in example-bboard's CLI provider.
4. Node's `--experimental-strip-types` rejects **TypeScript parameter properties**
   (`constructor(private readonly x: T)`). Fields must be declared explicitly.

## PHASE 0 EXIT GATE — PASSED

Full round trip against the local devnet, `mask/midnight/devkit/src/smoke.ts`:

```
[      0ms] building wallet from genesis mint seed
[    168ms] syncing wallet
[   1451ms] DUST ready — took 37ms
[   1460ms] NIGHT=500000000000000  DUST=1250000000000000000000000
[   1461ms] invoice amount (private): 42500
[  19862ms] deploy — took 18396ms
[  19862ms] deployed at fc927602cd7969ce0eea7d134dc1baa3bb43c4977233602377732ad7c87d274f
[  43659ms] create_invoice — took 23797ms
[  43660ms] commitment e3df416e7acafac5a9bff787e1b68be5136ec991588c8e93a90956631c763ad2
[  67658ms] settle_invoice — took 23998ms
[  67659ms] nullifier  fac42714d552f387e6c7a08962cd75091a34a021c18e2348e985c8a4ec5778bf
[  67866ms] double settle REJECTED: failed assert: invoice not open
[  67873ms] contract state present: true
[  68250ms] re-joined deployed contract: true
```

Deploy, two proven circuit calls with confirmed transactions, a correctly rejected replay, and
state read back through the indexer.

Note the replay was caught by the `invoice not open` status assert rather than the nullifier
assert — `settle_invoice` flips status to SETTLED before a second attempt reaches the nullifier
check. Both guards exist and both are correct; the status one simply fires first. Phase 2 should
keep the nullifier as the authoritative guard, since status alone is not sufficient once invoices
can be reopened or paid by multiple parties.

### The privacy claim, verified against the chain — not assumed

The product's entire premise is that the amount stays hidden. Checked rather than trusted:
`verify-privacy.ts` pulls the deployed contract's state, its zswap state and raw transaction bytes
from the indexer, then searches for the amount in **11 encodings** — decimal, big-endian hex,
little-endian hex, and both padded to 8/16/32/64 bytes.

```
searched 33132 chars of indexer data
  absent  decimal                42500
  absent  hex (big-endian)       a604
  absent  hex (little-endian)    04a6
  ... all 11 encodings absent ...
RESULT: amount does NOT appear in any indexer-visible data.
```

The commitment is on chain. The amount is not.

### Measured timings — the headline product risk

| Operation | Time |
|---|---|
| Wallet build + sync + DUST | 1.5 s |
| Contract deploy | 18.4 s |
| `create_invoice` (prove → balance → submit → confirm) | **23.8 s** |
| `settle_invoice` | **24.0 s** |
| Rejected replay (fails locally, never submitted) | 0.2 s |

**~24 seconds per circuit call on a local devnet with an idle proof server.** This is the number
that shapes Phase 7. A checkout that blocks for 24 seconds is not shippable as a naive spinner, and
this is the floor, not the ceiling — Mask's real circuits are larger than `mask_smoke`.

Design consequences to carry into Phase 1 and Phase 7:

- Payment UX must be asynchronous by default: commit the intent, show verifiable progress, and let
  the payer leave the tab.
- Circuit count per user action is a first-class design constraint — every extra proven call costs
  another ~24 s.
- Proof cost must be measured per circuit as Phase 2 grows, not discovered at the end.
- The rejected-replay path costs 0.2 s because it fails locally before submission. Failing fast and
  locally is a UX asset worth designing for deliberately.

### Traps found while getting here

Beyond the CRLF and healthcheck issues above, four more, all of which cost a run each:

5. `deployContract` will not accept a raw `new Contract(witnesses)`. It requires
   `CompiledContract.make(tag, ctor).pipe(withWitnesses(...), withCompiledFileAssets(...))` from
   `@midnight-ntwrk/midnight-js-protocol/compact-js`. Passing the raw class fails deep inside
   compact-js with `Cannot read properties of undefined (reading 'ctor')`.
6. The private-state store password must contain at least 3 of {uppercase, lowercase, digit,
   special}, enforced at deploy time.
7. **Duplicate WASM runtime.** Declaring `@midnight-ntwrk/compact-runtime` as a direct dependency
   made npm hoist `onchain-runtime-v3@3.1.0` while `midnight-js-protocol` pins `3.0.0` exactly, so a
   second nested copy appeared. Two WASM module instances mean `instanceof StateValue` fails across
   them, surfacing as `expected instance of StateValue` during a circuit call. Fixed with an
   `overrides` entry pinning a single `onchain-runtime-v3@3.0.0`, and by *not* declaring
   compact-runtime directly — which is exactly how example-bboard does it.
8. Compiled contract output must sit where Node can resolve `@midnight-ntwrk/compact-runtime` from
   it. `mask/midnight/node_modules` plus a `type: module` package.json in `contracts/` handles it.

## Still open in Phase 0

- ~~Deploy a contract and complete one full round trip.~~ **Done.**
- ~~Measure real proof-generation time.~~ **Done — ~24 s per circuit call.**
- **Lace wallet install, testnet account, tNIGHT from the faucet.** Not done. Everything above runs
  headlessly against the local devnet, which is the right target for Phases 1–6. Lace is required
  for Phase 7 (browser wallet integration) and for any public testnet demo, and it is the one
  Phase 0 item still outstanding.
- ~~Confirm proof-server 8.1.0 accepts circuits built against ledger 9.1.0.0-rc.3.~~ **Resolved —
  it does not, and it never would have.** See the stack decision above; we build on 0.31.1 /
  runtime 0.16.0 / ledger v8 instead. This was the predicted early failure and it was real.
