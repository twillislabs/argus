---
title: First-run setup
---

# First-run setup

While no accounts exist, every page sends you to **Set up Argus**.

## 1. Setup token

When the API starts with an empty user table it prints a one-time token:

```text
WARNING argus.setup: No accounts exist yet. Argus setup token: K7QX-2MNA-P4RT (expires 2026-11-19 14:02 UTC)
```

Copy it into the first step. Case, spaces and dashes don't matter. The token
expires after 24 hours (`ARGUS_SETUP_TOKEN_HOURS`); restarting the API issues
a new one and revokes the old. For automated installs you can fix the token
with `ARGUS_SETUP_TOKEN`.

The token stops anyone else on your network from claiming the server before
you do.

## 2. Admin account

Choose a display name, a username (3–32 letters, numbers, dots, dashes or
underscores) and a password of at least 12 characters. The password is
hashed with Argon2id and never stored in plain text.

## 3. Home location

Search for your town or enter coordinates. The search runs on your server
over GeoNames' list of every place with 15,000+ people (about 34,000 places),
so it works offline. You can qualify a name: `Goodlettsville, TN`,
`Springfield, Illinois`, `Paris, France`. For anywhere smaller, type the
coordinates; the time zone comes from the nearest listed place.

Argus opens the globe there, shows a home clock, and lists events within the
alert radius under **Near home**. Change it any time in **Settings**.

After setup you are signed in and the setup page disappears for good.
