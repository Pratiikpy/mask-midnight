// mUSDC, minted and spent on chain.
//
// The reference tokens existed as a compiled contract and a test suite, but had
// never been minted on a real chain or used to pay anything. This drives the
// whole path: mint mUSDC from mask_token, invoice in mUSDC, settle that invoice
// with the minted coin, and prove the contract refuses the wrong asset.
//
// It also settles a question the escrow run could not. That one derived its
// invoice amount from a wallet coin, whose value is 50_000_000_000_000 — the
// block reward, printed in plain decimal in every block's unshielded outputs.
// The search found it and could not tell "our amount leaked" from "the chain
// pays 50 trillion per block". Minting gives us the amount, so it is chosen to
// be six bytes wide and unlike anything the ledger produces on its own.

import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as Rx from 'rxjs';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';

import * as MaskPay from '../../contracts/build/mask_pay/contract/index.js';
import * as MaskToken from '../../contracts/build/mask_token/contract/index.js';
import { GENESIS_MINT_WALLET_SEED } from './config.ts';
import { buildWalletFromSeed, closeWallet, registerNightForDust, waitForSync } from './wallet.ts';
import { buildProviders } from './providers.ts';
import { generateOracleKeypair } from '../../contracts/src/oracle-signer.ts';
import { maskTokenColors } from '../../contracts/src/token-color.ts';
import {
  fetchContractState,
  fetchPublicRecord,
  findLeaks,
  latestHeight,
  waitForIndexed,
} from './public-record.ts';

const PAY_ASSETS = new URL('../../contracts/build/mask_pay', import.meta.url).pathname;
const TOKEN_ASSETS = new URL('../../contracts/build/mask_token', import.meta.url).pathname;
const ENV_PATH = new URL('../../app/.env.local', import.meta.url).pathname;

const PAY_STATE_ID = 'mask-token-e2e-pay';
const TOKEN_STATE_ID = 'mask-token-e2e-token';

const STANDARD = 0;
const NATIVE = 0;
const MUSDC = 1;
const MUSDC_TOKEN = MaskToken.MaskToken.MUSDC;

/** Six bytes wide, and nothing the chain mints on its own. */
const AMOUNT = 777_777_123_456n;

const rand = (n: number) => webcrypto.getRandomValues(new Uint8Array(n));
const asBytes = (hex: string): Uint8Array =>
  Uint8Array.from((hex.replace(/^0x/, '').match(/../g) ?? []).map((b) => parseInt(b, 16)));

const t0 = Date.now();
const step = (m: string) => console.log(`[${String(Date.now() - t0).padStart(7)}ms] ${m}`);

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

const MERCHANT = new Uint8Array(32).fill(0x6d);

const base = (over: Partial<PS> = {}): PS => ({
  merchantKey: MERCHANT,
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

const payWitnesses = {
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

const CompiledPay = CompiledContract.make<MaskPay.Contract<PS>>('MaskPay', MaskPay.Contract).pipe(
  CompiledContract.withWitnesses(payWitnesses as never),
  CompiledContract.withCompiledFileAssets('.'),
);

const CompiledToken = CompiledContract.make<MaskToken.Contract<Record<string, never>>>(
  'MaskToken',
  MaskToken.Contract,
).pipe(CompiledContract.withWitnesses({} as never), CompiledContract.withCompiledFileAssets('.'));

/** The mask_token deployed by deploy.ts, so this exercises the real one. */
function deployedTokenAddress(): string {
  const env = readFileSync(ENV_PATH, 'utf8');
  const m = /VITE_TOKEN_CONTRACT_ADDRESS=([0-9a-fA-F]+)/.exec(env);
  if (!m) throw new Error(`no VITE_TOKEN_CONTRACT_ADDRESS in ${ENV_PATH} — run deploy.ts first`);
  return m[1]!;
}

interface WalletCoin {
  type: string;
  nonce: string;
  value: string;
  mt_index: string;
}

async function coinsOfColor(wallet: unknown, colorHex: string): Promise<WalletCoin[]> {
  const state = await Rx.firstValueFrom((wallet as { state(): Rx.Observable<unknown> }).state());
  const available =
    ((state as { shielded?: { availableCoins?: unknown[] } }).shielded?.availableCoins ?? []) as {
      coin: WalletCoin;
    }[];
  return available.map((c) => c.coin).filter((c) => c.type.toLowerCase() === colorHex.toLowerCase());
}

/**
 * Wait for a minted coin to reach the wallet.
 *
 * Polls the wallet's own state rather than sleeping a guessed number of
 * seconds: the coin appears when the indexer has served the block, and that is
 * an event to wait for, not a duration to hope for.
 */
async function waitForCoin(
  wallet: unknown,
  colorHex: string,
  value: bigint,
  timeoutMs = 180_000,
): Promise<WalletCoin> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = (await coinsOfColor(wallet, colorHex)).find((c) => BigInt(c.value) === value);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`minted coin (colour ${colorHex.slice(0, 16)}…, value ${value}) never arrived`);
}

async function main(): Promise<void> {
  const oracle = generateOracleKeypair();
  step('building genesis wallet');
  const ctx = await buildWalletFromSeed(GENESIS_MINT_WALLET_SEED);
  await waitForSync(ctx.wallet);
  await registerNightForDust(ctx);

  const tokenAddress = deployedTokenAddress();
  const colors = maskTokenColors(tokenAddress);
  const musdcHex = toHex(colors.musdc);
  step(`mask_token at ${tokenAddress}`);
  step(`mUSDC colour ${musdcHex}`);

  const from = await latestHeight();

  // ---- mint mUSDC from the deployed token contract ----
  const tokenProviders = buildProviders(ctx, {
    zkConfigPath: TOKEN_ASSETS,
    privateStateStoreName: TOKEN_STATE_ID,
    accountId: GENESIS_MINT_WALLET_SEED,
  });
  // The LevelDB provider scopes private state by contract address and refuses
  // to write until it knows which contract it is for. deployContract sets this
  // itself; findDeployedContract does not.
  (tokenProviders.privateStateProvider as { setContractAddress(a: string): void }).setContractAddress(
    tokenAddress,
  );
  await (tokenProviders.privateStateProvider as { set(id: string, s: unknown): Promise<void> }).set(
    TOKEN_STATE_ID,
    {},
  );

  const token = await findDeployedContract(tokenProviders as never, {
    contractAddress: tokenAddress,
    compiledContract: CompiledToken,
    privateStateId: TOKEN_STATE_ID,
  } as never);
  const tokenCalls = (token as { callTx: Record<string, (...a: unknown[]) => Promise<unknown>> })
    .callTx;

  step(`minting ${AMOUNT} mUSDC`);
  let t = Date.now();
  await tokenCalls.mint(MUSDC_TOKEN, AMOUNT);
  step(`mint — ${Date.now() - t}ms`);

  step('waiting for the coin to reach the wallet');
  const minted = await waitForCoin(ctx.wallet, musdcHex, AMOUNT);
  step(`wallet holds mUSDC coin value=${minted.value}`);

  const musdcCoin = {
    nonce: asBytes(minted.nonce),
    color: asBytes(minted.type),
    value: BigInt(minted.value),
  };

  // ---- a mask_pay that knows this token's colours ----
  const payProviders = buildProviders(ctx, {
    zkConfigPath: PAY_ASSETS,
    privateStateStoreName: PAY_STATE_ID,
    accountId: GENESIS_MINT_WALLET_SEED,
  });
  // No setState before the deploy: the private-state provider is scoped by
  // contract address, and until deployContract assigns one there is nowhere to
  // write. The initial state goes in as an argument instead.
  const salt = rand(32);

  step('deploying a mask_pay with the real mUSDC and mUSAD colours sealed in');
  const pay = await deployContract(payProviders as never, {
    compiledContract: CompiledPay,
    privateStateId: PAY_STATE_ID,
    initialPrivateState: base({ salt }),
    args: [oracle.publicKey, colors.musdc, colors.musad],
  } as never);
  const payCalls = (pay as { callTx: Record<string, (...a: unknown[]) => Promise<unknown>> }).callTx;
  const payAddress = (pay as { deployTxData: { public: { contractAddress: string } } }).deployTxData
    .public.contractAddress;
  step(`mask_pay at ${payAddress}`);

  step('creating an invoice denominated in mUSDC');
  const created = (await payCalls.create_invoice(STANDARD, MUSDC, 0n)) as {
    private: { result: Uint8Array };
  };
  step(`commitment ${toHex(created.private.result)}`);

  // The defect this closes: before the colour check, a coin of the right value
  // in the wrong asset settled the invoice. A native coin worth the same as the
  // mUSDC invoice is the cheapest possible attack, so it is the one tested.
  step('attempting to settle the mUSDC invoice with a NATIVE coin — must be refused');
  const nativeImpostor = { nonce: rand(32), color: new Uint8Array(32), value: AMOUNT };
  const merchantAddr = { bytes: asBytes(ctx.shieldedSecretKeys.coinPublicKey) };
  let wrongAssetRejected = false;
  let wrongAssetMsg = '';
  try {
    await payCalls.settle_invoice_shielded(STANDARD, MUSDC, nativeImpostor, merchantAddr);
  } catch (e) {
    wrongAssetRejected = true;
    wrongAssetMsg = e instanceof Error ? e.message : String(e);
  }
  const rejectedForTheRightReason = /not the invoice's asset/.test(wrongAssetMsg);
  step(
    wrongAssetRejected
      ? `REFUSED${rejectedForTheRightReason ? ' (on asset)' : ' (WRONG REASON)'}: ${wrongAssetMsg.slice(0, 120)}`
      : 'WRONG ASSET ACCEPTED — BUG',
  );

  step('settling with the minted mUSDC coin');
  t = Date.now();
  const settled = (await payCalls.settle_invoice_shielded(
    STANDARD,
    MUSDC,
    musdcCoin,
    merchantAddr,
  )) as { private: { result: Uint8Array } };
  const settleMs = Date.now() - t;
  step(`settle_invoice_shielded — ${settleMs}ms`);
  step(`receipt ${toHex(settled.private.result)}`);

  // ---- privacy, with the control that makes an absence mean something ----
  step('searching the public record');
  // The indexer serves the settlement's block a moment after the node
  // confirms it. Searching before then finds nothing and proves nothing.
  if (!(await waitForIndexed(payAddress, toHex(settled.private.result)))) {
    console.error('');
    console.error('The indexer never served the settlement. Nothing was searched.');
    process.exitCode = 1;
    await closeWallet(ctx);
    return;
  }

  const record = await fetchPublicRecord(from, await latestHeight());
  const haystack = record.blob + (await fetchContractState(payAddress));

  const amountHits = findLeaks(haystack, AMOUNT).filter((h) => h.strong);
  // The colour is public — it is sealed into the contract in the clear — so it
  // must be findable. That is this run's proof the search is not blind.
  const controlFound = haystack.includes(musdcHex.toLowerCase());

  step(
    `${record.blocks} blocks, ${record.transactions} transactions, ${haystack.length} chars searched`,
  );

  const ok =
    wrongAssetRejected && rejectedForTheRightReason && controlFound && amountHits.length === 0;

  console.log('\n============== mUSDC END TO END ==============');
  console.log(`mask_token             ${tokenAddress}`);
  console.log(`mask_pay               ${payAddress}`);
  console.log(`minted                 ${AMOUNT} mUSDC`);
  console.log(`settled with mUSDC     yes (${settleMs}ms)`);
  console.log(`native coin refused    ${wrongAssetRejected} (on asset: ${rejectedForTheRightReason})`);
  console.log(`search control         ${controlFound ? 'colour visible' : 'BLIND — colour not found'}`);
  console.log(`amount in public data  ${amountHits.length === 0 ? 'absent' : amountHits.map((h) => h.label).join(', ')}`);
  console.log(`elapsed                ${Date.now() - t0}ms`);
  console.log(ok ? 'mUSDC E2E PASSED' : 'mUSDC E2E FAILED');
  console.log('==============================================\n');

  if (!ok) process.exitCode = 1;
  await closeWallet(ctx);
}

main().catch((e) => {
  console.error('\nTOKEN E2E FAILED:', e);
  process.exitCode = 1;
});
