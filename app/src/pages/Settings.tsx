import { useState } from 'react';
import { Button, Card, Field, Input, PrivacyNote, PageHeader } from '../components/ui.tsx';
import { useMask } from '../providers/MaskProvider.tsx';
import { loadInvoices, merchantKey, resetMerchantKey } from '../lib/invoice.ts';

export function SettingsPage() {
  const { connection } = useMask();
  const [key, setKey] = useState(() => merchantKey());
  const [importValue, setImportValue] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  function exportVault() {
    const blob = new Blob([JSON.stringify({ merchantKey: key, invoices: loadInvoices() }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mask-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice('Backup downloaded. Keep it somewhere safe — it is the only copy.');
  }

  function restoreKey() {
    const trimmed = importValue.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      setNotice('That is not a 64-character hex key.');
      return;
    }
    setKey(resetMerchantKey(trimmed));
    setImportValue('');
    setNotice('Identity key restored.');
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Your" accent="settings">
        Everything here lives on this device.
      </PageHeader>

      <Card className="p-6">
        <h2 className="font-medium">Merchant identity key</h2>
        <p className="mt-1 text-sm text-ink-dim">
          Every invoice you create is bound to this key. It is what proves an invoice is yours when
          you close, cancel or attest. Lose it and those invoices become unmanageable — the chain has
          no copy, because that is the point.
        </p>
        <div className="mt-4 break-all rounded-xl border border-line bg-surface-2 p-3 font-mono text-xs text-ink-dim">
          {key}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="ghost"
            className="text-xs"
            onClick={() => void navigator.clipboard?.writeText(key)}
          >
            Copy key
          </Button>
          <Button variant="ghost" className="text-xs" onClick={exportVault}>
            Download backup
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="font-medium">Restore an identity key</h2>
        <p className="mt-1 text-sm text-ink-dim">
          Replaces the key on this device. Invoices created with the old key stay in the list but can
          no longer be proven as yours.
        </p>
        <div className="mt-4 space-y-3">
          <Field label="Key">
            <Input
              value={importValue}
              onChange={(e) => setImportValue(e.target.value)}
              placeholder="64 hex characters"
              className="font-mono"
              spellCheck={false}
            />
          </Field>
          <Button variant="ghost" onClick={restoreKey} disabled={!importValue.trim()}>
            Restore
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="font-medium">Proving</h2>
        <p className="mt-1 text-sm text-ink-dim">
          Proofs are generated locally. Mask does not offer a hosted prover — one would see the
          amounts it exists to hide.
        </p>
        <div className="mt-4 space-y-2 font-mono text-xs text-ink-faint">
          <p>prover&nbsp;&nbsp;{connection.status === 'connected' ? connection.proverUri : 'not connected'}</p>
          <p>indexer&nbsp;{connection.status === 'connected' ? connection.indexerUri : 'not connected'}</p>
        </div>
      </Card>

      {notice ? (
        <Card className="p-5">
          <PrivacyNote>{notice}</PrivacyNote>
        </Card>
      ) : null}
    </div>
  );
}
