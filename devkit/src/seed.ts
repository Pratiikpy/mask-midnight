// Put real data on the deployed contract so the app has something to show.
//
// Creates a few invoices and settles some of them, then prints the digests so
// they can be pasted into the app's Verify page. This is what makes a demo
// honest: the UI reads state that actually exists rather than a fixture.

import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';

import * as MaskPay from '../../contracts/build/mask_pay/contract/index.js';
import { GENESIS_MINT_WALLET_SEED, PRIVACY_CANARY } from './config.ts';
import { buildWalletFromSeed, closeWallet, registerNightForDust, waitForSync } from './wallet.ts';
import { buildProviders } from './providers.ts';

const ASSETS = new URL('../../contracts/build/mask_pay', import.meta.url).pathname;
const ENV_PATH = new URL('../../app/.env.local', import.meta.url).pathname;
const PRIVATE_STATE_ID = 'mask-seed';

const STANDARD = 0;
const MULTIPAY = 1;
const NATIVE = 0;

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

const rand = (n: number) => webcrypto.getRandomValues(new Uint8Array(n));

const base = (over: Partial<PS> = {}): PS => ({
  merchantKey: new Uint8Array(32).fill(0x11),
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

const witnesses = {
  merchant_key: ({ privateState }: { privateState: PS }) => [privateState, privateState.merchantKey],
  invoice_salt: ({ privateState }: { privateState: PS }) => [privateState, privateState.salt],
  invoice_amount: ({ privateState }: { privateState: PS }) => [privateState, privateState.amount],
  payer_key: ({ privateState }: { privateState: PS }) => [privateState, privateState.payerKey],
  payment_index: ({ privateState }: { privateState: PS }) => [privateState, privateState.paymentIndex],
  owner_secret: ({ privateState }: { privateState: PS }) => [privateState, privateState.ownerSecret],
  converted_amount: ({ privateState }: { privateState: PS }) => [privateState, privateState.convertedAmount],
  attested_amounts: ({ privateState }: { privateState: PS }) => [privateState, privateState.attestedAmounts],
  attested_salts: ({ privateState }: { privateState: PS }) => [privateState, privateState.attestedSalts],
  attested_payers: ({ privateState }: { privateState: PS }) => [privateState, privateState.attestedPayers],
  attested_indices: ({ privateState }: { privateState: PS }) => [privateState, privateState.attestedIndices],
  attested_paths: ({ privateState }: { privateState: PS }) => [privateState, privateState.attestedPaths],
  batch_amounts: ({ privateState }: { privateState: PS }) => [privateState, privateState.batchAmounts],
  batch_salts: ({ privateState }: { privateState: PS }) => [privateState, privateState.batchSalts],
  batch_merchants: ({ privateState }: { privateState: PS }) => [privateState, privateState.batchMerchants],
  batch_indices: ({ privateState }: { privateState: PS }) => [privateState, privateState.batchIndices],
  getSchnorrReduction: ({ privateState }: { privateState: PS }, c: bigint) => [
    privateState,
    [c / (1n << 248n), c % (1n << 248n)],
  ],
};

const Compiled = CompiledContract.make<MaskPay.Contract<PS>>('MaskPay', MaskPay.Contract).pipe(
  CompiledContract.withWitnesses(witnesses as never),
  CompiledContract.withCompiledFileAssets('.'),
);

function deployedAddress(): string {
  const env = readFileSync(ENV_PATH, 'utf8');
  const m = /VITE_CONTRACT_ADDRESS=(\w+)/.exec(env);
  if (!m?.[1]) throw new Error('No VITE_CONTRACT_ADDRESS in app/.env.local — run deploy first.');
  return m[1];
}

async function main(): Promise<void> {
  const address = deployedAddress();
  console.log(`contract ${address}\n`);

  const ctx = await buildWalletFromSeed(GENESIS_MINT_WALLET_SEED);
  await waitForSync(ctx.wallet);
  await registerNightForDust(ctx);

  const providers = buildProviders(ctx, {
    zkConfigPath: ASSETS,
    privateStateStoreName: PRIVATE_STATE_ID,
    accountId: GENESIS_MINT_WALLET_SEED,
  });

  // The LevelDB provider scopes private state by contract address, and refuses
  // to write until it knows which contract it is for. deployContract sets this
  // itself; findDeployedContract does not.
  (providers.privateStateProvider as { setContractAddress(a: string): void }).setContractAddress(
    address,
  );

  const setState = (s: PS) =>
    (providers.privateStateProvider as { set(id: string, s: PS): Promise<void> }).set(
      PRIVATE_STATE_ID,
      s,
    );

  await setState(base());
  const contract = await findDeployedContract(providers as never, {
    contractAddress: address,
    compiledContract: Compiled,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: base(),
  } as never);
  const callTx = (contract as { callTx: Record<string, (...a: unknown[]) => Promise<unknown>> }).callTx;

  const results: string[] = [];

  // Written to disk at the end. Every seed run uses fresh salts, so the digests
  // change every time — a checker that hardcodes them (as the SDK's live-check
  // used to) passes once and then fails after the next reseed, forever.
  const digests: Record<string, string> = {};

  // An invoice that stays open.
  {
    const st = base({ amount: 42_500n });
    await setState(st);
    const t = Date.now();
    const out = (await callTx.create_invoice(STANDARD, NATIVE, 0n)) as {
      private: { result: Uint8Array };
    };
    const c = toHex(out.private.result);
    console.log(`open invoice      ${c}   (${Date.now() - t}ms)`);
    results.push(`OPEN INVOICE      ${c}`);
    digests.open = c;
  }

  // An invoice that gets settled, producing a receipt too.
  {
    const st = base({ amount: 91_300n });
    await setState(st);
    let t = Date.now();
    const out = (await callTx.create_invoice(STANDARD, NATIVE, 0n)) as {
      private: { result: Uint8Array };
    };
    const c = toHex(out.private.result);
    console.log(`settling invoice  ${c}   (${Date.now() - t}ms)`);

    t = Date.now();
    const settled = (await callTx.settle_invoice(STANDARD, NATIVE)) as {
      private: { result: Uint8Array };
    };
    const r = toHex(settled.private.result);
    console.log(`receipt           ${r}   (${Date.now() - t}ms)`);
    results.push(`SETTLED INVOICE   ${c}`, `RECEIPT           ${r}`);
    digests.settled = c;
    digests.receipt = r;
  }

  // A multipay invoice with two contributors.
  {
    const salt = rand(32);
    const st = base({ amount: 12_000n, salt });
    await setState(st);
    const out = (await callTx.create_invoice(MULTIPAY, NATIVE, 0n)) as {
      private: { result: Uint8Array };
    };
    const c = toHex(out.private.result);
    console.log(`multipay invoice  ${c}`);

    for (const payer of [rand(32), rand(32)]) {
      await setState(base({ amount: 12_000n, salt, payerKey: payer }));
      const s = (await callTx.settle_invoice(MULTIPAY, NATIVE)) as {
        private: { result: Uint8Array };
      };
      console.log(`  contribution    ${toHex(s.private.result)}`);
    }
    results.push(`MULTIPAY INVOICE  ${c}`);
    digests.multipay = c;
  }

  // The privacy canary: a settled invoice whose amount is six bytes wide and
  // whose expiry is published in the clear. `check-canary.ts` requires the
  // expiry to be findable and the amount not to be — one proves the search can
  // see, the other proves what it cannot.
  {
    const salt = rand(32);
    await setState(base({ amount: PRIVACY_CANARY.amount, salt }));
    const out = (await callTx.create_invoice(STANDARD, NATIVE, PRIVACY_CANARY.expiry)) as {
      private: { result: Uint8Array };
    };
    console.log(`privacy canary    ${toHex(out.private.result)}`);
    digests.canary = toHex(out.private.result);

    await setState(base({ amount: PRIVACY_CANARY.amount, salt, payerKey: rand(32) }));
    const settled = (await callTx.settle_invoice(STANDARD, NATIVE)) as {
      private: { result: Uint8Array };
    };
    console.log(`  settled         ${toHex(settled.private.result)}`);
  }

  const seedPath = new URL('../seed-output.json', import.meta.url).pathname;
  writeFileSync(
    seedPath,
    JSON.stringify({ contractAddress: address, digests }, null, 2) + '\n',
    'utf8',
  );
  console.log(`\nwrote ${seedPath}`);

  console.log('\n=============== PASTE THESE INTO /verify ===============');
  for (const r of results) console.log(r);
  console.log('=======================================================\n');

  await closeWallet(ctx);
}

main().catch((e) => {
  console.error('SEED FAILED:', e);
  process.exitCode = 1;
});
