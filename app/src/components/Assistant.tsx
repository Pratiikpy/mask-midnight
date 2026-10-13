// The assistant panel.
//
// A chat box in a privacy product needs to be honest about one thing above all:
// what leaves the machine. So this component is explicit about it, in the UI
// rather than only in a policy page —
//
//   * it attaches only public context (page, counts, whether a wallet is
//     connected), and the backend rejects the request outright if it ever
//     carries anything else;
//   * it says, above the input, that whatever the user types is sent to a model;
//   * it does not appear at all when the backend has no key, instead of
//     offering a box that answers every question with an error.
//
// Nothing here reads the invoice vault. That is deliberate and load-bearing:
// the vault holds amounts, salts and the merchant's identity key, and a helper
// that could read them would be a helper that could send them.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BACKEND_URL } from '../lib/config.ts';
import { Button, ErrorNote } from './ui.tsx';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantContext {
  currentPage?: string;
  invoiceCount?: number;
  openCount?: number;
  settledCount?: number;
  walletConnected?: boolean;
}

const SUGGESTIONS = [
  'What does the chain actually store about my invoice?',
  'Why does paying take thirty seconds?',
  'What is the difference between sending money and recording a payment?',
];

export function Assistant({ context }: { context: AssistantContext }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Ask once whether the backend can answer at all. An assistant that is not
  // configured should be absent, not broken.
  useEffect(() => {
    if (!BACKEND_URL) {
      setAvailable(false);
      return;
    }
    let cancelled = false;
    fetch(`${BACKEND_URL}/api/assistant`, { signal: AbortSignal.timeout(4_000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { configured?: boolean }) => {
        if (!cancelled) setAvailable(Boolean(d.configured));
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    const next: Message[] = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setDraft('');
    setBusy(true);
    setError(null);

    try {
      if (!BACKEND_URL) throw new Error('No assistant is configured for this deployment.');
      const res = await fetch(`${BACKEND_URL}/api/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only the conversation and the whitelisted context. The vault is not
        // in scope in this file, so there is nothing here to leak by accident.
        body: JSON.stringify({ messages: next, context }),
        signal: AbortSignal.timeout(35_000),
      });

      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `The assistant returned ${res.status}.`);
      setMessages([...next, { role: 'assistant', content: data.text ?? '' }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The assistant is unreachable.');
    } finally {
      setBusy(false);
    }
  }

  if (available !== true) return null;

  // Rendered into document.body rather than in place.
  //
  // `position: fixed` is relative to the nearest ancestor with a transform,
  // filter or backdrop-filter — not to the viewport — and the app shell has
  // one. In place, the panel was positioned against the centred content column
  // instead: 416px wide, anchored at x=261 rather than the right edge, and
  // running 400px below the fold. A portal takes it out of that chain.
  if (!open) {
    return createPortal(
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 rounded-full border border-line bg-surface-2 px-5 py-3 text-sm font-medium shadow-lg transition hover:border-aurora"
      >
        Ask about Mask
      </button>,
      document.body,
    );
  }

  // Not the shared Card: it hardcodes `relative`, which beat `fixed` in the
  // generated CSS and left the panel positioned as though it were in the flow —
  // and its backdrop-blur creates a containing block for fixed children, which
  // is what broke this before the portal. Same look, plain element, and a solid
  // background so text over the page stays readable.
  return createPortal(
    <div className="fixed bottom-6 right-6 z-40 flex max-h-[70vh] w-[min(26rem,calc(100vw-3rem))] flex-col rounded-2xl border border-line bg-surface shadow-2xl">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div>
          <p className="text-sm font-semibold">Ask about Mask</p>
          <p className="text-xs text-ink-faint">Answers about the product, not about your data</p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg px-2 py-1 text-ink-dim transition hover:text-ink"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-dim">
              It knows how Mask works — what the chain stores, why proving takes half a minute, what
              a receipt does and does not reveal.
            </p>
            <div className="space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-left text-xs text-ink-dim transition hover:border-aurora hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === 'user'
                  ? 'ml-8 rounded-2xl bg-surface-2 px-4 py-2 text-sm'
                  : 'mr-8 rounded-2xl border border-line px-4 py-2 text-sm whitespace-pre-wrap'
              }
            >
              {m.content}
            </div>
          ))
        )}
        {busy ? <p className="text-xs text-ink-faint">thinking…</p> : null}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line px-5 py-3">
        {/* Said every time, not buried in a policy page. */}
        <p className="mb-2 text-xs text-ink-faint">
          What you type is sent to a language model, along with which page you are on and how many
          invoices you have. Never your amounts, salts or keys — the server refuses those.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
          className="flex gap-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask a question"
            className="min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-aurora"
          />
          <Button type="submit" disabled={busy || !draft.trim()}>
            Send
          </Button>
        </form>
      </div>
    </div>,
    document.body,
  );
}
