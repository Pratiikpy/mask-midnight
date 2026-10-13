// Public-network sync probe: build a disposable wallet, sync it, report time and memory.
// Usage: MASK_NETWORK=preview node --experimental-strip-types src/net-sync.ts
import { randomBytes } from 'node:crypto';
import { NETWORK_ID } from './config.ts';
import { balances, buildWalletFromSeed, closeWallet, waitForSync } from './wallet.ts';

const seed = process.env.MASK_SEED ?? randomBytes(32).toString('hex');
const t0 = Date.now();
let peak = 0;
const tick = setInterval(() => {
  const rss = process.memoryUsage().rss;
  if (rss > peak) peak = rss;
  console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] rss=${(rss / 1e6).toFixed(0)}MB peak=${(peak / 1e6).toFixed(0)}MB`);
}, 15_000);

const ctx = await buildWalletFromSeed(seed);
console.log(`network=${NETWORK_ID} syncing...`);
await waitForSync(ctx.wallet, 3_600_000);
clearInterval(tick);
const b = await balances(ctx);
console.log(JSON.stringify({ network: NETWORK_ID, seconds: (Date.now() - t0) / 1000, peakRssMB: Math.round(peak / 1e6), unshieldedAddr: b.unshieldedAddr, night: String(b.night) }));
await closeWallet(ctx);
process.exit(0);
