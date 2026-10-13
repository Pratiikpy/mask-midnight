// Does the private amount actually stay off the chain?
//
// The whole product rests on this one claim, so it gets checked against the
// source of truth rather than trusted because the contract "looks right".
//
// What is searched: the deployed contract's state and zswap state, plus every
// block the indexer holds with every transaction in it — raw bytes, contract
// states, and unshielded UTXO values. If the amount is anywhere an observer can
// reach, it is in there.
//
// Usage: node --experimental-strip-types src/verify-privacy.ts <address> <amount> [more amounts…]

import {
  fetchContractState,
  fetchPublicRecord,
  findLeaks,
  latestHeight,
  needles,
} from './public-record.ts';

const [, , contractAddress, ...amountArgs] = process.argv;
if (!contractAddress || amountArgs.length === 0) {
  console.error('usage: verify-privacy.ts <contractAddress> <amount> [amount…]');
  process.exit(2);
}

const amounts = amountArgs.map((a) => {
  const v = BigInt(a);
  if (v <= 0n) throw new Error(`amount must be positive: ${a}`);
  return v;
});

async function main(): Promise<void> {
  console.log(`contract  ${contractAddress}`);
  console.log(`amounts   ${amounts.join(', ')}\n`);

  const head = await latestHeight();
  const record = await fetchPublicRecord(0, head);
  const state = await fetchContractState(contractAddress);
  const haystack = record.blob + state;

  console.log(`searched  ${haystack.length} chars`);
  console.log(
    `          ${record.blocks} blocks, ${record.transactions} transactions, ` +
      `plus the contract's own state\n`,
  );

  // A haystack this small would mean the fetch silently returned nothing, which
  // is exactly how a privacy check turns into a false green.
  if (haystack.length < 1_000) {
    console.error('REFUSING TO PASS: the indexer returned almost no data. Nothing was searched.');
    process.exitCode = 1;
    return;
  }

  let leaked = false;
  let inconclusive = false;

  for (const amount of amounts) {
    const hits = findLeaks(haystack, amount);
    const strong = hits.filter((h) => h.strong);
    if (strong.length > 0) leaked = true;

    // A value whose minimal encoding is only two or three bytes cannot be
    // decided by this method: the same pattern occurs by chance many times in a
    // megabyte of hex, so neither a hit nor a miss means anything. Saying so is
    // the honest answer; six-byte values are decidable.
    const decidable = amount >= 1n << 40n;
    if (!decidable) inconclusive = true;

    console.log(`  ${amount}${decidable ? '' : '   (too small to decide — see note below)'}`);
    for (const n of needles(amount)) {
      const h = hits.find((x) => x.label === n.label);
      const mark = !h ? 'absent ' : h.strong ? 'FOUND  ' : 'weak   ';
      console.log(`    ${mark} ${n.label.padEnd(10)} ${n.pattern}`);
    }
  }

  console.log();
  if (leaked) {
    console.log('RESULT: an amount appears in on-chain data — investigate before trusting this design.');
    process.exitCode = 1;
  } else if (inconclusive) {
    console.log(`RESULT: no strong evidence of any amount (${haystack.length} chars searched), but`);
    console.log('at least one value is too small for this search to decide. Marked "weak" hits are');
    console.log('chance collisions in hex, not disclosures. Use a value of 2^40 or more to decide.');
  } else {
    console.log(`RESULT: no amount appears in any indexer-visible data (${haystack.length} chars).`);
  }
}

main().catch((e) => {
  console.error('verification error:', e);
  process.exitCode = 1;
});
