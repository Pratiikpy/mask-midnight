// Print the balances of one wallet: unshielded NIGHT, shielded NIGHT and DUST.
// Usage:
//   MASK_NETWORK=preview node --experimental-strip-types src/balance.ts <name>      (reads .secrets/<network>-<name>.seed)
//   MASK_NETWORK=undeployed node --experimental-strip-types src/balance.ts genesis  (the local devnet's pre-funded wallet)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Rx from 'rxjs';
import { GENESIS_MINT_WALLET_SEED, NETWORK_ID } from './config.ts';
import { buildWalletFromSeed, closeWallet, waitForSync } from './wallet.ts';

const name = process.argv[2] ?? 'deployer';
const here = dirname(fileURLToPath(import.meta.url));
const seed =
  name === 'genesis' && NETWORK_ID === 'undeployed'
    ? GENESIS_MINT_WALLET_SEED
    : readFileSync(join(here, '..', '..', '.secrets', `${NETWORK_ID}-${name}.seed`), 'utf8').trim();

const t0 = Date.now();
const ctx = await buildWalletFromSeed(seed);

// Sync can take a long time on a public network and prints nothing on its own, so
// report how far each of the three wallets has got every 30 seconds.
const describe = (p: unknown): string => {
  if (!p || typeof p !== 'object') return String(p);
  const o = p as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => typeof o[k] === 'bigint' || typeof o[k] === 'number');
  return keys.map((k) => `${k}=${String(o[k])}`).join(' ');
};
const ticker = ctx.wallet
  .state()
  .pipe(Rx.throttleTime(30_000, undefined, { leading: true, trailing: true }))
  .subscribe((st) => {
    console.log(
      `[${Math.round((Date.now() - t0) / 1000)}s] shielded{${describe(st.shielded.state.progress)}} unshielded{${describe(st.unshielded.progress)}} dust{${describe(st.dust.state.progress)}}`,
    );
  });
const state = await waitForSync(ctx.wallet, 3_600_000);
const nightColor = (await import('@midnight-ntwrk/ledger-v8')).nativeToken().raw;
const latest = await Rx.firstValueFrom(ctx.wallet.state());

console.log(
  JSON.stringify(
    {
      network: NETWORK_ID,
      wallet: name,
      syncSeconds: Math.round((Date.now() - t0) / 1000),
      unshieldedNight: String(latest.unshielded?.balances[nightColor] ?? 0n),
      shieldedNight: String(latest.shielded?.balances[nightColor] ?? 0n),
      dust: String(latest.dust?.balance(new Date()) ?? 0n),
      dustCoins: latest.dust?.availableCoins.length ?? 0,
      unshieldedCoins: latest.unshielded?.availableCoins.length ?? 0,
    },
    null,
    2,
  ),
);
void state;
ticker.unsubscribe();
await closeWallet(ctx);
process.exit(0);
