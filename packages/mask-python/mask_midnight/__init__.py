"""Mask on Midnight — private invoices for Python backends.

What this library does, and just as importantly what it does not:

    Creates invoice terms and payment links          yes
    Decodes a payment link                           yes
    Verifies webhook signatures                      yes
    Reads invoice or receipt state from the chain    NO

The last one is not an oversight. Reading Mask's contract state means decoding
Midnight's ledger format, which is implemented in the WASM runtime that ships
with the TypeScript SDK. Reimplementing that decoder in Python would mean
maintaining a second, unverified copy of consensus-critical parsing — the kind
of thing that is fine until the day it silently disagrees.

So for on-chain verification, call the ``@mask/node`` SDK or the app's verify
endpoint. Everything that can be done correctly in pure Python is here, and the
boundary is stated rather than blurred.
"""

from .client import (
    InvoiceKind,
    Mask,
    MaskError,
    TokenKind,
    decode_terms,
    generate_merchant_key,
)

__all__ = [
    "InvoiceKind",
    "Mask",
    "MaskError",
    "TokenKind",
    "decode_terms",
    "generate_merchant_key",
]

__version__ = "2.0.0"
