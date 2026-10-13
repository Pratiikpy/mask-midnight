// Can a payer escrow a coin they did not first enumerate?
//
// This decides whether the browser app can offer escrowed payment at all.
//
// The devkit settles escrow by reading an existing UTXO out of the wallet —
// nonce, colour, value — and handing it to the circuit. A browser DApp cannot
// do that: the Lace connector exposes balances (`getShieldedBalances`) but no
// coin list, so there is no existing nonce to name.
//
// The alternative is to invent one: build a ShieldedCoinInfo with a fresh
// random nonce and let the wallet fund it while balancing. The connector's own
// documentation says `balanceUnsealedTransaction` will "add necessary inputs
// and outputs to remove imbalances", which reads as though it should work — but
// reading is not evidence, and the answer decides a feature. So it is tested.
//
// A pass means the Pay page can offer real escrow. A failure means it cannot,
// and the app should say so rather than pretend.

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

const ASSETS = new URL('../../contracts/build/mask_pay', import.meta.url).pathname;
const PRIVATE_STATE_ID = 'mask-fresh-coin';
const STANDARD = 0;
const NATIVE = 0;

/** Small, so the wallet can certainly cover it out of its own coins. */
const AMOUNT = 12_345n;

const rand = (n: number) => webcrypto.getRandomValues(new Uint8Array(n));
const asBytes = (hex: string): Uint8Array =>
  Uint8Array.from((hex.replace(/^0x/, '').match(/../g) ?? []).map((b) => parseInt(b, 16)));

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
  merchantKey: new Uint8Array(32).fill(0x4f),
  salt: rand(32),
  amount: AMOUNT,
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

  const salt = rand(32);
  console.log('deploying…');
  const deployed = await deployContract(providers as never, {
    compiledContract: Compiled,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: base({ salt }),
    args: [oracle.publicKey, UNBOUND_COLORS.musdc, UNBOUND_COLORS.musad],
  } as never);
  const callTx = (deployed as { callTx: Record<string, (...a: unknown[]) => Promise<unknown>> })
    .callTx;

  console.log(`creating an invoice for ${AMOUNT}`);
  await callTx.create_invoice(STANDARD, NATIVE, 0n);

  // The coin the browser would have to invent: correct colour, correct value,
  // a nonce that corresponds to nothing the wallet currently holds.
  const freshCoin = { nonce: rand(32), color: new Uint8Array(32), value: AMOUNT };
  const merchantAddr = { bytes: asBytes(ctx.shieldedSecretKeys.coinPublicKey) };

  console.log(`settling with a FRESH coin, nonce ${toHex(freshCoin.nonce).slice(0, 16)}…`);
  let ok = false;
  let message = '';
  try {
    const settled = (await callTx.settle_invoice_shielded(
      STANDARD,
      NATIVE,
      freshCoin,
      merchantAddr,
    )) as { private: { result: Uint8Array } };
    ok = true;
    console.log(`receipt ${toHex(settled.private.result)}`);
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }

  console.log('\n============== FRESH COIN PROBE ==============');
  if (ok) {
    console.log('ACCEPTED — the wallet funded a coin the DApp invented.');
    console.log('The browser app can offer escrowed payment: build the coin, let');
    console.log('the wallet balance it. No coin enumeration needed.');
  } else {
    console.log('REJECTED — a coin must already exist in the wallet to be escrowed.');
    console.log(`reason: ${message.slice(0, 300)}`);
    console.log('The Lace connector exposes balances but not a coin list, so a');
    console.log('browser DApp cannot name an existing coin. Escrow stays an SDK path.');
  }
  console.log('==============================================\n');

  await closeWallet(ctx);
}

main().catch((e) => {
  console.error('PROBE FAILED:', e);
  process.exitCode = 1;
});
