#!/usr/bin/env node
// Mask on Midnight — command line.
//
// Covers the parts of the product that do not need a wallet: generating a
// merchant key, minting invoice terms and links, decoding a link someone sent
// you, and reading public chain state. Anything that writes to the chain needs
// a proof and therefore a wallet, so it lives in the app rather than here.

import { readFileSync } from 'node:fs';
import { Mask, decodeTerms, generateMerchantKey, InvoiceKind, TokenKind } from '@mask/node';

const KIND_NAMES: Record<string, number> = {
  standard: InvoiceKind.STANDARD,
  multipay: InvoiceKind.MULTIPAY,
  donation: InvoiceKind.DONATION,
};

const TOKEN_NAMES: Record<string, number> = {
  night: TokenKind.NATIVE,
  tnight: TokenKind.NATIVE,
  musdc: TokenKind.MUSDC,
  musad: TokenKind.MUSAD,
};

const KIND_LABEL = ['standard', 'multipay', 'donation'];
const TOKEN_LABEL = ['tNIGHT', 'mUSDC', 'mUSAD'];

const USAGE = `mask — private invoices on Midnight

  mask keygen
      Generate a merchant identity key. Store it privately; every invoice
      binds to it and it is what proves an invoice is yours.

  mask invoice <amount> [--kind standard|multipay|donation]
                        [--token night|musdc|musad]
      Create invoice terms and a payment link. Nothing is written to the
      chain — publishing the commitment needs a proof, and so a wallet.

  mask decode <link>
      Show the terms inside a payment link.

  mask status <commitment>
      Read an invoice's public state from the chain.

  mask receipt <digest>
      Check whether a payment receipt was published.

  mask attestation <digest>
      Check whether a revenue attestation was published.

  mask stats
      How many invoices exist. The only aggregate the chain publishes.

Environment:
  MASK_MERCHANT_KEY      64 hex characters. Required for 'invoice'.
  MASK_CONTRACT_ADDRESS  Deployed mask_pay address. Required for chain reads.
  MASK_INDEXER_URI       Default http://localhost:8088/api/v4/graphql
  MASK_INDEXER_WS_URI    Default ws://localhost:8088/api/v4/graphql/ws
  MASK_APP_URL           Base URL for payment links.
`;

const env = (name: string, fallback = ''): string => process.env[name] ?? fallback;

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

/** Read the address from the environment, or from a deployed app/.env.local. */
function contractAddress(): string {
  const fromEnv = env('MASK_CONTRACT_ADDRESS');
  if (fromEnv) return fromEnv;
  for (const path of ['app/.env.local', '../app/.env.local', '../../app/.env.local']) {
    try {
      const m = /VITE_CONTRACT_ADDRESS=(\w+)/.exec(readFileSync(path, 'utf8'));
      if (m?.[1]) return m[1];
    } catch {
      /* keep looking */
    }
  }
  fail('No contract address. Set MASK_CONTRACT_ADDRESS.');
}

function client(requireKey: boolean): Mask {
  const merchantKey = env('MASK_MERCHANT_KEY');
  if (requireKey && !merchantKey) {
    fail("No merchant key. Set MASK_MERCHANT_KEY, or run 'mask keygen' to make one.");
  }
  return new Mask({
    contractAddress: contractAddress(),
    indexerUri: env('MASK_INDEXER_URI', 'http://localhost:8088/api/v4/graphql'),
    indexerWsUri: env('MASK_INDEXER_WS_URI', 'ws://localhost:8088/api/v4/graphql/ws'),
    // Chain reads never use the key; a throwaway keeps the constructor happy.
    merchantKey: merchantKey || '0'.repeat(64),
    appUrl: env('MASK_APP_URL'),
  });
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'keygen': {
      const key = generateMerchantKey();
      process.stdout.write(`${key}\n`);
      process.stderr.write(
        '\nStore this privately and back it up. Losing it means every invoice created\n' +
          'with it can no longer be proven as yours — the chain holds no copy.\n\n' +
          `  export MASK_MERCHANT_KEY=${key}\n\n`,
      );
      return;
    }

    case 'invoice': {
      const amount = args[0];
      if (!amount) fail('Usage: mask invoice <amount>');

      const kindName = (flag(args, 'kind') ?? 'standard').toLowerCase();
      const tokenName = (flag(args, 'token') ?? 'night').toLowerCase();
      const kind = KIND_NAMES[kindName];
      const token = TOKEN_NAMES[tokenName];
      if (kind === undefined) fail(`Unknown kind '${kindName}'. Use standard, multipay or donation.`);
      if (token === undefined) fail(`Unknown token '${tokenName}'. Use night, musdc or musad.`);

      let inv;
      try {
        inv = client(true).createInvoice({ amount, kind: kind as never, token: token as never });
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }

      process.stdout.write(`${inv.paymentLink}\n`);
      process.stderr.write(
        `\namount     ${inv.terms.amount} ${TOKEN_LABEL[token]}\n` +
          `type       ${KIND_LABEL[kind]}\n` +
          `reference  ${inv.reference}\n\n` +
          'The terms are in the URL fragment, which browsers never send to a server.\n' +
          'Anyone with this link can pay it — treat it like an unpaid bill.\n\n',
      );
      return;
    }

    case 'decode': {
      const link = args[0];
      if (!link) fail('Usage: mask decode <link>');
      const terms = decodeTerms(link);
      if (!terms) fail('That link is malformed.');

      process.stdout.write(
        JSON.stringify(
          {
            amount: terms.amount,
            token: TOKEN_LABEL[terms.token] ?? terms.token,
            kind: KIND_LABEL[terms.kind] ?? terms.kind,
            merchantKey: terms.merchantKey,
            salt: terms.salt,
            contractAddress: terms.contractAddress,
          },
          null,
          2,
        ) + '\n',
      );
      return;
    }

    case 'status': {
      const commitment = args[0];
      if (!commitment) fail('Usage: mask status <commitment>');
      const state = await client(false).getInvoice(commitment);

      if (state.status === 'unknown') {
        process.stdout.write('unknown\n');
        process.stderr.write('\nNo invoice with that commitment on this contract.\n\n');
        process.exitCode = 1;
        return;
      }

      process.stdout.write(`${state.status}\n`);
      process.stderr.write(
        `\ntype           ${KIND_LABEL[state.kind] ?? state.kind}\n` +
          `asset          ${TOKEN_LABEL[state.token] ?? state.token}\n` +
          `contributions  ${state.contributions}\n` +
          `expires        ${state.expiresAt === 0n ? 'never' : new Date(Number(state.expiresAt) * 1000).toISOString()}\n\n` +
          'The chain holds no amount for this invoice, so none is shown.\n\n',
      );
      return;
    }

    case 'stats': {
      // The one aggregate the ledger publishes. Worth its own command because
      // it is the only number about a business as a whole that anyone can read,
      // and knowing which number that is says a lot about the design.
      const created = await client(false).totalCreated();
      process.stdout.write(`${created}\n`);
      process.stderr.write(
        '\nInvoices created on this contract.\n' +
          'Not their value, not how many settled, not who issued them.\n\n',
      );
      return;
    }

    case 'receipt':
    case 'attestation': {
      const digest = args[0];
      if (!digest) fail(`Usage: mask ${command} <digest>`);
      const mask = client(false);
      const found =
        command === 'receipt'
          ? await mask.receiptExists(digest)
          : await mask.attestationExists(digest);

      process.stdout.write(`${found}\n`);
      process.stderr.write(
        found
          ? command === 'receipt'
            ? '\nA payment happened. Who paid and how much are not on chain.\n\n'
            : '\nA revenue claim was proven and accepted. The revenue itself is not on chain.\n\n'
          : '\nNot found on this contract.\n\n',
      );
      process.exitCode = found ? 0 : 1;
      return;
    }

    case 'help':
    case '--help':
    case '-h':
    case undefined:
      process.stdout.write(USAGE);
      return;

    default:
      fail(`Unknown command '${command}'. Run 'mask help'.`);
  }
}

main().catch((e) => {
  fail(e instanceof Error ? e.message : String(e));
});
