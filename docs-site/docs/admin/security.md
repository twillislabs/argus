---
title: Security model
---

# Security model

## Accounts and sessions

- **Passwords** are hashed with Argon2id (argon2-cffi, RFC 9106 parameters) and
  rehashed automatically when the parameters change.
- **Sessions** are random 256-bit tokens in an `HttpOnly`, `Secure`,
  `SameSite=Lax` cookie. Only a SHA-256 of the token is stored.
- **Lifetimes:** 12 hours idle, 7 days absolute, or 30 days with "keep me
  signed in".
- **CSRF:** every state-changing request must send the `X-CSRF-Token` header
  matching the session. JSON-only request bodies block form-based CSRF on the
  sign-in and setup endpoints.

## Brute-force protection

- After 5 failed sign-ins an account is locked for 15 minutes.
- Each client address may try 20 sign-ins per 15 minutes.
- Failures return the same message whether or not the user exists, and take
  the same time.

## Audit log

Setup, sign-in, failed sign-in, lockout and sign-out events are recorded with
the time, user and client address.

## Transport

Run Argus behind a reverse proxy that terminates TLS (Caddy, Traefik or
nginx). Cookies are `Secure` by default, so plain HTTP only works with
`ARGUS_COOKIE_SECURE=false`, which is meant for local development.
