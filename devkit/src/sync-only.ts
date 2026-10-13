// Sync a wallet on a public network, saving checkpoints, and print its balances.
// Safe to interrupt and re-run: it resumes from the last checkpoint.
// Usage: MASK_NETWORK=preprod BLOCKFROST_PROJECT_ID=... node --experimental-strip-types src/sync-only.ts [walletName]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NETWORK_ID } from './config.ts';
import { balances, closeWallet } from './wallet.ts';
import { syncResumable } from './wallet-resumable.ts';

const here = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2] ?? 'deployer';
const seed = readFileSync(join(here, '..', '..', '.secrets', `${NETWORK_ID}-${name}.seed`), 'utf8').trim();

const t0 = Date.now();
const ctx = await syncResumable(seed, name);
const b = await balances(ctx);
console.log(JSON.stringify({ network: NETWORK_ID, wallet: name, syncSeconds: Math.round((Date.now() - t0) / 1000), night: String(b.night), dust: String(b.dust) }));
await closeWallet(ctx);
process.exit(0);
