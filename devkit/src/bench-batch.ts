// Is batching actually faster?
//
// One proof covering four settlements replaces four proofs of ~30s each. That
// is only a win if proving cost grows sub-linearly with circuit size, which is
// an empirical question about PLONK and this circuit — not something to assume
// from the shape of the code.
//
// So: create four invoices, settle four individually, create four more, settle
// them as a batch, and compare. Reported either way.

import { webcrypto } from 'node:crypto';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';

import * as MaskPay from '../../contracts/build/mask_pay/contract/index.js';
import { GENESIS_MINT_WALLET_SEED } from './config.ts';
import { buildWalletFromSeed, closeWallet, registerNightForDust, waitForSync } from './wallet.ts';
import { buildProviders } from './providers.ts';
import { generateOracleKeypair } from '../../contracts/src/oracle-signer.ts';
import { UNBOUND_COLORS } from '../../contracts/src/token-color.ts';

const ASSETS = new URL('../../contracts/build/mask_pay', import.meta.url).pathname;
const PRIVATE_STATE_ID = 'mask-bench';
const STANDARD = 0;
const NATIVE = 0;

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

const base = (over: Partial<PS> = {}): PS => ({
  merchantKey: new Uint8Array(32).fill(0x11),
  salt: rand(32),
  amount: 1_000n,
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

const w = <K extends keyof PS>(k: K) => ({ privateState }: { privateState: PS }) =>
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

const time = async <T>(label: string, fn: () => Promise<T>): Promise<[T, number]> => {
  const t = Date.now();
  const r = await fn();
  const ms = Date.now() - t;
  console.log(`  ${label.padEnd(34)} ${String(ms).padStart(7)}ms`);
  return [r, ms];
};

async function main(): Promise<void> {
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

  console.log('deploying…');
  const deployed = await deployContract(providers as never, {
    compiledContract: Compiled,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: base(),
    args: [oracle.publicKey, UNBOUND_COLORS.musdc, UNBOUND_COLORS.musad],
  } as never);
  const callTx = (deployed as { callTx: Record<string, (...a: unknown[]) => Promise<unknown>> }).callTx;
  const address = (deployed as { deployTxData: { public: { contractAddress: string } } }).deployTxData
    .public.contractAddress;
  console.log(`deployed ${address}\n`);

  const merchant = new Uint8Array(32).fill(0x11);

  // ---- four individual settlements ----
  console.log('FOUR INDIVIDUAL SETTLEMENTS');
  const singles = Array.from({ length: 4 }, (_, i) => ({
    salt: rand(32),
    amount: BigInt(1_000 * (i + 1)),
  }));

  for (const s of singles) {
    await setState(base({ merchantKey: merchant, salt: s.salt, amount: s.amount }));
    await callTx.create_invoice(STANDARD, NATIVE, 0n);
  }

  let individualTotal = 0;
  for (const [i, s] of singles.entries()) {
    await setState(base({ merchantKey: merchant, salt: s.salt, amount: s.amount, payerKey: rand(32) }));
    const [, ms] = await time(`settle_invoice #${i + 1}`, () => callTx.settle_invoice(STANDARD, NATIVE));
    individualTotal += ms;
  }
  console.log(`  ${'TOTAL'.padEnd(34)} ${String(individualTotal).padStart(7)}ms\n`);

  // ---- one batch of four ----
  console.log('ONE BATCH OF FOUR');
  const batch = Array.from({ length: 4 }, (_, i) => ({
    salt: rand(32),
    amount: BigInt(5_000 * (i + 1)),
  }));

  for (const b of batch) {
    await setState(base({ merchantKey: merchant, salt: b.salt, amount: b.amount }));
    await callTx.create_invoice(STANDARD, NATIVE, 0n);
  }

  await setState(
    base({
      payerKey: rand(32),
      batchAmounts: batch.map((b) => b.amount),
      batchSalts: batch.map((b) => b.salt),
      batchMerchants: [merchant, merchant, merchant, merchant],
      batchIndices: [0n, 0n, 0n, 0n],
    }),
  );
  const [, batchMs] = await time('settle_batch (4 invoices)', () =>
    callTx.settle_batch(STANDARD, NATIVE),
  );

  const saved = individualTotal - batchMs;
  const pct = Math.round((saved / individualTotal) * 100);

  console.log('\n================= BATCH BENCHMARK =================');
  console.log(`four individual settlements   ${individualTotal}ms`);
  console.log(`one batch of four             ${batchMs}ms`);
  console.log(
    saved > 0
      ? `batching saves                ${saved}ms  (${pct}% faster)`
      : `batching COSTS                ${-saved}ms  (${-pct}% slower)`,
  );
  console.log('===================================================\n');

  await closeWallet(ctx);
}

main().catch((e) => {
  console.error('BENCH FAILED:', e);
  process.exitCode = 1;
});
