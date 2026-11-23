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

Administrators manage accounts in **Settings → Users & roles**, and can read the audit log in **Settings → Audit log**. Every role can use
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

### Sign-ups

**Sign-ups** at the top of Settings → Users & roles lets people make
their own accounts. It's off unless you turn it on.

- **Allow sign-ups** adds **Create an account** to the sign-in page
  (`/signup`): a username, name, optional email and a password (the
  same rules as any password).
- **Approve new accounts** (on by default): a new account shows as
  **Waiting** at the top of the accounts list, with **Approve** and
  **Decline** (which deletes it). Until it's approved, signing in with
  the right password says the account is waiting; a wrong password says
  only that it's wrong. The Settings menu shows how many are waiting.
  Off, people are signed in as soon as they sign up.
- **Role for new accounts**: Viewer or Analyst, never Administrator.
  Change anyone's role afterwards in the list.
- Each address may sign up 5 times an hour. Sign-ups and approvals are
  in the audit log.

Anyone who can reach your Argus can sign up while this is on, so keep
approval on unless the server is only reachable by people you trust.

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

## Wall screens

Wall screens pair with a one-time code (Settings > Displays) instead of a
password. The code is valid for ten minutes and only works once; the
screen holds a secret token that never leaves it, and the code alone
can't sign anything in. Each screen has its own *display* account that can
only open the Wall. Pairing, approving and unpairing are in the audit log
(`display.approved`, `display.paired`, `display.unpaired`; changes to a
screen's wall settings are `display.wall`), and unpairing
ends the screen's sessions straight away.
