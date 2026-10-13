// Headless wallet for the local devnet.
//
// Mirrors the flow proven by midnightntwrk/midnight-local-dev: build from a
// seed, sync all three sub-ledgers (shielded / unshielded / dust), then
// register NIGHT UTXOs for DUST generation so the wallet can pay fees.
//
// The subtle part is DUST. After registration `state.dust.balance(now)` starts
// climbing while there is still no *spendable* coin, and submitting during that
// window fails with "insufficient DUST". The correct readiness signal is
// `state.dust.availableCoins.length >= 1`, not a non-zero balance.

import {
  DustSecretKey,
  LedgerParameters,
  nativeToken,
  ZswapSecretKeys,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  DustAddress,
  MidnightBech32m,
  type WalletFacade,
  type FacadeState,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk';
import { FluentWalletBuilder, type DustWalletOptions } from '@midnight-ntwrk/testkit-js';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import { envConfig, NETWORK_ID } from './config.ts';

// @ts-expect-error: apollo's ws transport expects a global WebSocket
globalThis.WebSocket = WebSocket;

// `undeployed` (the local dev preset) needs a far larger fee overhead than a
// real network — 1_000n is enough on preview/preprod but leaves local
// transactions short of DUST. Value taken from example-bboard's CLI provider,
// which is the reference implementation for this SDK line.
export const DUST_OPTIONS: DustWalletOptions = {
  ledgerParams: LedgerParameters.initialParameters(),
  additionalFeeOverhead: NETWORK_ID === 'undeployed' ? 500_000_000_000_000_000n : 1_000n,
  feeBlocksMargin: 5,
};

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ZswapSecretKeys;
  dustSecretKey: DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

function isStrictlyComplete(progress: unknown): boolean {
  if (!progress || typeof progress !== 'object') return false;
  const fn = (progress as { isStrictlyComplete?: unknown }).isStrictlyComplete;
  return typeof fn === 'function' && (fn as () => boolean).call(progress);
}

export async function buildWalletFromSeed(seed: string): Promise<WalletContext> {
  const { wallet, seeds, keystore } = await FluentWalletBuilder.forEnvironment(envConfig())
    .withDustOptions(DUST_OPTIONS)
    .withSeed(seed)
    .buildWithoutStarting();

  const shieldedSecretKeys = ZswapSecretKeys.fromSeed(seeds.shielded);
  const dustSecretKey = DustSecretKey.fromSeed(seeds.dust);

  await wallet.start(shieldedSecretKeys, dustSecretKey);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore: keystore };
}

export function waitForSync(wallet: WalletFacade, timeout = 300_000): Promise<FacadeState> {
  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.filter(
        (s) =>
          isStrictlyComplete(s.shielded.state.progress) &&
          isStrictlyComplete(s.unshielded.progress) &&
          isStrictlyComplete(s.dust.state.progress),
      ),
      Rx.timeout({
        each: timeout,
        with: () => Rx.throwError(() => new Error(`wallet sync timed out after ${timeout}ms`)),
      }),
    ),
  );
}

export async function waitForSpendableDust(ctx: WalletContext, timeout = 180_000): Promise<void> {
  await Rx.firstValueFrom(
    ctx.wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((s) => (s.dust?.availableCoins.length ?? 0) >= 1),
      Rx.timeout({
        each: timeout,
        with: () => Rx.throwError(() => new Error(`no spendable DUST coin within ${timeout}ms`)),
      }),
    ),
  );
}

/** Register unshielded NIGHT UTXOs for DUST generation. Required before paying fees. */
export async function registerNightForDust(ctx: WalletContext): Promise<void> {
  const state = await Rx.firstValueFrom(
    ctx.wallet.state().pipe(Rx.filter((s) => isStrictlyComplete(s.unshielded.progress))),
  );

  const unregistered =
    state.unshielded?.availableCoins.filter((c) => c.meta.registeredForDustGeneration === false) ?? [];

  if (unregistered.length > 0) {
    const recipe = await ctx.wallet.registerNightUtxosForDustGeneration(
      unregistered,
      ctx.unshieldedKeystore.getPublicKey(),
      (payload) => ctx.unshieldedKeystore.signData(payload),
    );
    const finalized = await ctx.wallet.finalizeRecipe(recipe);
    await ctx.wallet.submitTransaction(finalized);
  }

  await waitForSpendableDust(ctx);
}

export interface Balances {
  unshieldedAddr: string;
  shieldedAddr: string;
  dustAddr: string;
  night: bigint;
  dust: bigint;
}

export async function balances(ctx: WalletContext): Promise<Balances> {
  const s = await Rx.firstValueFrom(ctx.wallet.state());
  return {
    unshieldedAddr: ctx.unshieldedKeystore.getBech32Address().asString(),
    shieldedAddr: MidnightBech32m.encode(NETWORK_ID, s.shielded.address).asString(),
    dustAddr: DustAddress.encodePublicKey(NETWORK_ID, ctx.dustSecretKey.publicKey),
    night:
      (s.unshielded?.balances[nativeToken().raw] ?? 0n) + (s.shielded?.balances[nativeToken().raw] ?? 0n),
    dust: s.dust?.balance(new Date()) ?? 0n,
  };
}

export async function closeWallet(ctx: WalletContext): Promise<void> {
  try {
    await ctx.wallet.stop();
  } catch {
    /* already stopped */
  }
}
