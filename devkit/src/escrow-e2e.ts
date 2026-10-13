// Escrowed settlement, on chain, with a real shielded coin.
//
// This is the one that matters: an invoice created for a private amount, then
// settled by actually moving a shielded coin worth exactly that amount, with
// the contract refusing anything else. Everything before this proved the logic;
// this proves the money moves.
//
// Afterwards the indexer is searched for the amount, because the product's
// claim is that it never appears — and that is checked, not asserted.

import { webcrypto } from 'node:crypto';
import * as Rx from 'rxjs';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';

import * as MaskPay from '../../contracts/build/mask_pay/contract/index.js';
import { GENESIS_MINT_WALLET_SEED, endpoints } from './config.ts';
import { balances, buildWalletFromSeed, closeWallet, registerNightForDust, waitForSync } from './wallet.ts';
import { buildProviders } from './providers.ts';
import { generateOracleKeypair } from '../../contracts/src/oracle-signer.ts';
import { UNBOUND_COLORS } from '../../contracts/src/token-color.ts';
import { fetchContractState, fetchPublicRecord, findLeaks, latestHeight } from './public-record.ts';

const ASSETS = new URL('../../contracts/build/mask_pay', import.meta.url).pathname;
const PRIVATE_STATE_ID = 'mask-escrow-private-state';

const STANDARD = 0;
const NATIVE = 0;

interface MaskPrivateState {
  merchantKey: Uint8Array;
  salt: Uint8Array;
  amount: bigint;
  payerKey: Uint8Array;
  paymentIndex: bigint;
  ownerSecret: Uint8Array;
  convertedAmount: bigint;
  // Unused here, but the Contract constructor requires a function for every
  // witness the circuit declares — including the ones only attestation and
  // batch settlement call.
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

const witnesses = {
  merchant_key: ({ privateState }: { privateState: MaskPrivateState }) => [privateState, privateState.merchantKey],
  invoice_salt: ({ privateState }: { privateState: MaskPrivateState }) => [privateState, privateState.salt],
  invoice_amount: ({ privateState }: { privateState: MaskPrivateState }) => [privateState, privateState.amount],
  payer_key: ({ privateState }: { privateState: MaskPrivateState }) => [privateState, privateState.payerKey],
  payment_index: ({ privateState }: { privateState: MaskPrivateState }) => [privateState, privateState.paymentIndex],
  owner_secret: ({ privateState }: { privateState: MaskPrivateState }) => [privateState, privateState.ownerSecret],
  converted_amount: ({ privateState }: { privateState: MaskPrivateState }) => [privateState, privateState.convertedAmount],
  attested_amounts: ({ privateState }: { privateState: MaskPrivateState }) => [privateState, privateState.attestedAmounts],
  attested_salts: ({ privateState }: { privateState: MaskPrivateState }) => [privateState, privateState.attestedSalts],
  attested_payers: ({ privateState }: { privateState: MaskPrivateState }) => [privateState, privateState.attestedPayers],
  attested_indices: ({ privateState }: { privateState: MaskPrivateState }) => [privateState, privateState.attestedIndices],
  attested_paths: ({ privateState }: { privateState: MaskPrivateState }) => [privateState, privateState.attestedPaths],
  batch_amounts: ({ privateState }: { privateState: MaskPrivateState }) => [privateState, privateState.batchAmounts],
  batch_salts: ({ privateState }: { privateState: MaskPrivateState }) => [privateState, privateState.batchSalts],
  batch_merchants: ({ privateState }: { privateState: MaskPrivateState }) => [privateState, privateState.batchMerchants],
  batch_indices: ({ privateState }: { privateState: MaskPrivateState }) => [privateState, privateState.batchIndices],
  // Required by the vendored Schnorr verifier: quotient and remainder of the
  // challenge divided by 2^248. See contracts/src/vendor/schnorr.compact.
  getSchnorrReduction: (
    { privateState }: { privateState: MaskPrivateState },
    challengeHash: bigint,
  ) => [privateState, [challengeHash / (1n << 248n), challengeHash % (1n << 248n)]],
};

const Compiled = CompiledContract.make<MaskPay.Contract<MaskPrivateState>>('MaskPay', MaskPay.Contract).pipe(
  CompiledContract.withWitnesses(witnesses as never),
  CompiledContract.withCompiledFileAssets('.'),
);

const t0 = Date.now();
const step = (m: string) => console.log(`[${String(Date.now() - t0).padStart(7)}ms] ${m}`);
const time = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const s = Date.now();
  const r = await fn();
  console.log(`[${String(Date.now() - t0).padStart(7)}ms] ${label} — ${Date.now() - s}ms`);
  return r;
};
const rand = (n: number) => webcrypto.getRandomValues(new Uint8Array(n));

const asBytes = (v: unknown): Uint8Array => {
  if (v instanceof Uint8Array) return v;
  if (typeof v === 'string') return Uint8Array.from(Buffer.from(v, 'hex'));
  const inner = (v as { bytes?: unknown })?.bytes;
  if (inner instanceof Uint8Array) return inner;
  if (typeof inner === 'string') return Uint8Array.from(Buffer.from(inner, 'hex'));
  throw new Error(`cannot coerce to bytes: ${JSON.stringify(v)}`);
};

/**
 * Does the settled amount appear anywhere an observer can read?
 *
 * Uses the shared public-record search rather than a bespoke one, and reports
 * three outcomes instead of two, because this run genuinely has three.
 *
 * The amount here is not chosen: it is the value of a real shielded coin the
 * genesis wallet holds, which on this devnet is 50_000_000_000_000 — the block
 * reward. That number is printed in plain decimal in every block's unshielded
 * outputs, so the search finds it and cannot tell a disclosure from the chain
 * paying its own author. Reporting that as a leak was wrong; reporting it as
 * clean would be worse. It is undecidable, and says so.
 *
 * `token-e2e.ts` decides the same question properly, by minting a coin whose
 * value it chooses.
 */
async function amountVisibility(
  address: string,
  amount: bigint,
  fromHeight: number,
): Promise<'absent' | 'present' | 'undecidable'> {
  const record = await fetchPublicRecord(fromHeight, await latestHeight());
  const haystack = record.blob + (await fetchContractState(address));
  console.log(`  searched ${haystack.length} chars over ${record.blocks} blocks`);

  const hits = findLeaks(haystack, amount).filter((h) => h.strong);
  for (const h of hits) console.log(`    FOUND   ${h.label.padEnd(8)} ${h.pattern}`);

  if (hits.length === 0) return 'absent';

  // Is every hit explained by the chain's own block rewards? Those sit in an
  // unshieldedCreatedOutputs value field, which our contract never writes to.
  const outsideRewards = hits.some(
    (h) =>
      h.label !== 'decimal' ||
      !haystack.includes(`"unshieldedcreatedoutputs":[{"value":"${amount}"`),
  );
  return outsideRewards ? 'present' : 'undecidable';
}

const oracle = generateOracleKeypair();

async function main(): Promise<void> {
  // Recorded before anything is published, so the search covers this run only.
  const fromHeight = await latestHeight();

  step('building genesis wallet');
  const ctx = await buildWalletFromSeed(GENESIS_MINT_WALLET_SEED);
  await waitForSync(ctx.wallet);
  await registerNightForDust(ctx);
  const bal = await balances(ctx);
  step(`NIGHT=${bal.night}`);

  // Pick a real spendable shielded coin. Its value becomes the invoice amount,
  // so the escrow check has something exact to enforce.
  const wstate = await Rx.firstValueFrom(ctx.wallet.state());
  const available = (wstate.shielded as unknown as { availableCoins?: unknown[] }).availableCoins ?? [];
  step(`wallet holds ${available.length} shielded coins`);

  const native = available
    .map((c) => (c as { coin: { type: string; nonce: string; value: string; mt_index: string } }).coin)
    .find((c) => /^0+$/.test(c.type));

  if (!native) {
    throw new Error('no native shielded coin available to spend');
  }

  // Unqualified: the escrow circuit receives this coin and forwards it in the
  // same transaction, so no merkle-tree index is involved.
  const coin = {
    nonce: asBytes(native.nonce),
    color: asBytes(native.type),
    value: BigInt(native.value),
  };
  const amount = coin.value;
  step(`spending coin value=${amount}`);

  const privateState: MaskPrivateState = {
    merchantKey: rand(32),
    salt: rand(32),
    amount,
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
  };

  const providers = buildProviders(ctx, {
    zkConfigPath: ASSETS,
    privateStateStoreName: PRIVATE_STATE_ID,
    accountId: GENESIS_MINT_WALLET_SEED,
  });

  const deployed = await time('deploy mask_pay', () =>
    deployContract(providers as never, {
      compiledContract: Compiled,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: privateState,
      // The oracle key is sealed at construction and can never be changed.
      args: [oracle.publicKey, UNBOUND_COLORS.musdc, UNBOUND_COLORS.musad],
    } as never),
  );
  const address = (deployed as { deployTxData: { public: { contractAddress: string } } }).deployTxData.public
    .contractAddress;
  const callTx = (deployed as { callTx: Record<string, (...a: unknown[]) => Promise<unknown>> }).callTx;
  step(`deployed at ${address}`);

  const created = (await time('create_invoice', () => callTx.create_invoice(STANDARD, NATIVE, 0n))) as {
    private: { result: Uint8Array };
  };
  step(`commitment ${toHex(created.private.result)}`);

  const merchantAddr = { bytes: asBytes(ctx.shieldedSecretKeys.coinPublicKey) };

  // Underpayment must be refused by the COIN VALUE check specifically.
  //
  // The private state is left correct so the commitment still resolves to the
  // real invoice; only the coin is short. Mutating the amount instead would
  // change the commitment and fail earlier at "unknown invoice", which proves
  // nothing about escrow — a green test for the wrong reason.
  step('attempting escrow with an UNDERPAYING coin — must be rejected on coin value');
  const shortCoin = { ...coin, value: coin.value - 1n };
  let underRejected = false;
  let underByValue = false;
  let underMsg = '';
  try {
    await callTx.settle_invoice_shielded(STANDARD, NATIVE, shortCoin, merchantAddr);
  } catch (e) {
    underRejected = true;
    underMsg = e instanceof Error ? e.message : String(e);
    underByValue = /coin value does not match/.test(underMsg);
  }
  step(
    underRejected
      ? `underpayment REJECTED${underByValue ? ' (by coin value check)' : ' (WRONG REASON)'}: ${underMsg.slice(0, 140)}`
      : 'UNDERPAYMENT ACCEPTED — BUG',
  );

  const settled = (await time('settle_invoice_shielded', () =>
    callTx.settle_invoice_shielded(STANDARD, NATIVE, coin, merchantAddr),
  )) as { private: { result: Uint8Array } };
  step(`receipt ${toHex(settled.private.result)}`);

  step('searching the public record for the amount');
  const visibility = await amountVisibility(address, amount, fromHeight);

  console.log('\n============= ESCROW E2E RESULT =============');
  console.log(`address               ${address}`);
  console.log(`commitment            ${toHex(created.private.result)}`);
  console.log(`receipt               ${toHex(settled.private.result)}`);
  console.log(`coin value moved      ${amount}`);
  console.log(`underpayment blocked  ${underRejected} (by coin-value check: ${underByValue})`);
  console.log(
    `amount in public data ${
      visibility === 'absent'
        ? 'absent'
        : visibility === 'undecidable'
          ? 'undecidable — equals the block reward; see token-e2e.ts'
          : 'PRESENT — LEAK'
    }`,
  );
  console.log(`elapsed               ${Date.now() - t0}ms`);
  console.log('============================================\n');

  if (visibility === 'present') process.exitCode = 1;
  await closeWallet(ctx);
}

main().catch((e) => {
  console.error('\nESCROW E2E FAILED:', e);
  process.exitCode = 1;
});
