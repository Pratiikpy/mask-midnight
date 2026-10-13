// Sync one wallet on a public network, then deploy and verify with it.
//
// Syncing a public network from genesis takes hours, so it is done once and the
// same wallet is used for both the deploy and the verification run.
//
// Usage: MASK_NETWORK=preprod BLOCKFROST_PROJECT_ID=... \
//        node --experimental-strip-types src/public-run.ts [walletName]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NETWORK_ID } from './config.ts';
import { deployAll } from './deploy-public.ts';
import { verifyAll } from './verify-deployment.ts';
import { closeWallet } from './wallet.ts';
import { syncResumable } from './wallet-resumable.ts';

const here = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2] ?? 'deployer';
const seed = readFileSync(join(here, '..', '..', '.secrets', `${NETWORK_ID}-${name}.seed`), 'utf8').trim();

console.log(`network ${NETWORK_ID}, wallet ${name}: syncing (resumable)`);
const t0 = Date.now();
const ctx = await syncResumable(seed, name);
console.log(`synced in ${Math.round((Date.now() - t0) / 1000)}s`);

await deployAll(ctx);
await verifyAll(ctx);
await closeWallet(ctx);
console.log('DONE');
process.exit(0);
