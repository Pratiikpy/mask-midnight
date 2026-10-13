// Prove a deployed mask_pay works, by using it.
//
// Reads deployments/<network>.json, then drives the real contract on the real
// network with real proofs and confirms each outcome by reading the ledger back
// through the indexer, not by trusting what the SDK returned. Writes the
// transaction ids and block heights it saw to deployments/<network>.evidence.json.
//
// Cases: create, settle, replay refused, cancel refused for a non-owner, cancel
// by the owner, and a settlement refused on a cancelled invoice. The refusals are
// the product; each is expected to fail before anything is submitted.
//
// Usage: MASK_NETWORK=preprod BLOCKFROST_PROJECT_ID=... \
//        node --experimental-strip-types src/verify-deployment.ts [walletName]

import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';

import * as MaskPay from '../../contracts/build/mask_pay/contract/index.js';
import { emptyPrivateState, witnesses, type MaskPrivateState } from '../../contracts/src/witnesses.ts';
import { NETWORK_ID } from './config.ts';
import { buildProviders } from './providers.ts';
import { buildWalletFromSeed, closeWallet, registerNightForDust, waitForSync } from './wallet.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const walletName = process.argv[2] ?? 'deployer';
const seed = readFileSync(join(root, '.secrets', `${NETWORK_ID}-${walletName}.seed`), 'utf8').trim();
const loadDeployment = () =>
  JSON.parse(readFileSync(join(root, 'deployments', `${NETWORK_ID}.json`), 'utf8')) as {
    pay: { address: string };
  };

const rand = (n: number) => webcrypto.getRandomValues(new Uint8Array(n));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const STATE_ID = 'mask-verify';

const Compiled = CompiledContract.make<MaskPay.Contract<MaskPrivateState>>('MaskPay', MaskPay.Contract).pipe(
  CompiledContract.withWitnesses(witnesses as never),
  CompiledContract.withCompiledFileAssets('.'),
);

// biome-ignore lint/suspicious/noExplicitAny: the SDK's provider types are structural and wide
type Any = any;

interface Step {
  step: string;
  outcome: 'confirmed' | 'refused';
  detail?: string;
  tx?: string;
  block?: number;
}
const steps: Step[] = [];
const record = (s: Step) => {
  steps.push(s);
  console.log(`${s.outcome === 'confirmed' ? 'PASS' : 'PASS (refused)'}  ${s.step}${s.tx ? `  ${s.tx}` : ''}${s.detail ? `  ${s.detail}` : ''}`);
};

/** Exercise the deployed contract using an already-synced wallet. */
export async function verifyAll(ctx: Any): Promise<void> {
  const deployment = loadDeployment();
  await registerNightForDust(ctx);

  const providers = buildProviders(ctx, {
    zkConfigPath: join(root, 'contracts', 'build', 'mask_pay'),
    privateStateStoreName: `mask-${NETWORK_ID}-verify`,
    accountId: seed,
  }) as Any;

  const merchantKey = rand(32);
  const salt = rand(32);
  const ownerSecret = rand(32);
  const amount = 1_000n;
  const merchantState: MaskPrivateState = { ...emptyPrivateState(), merchantKey, salt, amount, ownerSecret };
  const payerState: MaskPrivateState = { ...merchantState, payerKey: rand(32), ownerSecret: new Uint8Array(32) };

  const contract = (await findDeployedContract(providers, {
    contractAddress: deployment.pay.address,
    compiledContract: Compiled,
    privateStateId: STATE_ID,
    initialPrivateState: merchantState,
  } as never)) as Any;

  const as = async (s: MaskPrivateState) => providers.privateStateProvider.set(STATE_ID, s);

  const readLedger = async () => {
    const st = await providers.publicDataProvider.queryContractState(deployment.pay.address);
    return MaskPay.ledger(st.data) as Any;
  };
  const statusOf = async (commitment: Uint8Array) => {
    const l = await readLedger();
    return l.invoices.member(commitment) ? Number(l.invoices.lookup(commitment).status) : -1;
  };

  const STANDARD = MaskPay.InvoiceKind.STANDARD;
  const NATIVE = MaskPay.TokenKind.NATIVE;
  const expect = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`FAIL  ${msg}`);
  };

  // 1. Create. Confirmed by reading the commitment back off the ledger.
  await as(merchantState);
  const created = await contract.callTx.create_invoice(STANDARD, NATIVE, 0n);
  const commitment = created.private.result as Uint8Array;
  expect((await statusOf(commitment)) === 0, 'created invoice is not OPEN on the ledger');
  record({ step: 'create_invoice', outcome: 'confirmed', tx: created.public.txId, block: Number(created.public.blockHeight), detail: `commitment ${hex(commitment).slice(0, 16)}…` });

  // 2. A non-owner (a payer holding the whole link) cannot cancel it.
  await as({ ...merchantState, ownerSecret: rand(32) });
  let refusal = '';
  try {
    await contract.callTx.cancel_invoice(STANDARD, NATIVE);
  } catch (e) {
    refusal = String((e as Error).message);
  }
  expect(/not the invoice owner/.test(refusal), `non-owner cancel was not refused correctly: ${refusal}`);
  expect((await statusOf(commitment)) === 0, 'invoice changed after a refused cancel');
  record({ step: 'cancel by non-owner', outcome: 'refused', detail: 'not the invoice owner' });

  // 3. Settle as a payer.
  await as(payerState);
  const settled = await contract.callTx.settle_invoice(STANDARD, NATIVE);
  const receipt = settled.private.result as Uint8Array;
  expect((await statusOf(commitment)) === 1, 'settled invoice is not SETTLED on the ledger');
  expect((await readLedger()).receipts.member(receipt), 'receipt is not on the ledger');
  record({ step: 'settle_invoice', outcome: 'confirmed', tx: settled.public.txId, block: Number(settled.public.blockHeight), detail: `receipt ${hex(receipt).slice(0, 16)}…` });

  // 4. Replay is refused.
  refusal = '';
  try {
    await contract.callTx.settle_invoice(STANDARD, NATIVE);
  } catch (e) {
    refusal = String((e as Error).message);
  }
  expect(/not open|already settled/.test(refusal), `replay was not refused correctly: ${refusal}`);
  record({ step: 'replay settle', outcome: 'refused', detail: refusal.match(/invoice is not open|payment already settled/)?.[0] });

  // 5. A second invoice: the owner cancels it, then paying it is refused.
  const salt2 = rand(32);
  const merchant2: MaskPrivateState = { ...merchantState, salt: salt2 };
  await as(merchant2);
  const created2 = await contract.callTx.create_invoice(STANDARD, NATIVE, 0n);
  const commitment2 = created2.private.result as Uint8Array;
  record({ step: 'create second invoice', outcome: 'confirmed', tx: created2.public.txId, block: Number(created2.public.blockHeight) });

  const cancelled = await contract.callTx.cancel_invoice(STANDARD, NATIVE);
  expect((await statusOf(commitment2)) === 2, 'cancelled invoice is not CANCELLED on the ledger');
  record({ step: 'cancel by owner', outcome: 'confirmed', tx: cancelled.public.txId, block: Number(cancelled.public.blockHeight) });

  await as({ ...merchant2, payerKey: rand(32), ownerSecret: new Uint8Array(32) });
  refusal = '';
  try {
    await contract.callTx.settle_invoice(STANDARD, NATIVE);
  } catch (e) {
    refusal = String((e as Error).message);
  }
  expect(/not open/.test(refusal), `settling a cancelled invoice was not refused: ${refusal}`);
  record({ step: 'settle cancelled invoice', outcome: 'refused', detail: 'invoice is not open' });

  const final = await readLedger();
  const out = {
    network: NETWORK_ID,
    contract: deployment.pay.address,
    ledgerAfter: {
      invoicesCreated: String(final.created),
      invoicesOnLedger: String(final.invoices.size()),
      receipts: String(final.receipts.size()),
    },
    steps,
  };
  writeFileSync(join(root, 'deployments', `${NETWORK_ID}.evidence.json`), JSON.stringify(out, null, 2) + '\n');
  console.log(`\nall ${steps.length} checks passed; wrote deployments/${NETWORK_ID}.evidence.json`);
}

// Run directly: sync a wallet, then verify.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  (async () => {
    const ctx = await buildWalletFromSeed(seed);
    await waitForSync(ctx.wallet, 6 * 3_600_000);
    await verifyAll(ctx);
    await closeWallet(ctx);
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
