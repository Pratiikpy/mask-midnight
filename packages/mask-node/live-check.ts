// Live check against the running devnet and the seeded contract.
// Not a unit test: this proves the SDK reads real chain state correctly.

import { readFileSync } from 'node:fs';
// Imports the BUILT artifact, not source: this is the thing that actually
// ships, and the dynamic ledger import only resolves correctly after tsc.
import { Mask, generateMerchantKey } from './dist/index.js';

const env = readFileSync(new URL('../../app/.env.local', import.meta.url), 'utf8');
const address = /VITE_CONTRACT_ADDRESS=(\w+)/.exec(env)?.[1];
if (!address) throw new Error('no contract address; run deploy first');

const mask = new Mask({
  contractAddress: address,
  indexerUri: 'http://localhost:8088/api/v4/graphql',
  indexerWsUri: 'ws://localhost:8088/api/v4/graphql/ws',
  merchantKey: generateMerchantKey(),
  appUrl: 'https://pay.example.com',
});

// Read from what the seed actually wrote, not hardcoded.
//
// Every seed run draws fresh salts, so the commitments differ every time. An
// earlier version of this file pinned them as constants: it passed on the run
// it was written for and failed on every reseed afterwards, reporting "open
// invoice status: unknown" as though the SDK were broken when the invoice it
// was looking for had simply never existed on this contract.
const seedPath = new URL('../../devkit/seed-output.json', import.meta.url);
let seeded;
try {
  seeded = JSON.parse(readFileSync(seedPath, 'utf8'));
} catch {
  throw new Error(
    `No seed output at ${seedPath.pathname}.\n` +
      'Run devkit/src/seed.ts against the deployed contract first — this check reads\n' +
      'the digests that run produced.',
  );
}

if (seeded.contractAddress !== address) {
  throw new Error(
    `The seed output is for contract ${seeded.contractAddress}, but the app is pointed at\n` +
      `${address}. Reseed after redeploying.`,
  );
}

const { open: OPEN, settled: SETTLED, receipt: RECEIPT, multipay: MULTIPAY } = seeded.digests;
const ABSENT = 'f'.repeat(64);

const rows = [];
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  rows.push(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(34)} ${JSON.stringify(actual)}`);
  return ok;
};

let allOk = true;
console.log(`contract ${address}\n`);

const open = await mask.getInvoice(OPEN);
allOk &= check('open invoice status', open.status, 'open');
allOk &= check('open invoice contributions', open.contributions, 0);

const settled = await mask.getInvoice(SETTLED);
allOk &= check('settled invoice status', settled.status, 'settled');
allOk &= check('settled invoice contributions', settled.contributions, 1);
allOk &= check('isSettled(settled)', await mask.isSettled(SETTLED), true);
allOk &= check('isSettled(open)', await mask.isSettled(OPEN), false);

const multi = await mask.getInvoice(MULTIPAY);
allOk &= check('multipay stays open', multi.status, 'open');
allOk &= check('multipay contributions', multi.contributions, 2);

allOk &= check('receiptExists(real)', await mask.receiptExists(RECEIPT), true);
allOk &= check('receiptExists(absent)', await mask.receiptExists(ABSENT), false);
allOk &= check('attestationExists(absent)', await mask.attestationExists(ABSENT), false);
allOk &= check('unknown invoice', (await mask.getInvoice(ABSENT)).status, 'unknown');

// The chain must not be able to tell anyone the amount.
const serialised = JSON.stringify({ open, settled, multi }, (_k, v) =>
  typeof v === 'bigint' ? v.toString() : v,
);
allOk &= check('no amount in invoice state', /42500|91300|12000/.test(serialised), false);

console.log(rows.join('\n'));
console.log(`\n${allOk ? 'ALL LIVE CHECKS PASSED' : 'SOME LIVE CHECKS FAILED'}\n`);
process.exit(allOk ? 0 : 1);
