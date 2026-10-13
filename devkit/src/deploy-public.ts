// Deploy Mask to a public Midnight network (Preview or Preprod).
//
// A contract with many circuits cannot be deployed in one transaction on a public
// network: every circuit's verifier key rides in the deploy, and the total
// exceeds the node's per-transaction block weight. So the deploy is staged:
//
//   1. Deploy the contract with its state but NO verifier keys.
//   2. Insert each circuit's verifier key in its own maintenance transaction.
//
// The pattern follows the one other Midnight projects proved on Preview. The
// deployment is resumable: progress is written to deployments/<network>.state.json
// after every transaction, and a re-run reads on-chain state to skip any key that
// is already in.
//
// Two secrets matter and are written to .secrets/ (gitignored), never printed:
//   - the contract's maintenance signing key: lose it and no further key can be
//     inserted, replaced or removed, ever;
//   - the oracle secret: sealed into mask_pay at construction.
//
// Usage: MASK_NETWORK=preprod BLOCKFROST_PROJECT_ID=... \
//        node --experimental-strip-types src/deploy-public.ts [walletName]

import { webcrypto } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompiledContract, ContractExecutable } from '@midnight-ntwrk/compact-js';
import { ProvableCircuitId, VerifierKey } from '@midnight-ntwrk/compact-js/effect/Contract';
import { sampleSigningKey } from '@midnight-ntwrk/compact-runtime';
import {
  ContractDeploy,
  ContractState,
  Intent,
  Transaction,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  SucceedEntirely,
  asContractAddress,
  exitResultOrError,
  makeContractExecutableRuntime,
} from '@midnight-ntwrk/midnight-js-types';

import * as MaskPay from '../../contracts/build/mask_pay/contract/index.js';
import * as MaskToken from '../../contracts/build/mask_token/contract/index.js';
import { emptyPrivateState, witnesses } from '../../contracts/src/witnesses.ts';
import { generateOracleKeypair } from '../../contracts/src/oracle-signer.ts';
import { maskTokenColors } from '../../contracts/src/token-color.ts';
import { NETWORK_ID } from './config.ts';
import { buildProviders } from './providers.ts';
import { balances, buildWalletFromSeed, closeWallet, registerNightForDust, waitForSync } from './wallet.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const secretsDir = join(root, '.secrets');
const deployDir = join(root, 'deployments');
mkdirSync(secretsDir, { recursive: true });
mkdirSync(deployDir, { recursive: true });

const walletName = process.argv[2] ?? 'deployer';
const seed = readFileSync(join(secretsDir, `${NETWORK_ID}-${walletName}.seed`), 'utf8').trim();
const statePath = join(deployDir, `${NETWORK_ID}.state.json`);
const publicPath = join(deployDir, `${NETWORK_ID}.json`);

const TTL_MS = 60 * 60 * 1000;
const ttl = () => new Date(Date.now() + TTL_MS);
const rand = (n: number) => webcrypto.getRandomValues(new Uint8Array(n));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

interface ContractRecord {
  address?: string;
  deployTx?: string;
  deployBlock?: number;
  /** circuit id -> maintenance transaction that inserted its verifier key */
  keys: Record<string, { tx: string; block?: number }>;
}
interface State {
  network: string;
  deployer: string;
  token: ContractRecord;
  pay: ContractRecord;
  colors?: { musdc: string; musad: string };
  oraclePublicKey?: { x: string; y: string };
}

const state: State = existsSync(statePath)
  ? (JSON.parse(readFileSync(statePath, 'utf8')) as State)
  : { network: NETWORK_ID, deployer: '', token: { keys: {} }, pay: { keys: {} } };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

const PayCompiled = CompiledContract.make<MaskPay.Contract<ReturnType<typeof emptyPrivateState>>>(
  'MaskPay',
  MaskPay.Contract,
).pipe(CompiledContract.withWitnesses(witnesses as never), CompiledContract.withCompiledFileAssets('.'));

const TokenCompiled = CompiledContract.make<MaskToken.Contract<Record<string, never>>>(
  'MaskToken',
  MaskToken.Contract,
).pipe(CompiledContract.withWitnesses({} as never), CompiledContract.withCompiledFileAssets('.'));

// biome-ignore lint/suspicious/noExplicitAny: the SDK's wallet and provider types are structural and wide
type Any = any;

async function submit(ctx: Any, providers: Any, unproven: unknown, label: string) {
  const recipe = await ctx.wallet.balanceUnprovenTransaction(
    unproven as Any,
    { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
    { ttl: ttl() },
  );
  const signed = await ctx.wallet.signRecipe(recipe, (p: Any) => ctx.unshieldedKeystore.signData(p));
  const finalized = await ctx.wallet.finalizeRecipe(signed);
  const id: string = await ctx.wallet.submitTransaction(finalized);
  const data = await providers.publicDataProvider.watchForTxData(id);
  if (data.status !== SucceedEntirely) throw new Error(`${label}: transaction ${id} ended ${String(data.status)}`);
  console.log(`  ${label}: ${id} block ${data.blockHeight ?? '?'}`);
  return { id, block: Number(data.blockHeight ?? 0) };
}

/** Deploy a contract with no verifier keys, returning its address and signing key. */
async function deployStripped(
  ctx: Any,
  providers: Any,
  compiled: Any,
  privateState: unknown,
  args: unknown[],
  privateStateId: string,
  label: string,
  record: ContractRecord,
): Promise<void> {
  if (record.address) {
    console.log(`${label}: already deployed at ${record.address}`);
    return;
  }
  const signingKey = sampleSigningKey();
  const coinPublicKey = providers.walletProvider.getCoinPublicKey().toString();
  const exec = ContractExecutable.make(compiled) as Any;
  const runtime = makeContractExecutableRuntime(providers.zkConfigProvider, { coinPublicKey, signingKey }) as Any;

  const init = exitResultOrError(await runtime.runPromiseExit(exec.initialize(privateState, ...args))) as Any;
  const full = ContractState.deserialize(init.public.contractState.serialize());
  console.log(`${label}: full state has ${full.operations().length} operations; deploying without their keys`);

  const stripped = new ContractState();
  stripped.data = full.data;
  stripped.maintenanceAuthority = full.maintenanceAuthority;
  const deploy = new ContractDeploy(stripped);
  const address = deploy.address;

  const tx = Transaction.fromParts(getNetworkId(), undefined, undefined, Intent.new(ttl()).addDeploy(deploy));
  const out = await submit(ctx, providers, tx, `${label} deploy`);

  // The signing key is the maintenance authority. Persist it before anything else.
  const derived = init.private.signingKey as string;
  writeFileSync(join(secretsDir, `${NETWORK_ID}-${label}.signingkey`), `${String(derived)}\n`, { mode: 0o600 });
  (providers.privateStateProvider as Any).setContractAddress(address);
  await providers.privateStateProvider.set(privateStateId, init.private.privateState);
  await providers.privateStateProvider.setSigningKey(address, derived);

  record.address = address;
  record.deployTx = out.id;
  record.deployBlock = out.block;
  save();
}

/** Insert every circuit's verifier key that is not yet on chain, one transaction each. */
async function insertKeys(
  ctx: Any,
  providers: Any,
  compiled: Any,
  circuits: string[],
  label: string,
  record: ContractRecord,
): Promise<void> {
  const address = record.address!;
  // Returned as [circuit, key] pairs.
  const keys = new Map<string, Uint8Array>(
    (await providers.zkConfigProvider.getVerifierKeys(circuits as Any)) as Iterable<[string, Uint8Array]>,
  );

  for (const circuit of circuits) {
    const onChain = await providers.publicDataProvider.queryContractState(address);
    if (!onChain) throw new Error(`${label}: no contract state at ${address}`);
    const present = (ContractState.deserialize(onChain.serialize()).operations() as unknown[]).map(String);
    if (present.includes(circuit)) {
      console.log(`  ${label} key ${circuit}: already on chain`);
      continue;
    }

    const signingKey = await providers.privateStateProvider.getSigningKey(address);
    if (!signingKey) throw new Error(`${label}: signing key for ${address} not found`);

    const exec = ContractExecutable.make(compiled) as Any;
    const runtime = makeContractExecutableRuntime(providers.zkConfigProvider, {
      coinPublicKey: providers.walletProvider.getCoinPublicKey(),
      signingKey,
    }) as Any;
    const result = exitResultOrError(
      await runtime.runPromiseExit(
        exec.addOrReplaceContractOperation(
          ProvableCircuitId(circuit as Any),
          VerifierKey(keys.get(circuit) as Uint8Array),
          { address: asContractAddress(address), contractState: onChain },
        ),
      ),
    ) as Any;
    const tx = Transaction.fromParts(
      getNetworkId(),
      undefined,
      undefined,
      Intent.new(ttl()).addMaintenanceUpdate(result.public.maintenanceUpdate),
    );
    const out = await submit(ctx, providers, tx, `${label} key ${circuit}`);
    record.keys[circuit] = { tx: out.id, block: out.block };
    save();
  }
}

/** Deploy both contracts using an already-synced wallet. Safe to re-run: it resumes. */
export async function deployAll(ctx: Any): Promise<void> {
  await registerNightForDust(ctx);
  const bal = await balances(ctx);
  console.log(`unshielded address ${bal.unshieldedAddr}`);
  console.log(`NIGHT ${bal.night}  DUST ${bal.dust}`);
  state.deployer = bal.unshieldedAddr;

  // mask_token first: the reference-asset colours are derived from its address,
  // and mask_pay seals those colours in at construction.
  const tokenProviders = buildProviders(ctx, {
    zkConfigPath: join(root, 'contracts', 'build', 'mask_token'),
    privateStateStoreName: `mask-${NETWORK_ID}-token`,
    accountId: seed,
  });
  const tokenCircuits = Object.keys(new MaskToken.Contract({} as never).impureCircuits);
  await deployStripped(ctx, tokenProviders, TokenCompiled, {}, [rand(32)], 'mask-token', 'mask_token', state.token);
  await insertKeys(ctx, tokenProviders, TokenCompiled, tokenCircuits, 'mask_token', state.token);

  const colors = maskTokenColors(state.token.address!);
  state.colors = { musdc: hex(colors.musdc), musad: hex(colors.musad) };

  // The oracle key is sealed into mask_pay at construction and can never change,
  // so it is generated once, only if mask_pay is not deployed yet, and its secret
  // goes straight to a gitignored file.
  const oracle = generateOracleKeypair();
  if (state.pay.address) {
    console.log('mask_pay: oracle key already sealed; not generating a new one');
  } else {
    writeFileSync(join(secretsDir, `${NETWORK_ID}-oracle.secret`), `${String(oracle.secret)}\n`, { mode: 0o600 });
    state.oraclePublicKey = { x: String(oracle.publicKey.x), y: String(oracle.publicKey.y) };
    save();
  }

  const payProviders = buildProviders(ctx, {
    zkConfigPath: join(root, 'contracts', 'build', 'mask_pay'),
    privateStateStoreName: `mask-${NETWORK_ID}-pay`,
    accountId: seed,
  });
  const payCircuits = Object.keys(new MaskPay.Contract(witnesses as never).impureCircuits);
  await deployStripped(
    ctx,
    payProviders,
    PayCompiled,
    { ...emptyPrivateState(), ownerSecret: rand(32), merchantKey: rand(32) },
    [oracle.publicKey, colors.musdc, colors.musad],
    'mask-pay',
    'mask_pay',
    state.pay,
  );
  await insertKeys(ctx, payProviders, PayCompiled, payCircuits, 'mask_pay', state.pay);

  // What a reviewer can check: addresses, transaction ids and blocks. No secrets.
  writeFileSync(publicPath, JSON.stringify(state, null, 2) + '\n');
  console.log(`\nmask_pay    ${state.pay.address}`);
  console.log(`mask_token  ${state.token.address}`);
  console.log(`wrote ${publicPath}`);
}

// Run directly: sync a wallet, then deploy.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  (async () => {
    console.log(`network ${NETWORK_ID}, wallet ${walletName}`);
    const ctx = await buildWalletFromSeed(seed);
    console.log('syncing wallet (all three ledgers; this can take a long while on a public network)…');
    await waitForSync(ctx.wallet, 6 * 3_600_000);
    await deployAll(ctx);
    await closeWallet(ctx);
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
