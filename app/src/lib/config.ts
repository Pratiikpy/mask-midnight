// Network configuration.
//
// Endpoints come from the wallet's own getConfiguration() at runtime — the
// wallet is the authority on which network it is attached to, and hardcoding
// URLs is how an app ends up pointed at a different chain than the user is.
// These are fallbacks for the local devnet only.

export type NetworkId = 'undeployed' | 'testnet' | 'preview' | 'preprod' | 'mainnet';

export const NETWORK_ID: NetworkId =
  (import.meta.env.VITE_NETWORK_ID as NetworkId | undefined) ?? 'undeployed';

// `localhost`, not `127.0.0.1`. On Windows the browser sits outside WSL and
// reaches the devnet through WSL's localhost forwarding; a literal 127.0.0.1
// from the browser is the Windows loopback and refuses the connection.
export const LOCAL_FALLBACK = {
  indexerUri: 'http://localhost:8088/api/v4/graphql',
  indexerWsUri: 'ws://localhost:8088/api/v4/graphql/ws',
  proverServerUri: 'http://localhost:6300',
} as const;

/** Address of the deployed mask_pay contract, if one is configured. */
export const CONTRACT_ADDRESS: string | undefined = import.meta.env.VITE_CONTRACT_ADDRESS as
  | string
  | undefined;

/**
 * Measured proof times on the local devnet. Used to set honest expectations in
 * the UI instead of showing an indeterminate spinner for half a minute.
 */
export const EXPECTED_PROOF_SECONDS: Record<string, number> = {
  create_invoice: 25,
  refund_payment: 45,
  settle_invoice: 30,
  settle_invoice_shielded: 45,
  attest_revenue_at_least: 60,
};

/**
 * The Mask backend, for the two things that need a server: checkout sessions
 * and the assistant.
 *
 * Neither is required to use the product. The app talks to the chain directly;
 * if this is unreachable, checkout and the assistant are unavailable and
 * everything else still works.
 */
export const BACKEND_URL: string | null = (() => {
  const configured = import.meta.env.VITE_BACKEND_URL as string | undefined;
  // In development the backend runs beside the app. In a production build an
  // unset URL means there is no backend, and the app must not go looking for
  // one: a request to a host that is not there is a console error on every
  // page load for a feature the deployment never offered.
  const url = configured ?? (import.meta.env.DEV ? 'http://localhost:3100' : null);
  return url ? url.replace(/\/+$/, '') : null;
})();
