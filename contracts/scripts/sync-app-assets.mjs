// Copy mask_pay's compiled assets into the app's public directory.
//
// The browser fetches proving and verifier keys from its own origin at call
// time, so they have to sit under app/public. They are not in the repository —
// roughly 233 MB of generated binaries — which means this step is part of the
// build rather than a thing someone remembers to do.
//
// Forgetting it is not a loud failure: the app loads, the UI works, and the
// first circuit call fails deep inside the proof provider with a fetch error
// for a key file. That is why this runs automatically after a compile.

import { cpSync, existsSync } from 'node:fs';

const DIRS = ['keys', 'zkir', 'compiler'];
const from = (d) => new URL(`../build/mask_pay/${d}`, import.meta.url);
const to = (d) => new URL(`../../app/public/${d}`, import.meta.url);

for (const dir of DIRS) {
  const source = from(dir);
  if (!existsSync(source)) {
    console.error(`missing ${source.pathname} — compile mask_pay first`);
    process.exit(1);
  }
  cpSync(source, to(dir), { recursive: true });
}

console.log(`synced ${DIRS.join(', ')} into app/public`);
