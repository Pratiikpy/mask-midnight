// The site and app navigation.
//
// One bar, two modes. On the marketing pages it carries the four site links and
// a "Launch app" button; inside the app it carries the working links, two
// grouped menus, and the wallet control. The grouping is deliberate: the app has
// more destinations than a single row can hold without crowding.

import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ArrowRight, ChevronDown, Menu, X } from 'lucide-react';
import { useMask } from '../providers/MaskProvider.tsx';
import { shortHex } from '../lib/format.ts';

interface NavLeaf {
  to: string;
  label: string;
}
interface NavGroup {
  label: string;
  items: NavLeaf[];
}
type NavItem = NavLeaf | NavGroup;

const isGroup = (i: NavItem): i is NavGroup => 'items' in i;

const SITE_NAV: NavLeaf[] = [
  { to: '/', label: 'Home' },
  { to: '/vision', label: 'Vision' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/docs', label: 'Docs' },
];

const APP_NAV: NavItem[] = [
  { to: '/explorer', label: 'Explorer' },
  { to: '/create', label: 'Create Invoice' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/pay', label: 'Pay' },
  {
    label: 'Cards',
    items: [
      { to: '/cards', label: 'Mask Card' },
      { to: '/giftcards', label: 'Gift Cards' },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { to: '/developer', label: 'SDK / Developers' },
      { to: '/telegram-bot', label: 'Telegram Bot' },
    ],
  },
];

/** Pages that belong to the marketing site rather than the working app. */
export const SITE_PATHS = ['/', '/vision', '/privacy', '/docs'];

const linkClass = (active: boolean) =>
  `rounded-full px-4 py-2 text-sm font-medium transition ${
    active ? 'bg-surface-2 text-ink shadow-[inset_0_0_0_1px_var(--color-line-bright)]' : 'text-ink-dim hover:text-ink'
  }`;

function Dropdown({ group }: { group: NavGroup }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const active = group.items.some((i) => pathname.startsWith(i.to));

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className={`${linkClass(active)} inline-flex items-center gap-1.5`}
      >
        {group.label}
        <ChevronDown className={`h-3.5 w-3.5 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-1/2 top-full z-30 w-48 -translate-x-1/2 pt-2"
        >
          <div className="rounded-2xl border border-line-bright bg-surface p-1.5 shadow-2xl shadow-black/60">
            {group.items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                role="menuitem"
                className={({ isActive }) =>
                  `block rounded-xl px-3.5 py-2.5 text-sm transition ${
                    isActive ? 'bg-surface-2 text-ink' : 'text-ink-dim hover:bg-surface-2 hover:text-ink'
                  }`
                }
              >
                {i.label}
              </NavLink>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AccountControl() {
  const { connection, connect, disconnect, walletInstalled, mode, startDemo } = useMask();

  if (mode === 'demo') {
    return (
      <button
        onClick={disconnect}
        title="Leave demo mode"
        className="rounded-full border border-nova/50 px-4 py-2 text-xs font-semibold text-nova transition hover:border-nova"
      >
        Demo · exit
      </button>
    );
  }

  if (connection.status === 'connected') {
    return (
      <button
        onClick={disconnect}
        title={connection.coinPublicKey}
        className="rounded-full border border-aurora/40 px-4 py-2 font-mono text-xs text-aurora transition hover:border-aurora"
      >
        {shortHex(connection.coinPublicKey, 6, 4)}
      </button>
    );
  }

  if (connection.status === 'connecting') {
    return (
      <span className="mask-pulse rounded-full border border-line px-4 py-2 text-xs text-ink-dim">
        Connecting…
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={startDemo}
        className="rounded-full border border-aurora/40 whitespace-nowrap px-4 py-2 text-xs font-semibold text-aurora transition hover:border-aurora"
      >
        Try the demo
      </button>
      {walletInstalled ? (
        <button
          onClick={() => void connect()}
          className="whitespace-nowrap rounded-full bg-nova px-4 py-2 text-xs font-semibold text-ground transition hover:brightness-110"
        >
          Connect wallet
        </button>
      ) : (
        <a
          href="https://docs.midnight.network"
          target="_blank"
          rel="noreferrer"
          className="whitespace-nowrap rounded-full border border-line-bright px-4 py-2 text-xs text-ink-dim transition hover:border-nova hover:text-nova"
        >
          Install Lace
        </a>
      )}
    </div>
  );
}

export function Navbar() {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const onSite = SITE_PATHS.includes(pathname);

  useEffect(() => setMenuOpen(false), [pathname]);

  const items: NavItem[] = onSite ? SITE_NAV : APP_NAV;

  return (
    <header className="relative z-20 mx-auto flex w-full max-w-7xl items-center gap-4 px-5 py-5 md:px-10">
      <Link to="/" className="mr-auto flex items-center gap-3 no-underline md:mr-0 md:flex-1">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink">
          <span className="h-3.5 w-3.5 rotate-45 rounded-[3px] border-[2.5px] border-ground" />
        </span>
        <span>
          <span className="block text-base font-bold lowercase leading-none tracking-tight">mask.</span>
          <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">
            private by design
          </span>
        </span>
      </Link>

      <nav
        aria-label="Main"
        className="hidden flex-none items-center justify-center md:flex"
      >
        <div className="flex items-center gap-1 rounded-full border border-line-bright bg-surface/70 p-1 backdrop-blur">
          {items.map((i) =>
            isGroup(i) ? (
              <Dropdown key={i.label} group={i} />
            ) : (
              <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => linkClass(isActive)}>
                {i.label}
              </NavLink>
            ),
          )}
        </div>
      </nav>

      <div className="hidden items-center justify-end md:flex md:flex-1">
        {onSite ? (
          <Link
            to="/explorer"
            className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-xs font-semibold text-ground transition hover:bg-white"
          >
            Launch app <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <AccountControl />
        )}
      </div>

      <button
        type="button"
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line-bright md:hidden"
      >
        {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {menuOpen ? (
        <nav
          aria-label="Mobile"
          className="absolute inset-x-5 top-full z-30 rounded-3xl border border-line-bright bg-surface p-3 shadow-2xl shadow-black/60 md:hidden"
        >
          {items.flatMap((i) => (isGroup(i) ? i.items : [i])).map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.to === '/'}
              className={({ isActive }) =>
                `block rounded-2xl px-4 py-3 text-sm ${isActive ? 'bg-surface-2 text-ink' : 'text-ink-dim'}`
              }
            >
              {i.label}
            </NavLink>
          ))}
          <div className="mt-2 border-t border-line p-2">
            {onSite ? (
              <Link
                to="/explorer"
                className="flex items-center justify-center gap-2 rounded-full bg-ink py-3 text-sm font-semibold text-ground"
              >
                Launch app <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <AccountControl />
            )}
          </div>
        </nav>
      ) : null}
    </header>
  );
}
