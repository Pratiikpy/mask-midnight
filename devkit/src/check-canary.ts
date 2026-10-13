// The privacy assertion, on the contract the app actually talks to.
//
// `control-probe.ts` proves the method works, on a throwaway contract it
// deploys itself. This proves the claim on the real one — the address in
// app/.env.local, holding the invoices the UI displays.
//
// Two values, seeded together by `seed.ts`:
//
//   the canary EXPIRY is published in the invoice record, and must be found;
//   the canary AMOUNT never leaves the witness, and must not be.
//
// The first is what makes the second mean anything. A search that cannot find a
// value published in the clear cannot be trusted when it reports an absence,
// and that failure mode is not hypothetical: an earlier needle set missed
// exactly this value because it looked only for padded machine words.

import { readFileSync } from 'node:fs';
import { PRIVACY_CANARY } from './config.ts';
import { fetchContractState, fetchPublicRecord, findLeaks, latestHeight, needles } from './public-record.ts';

const ENV_PATH = new URL('../../app/.env.local', import.meta.url).pathname;

function deployedAddress(): string {
  const arg = process.argv[2];
  if (arg) return arg;
  const env = readFileSync(ENV_PATH, 'utf8');
  const m = /VITE_CONTRACT_ADDRESS=([0-9a-fA-F]+)/.exec(env);
  if (!m) throw new Error(`no VITE_CONTRACT_ADDRESS in ${ENV_PATH} — run deploy.ts first`);
  return m[1]!;
}

async function main(): Promise<void> {
  const address = deployedAddress();
  console.log(`contract  ${address}`);
  console.log(`canary    public expiry ${PRIVACY_CANARY.expiry}, private amount ${PRIVACY_CANARY.amount}\n`);

  const record = await fetchPublicRecord(0, await latestHeight());
  const haystack = record.blob + (await fetchContractState(address));
  console.log(`searched  ${haystack.length} chars over ${record.blocks} blocks, ${record.transactions} transactions\n`);

  const expiryHits = findLeaks(haystack, PRIVACY_CANARY.expiry);
  const amountHits = findLeaks(haystack, PRIVACY_CANARY.amount).filter((h) => h.strong);

  console.log(
    `public expiry   ${expiryHits.length > 0 ? `FOUND as ${expiryHits.map((h) => h.label).join(', ')}` : 'NOT FOUND'}`,
  );
  console.log(
    `private amount  ${amountHits.length > 0 ? `FOUND as ${amountHits.map((h) => h.label).join(', ')}` : 'absent'}`,
  );

  if (expiryHits.length === 0) {
    console.log('\nencodings tried for the public value:');
    for (const n of needles(PRIVACY_CANARY.expiry)) console.log(`  ${n.label.padEnd(8)} ${n.pattern}`);
  }

  const sighted = expiryHits.length > 0 && haystack.length > 100_000;
  const clean = amountHits.length === 0;

  console.log('\n================== PRIVACY CANARY ==================');
  if (!sighted) {
    console.log('CANARY UNPROVEN — the search could not find a value published in the');
    console.log('clear, so its verdict on the private one carries no weight.');
  } else if (!clean) {
    console.log('LEAKED — the private amount is readable in on-chain data.');
  } else {
    console.log('PRIVACY VERIFIED on the deployed contract.');
    console.log('The search demonstrably sees ledger integers, and the amount is not there.');
  }
  console.log('====================================================\n');

  if (!sighted || !clean) process.exitCode = 1;
}

main().catch((e) => {
  console.error('CANARY CHECK FAILED:', e);
  process.exitCode = 1;
});
