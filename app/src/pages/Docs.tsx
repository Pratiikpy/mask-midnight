import { Link } from 'react-router-dom';
import { Card, PageHeader } from '../components/ui.tsx';
import { CIRCUITS } from '../content/dev.ts';

export function DocsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Developer" accent="docs">
        Four ways in: a Node SDK, a Python SDK, a CLI and an MCP server. All of them create invoices and verify payments; none of them can see an amount they were not handed.
      </PageHeader>

      <Card className="p-6 sm:p-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">The one rule</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-dim">
          Your server never sees an amount, and that is deliberate. Invoice terms travel from the
          merchant&apos;s browser to the payer&apos;s browser in a URL fragment. Your backend routes
          the customer and learns from the chain that a payment happened. It cannot leak what it
          never held.
        </p>
      </Card>

      <Card className="p-6 sm:p-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">Integrations</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-dim">
          Code for the Node and Python SDKs, the CLI, the MCP server and webhooks is on the{' '}
          <Link to="/developer" className="text-aurora underline-offset-4 hover:underline">
            developer page
          </Link>
          .
        </p>
      </Card>

      <Card className="p-6 sm:p-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">
          Contract circuits
        </h2>
        <div className="mt-4 space-y-2">
          {CIRCUITS.map(([name, desc]) => (
            <div key={name} className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line/60 py-3">
              <code className="font-mono text-xs text-aurora">{name}</code>
              <span className="text-sm text-ink-dim">{desc}</span>
            </div>
          ))}
        </div>
        <p className="mt-5 text-xs leading-relaxed text-ink-faint">
          Timings measured on a local devnet. Proving is CPU-bound and runs on the payer&apos;s
          machine, so budget for it in your checkout flow rather than blocking a page on it.
        </p>
      </Card>
    </div>
  );
}
