import { useMemo } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { MaskProvider, useMask } from './providers/MaskProvider.tsx';
import { Navbar, SITE_PATHS } from './components/Navbar.tsx';
import { CreateInvoicePage } from './pages/CreateInvoice.tsx';
import { PayPage } from './pages/Pay.tsx';
import { DashboardPage } from './pages/Dashboard.tsx';
import { VerifyPage } from './pages/Verify.tsx';
import { AttestPage } from './pages/Attest.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { ExplorerPage } from './pages/Explorer.tsx';
import { GiftCardsPage } from './pages/GiftCards.tsx';
import { CardsPage } from './pages/Cards.tsx';
import { CheckoutPage } from './pages/Checkout.tsx';
import { InvoicePage } from './pages/Invoice.tsx';
import { HomePage } from './pages/Home.tsx';
import { VisionPage } from './pages/Vision.tsx';
import { PrivacyPage } from './pages/Privacy.tsx';
import { DocsPage } from './pages/Docs.tsx';
import { SupportPage } from './pages/Support.tsx';
import { BatchPayPage } from './pages/BatchPay.tsx';
import { DeveloperPage } from './pages/Developer.tsx';
import { TelegramBotPage } from './pages/TelegramBot.tsx';
import { Assistant } from './components/Assistant.tsx';
import { loadInvoices } from './lib/invoice.ts';

/**
 * On a phone the account controls live behind the menu, so a first-time visitor
 * would land on a form they cannot use and no hint of how to try it. This puts
 * the two ways in at the top of the page, and goes away once either is chosen.
 */
function ConnectPrompt() {
  const { mode, connection, startDemo, connect, walletInstalled } = useMask();
  if (mode !== 'none' || connection.status === 'connected' || connection.status === 'connecting') {
    return null;
  }
  return (
    <div className="mb-6 rounded-2xl border border-line-bright bg-surface/80 p-4 md:hidden">
      <p className="text-sm text-ink-dim">
        Connect a Midnight wallet to publish and pay, or try the real contract here with no wallet.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={startDemo}
          className="flex-1 rounded-full border border-aurora/40 py-2.5 text-xs font-semibold text-aurora"
        >
          Try the demo
        </button>
        {walletInstalled ? (
          <button
            onClick={() => void connect()}
            className="flex-1 rounded-full bg-nova py-2.5 text-xs font-semibold text-ground"
          >
            Connect wallet
          </button>
        ) : (
          <a
            href="https://docs.midnight.network"
            target="_blank"
            rel="noreferrer"
            className="flex-1 rounded-full border border-line-bright py-2.5 text-center text-xs text-ink-dim"
          >
            Install Lace
          </a>
        )}
      </div>
    </div>
  );
}

function DemoBanner() {
  const { mode } = useMask();
  if (mode !== 'demo') return null;
  return (
    <div
      role="status"
      className="mb-6 rounded-2xl border border-nova/30 bg-nova/5 px-5 py-4 text-sm text-ink-dim"
    >
      <strong className="text-nova">Demo mode.</strong> The real contract runs in this browser
      against a simulated ledger, so every refusal is the contract&apos;s own. No proof is generated
      and nothing reaches a chain. Reloading the page starts a fresh ledger.
    </div>
  );
}

const FOOTER_LINKS = [
  { to: '/batch', label: 'Batch pay' },
  { to: '/attest', label: 'Prove revenue' },
  { to: '/verify', label: 'Verify a payment' },
  { to: '/support', label: 'Support' },
  { to: '/settings', label: 'Settings' },
];

function Shell() {
  const { connection } = useMask();
  const { pathname } = useLocation();
  const onSite = SITE_PATHS.includes(pathname);

  // Counts, and only counts. The vault holds amounts, salts and the merchant's
  // identity key; none of them are read here, so none of them can be attached
  // to a request by accident. The backend rejects anything beyond this set
  // anyway, but the safer arrangement is not to have it in hand.
  const assistantContext = useMemo(() => {
    const invoices = loadInvoices();
    return {
      currentPage: pathname,
      invoiceCount: invoices.length,
      openCount: invoices.filter((i) => i.status === 'open' || i.status === 'pending').length,
      settledCount: invoices.filter((i) => i.status === 'settled').length,
      walletConnected: connection.status === 'connected',
    };
  }, [pathname, connection.status]);

  return (
    <div className="relative flex min-h-dvh flex-col">
      <Navbar />

      {connection.status === 'error' ? (
        <div className="mx-auto mb-6 w-full max-w-5xl px-5">
          <div className="rounded-2xl border border-danger/30 bg-danger/5 px-5 py-4 text-sm text-danger">
            {connection.message}
          </div>
        </div>
      ) : null}

      <main className={pathname === '/' ? 'flex-1' : 'mx-auto w-full max-w-5xl flex-1 px-5 pb-16 pt-4'}>
        {onSite ? null : <ConnectPrompt />}
        {onSite ? null : <DemoBanner />}
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/create" element={<CreateInvoicePage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/pay" element={<PayPage />} />
          <Route path="/batch" element={<BatchPayPage />} />
          <Route path="/giftcards" element={<GiftCardsPage />} />
          <Route path="/cards" element={<CardsPage />} />
          <Route path="/attest" element={<AttestPage />} />
          <Route path="/explorer" element={<ExplorerPage />} />
          <Route path="/verify" element={<VerifyPage />} />
          <Route path="/developer" element={<DeveloperPage />} />
          <Route path="/telegram-bot" element={<TelegramBotPage />} />
          <Route path="/checkout/:id" element={<CheckoutPage />} />
          <Route path="/invoice/:hash" element={<InvoicePage />} />
          <Route path="/vision" element={<VisionPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route
            path="*"
            element={<p className="text-sm text-ink-dim">That page does not exist.</p>}
          />
        </Routes>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-xs text-ink-faint md:px-10">
          <p>Amounts, merchant and payer identities never reach the chain. Only commitments do.</p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            {FOOTER_LINKS.map((l) => (
              <Link key={l.to} to={l.to} className="transition hover:text-ink">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>

      <Assistant context={assistantContext} />
    </div>
  );
}

export default function App() {
  return (
    <MaskProvider>
      <Shell />
    </MaskProvider>
  );
}
