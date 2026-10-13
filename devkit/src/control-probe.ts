// Can the privacy check see a value that IS public?
//
// "The amount does not appear on chain" is only meaningful if the search would
// have found it had it been there. So this publishes a number deliberately —
// `expires_at` is written into the public invoice record — and then looks for
// it with exactly the same needles the privacy check uses.
//
// If the control value is found, an absent amount means something. If the
// control value is NOT found, the search is blind to public integers and every
// clean result it has ever printed is worth nothing. That is the difference
// between a verified claim and a comfortable one.

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
  needles,
  waitForIndexed,
} from './public-record.ts';

const ASSETS = new URL('../../contracts/build/mask_pay', import.meta.url).pathname;
const PRIVATE_STATE_ID = 'mask-control';
const STANDARD = 0;
const NATIVE = 0;

/** Public by design: written into the invoice record for anyone to read. */
const PUBLIC_EXPIRY = 1_759_296_000_123n;
/**
 * Private by design: never leaves the witness.
 *
 * Six bytes wide on purpose. A small amount encodes as two bytes and turns up
 * in a megabyte of hex by chance, which would make this probe report a leak
 * that is not there.
 */
const PRIVATE_AMOUNT = 867_530_912_345_678n;

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

const MERCHANT = new Uint8Array(32).fill(0x3c);
const SALT = rand(32);

const state: PS = {
  merchantKey: MERCHANT,
  salt: SALT,
  amount: PRIVATE_AMOUNT,
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

  const from = await latestHeight();

  console.log('deploying…');
  const deployed = await deployContract(providers as never, {
    compiledContract: Compiled,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: state,
    args: [oracle.publicKey, UNBOUND_COLORS.musdc, UNBOUND_COLORS.musad],
  } as never);
  const callTx = (deployed as { callTx: Record<string, (...a: unknown[]) => Promise<unknown>> })
    .callTx;
  const address = (deployed as { deployTxData: { public: { contractAddress: string } } })
    .deployTxData.public.contractAddress;

  console.log(`creating an invoice with a PUBLIC expiry of ${PUBLIC_EXPIRY}`);
  console.log(`                and a PRIVATE amount of ${PRIVATE_AMOUNT}`);
  const created = (await callTx.create_invoice(STANDARD, NATIVE, PUBLIC_EXPIRY)) as {
    private: { result: Uint8Array };
  };
  const commitment = created.private.result;
  console.log(`commitment ${toHex(commitment)}`);

  // The node has confirmed the create; the indexer may not have served its
  // block yet. Reading now would find nothing and report the search as blind —
  // which is what happened inside a full QA run, where three other on-chain
  // checks were competing for the same indexer.
  const indexed = await waitForIndexed(address, toHex(commitment));
  if (!indexed) {
    console.error('');
    console.error('The indexer never served the new invoice. Nothing was searched.');
    console.error('That is an indexer problem, not a privacy result — no verdict is given.');
    process.exitCode = 1;
    await closeWallet(ctx);
    return;
  }

  const record = await fetchPublicRecord(from, await latestHeight());
  const haystack = record.blob + (await fetchContractState(address));
  console.log(`\nsearched ${haystack.length} chars over ${record.blocks} blocks\n`);

  // Control 1: the commitment. A 32-byte value the contract publishes outright.
  const commitHit = findRaw(haystack, toHex(commitment), 'commitment').length > 0;
  console.log(`commitment visible          ${commitHit ? 'YES' : 'NO'}`);

  // Control 2: the public integer. This is the one that decides whether an
  // absent amount means anything.
  const expiryHits = findLeaks(haystack, PUBLIC_EXPIRY);
  console.log(
    `public expiry visible       ${expiryHits.length > 0 ? `YES as ${expiryHits.map((h) => h.label).join(', ')}` : 'NO'}`,
  );
  if (expiryHits.length === 0) {
    console.log('  encodings tried:');
    for (const n of needles(PUBLIC_EXPIRY)) console.log(`    ${n.label.padEnd(8)} ${n.pattern}`);
  }

  // The thing that must NOT be there.
  const amountHits = findLeaks(haystack, PRIVATE_AMOUNT).filter((h) => h.strong);
  console.log(
    `private amount visible      ${amountHits.length > 0 ? `YES as ${amountHits.map((h) => h.label).join(', ')}` : 'NO'}`,
  );
  const saltHit = findRaw(haystack, toHex(SALT), 'salt').length > 0;
  const merchantHit = findRaw(haystack, toHex(MERCHANT), 'merchant').length > 0;
  console.log(`invoice salt visible        ${saltHit ? 'YES' : 'NO'}`);
  console.log(`merchant key visible        ${merchantHit ? 'YES' : 'NO'}`);

  const controlWorks = commitHit && expiryHits.length > 0;
  console.log('\n================= CONTROL PROBE =================');
  console.log(`address            ${address}`);
  if (controlWorks) {
    console.log('The search CAN see public values, so an absent private value');
    console.log('is evidence rather than an artefact of looking in the wrong place.');
  } else {
    console.log('THE SEARCH IS BLIND to values that are definitely public.');
    console.log('Every "no leak found" result from this method is unproven until fixed.');
  }
  console.log(
    `verdict            ${controlWorks && amountHits.length === 0 && !saltHit && !merchantHit ? 'PRIVACY VERIFIED' : controlWorks ? 'LEAK FOUND' : 'CHECK UNPROVEN'}`,
  );
  console.log('=================================================\n');

  if (!controlWorks || amountHits.length > 0 || saltHit || merchantHit) process.exitCode = 1;
  await closeWallet(ctx);
}

main().catch((e) => {
  console.error('CONTROL PROBE FAILED:', e);
  process.exitCode = 1;
});
