// Show the surrounding bytes of every apparent leak.
//
// A decimal hit in four megabytes of JSON is usually coincidence — a fee
// parameter, a block height, a UTXO value that happens to read the same. The
// only way to tell a real leak from a collision is to look at what the number
// is sitting next to, so this prints that rather than leaving a verdict to
// guesswork.
//
// Usage: node --experimental-strip-types src/leak-context.ts <value> [value…]

import { fetchPublicRecord, latestHeight, needles } from './public-record.ts';

const values = process.argv.slice(2).map((v) => BigInt(v));
if (values.length === 0) {
  console.error('usage: leak-context.ts <value> [value…]');
  process.exit(2);
}

async function main(): Promise<void> {
  const record = await fetchPublicRecord(0, await latestHeight());
  console.log(`searched ${record.chars} chars over ${record.blocks} blocks\n`);

  for (const v of values) {
    for (const n of needles(v)) {
      const re =
        n.label === 'decimal'
          ? new RegExp(`(?<![0-9a-f])${n.pattern}(?![0-9a-f])`, 'g')
          : new RegExp(n.pattern.toLowerCase(), 'g');

      let m: RegExpExecArray | null;
      let count = 0;
      while ((m = re.exec(record.blob)) !== null) {
        count++;
        if (count <= 4) {
          const s = Math.max(0, m.index - 90);
          const e = Math.min(record.blob.length, m.index + n.pattern.length + 90);
          console.log(`${v} as ${n.label} @ ${m.index}`);
          console.log(`  …${record.blob.slice(s, e)}…\n`);
        }
      }
      if (count > 4) console.log(`  (${count - 4} further occurrences of ${v} as ${n.label})\n`);
    }
  }
}

main().catch((e) => {
  console.error('failed:', e);
  process.exitCode = 1;
});
