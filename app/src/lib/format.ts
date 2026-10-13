/** Shorten a 32-byte hex digest for display without losing recognisability. */
export const shortHex = (hex: string, lead = 8, tail = 6): string =>
  hex.length <= lead + tail + 1 ? hex : `${hex.slice(0, lead)}…${hex.slice(-tail)}`;

export const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export const fromHex = (h: string): Uint8Array => {
  const clean = h.startsWith('0x') ? h.slice(2) : h;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

/** Mask stores whole units; no decimal handling is implied here. */
export const formatAmount = (v: bigint): string => v.toLocaleString('en-US');

export const parseAmount = (s: string): bigint | null => {
  const clean = s.replace(/[,\s_]/g, '');
  if (!/^\d+$/.test(clean)) return null;
  try {
    return BigInt(clean);
  } catch {
    return null;
  }
};

export const elapsedSince = (since: number): string => {
  const s = Math.floor((Date.now() - since) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};
