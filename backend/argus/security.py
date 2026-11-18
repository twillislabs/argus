"""Password hashing, tokens and password policy."""

import hashlib
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

# argon2-cffi defaults follow the RFC 9106 low-memory profile
# (Argon2id, 64 MiB, 3 passes), in line with OWASP guidance.
_hasher = PasswordHasher()

# Used to keep login timing the same when the username does not exist.
_DUMMY_HASH = _hasher.hash("argus-timing-equaliser")

SETUP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

# A small built-in list. Production should also check a breached-password
# list (see docs); this catches the worst offenders without network access.
_COMMON = {
    "password1234",
    "password12345",
    "passwordpassword",
    "123456789012",
    "qwertyuiopas",
    "iloveyou1234",
    "adminadmin12",
    "administrator",
    "letmein12345",
    "welcome12345",
    "changeme1234",
    "argusargus12",
}

MIN_PASSWORD_LENGTH = 12


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and (
            password_hash is not None
        )
    except (VerifyMismatchError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def digests_match(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("ascii"), b.encode("ascii"))


def new_setup_token() -> str:
    chars = [secrets.choice(SETUP_ALPHABET) for _ in range(12)]
    return "-".join("".join(chars[i : i + 4]) for i in range(0, 12, 4))


def normalize_setup_token(token: str) -> str:
    """Ignore case, spaces and dashes so the token is easy to type."""
    return "".join(c for c in token.upper() if c.isalnum())


def password_problem(password: str, username: str) -> str | None:
    """Return a user-facing reason the password is unacceptable."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return "Use a password of at least {0} characters.".format(
            MIN_PASSWORD_LENGTH
        )
    lowered = password.lower()
    if username and username.lower() in lowered:
        return "The password must not contain the username."
    if lowered in _COMMON or len(set(password)) < 4:
        return "That password is too easy to guess. Try a passphrase."
    return None
