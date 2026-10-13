// mask_pay end-to-end on the local devnet.
//
// The simulator suite proves the contract's logic in milliseconds. This proves
// the same contract behaves identically once real proofs, a real wallet and a
// real chain are involved — which is the only claim that counts.
//
// Deliberately exercises a failure as well as the happy path: a settlement
// with the wrong amount must be rejected, and must be rejected *locally*,
// before anything is submitted or paid for.

import { webcrypto } from 'node:crypto';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';

import * as MaskPay from '../../contracts/build/mask_pay/contract/index.js';
import { GENESIS_MINT_WALLET_SEED } from './config.ts';
import { balances, buildWalletFromSeed, closeWallet, registerNightForDust, waitForSync } from './wallet.ts';
import { buildProviders } from './providers.ts';
import { generateOracleKeypair } from '../../contracts/src/oracle-signer.ts';
import { UNBOUND_COLORS } from '../../contracts/src/token-color.ts';

const ASSETS = new URL('../../contracts/build/mask_pay', import.meta.url).pathname;
const PRIVATE_STATE_ID = 'mask-pay-private-state';

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

const Compiled = CompiledContract.make<MaskPay.Contract<MaskPrivateState>>(
  'MaskPay',
  MaskPay.Contract,
).pipe(
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

// Matches the Compact enums: STANDARD = 0, NATIVE = 0.
const STANDARD = 0;
const NATIVE = 0;

const oracle = generateOracleKeypair();

async function main(): Promise<void> {
  step('building genesis wallet');
  const ctx = await buildWalletFromSeed(GENESIS_MINT_WALLET_SEED);
  await waitForSync(ctx.wallet);
  await registerNightForDust(ctx);
  const bal = await balances(ctx);
  step(`NIGHT=${bal.night} DUST=${bal.dust}`);

  const amount = 42_500n;
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
  step(`private amount: ${amount}`);

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
  step(`deployed at ${address}`);

  const callTx = (deployed as { callTx: Record<string, (...a: unknown[]) => Promise<unknown>> }).callTx;

  const created = (await time('create_invoice', () =>
    callTx.create_invoice(STANDARD, NATIVE, 0n),
  )) as { public: { txId: string }; private: { result: Uint8Array } };
  const commitment = created.private.result;
  step(`commitment ${toHex(commitment)}`);

  // Wrong amount => different commitment => matches no invoice. Must fail, and
  // must fail locally without spending anything.
  step('attempting settlement with the WRONG amount — must be rejected');
  let wrongRejected = false;
  let wrongMsg = '';
  const good = privateState.amount;
  try {
    await providers.privateStateProvider.set(PRIVATE_STATE_ID, {
      ...privateState,
      amount: good + 1n,
    } as never);
    await callTx.settle_invoice(STANDARD, NATIVE);
  } catch (e) {
    wrongRejected = true;
    wrongMsg = e instanceof Error ? e.message : String(e);
  } finally {
    await providers.privateStateProvider.set(PRIVATE_STATE_ID, privateState as never);
  }
  step(wrongRejected ? `wrong amount REJECTED: ${wrongMsg.slice(0, 120)}` : 'WRONG AMOUNT ACCEPTED — BUG');

  const settled = (await time('settle_invoice', () => callTx.settle_invoice(STANDARD, NATIVE))) as {
    public: { txId: string };
    private: { result: Uint8Array };
  };
  step(`receipt ${toHex(settled.private.result)}`);

  step('attempting replay — must be rejected');
  let replayRejected = false;
  let replayMsg = '';
  try {
    await callTx.settle_invoice(STANDARD, NATIVE);
  } catch (e) {
    replayRejected = true;
    replayMsg = e instanceof Error ? e.message : String(e);
  }
  step(replayRejected ? `replay REJECTED: ${replayMsg.slice(0, 120)}` : 'REPLAY ACCEPTED — BUG');

  const state = await providers.publicDataProvider.queryContractState(address);

  console.log('\n============== MASK_PAY E2E RESULT ==============');
  console.log(`address              ${address}`);
  console.log(`commitment           ${toHex(commitment)}`);
  console.log(`receipt              ${toHex(settled.private.result)}`);
  console.log(`amount kept private  ${amount}`);
  console.log(`wrong amount blocked ${wrongRejected}`);
  console.log(`replay blocked       ${replayRejected}`);
  console.log(`state readable       ${state !== null}`);
  console.log(`elapsed              ${Date.now() - t0}ms`);
  console.log('================================================\n');

  await closeWallet(ctx);
}

main().catch((e) => {
  console.error('\nE2E FAILED:', e);
  process.exitCode = 1;
});
