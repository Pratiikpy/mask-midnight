// Put shielded mUSDC into a browser wallet so a payer can settle an invoice with a coin.
//
// The Lace test wallet holds unshielded tNIGHT only, and the "send the money" path
// needs a shielded coin of the invoice's asset worth exactly the invoice amount.
// mask_token's `mint` is open on testnet by design, so the funded wallet mints the
// coins and sends each one on to the recipient's shielded address.
//
// Usage: MASK_NETWORK=preview node --experimental-strip-types src/fund-shielded.ts \
//          <recipient shielded address> <amount>[,<amount>...] [walletName]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Rx from 'rxjs';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { MidnightBech32m, ShieldedAddress } from '@midnight-ntwrk/wallet-sdk';

import * as MaskToken from '../../contracts/build/mask_token/contract/index.js';
import { maskTokenColors } from '../../contracts/src/token-color.ts';
import { NETWORK_ID } from './config.ts';
import { buildProviders } from './providers.ts';
import { closeWallet, registerNightForDust } from './wallet.ts';
import { syncResumable } from './wallet-resumable.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const TOKEN_ASSETS = join(root, 'contracts', 'build', 'mask_token');

const [recipient, amountsArg, walletName = 'deployer'] = process.argv.slice(2);
if (!recipient || !amountsArg) throw new Error('usage: fund-shielded.ts <shielded address> <amount>[,<amount>...] [wallet]');
const amounts = amountsArg.split(',').map((a) => BigInt(a.trim()));

const seed = readFileSync(join(root, '.secrets', `${NETWORK_ID}-${walletName}.seed`), 'utf8').trim();
const tokenAddress = (JSON.parse(readFileSync(join(root, 'deployments', `${NETWORK_ID}.json`), 'utf8')) as {
  token: { address: string };
}).token.address;
const musdc = toHex(maskTokenColors(tokenAddress).musdc);

const t0 = Date.now();
const step = (m: string) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(5)}s] ${m}`);
// biome-ignore lint/suspicious/noExplicitAny: the SDK's wallet types are structural and very wide
type Any = any;

const CompiledToken = CompiledContract.make<MaskToken.Contract<Record<string, never>>>(
  'MaskToken',
  MaskToken.Contract,
).pipe(CompiledContract.withWitnesses({} as never), CompiledContract.withCompiledFileAssets('.'));

const shieldedCoins = async (wallet: Any, color: string) => {
  const s = await Rx.firstValueFrom(wallet.state());
  return ((s.shielded?.availableCoins ?? []) as { coin: { type: string; value: string } }[])
    .map((c) => c.coin)
    .filter((c) => c.type.toLowerCase() === color.toLowerCase());
};

step(`syncing ${walletName} on ${NETWORK_ID}`);
const ctx = await syncResumable(seed, walletName);
await registerNightForDust(ctx);
step('synced');

const receiver = MidnightBech32m.parse(recipient).decode(ShieldedAddress, NETWORK_ID);

const providers = buildProviders(ctx, {
  zkConfigPath: TOKEN_ASSETS,
  privateStateStoreName: 'fund-shielded-token',
  accountId: seed,
});
(providers.privateStateProvider as Any).setContractAddress(tokenAddress);
await (providers.privateStateProvider as Any).set('fund-shielded-token', {});
const token = (await findDeployedContract(providers as never, {
  contractAddress: tokenAddress,
  compiledContract: CompiledToken,
  privateStateId: 'fund-shielded-token',
} as never)) as Any;

for (const amount of amounts) {
  const before = (await shieldedCoins(ctx.wallet, musdc)).length;
  step(`minting ${amount} mUSDC`);
  const m = await token.callTx.mint(MaskToken.MaskToken.MUSDC, amount);
  step(`mint confirmed in block ${m.public?.blockHeight ?? '?'} (tx ${m.public?.txId ?? '?'})`);

  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline && !(await shieldedCoins(ctx.wallet, musdc)).some((c) => BigInt(c.value) === amount)) {
    await new Promise((r) => setTimeout(r, 2_000));
  }
  if (!(await shieldedCoins(ctx.wallet, musdc)).some((c) => BigInt(c.value) === amount)) {
    throw new Error(`the minted coin of ${amount} never reached the wallet (had ${before} mUSDC coins)`);
  }

  step(`sending ${amount} mUSDC to ${recipient.slice(0, 28)}…`);
  const recipe = await ctx.wallet.transferTransaction(
    [{ type: 'shielded', outputs: [{ type: musdc, receiverAddress: receiver, amount }] }],
    { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
    { ttl: new Date(Date.now() + 3_600_000) },
  );
  const signed = await ctx.wallet.signRecipe(recipe, (p: Any) => ctx.unshieldedKeystore.signData(p));
  const finalized = await ctx.wallet.finalizeRecipe(signed);
  const id: string = await ctx.wallet.submitTransaction(finalized);
  const data = await (providers.publicDataProvider as Any).watchForTxData(id);
  step(`transfer ${id} ended ${String(data.status)} in block ${data.blockHeight ?? '?'}`);
}

step('done');
await closeWallet(ctx);
process.exit(0);
