import { Link } from 'react-router-dom';
import { Badge, Card } from '../components/ui.tsx';
import { SNIPPETS } from '../content/dev.ts';

const SURFACES = [
  {
    name: 'Node SDK',
    pkg: '@mask/node',
    body: 'Create invoices, build payment links, verify webhooks and read settlement from the chain.',
  },
  {
    name: 'Python SDK',
    pkg: 'mask-midnight',
    body: 'The same links, terms and webhook verification for Flask, FastAPI and Django back ends.',
  },
  {
    name: 'CLI',
    pkg: '@mask/cli',
    body: 'Generate a merchant key, create an invoice, and check a status or a receipt from a terminal.',
  },
  {
    name: 'MCP server',
    pkg: '@mask/mcp',
    body: 'Lets an AI client create invoices and verify payments over stdio, with no amount ever attached to a request it did not make.',
  },
];

export function DeveloperPage() {
  return (
    <div className="space-y-6">
      <Card className="p-6 sm:p-8">
        <Badge tone="aurora">integrations</Badge>
        <h1 className="mt-3 font-display text-4xl tracking-tight sm:text-5xl">
          Build private checkout into <em className="text-aurora">your own product</em>.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-dim">
          Four ways in. All of them create invoices and verify payments, and none of them can see an
          amount they were not handed. Your server routes the customer and learns from the chain that
          a payment happened.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {SURFACES.map((s) => (
            <div key={s.name} className="rounded-2xl border border-line bg-surface-2 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">{s.name}</h2>
                <code className="font-mono text-[11px] text-aurora">{s.pkg}</code>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">{s.body}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6 sm:p-8">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-dim">The one rule</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-dim">
          Your server never sees an amount, and that is deliberate. Invoice terms travel from the
          merchant&apos;s browser to the payer&apos;s browser in a URL fragment, which browsers never
          transmit. Your backend cannot leak what it never held.
        </p>
      </Card>

      {SNIPPETS.map((s) => (
        <Card key={s.title} className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-6 py-3">
            <h3 className="text-sm font-medium">{s.title}</h3>
            <Badge>{s.lang}</Badge>
          </div>
          <pre className="overflow-x-auto px-6 py-5 font-mono text-xs leading-relaxed text-ink-dim">
            <code>{s.code}</code>
          </pre>
        </Card>
      ))}

      <p className="text-center text-xs text-ink-faint">
        Contract circuits, timings and the full reference are in the{' '}
        <Link to="/docs" className="text-aurora underline-offset-4 hover:underline">
          docs
        </Link>
        .
      </p>
    </div>
  );
}
