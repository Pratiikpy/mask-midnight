"""Invoice terms, payment links and webhook verification."""

from __future__ import annotations

import base64
import binascii
import hmac
import json
import re
import secrets
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Dict, Optional, Union

_HEX64 = re.compile(r"^[0-9a-fA-F]{64}$")


class InvoiceKind:
    """How an invoice may be settled. Values match the Compact enum."""

    STANDARD = 0
    MULTIPAY = 1
    DONATION = 2


class TokenKind:
    """Settlement asset. Values match the Compact enum."""

    NATIVE = 0
    MUSDC = 1
    MUSAD = 2


class MaskError(Exception):
    """Raised for configuration and input errors."""


@dataclass(frozen=True)
class InvoiceTerms:
    """The secret terms of an invoice.

    Reproducing the on-chain commitment requires all of them, which is why they
    travel directly from merchant to payer and never through a server.
    """

    merchant_key: str
    salt: str
    amount: str
    kind: int
    token: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "merchantKey": self.merchant_key,
            "salt": self.salt,
            "amount": self.amount,
            "kind": self.kind,
            "token": self.token,
        }


@dataclass(frozen=True)
class CreatedInvoice:
    terms: InvoiceTerms
    payment_link: str
    reference: str


def generate_merchant_key() -> str:
    """Generate a merchant identity key.

    Store it somewhere durable and private. Every invoice binds to it, and it
    is what proves an invoice is yours.
    """
    return secrets.token_hex(32)


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def decode_terms(encoded: str) -> Optional[Dict[str, Any]]:
    """Decode a payment link or bare fragment.

    Returns ``None`` rather than raising for anything malformed: this parses
    attacker-supplied input, and a caller checking for ``None`` is far more
    likely to be correct than a caller remembering to catch.
    """
    try:
        fragment = encoded.split("#", 1)[1] if "#" in encoded else encoded
        if not fragment:
            return None
        parsed = json.loads(_b64url_decode(fragment).decode("utf-8"))
        if not isinstance(parsed, dict):
            return None
        if not _HEX64.match(str(parsed.get("merchantKey", ""))):
            return None
        if not _HEX64.match(str(parsed.get("salt", ""))):
            return None
        int(str(parsed["amount"]))
        return parsed
    except (ValueError, KeyError, TypeError, binascii.Error, UnicodeDecodeError):
        return None


class Mask:
    """Client for creating invoices and verifying webhooks."""

    def __init__(
        self,
        contract_address: str,
        merchant_key: str,
        app_url: str = "",
        webhook_secret: Optional[str] = None,
    ) -> None:
        if not _HEX64.match(merchant_key):
            raise MaskError(
                "merchant_key must be 64 hex characters. Use generate_merchant_key()."
            )
        if not contract_address:
            raise MaskError("contract_address is required.")

        self.contract_address = contract_address
        self.merchant_key = merchant_key
        self.app_url = app_url.rstrip("/")
        self.webhook_secret = webhook_secret

    def create_invoice(
        self,
        amount: Union[int, str],
        kind: int = InvoiceKind.STANDARD,
        token: int = TokenKind.NATIVE,
    ) -> CreatedInvoice:
        """Create invoice terms and a payment link.

        Nothing is written to the chain here — publishing the commitment needs
        a proof, which needs a wallet. The link is valid immediately; the payer
        just cannot settle until the commitment lands.
        """
        value = int(amount)
        if value <= 0:
            raise MaskError("amount must be greater than zero.")

        terms = InvoiceTerms(
            merchant_key=self.merchant_key,
            salt=secrets.token_hex(32),
            amount=str(value),
            kind=kind,
            token=token,
        )

        payload = dict(terms.to_dict(), contractAddress=self.contract_address)
        encoded = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))

        # A fragment, never a query string: browsers do not transmit fragments
        # to servers, so the amount never reaches anyone's infrastructure.
        return CreatedInvoice(
            terms=terms,
            payment_link=f"{self.app_url}/pay#{encoded}",
            reference=terms.salt,
        )

    def sign_webhook(self, raw_body: str) -> str:
        """Sign a payload the way Mask signs webhooks."""
        if not self.webhook_secret:
            raise MaskError("webhook_secret is not configured.")
        digest = hmac.new(
            self.webhook_secret.encode("utf-8"), raw_body.encode("utf-8"), sha256
        ).hexdigest()
        return f"sha256={digest}"

    def verify_webhook(self, raw_body: str, signature: str) -> bool:
        """Verify a webhook signature in constant time.

        ``==`` on an HMAC leaks the correct prefix through timing, which makes
        forging one tractable. ``compare_digest`` does not.
        """
        if not self.webhook_secret:
            raise MaskError("webhook_secret is not configured.")

        expected = hmac.new(
            self.webhook_secret.encode("utf-8"), raw_body.encode("utf-8"), sha256
        ).hexdigest()
        received = signature[7:] if signature.startswith("sha256=") else signature
        return hmac.compare_digest(expected, received)
