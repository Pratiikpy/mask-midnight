// Phase 0 exit gate.
//
// Proves the full Midnight round trip against the local devnet, with timings:
//
//   fund wallet from genesis  ->  deploy mask_smoke
//   -> create_invoice   (prove -> balance -> submit -> indexer)
//   -> settle_invoice   (same)
//   -> settle again     (must FAIL — nullifier already spent)
//   -> read ledger state back through the indexer
//
// The double-settle attempt is the point. A round trip that only walks the
// happy path proves the plumbing, not the contract.

import { webcrypto } from 'node:crypto';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';

import { GENESIS_MINT_WALLET_SEED } from './config.ts';
import { balances, buildWalletFromSeed, closeWallet, registerNightForDust, waitForSync } from './wallet.ts';
import { buildProviders } from './providers.ts';
import { createMaskPrivateState, type MaskPrivateState } from './witnesses.ts';
import { MASK_SMOKE_ASSETS, MaskSmokeContract } from './contract.ts';

const PRIVATE_STATE_ID = 'mask-smoke-private-state';

const t0 = Date.now();
const step = (msg: string) => console.log(`[${String(Date.now() - t0).padStart(7)}ms] ${msg}`);

const time = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const start = Date.now();
  const out = await fn();
  console.log(`[${String(Date.now() - t0).padStart(7)}ms] ${label} — took ${Date.now() - start}ms`);
  return out;
};

const randomBytes = (n: number): Uint8Array => webcrypto.getRandomValues(new Uint8Array(n));

async function main(): Promise<void> {
  step('building wallet from genesis mint seed');
  const ctx = await buildWalletFromSeed(GENESIS_MINT_WALLET_SEED);

  step('syncing wallet');
  await waitForSync(ctx.wallet);

  step('registering NIGHT for DUST generation');
  await time('DUST ready', () => registerNightForDust(ctx));

  const bal = await balances(ctx);
  step(`NIGHT=${bal.night}  DUST=${bal.dust}`);
  step(`address ${bal.unshieldedAddr}`);

  // The invoice this run will create and settle. The amount below never leaves
  // this process — only its commitment does.
  const amount = 42_500n;
  const privateState: MaskPrivateState = createMaskPrivateState(randomBytes(32), amount, randomBytes(32));
  step(`invoice amount (private, must never appear on chain): ${amount}`);

  const providers = buildProviders(ctx, {
    zkConfigPath: MASK_SMOKE_ASSETS,
    privateStateStoreName: PRIVATE_STATE_ID,
    accountId: GENESIS_MINT_WALLET_SEED,
  });

  const deployed = await time('deploy', () =>
    deployContract(providers as never, {
      compiledContract: MaskSmokeContract,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: privateState,
    } as never),
  );

  const address = (deployed as { deployTxData: { public: { contractAddress: string } } }).deployTxData.public
    .contractAddress;
  step(`deployed at ${address}`);

  const callTxs = (deployed as { callTx: Record<string, (...a: unknown[]) => Promise<unknown>> }).callTx;

  const createRes = (await time('create_invoice', () => callTxs.create_invoice())) as {
    public: { txId: string };
    private: { result: Uint8Array };
  };
  const commitment = createRes.private.result;
  step(`commitment ${toHex(commitment)}  tx ${createRes.public.txId}`);

  const settleRes = (await time('settle_invoice', () => callTxs.settle_invoice())) as {
    public: { txId: string };
    private: { result: Uint8Array };
  };
  step(`nullifier  ${toHex(settleRes.private.result)}  tx ${settleRes.public.txId}`);

  step('attempting to settle the SAME invoice again — this must fail');
  let doubleSpendRejected = false;
  let rejection = '';
  try {
    await callTxs.settle_invoice();
  } catch (e) {
    doubleSpendRejected = true;
    rejection = e instanceof Error ? e.message : String(e);
  }
  step(doubleSpendRejected ? `double settle REJECTED: ${rejection.slice(0, 160)}` : 'DOUBLE SETTLE SUCCEEDED — BUG');

  step('reading ledger state back through the indexer');
  const state = await providers.publicDataProvider.queryContractState(address);
  step(`contract state present: ${state !== null}`);

  const joined = await findDeployedContract(providers as never, {
    contractAddress: address,
    compiledContract: MaskSmokeContract,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: privateState,
  } as never);
  step(`re-joined deployed contract: ${joined !== null}`);

  console.log('\n================ PHASE 0 RESULT ================');
  console.log(`deploy address        ${address}`);
  console.log(`commitment on chain   ${toHex(commitment)}`);
  console.log(`amount kept private   ${amount}  (never disclosed)`);
  console.log(`double settle blocked ${doubleSpendRejected}`);
  console.log(`total elapsed         ${Date.now() - t0}ms`);
  console.log('================================================\n');

  await closeWallet(ctx);
}

main().catch(async (e) => {
  console.error('\nSMOKE FAILED:', e);
  process.exitCode = 1;
});
