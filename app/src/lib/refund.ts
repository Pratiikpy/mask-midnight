// The refund code.
//
// To refund a payment the merchant must name it, and the only party who can is
// the payer: the payer key is generated fresh for each payment and never
// leaves their browser. So a payer who wants a refund hands the merchant this
// code, privately, over whatever channel they already use.
//
// It carries the payer's key and the payment index (which together name one
// receipt) and the shielded coin key the refund should be sent to. It does not
// carry the invoice, the amount, or anything the merchant does not already hold.
// It is as sensitive as the payment link: whoever has it can read which payment
// it names and where its refund goes.

export interface RefundCode {
  payerKey: string; // hex, 32 bytes
  paymentIndex: string; // decimal
  payerAddr: string; // hex, the payer's shielded coin public key
}

export function encodeRefundCode(code: RefundCode): string {
  return btoa(JSON.stringify(code)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeRefundCode(encoded: string): RefundCode | null {
  try {
    const b64 = encoded.trim().replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(b64)) as Partial<RefundCode>;
    if (typeof parsed.payerKey !== 'string' || !/^[0-9a-f]{64}$/i.test(parsed.payerKey)) return null;
    if (typeof parsed.payerAddr !== 'string' || !/^[0-9a-f]{64}$/i.test(parsed.payerAddr)) return null;
    if (typeof parsed.paymentIndex !== 'string' || !/^\d+$/.test(parsed.paymentIndex)) return null;
    return parsed as RefundCode;
  } catch {
    return null;
  }
}
