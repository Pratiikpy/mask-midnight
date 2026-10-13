// A payment link as a QR code.
//
// The point is in-person payment: a merchant shows this, a payer scans it, and
// the terms travel merchant-to-payer without passing through a server, a chat
// app, or anything that keeps a copy. That is the same channel the share link
// uses, with the copy step removed.
//
// Worth being clear about what is in the image, because it is not a payment
// address: the fragment carries the invoice's real terms — amount, salt,
// merchant key. Anyone who photographs the screen can pay the invoice, and can
// read what it is for. That is not a flaw in the QR; it is what a payment link
// is. The UI says it under the code rather than leaving someone to find out.

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface Props {
  /** The full payment URL, fragment included. */
  value: string;
  size?: number;
}

export function PaymentQR({ value, size = 200 }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    QRCode.toDataURL(value, {
      width: size * 2, // rendered at 2x so it stays crisp on a dense screen
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        // Deliberately not the app's near-black background: scanners want
        // contrast, and a dark-on-dark code is a code nobody can read.
        dark: '#0b0f14',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((e: unknown) => {
        // A link longer than the format allows is the realistic failure, and it
        // should say which rather than rendering nothing.
        if (!cancelled) {
          setError(
            value.length > 2_000
              ? 'This link is too long to fit in a QR code. Send it as a link instead.'
              : `Could not render a code: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) return <p className="text-xs text-ink-faint">{error}</p>;
  if (!dataUrl) return <div style={{ width: size, height: size }} className="rounded-xl bg-surface-2" />;

  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt="Payment link as a QR code"
      className="rounded-xl bg-white p-2"
    />
  );
}
