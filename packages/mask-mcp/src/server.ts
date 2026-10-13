#!/usr/bin/env node
// Mask on Midnight — MCP server.
//
// Exposes Mask to an AI client over stdio JSON-RPC. Deliberately limited to
// what can be done without a wallet: minting invoice terms and links, decoding
// links, and reading public chain state.
//
// It cannot pay, settle, or move funds, and that is a design choice rather than
// an omission. Settling needs a proof and a signature; handing an autonomous
// agent the ability to spend on the user's behalf is not a capability worth
// having by default.

import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { Mask, decodeTerms, generateMerchantKey } from '@mask/node';

const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

const env = (n: string, d = ''): string => process.env[n] ?? d;

function contractAddress(): string {
  const fromEnv = env('MASK_CONTRACT_ADDRESS');
  if (fromEnv) return fromEnv;
  for (const p of ['app/.env.local', '../app/.env.local', '../../app/.env.local']) {
    try {
      const m = /VITE_CONTRACT_ADDRESS=(\w+)/.exec(readFileSync(p, 'utf8'));
      if (m?.[1]) return m[1];
    } catch {
      /* keep looking */
    }
  }
  return '';
}

function client(): Mask {
  const address = contractAddress();
  if (!address) throw new Error('MASK_CONTRACT_ADDRESS is not set.');
  return new Mask({
    contractAddress: address,
    indexerUri: env('MASK_INDEXER_URI', 'http://localhost:8088/api/v4/graphql'),
    indexerWsUri: env('MASK_INDEXER_WS_URI', 'ws://localhost:8088/api/v4/graphql/ws'),
    merchantKey: env('MASK_MERCHANT_KEY') || '0'.repeat(64),
    appUrl: env('MASK_APP_URL'),
  });
}

const TOOLS = [
  {
    name: 'mask_create_invoice',
    description:
      'Create a private invoice and a payment link. The amount is never published to the chain — ' +
      'only a commitment is. The link carries the terms in its URL fragment, which browsers never ' +
      'send to a server. Requires MASK_MERCHANT_KEY.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'string', description: 'Whole units, as a decimal string.' },
        kind: {
          type: 'string',
          enum: ['standard', 'multipay', 'donation'],
          description: 'standard settles once; multipay and donation accept many payers.',
        },
        token: { type: 'string', enum: ['night', 'musdc', 'musad'] },
      },
      required: ['amount'],
    },
  },
  {
    name: 'mask_decode_link',
    description: 'Read the terms inside a Mask payment link.',
    inputSchema: {
      type: 'object',
      properties: { link: { type: 'string' } },
      required: ['link'],
    },
  },
  {
    name: 'mask_invoice_status',
    description:
      "Read an invoice's public state from the chain: open, settled, cancelled or unknown, plus " +
      'how many contributions it received. No amount is returned, because the chain holds none.',
    inputSchema: {
      type: 'object',
      properties: { commitment: { type: 'string', description: '64 hex characters.' } },
      required: ['commitment'],
    },
  },
  {
    name: 'mask_verify_receipt',
    description:
      'Check whether a payment receipt was published on chain. Proves a payment happened without ' +
      'revealing who paid or how much. The publishing transaction also touched an opaque invoice commitment.',
    inputSchema: {
      type: 'object',
      properties: { receipt: { type: 'string', description: '64 hex characters.' } },
      required: ['receipt'],
    },
  },
  {
    name: 'mask_verify_attestation',
    description:
      'Check whether a revenue attestation was published on chain. A merchant can prove revenue ' +
      'met a threshold without revealing the revenue.',
    inputSchema: {
      type: 'object',
      properties: { digest: { type: 'string', description: '64 hex characters.' } },
      required: ['digest'],
    },
  },
  {
    name: 'mask_generate_merchant_key',
    description:
      'Generate a merchant identity key. Every invoice binds to it and it proves ownership; the ' +
      'chain keeps no copy, so it must be stored safely.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const KINDS: Record<string, number> = { standard: 0, multipay: 1, donation: 2 };
const TOKENS: Record<string, number> = { night: 0, musdc: 1, musad: 2 };
const KIND_LABEL = ['standard', 'multipay', 'donation'];
const TOKEN_LABEL = ['tNIGHT', 'mUSDC', 'mUSAD'];

const text = (s: string) => ({ content: [{ type: 'text', text: s }] });

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'mask_generate_merchant_key':
      return text(
        `${generateMerchantKey()}\n\nStore this privately. The chain holds no copy — losing it ` +
          'means invoices created with it can no longer be proven as yours.',
      );

    case 'mask_create_invoice': {
      const kind = KINDS[String(args.kind ?? 'standard').toLowerCase()];
      const token = TOKENS[String(args.token ?? 'night').toLowerCase()];
      if (kind === undefined) throw new Error('kind must be standard, multipay or donation.');
      if (token === undefined) throw new Error('token must be night, musdc or musad.');
      if (!env('MASK_MERCHANT_KEY')) {
        throw new Error('MASK_MERCHANT_KEY is not set — cannot create an invoice without it.');
      }

      const inv = client().createInvoice({
        amount: String(args.amount),
        kind: kind as never,
        token: token as never,
      });
      return text(
        `Payment link:\n${inv.paymentLink}\n\n` +
          `amount     ${inv.terms.amount} ${TOKEN_LABEL[token]}\n` +
          `type       ${KIND_LABEL[kind]}\n` +
          `reference  ${inv.reference}\n\n` +
          'The amount is not on chain. Anyone holding this link can pay it.',
      );
    }

    case 'mask_decode_link': {
      const terms = decodeTerms(String(args.link));
      if (!terms) throw new Error('That link is malformed.');
      return text(
        JSON.stringify(
          {
            amount: terms.amount,
            token: TOKEN_LABEL[terms.token] ?? terms.token,
            kind: KIND_LABEL[terms.kind] ?? terms.kind,
            merchantKey: terms.merchantKey,
            contractAddress: terms.contractAddress,
          },
          null,
          2,
        ),
      );
    }

    case 'mask_invoice_status': {
      const state = await client().getInvoice(String(args.commitment));
      if (state.status === 'unknown') {
        return text('unknown — no invoice with that commitment on this contract.');
      }
      return text(
        `${state.status}\n\n` +
          `type           ${KIND_LABEL[state.kind] ?? state.kind}\n` +
          `asset          ${TOKEN_LABEL[state.token] ?? state.token}\n` +
          `contributions  ${state.contributions}\n` +
          `expires        ${state.expiresAt === 0n ? 'never' : new Date(Number(state.expiresAt) * 1000).toISOString()}\n\n` +
          'No amount is shown because the chain holds none.',
      );
    }

    case 'mask_verify_receipt': {
      const found = await client().receiptExists(String(args.receipt));
      return text(
        found
          ? 'Found. A payment happened. Who paid and how much are not on chain.'
          : 'Not found on this contract.',
      );
    }

    case 'mask_verify_attestation': {
      const found = await client().attestationExists(String(args.digest));
      return text(
        found
          ? 'Found. A revenue claim was proven and accepted. The revenue itself is not on chain.'
          : 'Not found on this contract.',
      );
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function send(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function handle(req: JsonRpcRequest): Promise<void> {
  // Notifications carry no id and must not be answered.
  const isNotification = req.id === undefined || req.id === null;

  try {
    let result: unknown;

    switch (req.method) {
      case 'initialize':
        result = {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'mask-midnight', version: '2.0.0' },
        };
        break;
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'tools/call':
        result = await callTool(
          String(req.params?.name),
          (req.params?.arguments as Record<string, unknown>) ?? {},
        );
        break;
      case 'ping':
        result = {};
        break;
      default:
        if (isNotification) return;
        send({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        });
        return;
    }

    if (!isNotification) send({ jsonrpc: '2.0', id: req.id, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isNotification) return;
    // Tool failures are reported as tool results, not protocol errors — the
    // model should see "that receipt is malformed" and correct itself, not a
    // transport-level fault.
    if (req.method === 'tools/call') {
      send({
        jsonrpc: '2.0',
        id: req.id,
        result: { content: [{ type: 'text', text: `Error: ${message}` }], isError: true },
      });
    } else {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32603, message } });
    }
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(trimmed) as JsonRpcRequest;
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  void handle(req);
});
