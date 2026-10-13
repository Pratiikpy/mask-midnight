import { Link } from 'react-router-dom';
import { ArrowRight, Eye, Scale, ShieldOff, Split, TriangleAlert, Moon } from 'lucide-react';
import { Card, PageHeader } from '../components/ui.tsx';

const SECTIONS = [
  {
    icon: Scale,
    h: 'The problem is not secrecy. It is asymmetry.',
    p: 'Every business already keeps its revenue private. What a transparent ledger does is invert that by default: suppliers, competitors and anyone curious can read what you earn, what you pay and when. Nobody chose that trade. It arrived with the technology.',
  },
  {
    icon: Split,
    h: 'Privacy and proof are not opposites',
    p: 'The usual framing says you can be auditable or private and must pick one. That is a limitation of the tools, not a law. A proof can establish that a payment happened, that terms were honoured, that revenue passed a threshold, while the underlying numbers stay yours.',
  },
  {
    icon: Moon,
    h: 'What Midnight changes',
    p: 'A ledger with two halves: public where verification needs it, private where it does not. Mask puts a commitment on the public half and keeps everything meaningful on the private one. The result is a payment anyone can verify and nobody can read.',
  },
  {
    icon: ShieldOff,
    h: 'Where we refuse to compromise',
    p: 'We do not run a prover, because a prover sees the values it proves about. We do not accept amounts on our servers, because a server that holds data can be compelled to produce it. Where a feature would require either, we drop the feature instead. That is how gift cards ended up as cash rather than as accounts we could freeze.',
  },
  {
    icon: TriangleAlert,
    h: 'What we will not claim',
    p: 'Timing still correlates on a quiet chain. A receipt can be paired with the invoice it settled. Anyone you hand a payment link to learns the amount. Gift cards cannot be cancelled. These are stated in the product rather than buried, because a privacy tool that overstates itself is worse than one that does not exist: people rely on it.',
  },
  {
    icon: Eye,
    h: 'Where it goes next',
    p: 'Settlement that does not pair a receipt with its invoice, and revenue attestations that only the merchant can publish. Both are named, open items in the threat model, and each will ship with the test that proves it.',
  },
];

export function VisionPage() {
  return (
    <div>
      <PageHeader title="The future of" accent="private payments">
        Your money is nobody else&rsquo;s business. Mask brings zero-knowledge cryptography to digital
        commerce and settlement, and says plainly where it stops.
      </PageHeader>

      <div className="grid gap-5 md:grid-cols-2">
        {SECTIONS.map((s) => (
          <Card key={s.h} className="group p-7 transition hover:border-nova/50">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line-bright bg-surface-2 text-aurora transition group-hover:text-nova">
              <s.icon className="h-5 w-5" />
            </span>
            <h2 className="mt-5 text-xl font-semibold tracking-tight">{s.h}</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-dim">{s.p}</p>
          </Card>
        ))}
      </div>

      <div className="mt-16 text-center">
        <Link
          to="/privacy"
          className="inline-flex items-center gap-3 rounded-full border border-nova/40 bg-surface/70 px-8 py-3 font-mono text-xs uppercase tracking-[0.2em] text-ink-dim backdrop-blur transition hover:border-nova hover:text-ink"
        >
          Building the private economy on Midnight <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
