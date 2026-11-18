"""Encryption for secrets stored in the database (API keys).

Values are encrypted with Fernet (AES-128-CBC with HMAC-SHA256) under a
key derived from ARGUS_SECRET_KEY, so a database dump alone doesn't
reveal them. Changing ARGUS_SECRET_KEY makes stored secrets unreadable;
they must then be entered again.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

CONTEXT = b"argus/stored-secrets/v1"


def _fernet(secret_key: str) -> Fernet:
    digest = hashlib.sha256(CONTEXT + secret_key.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(secret_key: str, plaintext: str) -> str:
    return _fernet(secret_key).encrypt(plaintext.encode("utf-8")).decode()


def decrypt(secret_key: str, token: str) -> str | None:
    """The plaintext, or None if the key changed or the token is bad."""
    try:
        return _fernet(secret_key).decrypt(token.encode("utf-8")).decode()
    except (InvalidToken, ValueError):
        return None


def hint(plaintext: str) -> str:
    """What may be shown of a secret: its last four characters."""
    return "…{0}".format(plaintext[-4:]) if len(plaintext) >= 8 else "set"
