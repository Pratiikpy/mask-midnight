// Deploy Mask to the local devnet and record the addresses for the app.
//
// Two contracts, in order, because the second depends on the first:
//
//   mask_token issues the mUSDC and mUSAD reference assets. Their colours are
//   derived from its address, so it has to exist before anything can name them.
//
//   mask_pay seals those two colours in at construction, which is what ties an
//   invoice denominated in mUSDC to a coin that actually is mUSDC. Sealed
//   means nobody can re-point them later, including whoever deployed this.
//
// Writes app/.env.local so the frontend picks both up without anyone copying a
// hex string by hand, and prints the oracle secret that was sealed in — that
// key can never be changed afterwards, so it has to be kept.

import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';

import * as MaskPay from '../../contracts/build/mask_pay/contract/index.js';
import * as MaskToken from '../../contracts/build/mask_token/contract/index.js';
import { GENESIS_MINT_WALLET_SEED } from './config.ts';
import { balances, buildWalletFromSeed, closeWallet, registerNightForDust, waitForSync } from './wallet.ts';
import { buildProviders } from './providers.ts';
import { generateOracleKeypair } from '../../contracts/src/oracle-signer.ts';
import { maskTokenColors } from '../../contracts/src/token-color.ts';

const ASSETS = new URL('../../contracts/build/mask_pay', import.meta.url).pathname;
const TOKEN_ASSETS = new URL('../../contracts/build/mask_token', import.meta.url).pathname;
const ENV_PATH = new URL('../../app/.env.local', import.meta.url).pathname;
const PRIVATE_STATE_ID = 'mask-deploy';

interface MaskPrivateState {
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

const rand = (n: number) => webcrypto.getRandomValues(new Uint8Array(n));

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
  getSchnorrReduction: (
    { privateState }: { privateState: MaskPrivateState },
    challengeHash: bigint,
  ) => [privateState, [challengeHash / (1n << 248n), challengeHash % (1n << 248n)]],
};

const Compiled = CompiledContract.make<MaskPay.Contract<MaskPrivateState>>('MaskPay', MaskPay.Contract).pipe(
  CompiledContract.withWitnesses(witnesses as never),
  CompiledContract.withCompiledFileAssets('.'),
);

// mask_token has no witnesses: everything it needs is an argument or ledger
// state, so there is nothing private to supply.
const CompiledToken = CompiledContract.make<MaskToken.Contract<Record<string, never>>>(
  'MaskToken',
  MaskToken.Contract,
).pipe(CompiledContract.withWitnesses({} as never), CompiledContract.withCompiledFileAssets('.'));

async function main(): Promise<void> {
  const oracle = generateOracleKeypair();

  console.log('building genesis wallet…');
  const ctx = await buildWalletFromSeed(GENESIS_MINT_WALLET_SEED);
  await waitForSync(ctx.wallet);
  await registerNightForDust(ctx);
  const bal = await balances(ctx);
  console.log(`NIGHT=${bal.night}`);

  const tokenProviders = buildProviders(ctx, {
    zkConfigPath: TOKEN_ASSETS,
    privateStateStoreName: `${PRIVATE_STATE_ID}-token`,
    accountId: GENESIS_MINT_WALLET_SEED,
  });

  console.log('deploying mask_token…');
  const tokenStarted = Date.now();
  const tokenDeployed = await deployContract(tokenProviders as never, {
    compiledContract: CompiledToken,
    privateStateId: `${PRIVATE_STATE_ID}-token`,
    initialPrivateState: {},
    args: [rand(32)],
  } as never);
  const tokenAddress = (tokenDeployed as { deployTxData: { public: { contractAddress: string } } })
    .deployTxData.public.contractAddress;
  console.log(`mask_token deployed in ${Date.now() - tokenStarted}ms at ${tokenAddress}`);

  // Derived, not queried: the colour of a shielded token is a pure function of
  // (domain separator, issuing address), and calling `token_color` on chain
  // would cost a proof and half a minute for a value we can compute here. The
  // derivation is checked against the compiled contract by
  // contracts/test/token-color.test.ts.
  const colors = maskTokenColors(tokenAddress);

  const providers = buildProviders(ctx, {
    zkConfigPath: ASSETS,
    privateStateStoreName: PRIVATE_STATE_ID,
    accountId: GENESIS_MINT_WALLET_SEED,
  });

  const initialPrivateState: MaskPrivateState = {
    merchantKey: rand(32),
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
  };

  console.log('deploying mask_pay…');
  const started = Date.now();
  const deployed = await deployContract(providers as never, {
    compiledContract: Compiled,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState,
    args: [oracle.publicKey, colors.musdc, colors.musad],
  } as never);

  const address = (deployed as { deployTxData: { public: { contractAddress: string } } }).deployTxData.public
    .contractAddress;

  writeFileSync(
    ENV_PATH,
    [
      '# Written by devkit/src/deploy.ts. Do not edit by hand.',
      'VITE_NETWORK_ID=undeployed',
      `VITE_CONTRACT_ADDRESS=${address}`,
      `VITE_TOKEN_CONTRACT_ADDRESS=${tokenAddress}`,
      '',
    ].join('\n'),
    'utf8',
  );

  console.log(`\ndeployed in ${Date.now() - started}ms`);
  console.log(`mask_pay      ${address}`);
  console.log(`mask_token    ${tokenAddress}`);
  console.log(`mUSDC colour  ${Buffer.from(colors.musdc).toString('hex')}`);
  console.log(`mUSAD colour  ${Buffer.from(colors.musad).toString('hex')}`);
  console.log(`oracle pk.x   ${oracle.publicKey.x}`);
  console.log(`oracle pk.y   ${oracle.publicKey.y}`);
  console.log(`oracle secret ${oracle.secret}`);
  console.log('\nSealed at construction — the oracle key cannot be changed later. Keep the secret.');
  console.log(`wrote ${ENV_PATH}`);

  await closeWallet(ctx);
}

main().catch((e) => {
  console.error('DEPLOY FAILED:', e);
  process.exitCode = 1;
});
