// Keeps the merchant's local invoice records in step with the chain.
//
// The vault only knows what this device did. A payer settles an invoice from
// another browser, so an invoice that was paid would stay "open" here forever,
// and keep offering to be cancelled, unless its status is read back from the
// ledger.

import { readLedger } from './chain.ts';
import { fromHex } from './format.ts';
import { loadInvoices, saveInvoice } from './invoice.ts';

const STATUS = ['open', 'settled', 'cancelled'] as const;

/** Returns true when at least one record changed. Silent when the chain cannot be read. */
export async function syncInvoiceStatuses(): Promise<boolean> {
  const mine = loadInvoices().filter((i) => i.commitment);
  if (mine.length === 0) return false;
  let ledger;
  try {
    ledger = await readLedger();
  } catch {
    return false; // chain unreachable: keep the last known statuses
  }
  let changed = false;
  for (const inv of mine) {
    const key = fromHex(inv.commitment!);
    if (!ledger.invoices.member(key)) continue;
    const onChain = STATUS[ledger.invoices.lookup(key).status];
    if (onChain && onChain !== inv.status) {
      saveInvoice({ ...inv, status: onChain });
      changed = true;
    }
  }
  return changed;
}
