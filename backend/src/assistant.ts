// The assistant, and the line it is not allowed to cross.
//
// A helper that answers questions about the product and about a merchant's own
// dashboard is useful, and it raises a problem.
//
// A model is a third party. Anything sent to it has left the machine. Here the
// amounts, salts and identity keys are the whole secret, and they live in the
// browser's own vault — so an assistant that "knows about your invoices" would
// be an assistant that ships your invoices to Google.
//
// The resolution is a whitelist, enforced on the way out:
//
//   * The browser decides what context to attach, and may only attach fields
//     from PUBLIC_CONTEXT_FIELDS — status, counts, kinds, digests. All of it is
//     already readable by anyone with the chain.
//   * Anything else is rejected before the request is built, not filtered out
//     of it. A silent filter would let a mistake ship quietly; a rejection
//     shows up the first time it is tried.
//   * The user's own typed message is theirs to write. It is not scanned, and
//     the UI says plainly that whatever they type is sent.
//
// The system prompt carries the product's real, measured numbers so the model
// answers from fact rather than from the shape of the question.

export class AssistantError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'AssistantError';
    this.status = status;
  }
}

/**
 * The only context the browser may attach.
 *
 * Every one of these is public: it is either on the ledger or derivable from
 * it. Adding a field here is a privacy decision, which is why the list is
 * short, explicit, and tested.
 */
export const PUBLIC_CONTEXT_FIELDS = [
  'contractAddress',
  'networkId',
  'invoiceCount',
  'openCount',
  'settledCount',
  'cancelledCount',
  'currentPage',
  'walletConnected',
] as const;

export type PublicContext = Partial<Record<(typeof PUBLIC_CONTEXT_FIELDS)[number], unknown>>;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are the assistant inside Mask, a private invoicing product built on Midnight.

Answer from these facts. Do not invent numbers, and say "I don't know" rather than guessing.

WHAT MASK IS
Merchants create invoices whose amount, salt, merchant identity and payer are never published. The
chain holds a commitment — a single hash over a joint pre-image with a domain separator. Paying
proves knowledge of the real terms without revealing them.

WHAT THE CHAIN HOLDS, PUBLICLY AND FOREVER
- an invoice commitment, its status (open/settled/cancelled), kind, settlement asset, expiry, and a
  count of contributions
- receipt digests, and a Merkle tree of them
- published revenue attestations
- a count of invoices ever created
Nothing else. No amount, no merchant, no payer, no title, no memo.

WHAT IT DOES NOT HOLD
Amounts, salts, merchant identity keys, payer identities, invoice titles and memos. These live in
the holder's own browser and travel merchant-to-payer in a payment link.

MEASURED PROOF TIMES ON THE LOCAL DEVNET
- create_invoice ~24-29s
- settle_invoice ~24-30s
- settle_invoice_shielded ~36-59s
- attest_revenue_at_least ~53s
- settle_batch, four invoices under one proof, ~60s versus ~100s paid one at a time
Proving runs on the user's own machine. A hosted prover would be faster but would see the amount.

HOW PAYING WORKS
"Send the money" moves a shielded coin worth exactly the amount due, and the contract refuses a coin
of the wrong value or the wrong asset. "Record the payment only" publishes a receipt without moving
a coin, for when money changed hands elsewhere.

REVENUE ATTESTATION
A merchant can prove total revenue over four payments was at least a threshold. The verifier learns
the threshold and that the claim holds — not the total, not any individual amount, not who paid.

WHAT YOU CANNOT SEE
You do not have access to any amount, salt or key, and you never will: the product deliberately does
not send them to you. If asked for one, explain that, and point the user at their own dashboard where
the data actually lives.

STYLE
Short and plain. No marketing language. If something is a limitation, say so.`;

export interface AssistantOptions {
  apiKey?: string;
  model?: string;
  /** Injectable so tests never reach the network. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface AssistantReply {
  text: string;
  model: string;
}

/**
 * Reject a context that carries anything not on the whitelist.
 *
 * Throws rather than filters, on purpose: a caller that attaches a secret has a
 * bug, and the bug should surface the first time it runs rather than being
 * quietly cleaned up on every request forever.
 */
export function assertPublicContext(context: unknown): PublicContext {
  if (context === undefined || context === null) return {};
  if (typeof context !== 'object' || Array.isArray(context)) {
    throw new AssistantError('context must be an object.');
  }

  const allowed = new Set<string>(PUBLIC_CONTEXT_FIELDS);
  const offending = Object.keys(context as Record<string, unknown>).filter((k) => !allowed.has(k));
  if (offending.length > 0) {
    throw new AssistantError(
      `context may only carry public fields. Refused: ${offending.join(', ')}. ` +
        `Allowed: ${PUBLIC_CONTEXT_FIELDS.join(', ')}.`,
    );
  }

  // A whitelisted key holding a nested object could smuggle anything.
  for (const [k, v] of Object.entries(context as Record<string, unknown>)) {
    const t = typeof v;
    if (v !== null && t !== 'string' && t !== 'number' && t !== 'boolean' && t !== 'bigint') {
      throw new AssistantError(`context.${k} must be a string, number or boolean.`);
    }
  }

  return context as PublicContext;
}

/** Validate the conversation itself: shape, size, and that it is not empty. */
export function assertMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AssistantError('messages must be a non-empty array.');
  }
  if (messages.length > 40) {
    throw new AssistantError('conversation too long; start a new one.');
  }

  return messages.map((m, i) => {
    const msg = m as Partial<ChatMessage>;
    if (msg.role !== 'user' && msg.role !== 'assistant') {
      throw new AssistantError(`messages[${i}].role must be "user" or "assistant".`);
    }
    if (typeof msg.content !== 'string' || msg.content.trim() === '') {
      throw new AssistantError(`messages[${i}].content must be a non-empty string.`);
    }
    if (msg.content.length > 4_000) {
      throw new AssistantError(`messages[${i}].content is too long (max 4000 characters).`);
    }
    return { role: msg.role, content: msg.content };
  });
}

const contextBlock = (context: PublicContext): string => {
  const entries = Object.entries(context).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return '';
  return (
    '\n\nPUBLIC CONTEXT FROM THE USER\'S SESSION (all of this is readable on chain by anyone):\n' +
    entries.map(([k, v]) => `- ${k}: ${String(v)}`).join('\n')
  );
};

export class Assistant {
  readonly #apiKey: string | undefined;
  readonly #model: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  /** Counts only. Never a prompt, never a reply. */
  readonly stats = { requests: 0, failures: 0 };

  constructor(opts: AssistantOptions = {}) {
    this.#apiKey = opts.apiKey ?? process.env.GOOGLE_API_KEY;
    this.#model = opts.model ?? process.env.GOOGLE_GEMINI_MODEL ?? 'gemini-2.5-flash';
    this.#fetch = opts.fetchImpl ?? fetch;
    this.#timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /** Whether the assistant can answer at all. The UI asks before offering it. */
  get configured(): boolean {
    return Boolean(this.#apiKey);
  }

  async chat(messages: ChatMessage[], context: PublicContext = {}): Promise<AssistantReply> {
    if (!this.#apiKey) {
      throw new AssistantError(
        'The assistant is not configured. Set GOOGLE_API_KEY on the backend to enable it.',
        503,
      );
    }

    this.stats.requests++;

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT + contextBlock(context) }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
    };

    let res: Response;
    try {
      res = await this.#fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.#model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.#apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.#timeoutMs),
        },
      );
    } catch (e) {
      this.stats.failures++;
      throw new AssistantError(
        `Could not reach the model: ${e instanceof Error ? e.message : String(e)}`,
        502,
      );
    }

    if (!res.ok) {
      this.stats.failures++;
      // The upstream body can contain the API key in an error echo, so it is
      // not passed through.
      throw new AssistantError(`The model returned ${res.status}.`, 502);
    }

    const payload = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();

    if (!text) {
      this.stats.failures++;
      throw new AssistantError('The model returned an empty answer.', 502);
    }

    return { text, model: this.#model };
  }
}
