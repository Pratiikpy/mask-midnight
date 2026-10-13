// Read only the unshielded NIGHT balance. The unshielded wallet finishes syncing
// long before the shielded and DUST wallets do, so this answers "did the faucet
// pay me" in a minute instead of waiting for a full sync.
// Usage: MASK_NETWORK=preprod node --experimental-strip-types src/unshielded.ts <name>
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Rx from 'rxjs';
import { nativeToken } from '@midnight-ntwrk/ledger-v8';
import { NETWORK_ID } from './config.ts';
import { buildWalletFromSeed, closeWallet } from './wallet.ts';

const name = process.argv[2] ?? 'deployer';
const here = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(join(here, '..', '..', '.secrets', `${NETWORK_ID}-${name}.seed`), 'utf8').trim();

const t0 = Date.now();
const ctx = await buildWalletFromSeed(seed);
const state = await Rx.firstValueFrom(
  ctx.wallet.state().pipe(
    Rx.filter((s) => {
      const p = s.unshielded.progress as { isStrictlyComplete?: () => boolean };
      return typeof p?.isStrictlyComplete === 'function' && p.isStrictlyComplete();
    }),
    Rx.timeout({ each: 1_800_000, with: () => Rx.throwError(() => new Error('unshielded sync timed out')) }),
  ),
);
console.log(
  JSON.stringify({
    network: NETWORK_ID,
    wallet: name,
    syncSeconds: Math.round((Date.now() - t0) / 1000),
    unshieldedNight: String(state.unshielded.balances[nativeToken().raw] ?? 0n),
    unshieldedCoins: state.unshielded.availableCoins.length,
  }),
);
await closeWallet(ctx);
process.exit(0);
