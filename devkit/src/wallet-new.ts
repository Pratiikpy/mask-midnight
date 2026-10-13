// Create a disposable wallet seed for a public test network and print its addresses.
// The seed is written to .secrets/<network>.seed (gitignored) and never printed.
// Usage: MASK_NETWORK=preview node --experimental-strip-types src/wallet-new.ts [name]
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FluentWalletBuilder } from '@midnight-ntwrk/testkit-js';
import { MidnightBech32m, DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { DustSecretKey, ZswapSecretKeys } from '@midnight-ntwrk/ledger-v8';
import { NETWORK_ID, envConfig } from './config.ts';
import { DUST_OPTIONS } from './wallet.ts';

const here = dirname(fileURLToPath(import.meta.url));
const secrets = join(here, '..', '..', '.secrets');
mkdirSync(secrets, { recursive: true });
const name = process.argv[2] ?? 'deployer';
const file = join(secrets, `${NETWORK_ID}-${name}.seed`);

let seed: string;
if (existsSync(file)) {
  seed = readFileSync(file, 'utf8').trim();
} else {
  seed = randomBytes(32).toString('hex');
  writeFileSync(file, seed + '\n', { mode: 0o600 });
}

const { seeds, keystore } = await FluentWalletBuilder.forEnvironment(envConfig())
  .withDustOptions(DUST_OPTIONS)
  .withSeed(seed)
  .buildWithoutStarting();
const shielded = ZswapSecretKeys.fromSeed(seeds.shielded);
const dust = DustSecretKey.fromSeed(seeds.dust);
console.log(JSON.stringify({
  network: NETWORK_ID,
  name,
  seedFile: file,
  unshieldedAddr: keystore.getBech32Address().asString(),
  dustAddr: DustAddress.encodePublicKey(NETWORK_ID, dust.publicKey),
  shieldedCoinPk: shielded.coinPublicKey,
}, null, 2));
process.exit(0);
