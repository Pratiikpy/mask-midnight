// The landing page.
//
// Ten sections in a fixed order: the promise, the explainer, the problem, what
// Mask is, the AI-assistant integration, the phone, the three steps, the chain,
// the comparison and the close. Every claim on it is one the product can back,
// which is why there are no app-store badges and no "100% private": the page
// says what is hidden, what is not, and where the edges are.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Coins,
  EyeOff,
  FileLock2,
  Layers,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Stamp,
  WalletCards,
} from 'lucide-react';
import { useMask } from '../providers/MaskProvider.tsx';

/** Fade a block in the first time it scrolls into view. */
function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ animationDelay: `${delay}ms` }}
      className={`${shown ? 'mask-rise' : 'opacity-0'} ${className}`}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-aurora/30 bg-aurora/5 px-3.5 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-aurora">
      <span className="h-1.5 w-1.5 rounded-full bg-aurora" />
      {children}
    </span>
  );
}

function SectionTitle({ eyebrow, children, sub }: { eyebrow: string; children: ReactNode; sub?: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="font-display mt-6 text-4xl leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
        {children}
      </h2>
      {sub ? <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-ink-dim">{sub}</p> : null}
    </div>
  );
}

/** The night sky behind the hero: a moon, two orbit rings, and three live markers. */
function Moon() {
  return (
    <svg
      viewBox="0 0 520 520"
      aria-hidden="true"
      className="mask-float pointer-events-none absolute -right-24 top-4 h-[520px] w-[520px] opacity-90 md:right-[-4rem] lg:right-[2%]"
    >
      <defs>
        <radialGradient id="moon-body" cx="38%" cy="34%" r="75%">
          <stop offset="0%" stopColor="#dfe4ff" />
          <stop offset="55%" stopColor="#8f9bd8" />
          <stop offset="100%" stopColor="#2b3577" />
        </radialGradient>
        <radialGradient id="moon-halo" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="#9a89ff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#9a89ff" stopOpacity="0" />
        </radialGradient>
        <mask id="moon-bite">
          <rect width="520" height="520" fill="white" />
          <circle cx="330" cy="215" r="150" fill="black" />
        </mask>
      </defs>
      <circle cx="260" cy="260" r="250" fill="url(#moon-halo)" />
      <circle cx="260" cy="260" r="205" fill="none" stroke="#2b3577" strokeWidth="1" strokeDasharray="2 7" />
      <circle cx="260" cy="260" r="245" fill="none" stroke="#1b2250" strokeWidth="1" />
      <circle cx="260" cy="260" r="130" fill="url(#moon-body)" mask="url(#moon-bite)" />
      {[
        [455, 200],
        [90, 140],
        [190, 470],
      ].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="14" fill="none" stroke="#6ee7f9" strokeOpacity="0.35" />
          <circle cx={x} cy={y} r="4" fill="#6ee7f9" className="mask-pulse" />
        </g>
      ))}
    </svg>
  );
}

const QUESTIONS = [
  'Can a recipient see my wallet balance after I pay them?',
  'Is there a way to hide my balance when sending crypto?',
  'Can someone find my personal information from my wallet address?',
  'If someone links my identity to a wallet, can they track every transaction?',
  'How do I pay a vendor without showing them my total holdings?',
  'What can anyone see on the public ledger about an invoice I paid?',
  'Is it safe to share my address with a client?',
  'Can a competitor read my revenue from the chain?',
  'How do exchanges keep wallet balances out of public view?',
  'Does paying one invoice reveal my other payments?',
];

const FEATURES = [
  {
    icon: FileLock2,
    title: 'Zero-knowledge invoices',
    body: 'The chain stores one 32-byte commitment binding the merchant key, the amount, the terms and a random salt. Nothing in it can be recovered: not by us, not by a node operator, not by anyone reading the chain in ten years.',
    wide: true,
  },
  {
    icon: EyeOff,
    title: 'Shielded settlement',
    body: 'Value moves as a shielded coin, so sender, recipient and amount are hidden by the protocol, verified against a running chain rather than assumed.',
  },
  {
    icon: Stamp,
    title: 'Receipts and nullifiers',
    body: 'Every payment publishes a receipt digest and a one-time nullifier. The receipt proves it happened; the nullifier makes replaying it impossible.',
  },
  {
    icon: Coins,
    title: 'Multi-asset',
    body: 'Settle in tNIGHT or the mUSDC and mUSAD reference assets, and pay in a different asset with a rate the oracle signs and the contract verifies.',
  },
  {
    icon: Layers,
    title: 'Flexible invoice types',
    body: 'Standard invoices close on the first payment. Multi-pay and donation invoices keep collecting until the owner closes them. Refunds return the same coin.',
  },
  {
    icon: WalletCards,
    title: 'Metadata stays with you',
    body: 'Titles, notes and your totals live on your device. They are never sent to a server, and the dashboard computes your revenue where only you can see it.',
    wide: true,
  },
  {
    icon: ShieldCheck,
    title: 'Prove it without showing it',
    body: 'Show a bank that revenue passed a threshold without revealing a single invoice, amount or client.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Create an invoice',
    body: 'Set an amount, an asset and an expiry. Your machine hashes the terms into a commitment and publishes only that.',
  },
  {
    n: '02',
    title: 'Share and verify',
    body: 'Send the payment link. The terms travel in the URL fragment, which no server ever receives, and the payer’s client checks the commitment on chain before they pay.',
  },
  {
    n: '03',
    title: 'Pay in zero knowledge',
    body: 'The payer proves they know the real terms and a shielded coin moves in the same transaction. A wrong amount fails on their own machine, in under a second.',
  },
];

const CHAIN_POINTS = [
  { title: 'Proofs run on your machine', body: 'A hosted prover would see the amounts it exists to hide, so proving happens locally.' },
  { title: 'Private state stays private', body: 'Amounts, salts and keys are witnesses. The compiler refuses to let one reach the public ledger without an explicit disclosure.' },
  { title: 'Selective disclosure', body: 'Prove to a bank that revenue passed a threshold without showing a single invoice.' },
];

const COMPARE: [string, string, string][] = [
  ['Invoice amount', 'Public on most chains', 'Hidden'],
  ['Who paid whom', 'Public', 'Hidden'],
  ['That a payment happened', 'Public', 'Provable'],
  ['Revenue totals', 'Derivable by anyone', 'Provable without revealing'],
  ['Double-spend protection', 'Enforced on chain', 'Enforced on chain'],
];

export function HomePage() {
  const navigate = useNavigate();
  const { startDemo } = useMask();

  function tryDemo() {
    startDemo();
    navigate('/create');
  }

  return (
    <div className="overflow-x-clip">
      {/* 1. The promise */}
      <section className="relative mx-auto flex min-h-[78vh] max-w-7xl items-center px-5 pb-16 pt-10 md:px-10">
        <Moon />
        <div className="relative z-10 max-w-3xl">
          <Eyebrow>Private by design · masked by default</Eyebrow>
          <h1 className="font-display mt-7 text-[3.4rem] leading-[0.95] tracking-tight sm:text-7xl lg:text-[6.2rem]">
            Your money is <em className="text-aurora">nobody else&rsquo;s</em> business.
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-relaxed text-ink-dim">
            Private invoices. Shielded escrow. Public proof, masked amounts. Built with
            zero-knowledge cryptography on Midnight.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              to="/create"
              className="inline-flex items-center gap-2 rounded-full bg-nova px-7 py-3.5 text-sm font-semibold text-ground transition hover:brightness-110"
            >
              Create an invoice <ArrowRight className="h-4 w-4" />
            </Link>
            <button
              onClick={tryDemo}
              className="inline-flex items-center gap-2 rounded-full border border-line-bright bg-surface/60 px-7 py-3.5 text-sm font-semibold text-ink backdrop-blur transition hover:border-aurora hover:text-aurora"
            >
              <Sparkles className="h-4 w-4" /> Try the demo
            </button>
          </div>
          <p className="mt-4 text-sm text-ink-faint">
            No wallet needed to try it. The real contract runs in your browser.
          </p>
          <div className="mt-12 flex flex-wrap gap-2.5">
            {['Zero-knowledge native', 'Shielded settlement', 'Selective disclosure', 'Non-custodial'].map((c) => (
              <span
                key={c}
                className="rounded-full border border-line px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* 2. The explainer: what you see against what the chain sees */}
      <section className="mx-auto max-w-6xl px-5 py-16 md:px-10">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] border border-line-bright bg-surface/70 p-8 backdrop-blur md:p-14">
            <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-nova/20 blur-[90px]" />
            <h2 className="font-display relative max-w-2xl text-4xl leading-[1.05] sm:text-5xl md:text-6xl">
              Private payments that actually <em className="text-aurora">explain</em> what Mask does.
            </h2>
            <p className="relative mt-4 max-w-xl text-base text-ink-dim">
              Private checkout links, hidden payment trails and verifiable settlement on Midnight.
            </p>
            <div className="relative mt-10 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-line bg-ground/60 p-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-aurora">What you see</p>
                <p className="mt-4 text-sm text-ink-dim">Design retainer, March</p>
                <p className="font-display mt-1 text-5xl">42,500</p>
                <p className="mt-1 text-sm text-ink-faint">tNIGHT, due in 7 days</p>
              </div>
              <div className="rounded-2xl border border-line bg-ground/60 p-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-nova">What the chain sees</p>
                <p className="mt-4 break-all font-mono text-sm leading-relaxed text-ink-dim">
                  4e7a733de54513ea<br />567418afbfb2ae47<br />250a47f482764317<br />3ac9a88f1a61e263
                </p>
                <p className="mt-3 text-sm text-ink-faint">A commitment. Not the amount, not the merchant, not the memo.</p>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* 3. The problem */}
      <section className="mx-auto max-w-7xl px-5 py-20 md:px-10">
        <Reveal>
          <SectionTitle
            eyebrow="The problem"
            sub="Every transaction on a public ledger broadcasts a wallet's balance, history and habits to the entire world."
          >
            Public ledgers <em className="text-nova">expose</em> you
          </SectionTitle>
        </Reveal>
        <div className="mt-12 space-y-4 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
          {[QUESTIONS.slice(0, 5), QUESTIONS.slice(5)].map((row, r) => (
            <div key={r} className="flex gap-4 overflow-hidden">
              {[0, 1].map((k) => (
                <div
                  key={k}
                  aria-hidden={k === 1}
                  className="flex shrink-0 animate-[marquee_60s_linear_infinite] gap-4"
                  style={{ animationDirection: r === 1 ? 'reverse' : 'normal' }}
                >
                  {row.map((q) => (
                    <div key={q} className="w-72 shrink-0 rounded-2xl border border-line bg-surface/70 p-5">
                      <p className="text-sm leading-relaxed text-ink-dim">{q}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-ink-faint">
          Questions people ask, written out. The answer on most chains is yes.
        </p>
      </section>

      {/* 4. What is Mask */}
      <section className="mx-auto max-w-7xl px-5 py-20 md:px-10">
        <Reveal>
          <SectionTitle
            eyebrow="What is Mask"
            sub="A private invoice and payment protocol. Create invoices, collect payments and settle, without exposing who paid whom or how much."
          >
            Everything a checkout needs, <em className="text-aurora">nothing it shouldn&rsquo;t</em>
          </SectionTitle>
        </Reveal>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 60} className={f.wide ? 'md:col-span-2' : ''}>
              <div className="group h-full rounded-3xl border border-line bg-surface/70 p-7 transition hover:border-nova/50">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line-bright bg-surface-2 text-aurora transition group-hover:text-nova">
                  <f.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-lg font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-dim">{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 5. AI assistants */}
      <section className="mx-auto max-w-6xl px-5 py-20 md:px-10">
        <Reveal>
          <div className="grid items-center gap-10 rounded-[2rem] border border-line bg-surface/70 p-8 md:grid-cols-2 md:p-12">
            <div>
              <Eyebrow>Integrations</Eyebrow>
              <h2 className="font-display mt-6 text-4xl leading-[1.05] sm:text-5xl">
                Works with your <em className="text-aurora">AI assistant</em>.
              </h2>
              <p className="mt-5 text-base leading-relaxed text-ink-dim">
                Mask&rsquo;s MCP server lets an AI agent create invoices and verify payments, with the
                same privacy the app has. It speaks stdio, so it works with any client that supports an
                MCP package.
              </p>
              <Link
                to="/developer"
                className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-aurora hover:underline"
              >
                SDK, CLI and MCP <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="rounded-2xl border border-line bg-ground/70 p-5 font-mono text-xs leading-relaxed text-ink-dim">
              <p className="flex items-center gap-2 text-aurora">
                <Bot className="h-4 w-4" /> mask-mcp
              </p>
              <p className="mt-3">
                <span className="text-nova">you</span>&nbsp; Invoice Aster Studio for 12,000 mUSDC, due Friday.
              </p>
              <p className="mt-2">
                <span className="text-aurora">mask</span>&nbsp; Created. Payment link ready. Only the
                commitment is on chain.
              </p>
              <p className="mt-2">
                <span className="text-nova">you</span>&nbsp; Has it been paid?
              </p>
              <p className="mt-2">
                <span className="text-aurora">mask</span>&nbsp; Settled. The ledger holds a receipt, not an amount.
              </p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* 6. In your pocket */}
      <section className="mx-auto max-w-6xl px-5 py-20 md:px-10">
        <Reveal>
          <SectionTitle
            eyebrow="On any screen"
            sub="Mask runs in a mobile browser. Show a QR code, scan it, and pay privately."
          >
            Privacy in your <em className="text-nova">pocket</em>
          </SectionTitle>
        </Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <Reveal>
            <div className="h-full rounded-3xl border border-line bg-surface/70 p-7">
              <ScanLine className="h-6 w-6 text-aurora" />
              <h3 className="mt-4 text-lg font-semibold">Private QR checkout</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">
                The QR code carries the invoice terms, so the person who scans it can pay and nobody
                else learns them. Treat it like cash: anyone who photographs it can read what it is for.
              </p>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="h-full rounded-3xl border border-line bg-surface/70 p-7">
              <ShieldCheck className="h-6 w-6 text-nova" />
              <h3 className="mt-4 text-lg font-semibold">Your keys, your device</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">
                The proof is built where the secrets are. Nothing about an amount or an identity key is
                sent to a server to be proven for you.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 7. Three steps */}
      <section className="mx-auto max-w-7xl px-5 py-20 md:px-10">
        <Reveal>
          <SectionTitle
            eyebrow="How it works"
            sub="From invoice creation to private settlement, the whole flow is designed around zero knowledge."
          >
            Three steps to <em className="text-aurora">privacy</em>
          </SectionTitle>
        </Reveal>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 90}>
              <div className="relative h-full overflow-hidden rounded-3xl border border-line bg-surface/70 p-8">
                <span className="font-display absolute -right-2 -top-6 text-[8rem] leading-none text-line-bright/40">
                  {s.n}
                </span>
                <h3 className="relative mt-16 text-xl font-semibold tracking-tight">{s.title}</h3>
                <p className="relative mt-3 text-sm leading-relaxed text-ink-dim">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 8. The chain */}
      <section className="mx-auto max-w-6xl px-5 py-20 md:px-10">
        <Reveal>
          <SectionTitle
            eyebrow="Powered by Midnight"
            sub="Midnight is a blockchain built to protect user and business data, combining public verifiability with programmable privacy and selective disclosure."
          >
            A chain where privacy is the <em className="text-nova">default</em>
          </SectionTitle>
        </Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {CHAIN_POINTS.map((c, i) => (
            <Reveal key={c.title} delay={i * 80}>
              <div className="h-full rounded-3xl border border-line bg-surface/70 p-7">
                <h3 className="text-base font-semibold">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-dim">{c.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 9. Comparison */}
      <section className="mx-auto max-w-4xl px-5 py-20 md:px-10">
        <Reveal>
          <SectionTitle
            eyebrow="The difference"
            sub="Exactly what is public, so nothing has to be taken on faith."
          >
            Privacy is <em className="text-aurora">not optional</em>
          </SectionTitle>
        </Reveal>
        <Reveal delay={80}>
          <div className="mt-12 overflow-hidden rounded-3xl border border-line bg-surface/70">
            <div className="grid grid-cols-[1.2fr_1fr_1fr] border-b border-line px-6 py-4 font-mono text-[10px] uppercase tracking-[0.18em]">
              <span />
              <span className="text-ink-faint">Public chains</span>
              <span className="text-aurora">Mask protocol</span>
            </div>
            {COMPARE.map(([what, pub, mask]) => (
              <div
                key={what}
                className="grid grid-cols-[1.2fr_1fr_1fr] items-center border-b border-line/60 px-6 py-4 text-sm last:border-0"
              >
                <span className="text-ink-dim">{what}</span>
                <span className="text-ink-faint">{pub}</span>
                <span className="font-medium text-aurora">{mask}</span>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={120}>
          <div className="mt-6 rounded-3xl border border-line bg-surface/70 p-7">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-ink-dim">Honest about the edges</h3>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink-dim">
              <p>
                <strong className="text-ink">Payments take about half a minute.</strong> Proving runs on
                your own machine on purpose. A hosted prover would see the amounts it exists to hide.
              </p>
              <p>
                <strong className="text-ink">Timing correlates on a quiet chain.</strong> An invoice created
                and settled minutes apart, with little else happening, links the two. Volume fixes that;
                cryptography does not.
              </p>
              <p>
                <strong className="text-ink">A receipt can be paired with its invoice.</strong> The
                settling transaction touches both. The invoice is an opaque hash, so no amount, payer or
                merchant is revealed by the pairing.
              </p>
              <p>
                <strong className="text-ink">Gift cards are cash.</strong> Whoever holds one can spend it,
                and a lost one cannot be cancelled.
              </p>
            </div>
            <Link
              to="/privacy"
              className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-aurora hover:underline"
            >
              The full list of what is public <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Reveal>
      </section>

      {/* 10. The close */}
      <section className="mx-auto max-w-5xl px-5 pb-28 pt-16 text-center md:px-10">
        <Reveal>
          <h2 className="font-display text-5xl leading-[1.02] tracking-tight sm:text-6xl md:text-7xl">
            Engineering <em className="text-aurora">financial</em> freedom.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-ink-dim">
            Join the network where privacy is not a feature but a fundamental right. Secure your
            transactions with zero-knowledge technology.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link
              to="/explorer"
              className="inline-flex items-center gap-2 rounded-full bg-nova px-8 py-4 text-sm font-semibold text-ground transition hover:brightness-110"
            >
              Launch app <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/docs"
              className="inline-flex items-center gap-2 rounded-full border border-line-bright px-8 py-4 text-sm font-semibold text-ink transition hover:border-aurora hover:text-aurora"
            >
              Read the docs
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
