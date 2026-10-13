// Mask on Midnight — checkout backend.
//
// Uses node:http rather than Express: the whole surface is six routes, and a
// framework would be more dependency than code.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { SessionStore, generateWebhookSecret } from './store.ts';
import { ChainWatcher } from './watcher.ts';
import {
  Assistant,
  AssistantError,
  assertMessages,
  assertPublicContext,
} from './assistant.ts';

const env = (n: string, d = ''): string => process.env[n] ?? d;

function contractAddress(): string {
  const fromEnv = env('MASK_CONTRACT_ADDRESS');
  if (fromEnv) return fromEnv;
  for (const p of ['../app/.env.local', '../../app/.env.local', 'app/.env.local']) {
    try {
      const m = /VITE_CONTRACT_ADDRESS=(\w+)/.exec(readFileSync(p, 'utf8'));
      if (m?.[1]) return m[1];
    } catch {
      /* keep looking */
    }
  }
  return '';
}

const PORT = Number(env('PORT', '3100'));
const WEBHOOK_SECRET = env('MASK_WEBHOOK_SECRET') || generateWebhookSecret();

export const store = new SessionStore();
export const watcher = new ChainWatcher(store, {
  contractAddress: contractAddress(),
  indexerUri: env('MASK_INDEXER_URI', 'http://localhost:8088/api/v4/graphql'),
  indexerWsUri: env('MASK_INDEXER_WS_URI', 'ws://localhost:8088/api/v4/graphql/ws'),
  webhookSecret: WEBHOOK_SECRET,
  intervalMs: Number(env('MASK_POLL_MS', '5000')),
});

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    // Reads are public; the app runs on a different origin in development.
    'Access-Control-Allow-Origin': env('MASK_CORS_ORIGIN', '*'),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(payload);
};

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // A checkout session is a few hundred bytes; anything larger is not one.
    if (size > 64 * 1024) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// One instance, so the "is it configured" answer and the counters are shared.
const assistant = new Assistant();

export async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/$/, '') || '/';

  if (req.method === 'OPTIONS') {
    json(res, 204, {});
    return;
  }

  if (path === '/' || path === '/health') {
    json(res, 200, {
      service: 'mask-midnight-backend',
      status: 'ok',
      contract: contractAddress() || null,
      sessions: store.size(),
      watcher: watcher.stats,
      // Said plainly, because it is the interesting property.
      assistant: assistant.configured ? 'available' : 'not configured',
      note: 'This server never sees invoice amounts. They travel in the payment link fragment.',
    });
    return;
  }

  // The assistant. The browser is told whether it exists before it offers it,
  // so a user is never given a chat box that cannot answer.
  if (path === '/api/assistant' && req.method === 'GET') {
    json(res, 200, { configured: assistant.configured, stats: assistant.stats });
    return;
  }

  if (path === '/api/assistant/chat' && req.method === 'POST') {
    let body: Record<string, unknown>;
    try {
      body = (await readBody(req)) as Record<string, unknown>;
    } catch (e) {
      json(res, 400, { error: e instanceof Error ? e.message : 'invalid JSON' });
      return;
    }

    try {
      // Validated before anything is built, so a request carrying a secret is
      // refused here rather than quietly cleaned up and forwarded.
      const messages = assertMessages(body.messages);
      const context = assertPublicContext(body.context);
      const answer = await assistant.chat(messages, context);
      json(res, 200, answer);
    } catch (e) {
      if (e instanceof AssistantError) {
        json(res, e.status, { error: e.message });
        return;
      }
      json(res, 500, { error: 'assistant failed' });
    }
    return;
  }

  if (path === '/api/checkout/sessions' && req.method === 'POST') {
    let body: Record<string, unknown>;
    try {
      body = (await readBody(req)) as Record<string, unknown>;
    } catch (e) {
      json(res, 400, { error: e instanceof Error ? e.message : 'invalid JSON' });
      return;
    }

    if (typeof body.paymentUrl !== 'string' || !body.paymentUrl) {
      json(res, 400, { error: 'paymentUrl is required' });
      return;
    }
    if (body.commitment !== undefined && !/^[0-9a-fA-F]{64}$/.test(String(body.commitment))) {
      json(res, 400, { error: 'commitment must be 64 hex characters' });
      return;
    }

    const session = store.create({
      paymentUrl: body.paymentUrl,
      commitment: body.commitment as string | undefined,
      clientReference: body.clientReference as string | undefined,
      successUrl: body.successUrl as string | undefined,
      cancelUrl: body.cancelUrl as string | undefined,
      webhookUrl: body.webhookUrl as string | undefined,
      ttlMs: typeof body.ttlMs === 'number' ? body.ttlMs : undefined,
    });
    json(res, 201, session);
    return;
  }

  const sessionMatch = /^\/api\/checkout\/sessions\/([A-Za-z0-9_]+)$/.exec(path);
  if (sessionMatch) {
    const session = store.get(sessionMatch[1]!);
    if (!session) {
      json(res, 404, { error: 'no such session' });
      return;
    }

    if (req.method === 'GET') {
      json(res, 200, session);
      return;
    }

    // Attach the commitment once the merchant's client has published it. The
    // watcher cannot look for a settlement until it knows what to look for.
    if (req.method === 'POST') {
      let body: Record<string, unknown>;
      try {
        body = (await readBody(req)) as Record<string, unknown>;
      } catch {
        json(res, 400, { error: 'invalid JSON' });
        return;
      }
      if (!/^[0-9a-fA-F]{64}$/.test(String(body.commitment))) {
        json(res, 400, { error: 'commitment must be 64 hex characters' });
        return;
      }
      json(res, 200, store.update(session.id, { commitment: String(body.commitment) }));
      return;
    }
  }

  json(res, 404, { error: 'not found' });
}

export const server = createServer((req, res) => {
  void route(req, res).catch(() => json(res, 500, { error: 'internal error' }));
});

// Only listen when run directly, so tests can import the router.
const isMain = process.argv[1]?.endsWith('server.ts');
if (isMain) {
  watcher.start();
  server.listen(PORT, () => {
    process.stdout.write(`mask backend on http://localhost:${PORT}\n`);
    process.stdout.write(`contract ${contractAddress() || '(none configured)'}\n`);
    if (!env('MASK_WEBHOOK_SECRET')) {
      process.stdout.write(`webhook secret (generated) ${WEBHOOK_SECRET}\n`);
    }
  });
}
