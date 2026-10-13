// A wallet that survives an interrupted sync.
//
// Syncing a public network from genesis takes hours. The SDK gives no recovery:
// when the connection drops, or the machine sleeps and wakes, the three
// sub-wallets raise `Wallet.Sync` errors, stop, and the process sits idle with
// nothing to say about it. A deploy that reaches hour two and then loses
// everything is not acceptable, so this saves progress and resumes from it.
//
//   - every CHECKPOINT_MS it serialises the shielded, unshielded and DUST
//     wallets to .secrets/<network>-<name>.walletstate.json (written atomically);
//   - it watches progress, and when nothing has moved for STALL_MS, or a
//     sub-wallet errors, it stops the wallet and rebuilds it from the last
//     checkpoint instead of from genesis;
//   - it logs progress, because "syncing 105 min" with no number is not a status.
//
// The wallet is assembled the way testkit's FluentWalletBuilder does it, except
// each sub-wallet is restored from a checkpoint when one exists.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DustSecretKey,
  LedgerParameters,
  ZswapSecretKeys,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  DustWallet,
  InMemoryTransactionHistoryStorage,
  ShieldedWallet,
  UnshieldedWallet,
  PublicKey,
  WalletEntrySchema,
  WalletFacade,
  createKeystore,
  mergeWalletEntries,
} from '@midnight-ntwrk/wallet-sdk';
import { FluentWalletBuilder } from '@midnight-ntwrk/testkit-js';
import * as Rx from 'rxjs';
import { NETWORK_ID, envConfig } from './config.ts';
import { DUST_OPTIONS, type WalletContext } from './wallet.ts';

// biome-ignore lint/suspicious/noExplicitAny: the SDK's wallet types are structural and very wide
type Any = any;

const here = dirname(fileURLToPath(import.meta.url));
const secretsDir = join(here, '..', '..', '.secrets');

const CHECKPOINT_MS = 120_000;
const STALL_MS = 10 * 60_000;
const REPORT_MS = 60_000;

interface Checkpoint {
  savedAt: string;
  shielded: unknown;
  unshielded: unknown;
  dust: unknown;
}

const checkpointPath = (name: string) => join(secretsDir, `${NETWORK_ID}-${name}.walletstate.json`);

function loadCheckpoint(name: string): Checkpoint | null {
  const p = checkpointPath(name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Checkpoint;
  } catch {
    return null; // a torn or corrupt file is no checkpoint; start over rather than crash
  }
}

function saveCheckpoint(name: string, cp: Checkpoint): void {
  mkdirSync(secretsDir, { recursive: true });
  const p = checkpointPath(name);
  writeFileSync(`${p}.tmp`, JSON.stringify(cp));
  renameSync(`${p}.tmp`, p);
}

/** Assemble the facade, restoring each sub-wallet from `cp` when there is one. */
async function assemble(seed: string, cp: Checkpoint | null): Promise<WalletContext> {
  const builder = FluentWalletBuilder.forEnvironment(envConfig()).withDustOptions(DUST_OPTIONS).withSeed(seed) as Any;
  const config = builder.config as Any;
  const seeds = builder.seeds as Any;
  const keystore = createKeystore(seeds.unshielded, NETWORK_ID as Any);

  const dustConfig = {
    ...config,
    costParameters: {
      ledgerParams: DUST_OPTIONS.ledgerParams,
      additionalFeeOverhead: DUST_OPTIONS.additionalFeeOverhead,
      feeBlocksMargin: DUST_OPTIONS.feeBlocksMargin,
    },
  };
  const unshieldedConfig = {
    ...config,
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
  };

  const shielded = cp
    ? await (ShieldedWallet(config) as Any).restore(cp.shielded)
    : (ShieldedWallet(config) as Any).startWithSeed(seeds.shielded);
  const unshielded = cp
    ? await (UnshieldedWallet(unshieldedConfig) as Any).restore(cp.unshielded)
    : (UnshieldedWallet(unshieldedConfig) as Any).startWithPublicKey(PublicKey.fromKeyStore(keystore));
  const dust = cp
    ? await (DustWallet(dustConfig) as Any).restore(cp.dust)
    : (DustWallet(dustConfig) as Any).startWithSeed(seeds.dust, LedgerParameters.initialParameters().dust);

  const wallet = await WalletFacade.init({
    configuration: config,
    shielded: () => shielded,
    unshielded: () => unshielded,
    dust: () => dust,
  } as Any);

  const shieldedSecretKeys = ZswapSecretKeys.fromSeed(seeds.shielded);
  const dustSecretKey = DustSecretKey.fromSeed(seeds.dust);
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore: keystore } as WalletContext;
}

const num = (p: unknown, k: string): number => {
  const v = (p as Record<string, unknown> | undefined)?.[k];
  return typeof v === 'bigint' || typeof v === 'number' ? Number(v) : 0;
};

const isDone = (p: unknown): boolean => {
  const fn = (p as { isStrictlyComplete?: () => boolean } | undefined)?.isStrictlyComplete;
  return typeof fn === 'function' && fn.call(p);
};

/**
 * Build a wallet and sync it fully, saving checkpoints and resuming from them
 * after a stall or a sync error. Returns a synced wallet context.
 */
export async function syncResumable(seed: string, name: string, totalTimeoutMs = 12 * 3_600_000): Promise<WalletContext> {
  const deadline = Date.now() + totalTimeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    const cp = loadCheckpoint(name);
    console.log(
      `[sync] attempt ${attempt}: ${cp ? `resuming from checkpoint saved ${cp.savedAt}` : 'starting from genesis'}`,
    );
    const ctx = await assemble(seed, cp);

    let failed: string | null = null;
    let lastProgress = -1;
    let lastMove = Date.now();
    let lastSave = 0;
    let lastReport = 0;

    const sub = ctx.wallet.state().subscribe({
      error: (e: unknown) => {
        failed = `state stream error: ${String((e as Error)?.message ?? e)}`;
      },
    });

    try {
      for (;;) {
        const s = (await Rx.firstValueFrom(ctx.wallet.state())) as Any;
        const sh = s.shielded.state.progress;
        const un = s.unshielded.progress;
        const du = s.dust.state.progress;

        if (isDone(sh) && isDone(un) && isDone(du)) {
          sub.unsubscribe();
          console.log('[sync] complete');
          return ctx;
        }

        const progress = num(sh, 'appliedIndex') + num(un, 'appliedId') + num(du, 'appliedIndex');
        if (progress !== lastProgress) {
          lastProgress = progress;
          lastMove = Date.now();
        }

        if (Date.now() - lastReport > REPORT_MS) {
          lastReport = Date.now();
          console.log(
            `[sync] shielded ${num(sh, 'appliedIndex')}/${num(sh, 'highestRelevantWalletIndex')}  unshielded ${num(un, 'appliedId')}/${num(un, 'highestTransactionId')}  dust ${num(du, 'appliedIndex')}/${num(du, 'highestRelevantWalletIndex')}`,
          );
        }

        if (Date.now() - lastSave > CHECKPOINT_MS && progress > 0) {
          lastSave = Date.now();
          try {
            saveCheckpoint(name, {
              savedAt: new Date().toISOString(),
              shielded: await ctx.wallet.shielded.serializeState(),
              unshielded: await ctx.wallet.unshielded.serializeState(),
              dust: await ctx.wallet.dust.serializeState(),
            });
          } catch (e) {
            console.log(`[sync] checkpoint not saved: ${String((e as Error).message)}`);
          }
        }

        if (failed) break;
        if (Date.now() - lastMove > STALL_MS) {
          failed = `no progress for ${Math.round((Date.now() - lastMove) / 60_000)} minutes`;
          break;
        }
        if (Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 5_000));
      }
    } catch (e) {
      failed = failed ?? String((e as Error)?.message ?? e);
    }

    sub.unsubscribe();
    console.log(`[sync] stopping this attempt: ${failed ?? 'deadline reached'}`);
    try {
      await ctx.wallet.stop();
    } catch {
      /* already stopped */
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  throw new Error('wallet did not finish syncing before the deadline');
}
