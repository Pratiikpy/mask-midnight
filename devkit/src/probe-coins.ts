// What does a spendable shielded coin actually look like?
//
// settle_invoice_shielded needs a QualifiedShieldedCoinInfo — nonce, color,
// value, mt_index. Where that comes from in the wallet state is not something
// to guess at, so this prints the real structure.

import * as Rx from 'rxjs';
import { GENESIS_MINT_WALLET_SEED } from './config.ts';
import { buildWalletFromSeed, closeWallet, registerNightForDust, waitForSync } from './wallet.ts';

const show = (label: string, v: unknown) => {
  console.log(`\n=== ${label} ===`);
  console.log(
    JSON.stringify(
      v,
      (_k, val) => {
        if (typeof val === 'bigint') return `${val}n`;
        if (val instanceof Uint8Array) return `<${val.length}b ${Buffer.from(val).toString('hex').slice(0, 32)}…>`;
        return val;
      },
      2,
    )?.slice(0, 2500),
  );
};

async function main(): Promise<void> {
  const ctx = await buildWalletFromSeed(GENESIS_MINT_WALLET_SEED);
  await waitForSync(ctx.wallet);
  await registerNightForDust(ctx);

  const s = await Rx.firstValueFrom(ctx.wallet.state());

  console.log('top-level state keys:', Object.keys(s));
  console.log('shielded keys:', Object.keys(s.shielded ?? {}));
  console.log('shielded.state keys:', Object.keys((s.shielded as { state?: object })?.state ?? {}));
  console.log('unshielded keys:', Object.keys(s.unshielded ?? {}));

  const shieldedAny = s.shielded as unknown as Record<string, unknown>;
  const inner = (shieldedAny.state ?? {}) as Record<string, unknown>;

  for (const key of ['availableCoins', 'coins', 'balances', 'pendingCoins']) {
    if (key in shieldedAny) show(`shielded.${key}`, shieldedAny[key]);
    if (key in inner) show(`shielded.state.${key}`, inner[key]);
  }

  show('unshielded.availableCoins[0]', (s.unshielded as { availableCoins?: unknown[] })?.availableCoins?.[0]);

  await closeWallet(ctx);
}

main().catch((e) => {
  console.error('probe failed:', e);
  process.exitCode = 1;
});
