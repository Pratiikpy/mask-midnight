// The complete public record, as an outside observer sees it.
//
// Every privacy claim in this product reduces to one question: does a private
// value appear anywhere an observer can read? Answering it honestly means
// searching everything the indexer will serve — every block, every raw
// transaction, every contract state — not just the contract's latest action.
//
// An earlier version of the privacy check searched only that latest action and
// still printed "every transaction the indexer holds". The query it used to
// back that claim passed a contract address where a transaction hash belongs,
// failed, and was swallowed by a `.catch(() => null)`. It reported a clean
// result over a haystack that was never fetched. This module exists so that
// cannot happen again: the fetch either succeeds or throws, and the caller is
// told how much was actually searched.

import { endpoints } from './config.ts';

interface GqlResponse {
  data?: Record<string, unknown>;
  errors?: unknown;
}

async function gql(query: string, variables: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(endpoints.indexer, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`indexer returned HTTP ${res.status}`);
  const body = (await res.json()) as GqlResponse;
  if (body.errors) throw new Error(`indexer error: ${JSON.stringify(body.errors)}`);
  if (!body.data) throw new Error('indexer returned no data');
  return body.data;
}

/** Height of the chain head, as the indexer sees it. */
export async function latestHeight(): Promise<number> {
  const d = await gql('{ block { height } }');
  const h = (d.block as { height?: number } | null)?.height;
  if (typeof h !== 'number') throw new Error('indexer did not return a head block');
  return h;
}

export interface PublicRecord {
  /** Everything fetched, as one lowercase string ready to search. */
  blob: string;
  blocks: number;
  transactions: number;
  chars: number;
}

/**
 * Fetch every block in `[from, to]` with its transactions, raw bytes and
 * contract states.
 *
 * Blocks are requested in batches of aliased queries rather than one at a time,
 * because a few hundred round trips is the difference between a check that gets
 * run and one that gets skipped. Ten per request is the ceiling: the indexer
 * rejects fifteen of these with "Query is too complex", measured against the
 * running instance rather than guessed.
 */
export async function fetchPublicRecord(from: number, to: number, batch = 10): Promise<PublicRecord> {
  if (to < from) throw new Error(`empty range ${from}..${to}`);

  const parts: string[] = [];
  let blocks = 0;
  let transactions = 0;

  for (let start = from; start <= to; start += batch) {
    const end = Math.min(start + batch - 1, to);
    const aliases: string[] = [];
    for (let h = start; h <= end; h++) {
      aliases.push(
        `b${h}: block(offset: { height: ${h} }) {
           height hash zswapMerkleTreeRoot
           transactions {
             hash raw
             contractActions { address state zswapState }
             unshieldedCreatedOutputs { value owner }
             unshieldedSpentOutputs { value owner }
           }
         }`,
      );
    }
    const data = await gql(`{ ${aliases.join('\n')} }`);

    for (const value of Object.values(data)) {
      if (value === null || value === undefined) continue;
      blocks++;
      const txs = (value as { transactions?: unknown[] }).transactions ?? [];
      transactions += txs.length;
      parts.push(JSON.stringify(value));
    }
  }

  const blob = parts.join('').toLowerCase();
  return { blob, blocks, transactions, chars: blob.length };
}

/** Also pull the contract's own latest state, which is not inside a block body. */
export async function fetchContractState(address: string): Promise<string> {
  const d = await gql(
    `query($a: HexEncoded!) {
       contractAction(address: $a) {
         __typename address state zswapState
         transaction { hash raw protocolVersion }
       }
     }`,
    { a: address },
  );
  return JSON.stringify(d).toLowerCase();
}

/**
 * Wait until something written on chain is actually being served.
 *
 * The node confirming a transaction and the indexer serving the block it landed
 * in are two different events, and the gap between them widens under load. A
 * check that writes and then immediately reads will intermittently find nothing
 * — and if that check is a privacy control, "nothing found" reads as "the search
 * is blind", which is exactly the wrong conclusion.
 *
 * This happened: the control probe passed on its own and failed inside a full QA
 * run, where three other on-chain checks were competing for the same indexer.
 *
 * Polls for the value rather than sleeping a guessed interval, and reports
 * honestly when it never arrives instead of returning a verdict either way.
 */
export async function waitForIndexed(
  address: string,
  hexNeedle: string,
  timeoutMs = 90_000,
  intervalMs = 2_000,
): Promise<boolean> {
  const needle = hexNeedle.replace(/^0x/, '').toLowerCase();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      if ((await fetchContractState(address)).includes(needle)) return true;
    } catch {
      // The indexer can refuse a contract it has not seen yet. Keep waiting.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export interface Needle {
  label: string;
  pattern: string;
}

/**
 * Every encoding a number could realistically take in on-chain data.
 *
 * Decimal is matched with digit boundaries, and hex only at byte-aligned
 * widths. A bare hex substring of a small number ("a604") turns up by chance in
 * a 67 KB blob roughly once, which once produced a FAIL against a contract that
 * leaks nothing — a false alarm is as damaging to the check's credibility as a
 * miss.
 */
export function needles(v: bigint): Needle[] {
  const out: Needle[] = [{ label: 'decimal', pattern: v.toString(10) }];

  let hex = v.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const le = (hex.match(/../g) ?? []).reverse().join('');

  // Minimal-width first. Midnight's serialised ledger state stores an integer
  // as the fewest bytes that hold it, not as a padded machine word — a public
  // `expires_at` of 1759296000123 appears as `01999e36907b` and as nothing
  // else. A needle set of padded widths only found none of it, and would have
  // reported a contract that publishes the value in the clear as private.
  out.push({ label: 'BE', pattern: hex });
  out.push({ label: 'LE', pattern: le });

  for (const width of [8, 16, 32, 64]) {
    out.push({ label: `BE${width}`, pattern: hex.padStart(width * 2, '0') });
    out.push({ label: `LE${width}`, pattern: le.padEnd(width * 2, '0') });
  }
  return out;
}

/**
 * Is this needle long enough for a hit to mean something?
 *
 * The minimal encoding of 7500 is two bytes, `1d4c`. In an 800 KB hex blob that
 * pattern is expected to occur about a dozen times by chance, and it does — the
 * first honest run of this search reported every small amount as leaked. A
 * short needle therefore cannot distinguish a leak from noise in either
 * direction, so tests that depend on this search must use values whose minimal
 * encoding is at least six bytes; twelve hex characters do not collide inside a
 * few megabytes.
 *
 * Weak hits are still reported, marked as such, never counted as proof.
 */
export const isStrongNeedle = (n: Needle): boolean =>
  n.label === 'decimal' ? n.pattern.length >= 4 : n.pattern.length >= 12;

export interface LeakHit {
  value: string;
  label: string;
  pattern: string;
  /** False when the needle is short enough to occur by chance — see below. */
  strong: boolean;
}

/**
 * Match a decimal number as a number, not as a run of characters.
 *
 * The boundary excludes hex digits, not just decimal ones. Almost all of this
 * haystack is hex, and "7500" sits inside `…d57d7500a126…` by pure chance —
 * with a digits-only boundary that reads as a leaked amount, which is precisely
 * the false alarm this check exists to avoid. A real decimal leak in JSON is
 * bounded by a quote, colon, comma or brace, never by a hex character.
 */
const decimalRe = (pattern: string) => new RegExp(`(?<![0-9a-f])${pattern}(?![0-9a-f])`);

/** Search a haystack for one value in all its encodings. */
export function findLeaks(haystack: string, value: bigint, label = value.toString()): LeakHit[] {
  const hits: LeakHit[] = [];
  for (const n of needles(value)) {
    const found =
      n.label === 'decimal'
        ? decimalRe(n.pattern).test(haystack)
        : haystack.includes(n.pattern.toLowerCase());
    if (found) hits.push({ value: label, label: n.label, pattern: n.pattern, strong: isStrongNeedle(n) });
  }
  return hits;
}

/** Search for a raw byte string — a key, a salt, anything already hex. */
export function findRaw(haystack: string, hex: string, label: string): LeakHit[] {
  const p = hex.replace(/^0x/, '').toLowerCase();
  return haystack.includes(p) ? [{ value: label, label: 'raw hex', pattern: p, strong: p.length >= 12 }] : [];
}
