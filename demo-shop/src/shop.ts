// A shop that takes private payments.
//
// This exists to prove the integration story is real: a merchant's server that
// creates invoices, redirects customers to checkout, receives a signed webhook,
// and fulfils an order — without ever holding an amount.
//
// Read the fulfilment handler and note what it does not have. There is no
// `order.total` anywhere in this file's server state, because Mask never gives
// it one. The shop knows its own prices; the chain and the payment rail do not.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { Mask, generateMerchantKey } from '@mask/node';

const PORT = Number(process.env.PORT ?? 4000);
const APP_URL = process.env.MASK_APP_URL ?? 'http://localhost:5175';
const BACKEND = process.env.MASK_BACKEND_URL ?? 'http://localhost:3100';
const WEBHOOK_SECRET = process.env.MASK_WEBHOOK_SECRET ?? 'live-test-secret';

function contractAddress(): string {
  if (process.env.MASK_CONTRACT_ADDRESS) return process.env.MASK_CONTRACT_ADDRESS;
  for (const p of ['../app/.env.local', '../../app/.env.local']) {
    try {
      const m = /VITE_CONTRACT_ADDRESS=(\w+)/.exec(readFileSync(p, 'utf8'));
      if (m?.[1]) return m[1];
    } catch {
      /* keep looking */
    }
  }
  throw new Error('No contract address. Deploy mask_pay first.');
}

// The shop's own catalogue. Prices live here, in the merchant's system, which
// is the only place they exist outside the payer's browser.
const CATALOGUE = [
  { sku: 'tee', name: 'Mask T-shirt', price: 3_500n },
  { sku: 'hoodie', name: 'Mask Hoodie', price: 8_900n },
  { sku: 'sticker', name: 'Sticker pack', price: 500n },
];

/** Orders the shop is waiting on, and the ones it has fulfilled. */
const orders = new Map<
  string,
  { sku: string; sessionId?: string; status: 'awaiting_payment' | 'paid'; placedAt: number }
>();

const merchantKey = process.env.MASK_MERCHANT_KEY ?? generateMerchantKey();

const mask = new Mask({
  contractAddress: contractAddress(),
  indexerUri: process.env.MASK_INDEXER_URI ?? 'http://localhost:8088/api/v4/graphql',
  indexerWsUri: process.env.MASK_INDEXER_WS_URI ?? 'ws://localhost:8088/api/v4/graphql/ws',
  merchantKey,
  appUrl: APP_URL,
  webhookSecret: WEBHOOK_SECRET,
});

const send = (res: ServerResponse, status: number, body: unknown, type = 'application/json') => {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const page = (body: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Demo Shop — pays with Mask</title>
<style>
  :root { color-scheme: dark }
  body { background:#08090a; color:#f2f4f5; font:16px/1.6 ui-sans-serif,system-ui,sans-serif;
         margin:0; padding:48px 20px; }
  main { max-width:640px; margin:0 auto }
  h1 { font-size:28px; letter-spacing:-.02em; margin:0 0 4px }
  p.sub { color:#9aa3ab; margin:0 0 32px }
  .item { display:flex; align-items:center; justify-content:space-between; gap:16px;
          border:1px solid #23272b; border-radius:16px; padding:16px 20px; margin-bottom:12px;
          background:#0f1113 }
  .price { color:#46e0a8; font-weight:600 }
  button, a.btn { background:#f2903a; color:#08090a; border:0; border-radius:12px;
                  padding:10px 18px; font:inherit; font-weight:600; cursor:pointer;
                  text-decoration:none; display:inline-block }
  .note { border:1px solid #23272b; border-radius:16px; padding:20px; margin-top:32px;
          color:#6b747c; font-size:14px; background:#0f1113 }
  code { color:#46e0a8; font-family:ui-monospace,monospace; font-size:13px }
  .ok { color:#46e0a8 }
</style></head><body><main>${body}</main></body></html>`;

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/$/, '') || '/';

  if (path === '/') {
    const items = CATALOGUE.map(
      (i) => `<div class="item">
        <div><strong>${i.name}</strong><br><span class="price">${i.price.toLocaleString()} tNIGHT</span></div>
        <form method="POST" action="/buy"><input type="hidden" name="sku" value="${i.sku}">
        <button type="submit">Buy</button></form>
      </div>`,
    ).join('');

    const fulfilled = [...orders.entries()].filter(([, o]) => o.status === 'paid');
    const recent = fulfilled.length
      ? `<div class="note"><strong class="ok">Fulfilled orders</strong><br>${fulfilled
          .map(([id, o]) => `<code>${id}</code> — ${o.sku}`)
          .join('<br>')}</div>`
      : '';

    send(
      res,
      200,
      page(`<h1>Demo Shop</h1>
        <p class="sub">A shop that takes private payments.</p>
        ${items}
        <div class="note">
          This server knows its own prices. It never learns what you paid — the amount travels
          from this page to your wallet in a URL fragment, which browsers do not send to servers.
          When the chain confirms a payment, this shop is told <em>that</em> it happened and which
          order it was for. Never how much.
        </div>
        ${recent}`),
      'text/html',
    );
    return;
  }

  if (path === '/buy' && req.method === 'POST') {
    const body = await readBody(req);
    const sku = new URLSearchParams(body).get('sku');
    const item = CATALOGUE.find((i) => i.sku === sku);
    if (!item) {
      send(res, 400, page('<h1>Unknown item</h1><a class="btn" href="/">Back</a>'), 'text/html');
      return;
    }

    const orderId = `order_${Math.random().toString(36).slice(2, 10)}`;

    // The SDK builds the payment link locally. The amount goes into the link's
    // fragment and nowhere else.
    const invoice = mask.createInvoice({ amount: item.price });

    // The checkout session carries only routing information.
    let sessionId: string | undefined;
    try {
      const created = await fetch(`${BACKEND}/api/checkout/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentUrl: invoice.paymentLink,
          clientReference: orderId,
          successUrl: `http://localhost:${PORT}/thanks?order=${orderId}`,
          cancelUrl: `http://localhost:${PORT}/`,
          webhookUrl: `http://localhost:${PORT}/mask-webhook`,
        }),
      });
      if (created.ok) sessionId = ((await created.json()) as { id: string }).id;
    } catch {
      // The shop still works without the hosted checkout — it just sends the
      // customer straight to the payment link.
    }

    orders.set(orderId, { sku: item.sku, sessionId, status: 'awaiting_payment', placedAt: Date.now() });

    const target = sessionId ? `${APP_URL}/checkout/${sessionId}` : invoice.paymentLink;
    res.writeHead(302, { Location: target });
    res.end();
    return;
  }

  if (path === '/mask-webhook' && req.method === 'POST') {
    const raw = await readBody(req);
    const signature = (req.headers['x-mask-signature'] as string) ?? '';

    // Verified before anything is trusted. An unsigned or mis-signed webhook is
    // an attacker claiming an order was paid for.
    if (!mask.verifyWebhook(raw, signature)) {
      send(res, 401, { error: 'bad signature' });
      return;
    }

    const event = JSON.parse(raw) as { type: string; clientReference?: string };
    if (event.type === 'checkout.settled' && event.clientReference) {
      const order = orders.get(event.clientReference);
      if (order) {
        order.status = 'paid';
        process.stdout.write(`fulfilled ${event.clientReference} (${order.sku})\n`);
      }
    }
    send(res, 200, { received: true });
    return;
  }

  if (path === '/thanks') {
    const id = url.searchParams.get('order') ?? '';
    const order = orders.get(id);
    send(
      res,
      200,
      page(`<h1>Thank you</h1>
        <p class="sub">Order <code>${id}</code> — ${order?.status === 'paid' ? '<span class="ok">paid and fulfilled</span>' : 'awaiting confirmation'}</p>
        <div class="note">The shop learned your payment landed from the chain, not from you.
        It still does not know what you paid.</div>
        <p style="margin-top:24px"><a class="btn" href="/">Back to the shop</a></p>`),
      'text/html',
    );
    return;
  }

  if (path === '/orders') {
    send(res, 200, { orders: Object.fromEntries(orders) });
    return;
  }

  send(res, 404, page('<h1>Not found</h1><a class="btn" href="/">Back</a>'), 'text/html');
}

export const server = createServer((req, res) => {
  void route(req, res).catch((e) => {
    process.stderr.write(`error: ${e}\n`);
    send(res, 500, { error: 'internal error' });
  });
});

const isMain = process.argv[1]?.endsWith('shop.ts');
if (isMain) {
  server.listen(PORT, () => {
    process.stdout.write(`demo shop on http://localhost:${PORT}\n`);
    process.stdout.write(`contract ${contractAddress()}\n`);
    if (!process.env.MASK_MERCHANT_KEY) {
      process.stdout.write(`merchant key (generated) ${merchantKey}\n`);
    }
  });
}
