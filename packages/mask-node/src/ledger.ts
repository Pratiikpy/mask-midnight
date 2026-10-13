// Bridge to the compiled contract's ledger reader.
//
// Isolated in its own module so the SDK's pure functions — link building,
// webhook verification — can be imported without pulling in the WASM-backed
// contract bundle.

// Resolved at runtime rather than build time: the compiled contract lives
// outside this package and is regenerated whenever the contract changes, so
// baking its types into the published SDK would make them go stale silently.
const MaskPay = await import(
  new URL('../../../contracts/build/mask_pay/contract/index.js', import.meta.url).href
) as { ledger(data: unknown): unknown };

export function readLedger(data: unknown): unknown {
  return MaskPay.ledger(data as never);
}
