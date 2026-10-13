// Prove revenue on chain, against the real proof server and a real ledger.
//
// The attestation is the product's headline claim: a merchant proves total
// revenue is at least X without revealing any invoice, any amount, or any
// payer. Until now it had only ever run inside the simulator, where the Merkle
// tree is a JavaScript object. That is not the same thing as proving it — the
// paths here come out of the ledger the indexer serves, and the proof is built
// by the same proof server a user would hit.
//
// Four payments, four Merkle paths, one proof. Measured, and then checked for
// leaks: after the attestation is published, none of the four amounts and none
// of the payer keys may appear anywhere in the contract's public state.

import { webcrypto } from 'node:crypto';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';

import * as MaskPay from '../../contracts/build/mask_pay/contract/index.js';
import { GENESIS_MINT_WALLET_SEED } from './config.ts';
import { buildWalletFromSeed, closeWallet, registerNightForDust, waitForSync } from './wallet.ts';
import { buildProviders } from './providers.ts';
import { generateOracleKeypair } from '../../contracts/src/oracle-signer.ts';
import { UNBOUND_COLORS } from '../../contracts/src/token-color.ts';
import {
  fetchContractState,
  fetchPublicRecord,
  findLeaks,
  findRaw,
  latestHeight,
  waitForIndexed,
} from './public-record.ts';

const ASSETS = new URL('../../contracts/build/mask_pay', import.meta.url).pathname;
const PRIVATE_STATE_ID = 'mask-attest';
const STANDARD = 0;
const NATIVE = 0;

/**
 * The four real payments, and the claim made about their sum.
 *
 * Deliberately large. A small amount such as 7500 encodes as the two bytes
 * `1d4c`, which occurs by chance about a dozen times in an 800 KB hex blob —
 * the leak search cannot tell that from a real disclosure, in either direction.
 * Six-byte values do not collide, so an absence here is evidence.
 */
const AMOUNTS = [123_456_789_012_345n, 234_567_890_123_456n, 345_678_901_234_567n, 456_789_012_345_678n];
const THRESHOLD = 1_100_000_000_000_000n;

/**
 * A distinctive public expiry, used as the search's positive control.
 *
 * `expires_at` is written into the invoice record in the clear, so it MUST turn
 * up in the public data. If it does not, the search is looking at the wrong
 * bytes and an absent amount would prove nothing.
 */
const PUBLIC_EXPIRY = 1_759_296_000_777n;

const rand = (n: number) => webcrypto.getRandomValues(new Uint8Array(n));

interface PS {
  merchantKey: Uint8Array;
  salt: Uint8Array;
  amount: bigint;
  payerKey: Uint8Array;
  paymentIndex: bigint;
  ownerSecret: Uint8Array;
  convertedAmount: bigint;
  attestedAmounts: bigint[];
  attestedSalts: Uint8Array[];
  attestedPayers: Uint8Array[];
  attestedIndices: bigint[];
  attestedPaths: unknown[];
  batchAmounts: bigint[];
  batchSalts: Uint8Array[];
  batchMerchants: Uint8Array[];
  batchIndices: bigint[];
}

const MERCHANT = new Uint8Array(32).fill(0x7a);

const base = (over: Partial<PS> = {}): PS => ({
  merchantKey: MERCHANT,
  salt: rand(32),
  amount: 0n,
  payerKey: rand(32),
  paymentIndex: 0n,
  ownerSecret: crypto.getRandomValues(new Uint8Array(32)),
  convertedAmount: 0n,
  attestedAmounts: [],
  attestedSalts: [],
  attestedPayers: [],
  attestedIndices: [],
  attestedPaths: [],
  batchAmounts: [],
  batchSalts: [],
  batchMerchants: [],
  batchIndices: [],
  ...over,
});

const w =
  <K extends keyof PS>(k: K) =>
  ({ privateState }: { privateState: PS }) =>
    [privateState, privateState[k]] as const;

const witnesses = {
  merchant_key: w('merchantKey'),
  invoice_salt: w('salt'),
  invoice_amount: w('amount'),
  payer_key: w('payerKey'),
  payment_index: w('paymentIndex'),
  owner_secret: w('ownerSecret'),
  converted_amount: w('convertedAmount'),
  attested_amounts: w('attestedAmounts'),
  attested_salts: w('attestedSalts'),
  attested_payers: w('attestedPayers'),
  attested_indices: w('attestedIndices'),
  attested_paths: w('attestedPaths'),
  batch_amounts: w('batchAmounts'),
  batch_salts: w('batchSalts'),
  batch_merchants: w('batchMerchants'),
  batch_indices: w('batchIndices'),
  getSchnorrReduction: ({ privateState }: { privateState: PS }, c: bigint) => [
    privateState,
    [c / (1n << 248n), c % (1n << 248n)],
  ],
};

const Compiled = CompiledContract.make<MaskPay.Contract<PS>>('MaskPay', MaskPay.Contract).pipe(
  CompiledContract.withWitnesses(witnesses as never),
  CompiledContract.withCompiledFileAssets('.'),
);

const step = (m: string) => console.log(`\n> ${m}`);

async function time<T>(label: string, fn: () => Promise<T>): Promise<[T, number]> {
  const t = Date.now();
  const r = await fn();
  const ms = Date.now() - t;
  console.log(`  ${label.padEnd(32)} ${String(ms).padStart(7)}ms`);
  return [r, ms];
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const oracle = generateOracleKeypair();
  const ctx = await buildWalletFromSeed(GENESIS_MINT_WALLET_SEED);
  await waitForSync(ctx.wallet);
  await registerNightForDust(ctx);

  const providers = buildProviders(ctx, {
    zkConfigPath: ASSETS,
    privateStateStoreName: PRIVATE_STATE_ID,
    accountId: GENESIS_MINT_WALLET_SEED,
  });

  const setState = (s: PS) =>
    (providers.privateStateProvider as { set(id: string, s: PS): Promise<void> }).set(
      PRIVATE_STATE_ID,
      s,
    );

  // Everything this run publishes lands at or after this height.
  const deployHeight = await latestHeight();

  step('deploying a fresh mask_pay');
  const deployed = await deployContract(providers as never, {
    compiledContract: Compiled,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: base(),
    args: [oracle.publicKey, UNBOUND_COLORS.musdc, UNBOUND_COLORS.musad],
  } as never);
  const callTx = (deployed as { callTx: Record<string, (...a: unknown[]) => Promise<unknown>> })
    .callTx;
  const address = (deployed as { deployTxData: { public: { contractAddress: string } } })
    .deployTxData.public.contractAddress;
  console.log(`  ${address}`);

  // Four invoices from one merchant, then four settlements. Every private term
  // is kept so the attestation can recompute the receipts later.
  const payments = AMOUNTS.map((amount) => ({ amount, salt: rand(32), payer: rand(32) }));

  step('creating four invoices');
  for (const p of payments) {
    await setState(base({ salt: p.salt, amount: p.amount }));
    await callTx.create_invoice(STANDARD, NATIVE, PUBLIC_EXPIRY);
  }

  step('settling all four');
  const receipts: Uint8Array[] = [];
  for (const p of payments) {
    await setState(base({ salt: p.salt, amount: p.amount, payerKey: p.payer }));
    const r = (await callTx.settle_invoice(STANDARD, NATIVE)) as { private: { result: Uint8Array } };
    receipts.push(r.private.result);
    console.log(`  receipt ${toHex(r.private.result)}`);
  }

  // The paths come from the ledger the indexer serves, not from a local
  // reconstruction — that is the whole point of running this on chain.
  step('reading the receipt tree from chain');
  const state = await providers.publicDataProvider.queryContractState(address);
  if (state === null) throw new Error('contract state unreadable');
  const ledger = MaskPay.ledger(state.data as never) as unknown as {
    receipt_tree: { findPathForLeaf(leaf: Uint8Array): unknown };
  };

  const paths = receipts.map((r) => {
    const p = ledger.receipt_tree.findPathForLeaf(r);
    if (p === undefined) throw new Error(`receipt ${toHex(r)} is not in the on-chain tree`);
    return p;
  });
  console.log('  four paths recovered from on-chain state');

  const realTotal = AMOUNTS.reduce((a, b) => a + b, 0n);
  step(`proving revenue >= ${THRESHOLD} (real total ${realTotal}, never disclosed)`);
  await setState(
    base({
      attestedAmounts: payments.map((p) => p.amount),
      attestedSalts: payments.map((p) => p.salt),
      attestedPayers: payments.map((p) => p.payer),
      attestedIndices: [0n, 0n, 0n, 0n],
      attestedPaths: paths,
    }),
  );
  const [attested, attestMs] = await time('attest_revenue_at_least', () =>
    callTx.attest_revenue_at_least(STANDARD, NATIVE, THRESHOLD),
  );
  const digest = (attested as { private: { result: Uint8Array } }).private.result;
  console.log(`  digest ${toHex(digest)}`);

  // A false claim must fail, and must fail without publishing anything.
  // Derived from the real total, never a constant. An earlier version hardcoded
  // 100_000 here; when the amounts were raised to six-byte values that number
  // fell BELOW the real total, so the "false" claim was true, the contract
  // rightly accepted it, and the run reported a contract failure that was
  // really a test failure.
  const falseThreshold = realTotal + 1n;
  step(`claiming ${falseThreshold}, one more than the real total — must be rejected`);
  let falseRejected = false;
  let falseMsg = '';
  try {
    await callTx.attest_revenue_at_least(STANDARD, NATIVE, falseThreshold);
  } catch (e) {
    falseRejected = true;
    falseMsg = e instanceof Error ? e.message : String(e);
  }
  console.log(falseRejected ? `  REJECTED: ${falseMsg.slice(0, 110)}` : '  ACCEPTED — BUG');

  step('verifying the attestation is published and readable by anyone');
  const after = await providers.publicDataProvider.queryContractState(address);
  const ledgerAfter = MaskPay.ledger(after!.data as never) as unknown as {
    attestations: { member(d: Uint8Array): boolean; size(): bigint };
  };
  const published = ledgerAfter.attestations.member(digest);
  console.log(`  attestations: ${ledgerAfter.attestations.size()}, ours present: ${published}`);

  // The leak check, against the record an outside observer can actually read:
  // every block since this contract was deployed, every raw transaction in
  // them, and the contract's own state.
  //
  // Serialising the ledger object instead would be worthless — it is a WASM
  // handle, and JSON.stringify returns almost nothing for it. An earlier
  // version of this script did exactly that and reported "no leaks" over 293
  // characters, which proves nothing at all.
  step('checking the public record for leaks');
  // Wait for the indexer to serve the attestation before searching for it.
  // The node confirming and the indexer serving are separate events, and
  // reading too early would find nothing and fail the control.
  if (!(await waitForIndexed(address, toHex(digest)))) {
    console.error('');
    console.error('The indexer never served the attestation. Nothing was searched.');
    process.exitCode = 1;
    await closeWallet(ctx);
    return;
  }

  const record = await fetchPublicRecord(deployHeight, await latestHeight());
  const haystack = record.blob + (await fetchContractState(address));
  console.log(
    `  ${record.blocks} blocks, ${record.transactions} transactions, ${haystack.length} chars`,
  );

  const hits = [
    ...AMOUNTS.flatMap((a) => findLeaks(haystack, a)),
    ...findLeaks(haystack, realTotal, `total ${realTotal}`),
    ...payments.flatMap((p) => findRaw(haystack, toHex(p.payer), 'payer key')),
    ...payments.flatMap((p) => findRaw(haystack, toHex(p.salt), 'invoice salt')),
    ...findRaw(haystack, toHex(MERCHANT), 'merchant key'),
  ];
  const leaks = hits.filter((h) => h.strong).map((h) => `${h.value} as ${h.label}`);
  const weak = hits.filter((h) => !h.strong).map((h) => `${h.value} as ${h.label}`);
  if (weak.length > 0) console.log(`  ${weak.length} weak-needle hits ignored (chance collisions)`);

  // Positive control: a value that is public by design must be found. Without
  // it, "no amounts found" is indistinguishable from "nothing was searched
  // properly" — which is exactly what happened when the needle set held only
  // padded widths and missed the minimal little-endian form the ledger uses.
  const controlHits = findLeaks(haystack, PUBLIC_EXPIRY, `expiry ${PUBLIC_EXPIRY}`);
  const controlOk = controlHits.length > 0 && haystack.length > 10_000;
  console.log(
    controlOk
      ? `  control: public expiry found as ${controlHits.map((h) => h.label).join(', ')} — the search sees ledger integers`
      : `  CONTROL FAILED: public expiry not found in ${haystack.length} chars — search is blind`,
  );

  const ok =
    published && falseRejected && leaks.length === 0 && receipts.length === 4 && controlOk;

  console.log('\n============== ATTESTATION E2E RESULT ==============');
  console.log(`address                  ${address}`);
  console.log('payments settled         4');
  console.log(`threshold proven         ${THRESHOLD}`);
  console.log(`real total (private)     ${realTotal}`);
  console.log(`attest_revenue_at_least  ${attestMs}ms`);
  console.log(`digest                   ${toHex(digest)}`);
  console.log(`published on ledger      ${published}`);
  console.log(`false claim rejected     ${falseRejected}`);
  console.log(`leaks in public record   ${leaks.length === 0 ? 'none' : leaks.join(', ')}`);
  console.log(`searched                 ${record.blocks} blocks, ${record.transactions} txs, ${haystack.length} chars`);
  console.log(`search control           ${controlOk ? 'passed (threshold visible)' : 'FAILED'}`);
  console.log(`elapsed                  ${Date.now() - t0}ms`);
  console.log(ok ? 'ATTESTATION E2E PASSED' : 'ATTESTATION E2E FAILED');
  console.log('===================================================\n');

  if (!ok) process.exitCode = 1;
  await closeWallet(ctx);
}

main().catch((e) => {
  console.error('\nATTEST E2E FAILED:', e);
  process.exitCode = 1;
});
