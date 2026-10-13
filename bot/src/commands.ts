// What the bot can say, and why it cannot say more.
//
// The obvious bot would create invoices, hold merchant sessions and quote
// amounts. That is the wrong design here: the amount, the salt and the
// merchant's identity key ARE the secret. A bot that created invoices would have to hold all three for every
// merchant it served, which would rebuild, on one server, exactly the database
// this product exists to avoid. Telegram would then hold it too: bot messages
// are plaintext to Telegram, and a chat log full of invoice terms is a chat log
// full of everything the chain was carefully not told.
//
// So this bot reads public state and hands out links. Anything requiring a
// secret happens in the browser, where the secret already lives and stays.
// Every command below is either a query anyone could run against the indexer,
// or a link.
//
// The router is a pure function of (text, chain reader) so the whole surface is
// testable without a bot token, a network, or a chain.

export interface InvoiceView {
  status: 'open' | 'settled' | 'cancelled' | 'unknown';
  kind: string;
  token: string;
  contributions: number;
  expiresAt: bigint;
}

/** Everything the bot is allowed to know. All of it is public. */
export interface ChainReader {
  getInvoice(commitment: string): Promise<InvoiceView>;
  receiptExists(receipt: string): Promise<boolean>;
  attestationExists(digest: string): Promise<boolean>;
  totalCreated(): Promise<bigint>;
}

export interface BotContext {
  chain: ChainReader;
  /** Where the browser app lives, for the links that carry the real work. */
  appUrl: string;
  /** Commitments this chat is watching, so /watch can report duplicates. */
  watched: (chatId: number) => Promise<string[]>;
  watch: (chatId: number, commitment: string) => Promise<void>;
  unwatch: (chatId: number, commitment: string) => Promise<boolean>;
}

export interface Reply {
  text: string;
  /** Markdown is off by default: a commitment is hex, but a memo is not ours. */
  parseMode?: 'MarkdownV2';
  buttons?: { text: string; url: string }[];
}

const HEX64 = /^[0-9a-f]{64}$/i;

export const COMMANDS = [
  { command: 'start', description: 'What this bot can and cannot do' },
  { command: 'invoice', description: 'Look up an invoice by its commitment' },
  { command: 'receipt', description: 'Check whether a receipt is on the ledger' },
  { command: 'attestation', description: 'Check a published revenue attestation' },
  { command: 'watch', description: 'Get a message when an invoice settles' },
  { command: 'unwatch', description: 'Stop watching an invoice' },
  { command: 'watching', description: 'List what this chat is watching' },
  { command: 'stats', description: 'Invoices created, the one public aggregate' },
  { command: 'create', description: 'Open the invoice form in the browser' },
  { command: 'pay', description: 'Open a payment link in the browser' },
  { command: 'privacy', description: 'What this bot never sees' },
] as const;

const START = [
  'Mask on Midnight — invoices that settle in public and stay private.',
  '',
  'What this bot does:',
  '  /invoice <commitment>   is it open, settled or cancelled',
  '  /receipt <digest>       is this receipt on the ledger',
  '  /attestation <digest>   was this revenue claim published',
  '  /watch <commitment>     a message the moment it settles',
  '  /watching               what this chat is watching',
  '  /unwatch <commitment>   stop',
  '  /stats                  invoices created, the one public number',
  '  /create                 open the invoice form',
  '  /pay <link>             open a payment link',
  '',
  'What it does not do: create invoices, hold your keys, or learn an amount.',
  'Those need secrets, and a bot is the wrong place to keep them. /privacy',
].join('\n');

const PRIVACY = [
  'What this bot never sees:',
  '',
  '  the amount of any invoice',
  '  your merchant identity key',
  '  any invoice salt',
  '  who paid whom',
  '',
  'It reads the same public ledger anyone can read: whether a commitment exists,',
  'whether it has been settled, how many contributions it has taken, and how',
  'many invoices exist in total. That is all the chain holds.',
  '',
  'Creating and paying happen in your browser, where your keys already are.',
  'A bot that could create an invoice for you would have to hold the terms of',
  'it — and every message it sent you would put those terms in a chat log.',
].join('\n');

const usage = (cmd: string, arg: string): Reply => ({
  text: `Usage: /${cmd} <${arg}>\n\nA ${arg} is 64 hex characters. Copy it from the app.`,
});

const notHex = (what: string): Reply => ({
  text: `That does not look like a ${what}. It should be 64 hex characters — no 0x prefix, nothing else.`,
});

const STATUS_LINE: Record<InvoiceView['status'], string> = {
  open: 'OPEN — accepting settlement',
  settled: 'SETTLED',
  cancelled: 'CANCELLED by the merchant',
  unknown: 'not on this contract',
};

function describeInvoice(commitment: string, v: InvoiceView): string {
  if (v.status === 'unknown') {
    return [
      `${commitment.slice(0, 16)}…`,
      '',
      'No invoice with that commitment exists on this contract.',
      'Either it was never created, or it belongs to a different deployment.',
    ].join('\n');
  }

  const lines = [
    `${commitment.slice(0, 16)}…`,
    '',
    STATUS_LINE[v.status],
    `kind          ${v.kind}`,
    `asset         ${v.token}`,
    `contributions ${v.contributions}`,
  ];

  if (v.expiresAt > 0n) {
    const when = new Date(Number(v.expiresAt) * 1000);
    lines.push(`expires       ${when.toISOString()}`);
  } else {
    lines.push('expires       never');
  }

  // Said out loud every time, because the absence is the product.
  lines.push('', 'No amount is shown because the chain does not hold one.');
  return lines.join('\n');
}

/**
 * Route one message to a reply.
 *
 * Unknown input gets a helpful answer rather than silence: a bare 64-hex string
 * is almost always someone pasting a commitment without the command, so it is
 * treated as one.
 */
export async function handle(text: string, chatId: number, ctx: BotContext): Promise<Reply> {
  const trimmed = text.trim();
  const [rawCmd = '', ...rest] = trimmed.split(/\s+/);
  const arg = rest.join(' ').trim();

  // Telegram appends @botname to commands in groups.
  const cmd = rawCmd.replace(/^\//, '').split('@')[0]!.toLowerCase();

  switch (cmd) {
    case 'start':
    case 'help':
      return { text: START, buttons: [{ text: 'Open Mask', url: ctx.appUrl }] };

    case 'privacy':
      return { text: PRIVACY, buttons: [{ text: 'Privacy, in full', url: `${ctx.appUrl}/privacy` }] };

    case 'invoice': {
      if (!arg) return usage('invoice', 'commitment');
      if (!HEX64.test(arg)) return notHex('commitment');
      const v = await ctx.chain.getInvoice(arg.toLowerCase());
      return {
        text: describeInvoice(arg.toLowerCase(), v),
        buttons: [{ text: 'Verify in the app', url: `${ctx.appUrl}/verify?q=${arg.toLowerCase()}` }],
      };
    }

    case 'receipt': {
      if (!arg) return usage('receipt', 'digest');
      if (!HEX64.test(arg)) return notHex('receipt digest');
      const exists = await ctx.chain.receiptExists(arg.toLowerCase());
      return {
        text: exists
          ? `${arg.slice(0, 16)}…\n\nOn the ledger. This payment happened.\n\nWho paid and what it was worth are not derivable from it. The transaction that published it also touched an invoice commitment, which is an opaque hash.`
          : `${arg.slice(0, 16)}…\n\nNot on the ledger. No payment with that receipt has settled on this contract.`,
      };
    }

    case 'attestation':
    case 'attest': {
      if (!arg) return usage('attestation', 'digest');
      if (!HEX64.test(arg)) return notHex('attestation digest');
      const exists = await ctx.chain.attestationExists(arg.toLowerCase());
      return {
        text: exists
          ? `${arg.slice(0, 16)}…\n\nPublished. A merchant proved a revenue claim, and the proof was checked by the chain.\n\nThe threshold they proved is part of the claim; their actual revenue is not, and never was.`
          : `${arg.slice(0, 16)}…\n\nNo such attestation on this contract.`,
      };
    }

    case 'watch': {
      if (!arg) return usage('watch', 'commitment');
      if (!HEX64.test(arg)) return notHex('commitment');
      const commitment = arg.toLowerCase();

      const already = await ctx.watched(chatId);
      if (already.includes(commitment)) {
        return { text: `Already watching ${commitment.slice(0, 16)}…` };
      }

      const v = await ctx.chain.getInvoice(commitment);
      if (v.status === 'unknown') {
        return {
          text: `No invoice with that commitment exists on this contract, so there is nothing to watch yet.\n\nIf it was just created, settlement of the create takes about 25 seconds — try again.`,
        };
      }
      if (v.status !== 'open') {
        return { text: `That invoice is already ${v.status}. Nothing left to wait for.` };
      }

      await ctx.watch(chatId, commitment);
      return {
        text: `Watching ${commitment.slice(0, 16)}…\n\nYou will get one message when it settles. The message will say that it settled and nothing about what it was worth.`,
      };
    }

    case 'unwatch': {
      if (!arg) return usage('unwatch', 'commitment');
      if (!HEX64.test(arg)) return notHex('commitment');
      const removed = await ctx.unwatch(chatId, arg.toLowerCase());
      return {
        text: removed
          ? `Stopped watching ${arg.slice(0, 16)}…`
          : `This chat was not watching that one.`,
      };
    }

    case 'watching': {
      const list = await ctx.watched(chatId);
      if (list.length === 0) return { text: 'Not watching anything. /watch <commitment> to start.' };
      return {
        text: [`Watching ${list.length}:`, '', ...list.map((c) => `  ${c.slice(0, 24)}…`)].join('\n'),
      };
    }

    case 'stats': {
      const created = await ctx.chain.totalCreated();
      return {
        text: [
          `${created} invoices created on this contract.`,
          '',
          'That is the only aggregate the ledger publishes. Not their value, not',
          'how many settled, not who issued them — a count, deliberately.',
        ].join('\n'),
        buttons: [{ text: 'Explorer', url: `${ctx.appUrl}/explorer` }],
      };
    }

    case 'create':
      return {
        text: [
          'Invoices are created in the browser, not here.',
          '',
          'The amount, the salt and your identity key never leave your machine —',
          'so the form has to run where they already are. The chain gets a',
          'commitment; this chat gets nothing.',
        ].join('\n'),
        buttons: [{ text: 'Create an invoice', url: `${ctx.appUrl}/create` }],
      };

    case 'pay': {
      if (!arg) {
        return {
          text: 'Send /pay followed by the payment link the merchant gave you, and I will open it.',
          buttons: [{ text: 'Open Mask', url: `${ctx.appUrl}/pay` }],
        };
      }
      // The link carries the invoice terms in its fragment. Note what that
      // means: pasting it here shows them to Telegram. Say so.
      const link = arg.startsWith('http') ? arg : `${ctx.appUrl}/pay#${arg.replace(/^#/, '')}`;
      return {
        text: [
          'Opening in the browser, where the proof is built on your own machine.',
          '',
          'One thing worth knowing: a payment link carries the invoice terms, so',
          'anything you paste into a chat has been seen by Telegram. Following the',
          'link directly avoids that.',
        ].join('\n'),
        buttons: [{ text: 'Pay in the browser', url: link }],
      };
    }

    default: {
      // A bare commitment, pasted without a command.
      if (HEX64.test(trimmed)) return handle(`/invoice ${trimmed}`, chatId, ctx);
      if (trimmed.startsWith('/')) {
        return { text: `I do not know /${cmd}. Try /start for the list.` };
      }
      return {
        text: 'Send a commitment, a receipt digest, or /start for what this bot can do.',
      };
    }
  }
}
