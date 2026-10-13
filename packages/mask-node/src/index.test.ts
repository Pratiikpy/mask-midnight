// SDK tests.
//
// Split deliberately: the pure surface (links, terms, webhooks) is tested
// exhaustively offline, and the chain-reading surface is exercised against the
// live devnet by devkit/src/seed.ts rather than mocked. A mocked indexer would
// only prove the mock works.

import { describe, it, expect } from 'vitest';
import { Mask, MaskError, decodeTerms, generateMerchantKey, InvoiceKind, TokenKind } from './index.js';

const config = {
  contractAddress: 'a'.repeat(64),
  indexerUri: 'http://localhost:8088/api/v4/graphql',
  indexerWsUri: 'ws://localhost:8088/api/v4/graphql/ws',
  merchantKey: 'b'.repeat(64),
  appUrl: 'https://pay.example.com',
  webhookSecret: 'shhh-this-is-a-test-secret',
};

describe('configuration', () => {
  it('rejects a malformed merchant key', () => {
    expect(() => new Mask({ ...config, merchantKey: 'nope' })).toThrow(MaskError);
  });

  it('rejects a missing contract address', () => {
    expect(() => new Mask({ ...config, contractAddress: '' })).toThrow(MaskError);
  });

  it('generates a valid merchant key', () => {
    expect(generateMerchantKey()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('createInvoice', () => {
  it('produces terms and a payment link', () => {
    const mask = new Mask(config);
    const inv = mask.createInvoice({ amount: 42_500n });

    expect(inv.terms.amount).toBe('42500');
    expect(inv.terms.merchantKey).toBe(config.merchantKey);
    expect(inv.terms.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(inv.paymentLink.startsWith('https://pay.example.com/pay#')).toBe(true);
  });

  it('puts the terms in the FRAGMENT, never the query string', () => {
    // The whole privacy claim of the link rests on this: a fragment is not
    // transmitted to a server, a query string is.
    const inv = new Mask(config).createInvoice({ amount: 1n });
    const url = new URL(inv.paymentLink);
    expect(url.search).toBe('');
    expect(url.hash.length).toBeGreaterThan(1);
  });

  it('uses a fresh salt every time', () => {
    const mask = new Mask(config);
    const salts = new Set(
      Array.from({ length: 25 }, () => mask.createInvoice({ amount: 100n }).terms.salt),
    );
    expect(salts.size).toBe(25);
  });

  it('rejects a zero or negative amount', () => {
    const mask = new Mask(config);
    expect(() => mask.createInvoice({ amount: 0n })).toThrow(/greater than zero/);
    expect(() => mask.createInvoice({ amount: -5n })).toThrow(/greater than zero/);
  });

  it('accepts number and string amounts', () => {
    const mask = new Mask(config);
    expect(mask.createInvoice({ amount: 500 }).terms.amount).toBe('500');
    expect(mask.createInvoice({ amount: '900' }).terms.amount).toBe('900');
  });

  it('carries kind and token through', () => {
    const inv = new Mask(config).createInvoice({
      amount: 10n,
      kind: InvoiceKind.MULTIPAY,
      token: TokenKind.MUSDC,
    });
    expect(inv.terms.kind).toBe(InvoiceKind.MULTIPAY);
    expect(inv.terms.token).toBe(TokenKind.MUSDC);
  });
});

describe('decodeTerms', () => {
  it('round-trips a payment link', () => {
    const inv = new Mask(config).createInvoice({ amount: 77_000n });
    const decoded = decodeTerms(inv.paymentLink);

    expect(decoded).not.toBeNull();
    expect(decoded!.amount).toBe('77000');
    expect(decoded!.salt).toBe(inv.terms.salt);
    expect(decoded!.contractAddress).toBe(config.contractAddress);
  });

  it('accepts a bare fragment as well as a full URL', () => {
    const inv = new Mask(config).createInvoice({ amount: 5n });
    const fragment = inv.paymentLink.split('#')[1]!;
    expect(decodeTerms(fragment)?.amount).toBe('5');
  });

  it('returns null for junk rather than throwing', () => {
    for (const bad of ['', 'not-base64!!', 'aGVsbG8=', '#', 'https://x.com/pay#zzzz']) {
      expect(decodeTerms(bad)).toBeNull();
    }
  });

  it('rejects terms with a malformed key or salt', () => {
    const forged = Buffer.from(
      JSON.stringify({ merchantKey: 'short', salt: 'short', amount: '1', kind: 0, token: 0 }),
    ).toString('base64url');
    expect(decodeTerms(forged)).toBeNull();
  });
});

describe('webhooks', () => {
  it('accepts a signature it produced', () => {
    const mask = new Mask(config);
    const body = JSON.stringify({ event: 'invoice.settled', receipt: 'ab'.repeat(32) });
    expect(mask.verifyWebhook(body, mask.signWebhook(body))).toBe(true);
  });

  it('rejects a tampered body', () => {
    const mask = new Mask(config);
    const sig = mask.signWebhook(JSON.stringify({ amount: 100 }));
    expect(mask.verifyWebhook(JSON.stringify({ amount: 999 }), sig)).toBe(false);
  });

  it('rejects a signature from a different secret', () => {
    const a = new Mask(config);
    const b = new Mask({ ...config, webhookSecret: 'a-completely-different-secret' });
    const body = '{"x":1}';
    expect(a.verifyWebhook(body, b.signWebhook(body))).toBe(false);
  });

  it('rejects junk signatures without throwing', () => {
    const mask = new Mask(config);
    for (const bad of ['', 'sha256=', 'not-hex', 'sha256=zz']) {
      expect(mask.verifyWebhook('{}', bad)).toBe(false);
    }
  });

  it('throws when no secret is configured', () => {
    const mask = new Mask({ ...config, webhookSecret: undefined });
    expect(() => mask.verifyWebhook('{}', 'sha256=00')).toThrow(/webhookSecret/);
  });
});

describe('input validation on chain reads', () => {
  it('rejects malformed digests before touching the network', async () => {
    const mask = new Mask(config);
    await expect(mask.receiptExists('short')).rejects.toThrow(/64 hex/);
    await expect(mask.attestationExists('short')).rejects.toThrow(/64 hex/);
    await expect(mask.getInvoice('short')).rejects.toThrow(/64 hex/);
  });
});
