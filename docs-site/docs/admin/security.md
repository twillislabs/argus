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

## Users and roles

Administrators manage accounts in **Settings → Users**. Every role can use
the map, search and follow aircraft, and keep its own preferences:

| Role | Can also |
|---|---|
| **Administrator** | Manage users and roles, change server-wide settings (map imagery, the Google key) |
| **Analyst** | Use analyst tools as they arrive (alerts, notes, watchlists, AI) |
| **Viewer** | Nothing more: the map, read-only |
| **Display** | For a wall screen: read-only, its sessions never time out when idle, and only an admin can change its details or password |

- **New accounts** get a temporary password, shown to the admin once. At
  first sign-in the user must choose their own; until then the server
  refuses every other request.
- **Reset password** issues a new temporary password the same way and signs
  the user out on every device.
- **Deactivate** blocks sign-in and ends the user's sessions but keeps the
  account; **Delete** removes it (audit entries stay, without the user).
- **Unlock** clears a lockout from failed sign-ins.
- **Guards:** you can't change your own role, or deactivate or delete
  yourself, and Argus always keeps at least one active administrator.
- **Changing your password** (Settings → Account) signs out your other
  devices.

## Brute-force protection

- After 5 failed sign-ins an account is locked for 15 minutes.
- Each client address may try 20 sign-ins per 15 minutes.
- Failures return the same message whether or not the user exists, and take
  the same time.

## Audit log

Setup, sign-in, failed sign-in, lockout and sign-out events are recorded with
the time, user and client address, as are password changes, every user
management action (create, role or status change, reset, unlock, delete)
and server setting changes.

## Transport

Run Argus behind a reverse proxy that terminates TLS (Caddy, Traefik or
nginx). Cookies are `Secure` by default, so plain HTTP only works with
`ARGUS_COOKIE_SECURE=false`, which is meant for local development.
