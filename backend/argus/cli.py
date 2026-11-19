"""Server-side commands for admins, run in the API container by the
./argus script at the repository root (./argus help):

    python -m argus.cli users
    python -m argus.cli reset-password USERNAME
    python -m argus.cli unlock USERNAME

reset-password prints a temporary password, clears any lockout and ends
the user's sessions; they choose a new password when they sign in.
"""

import asyncio
import sys

from sqlalchemy import delete, func, select

from argus.config import get_settings
from argus.db import Database
from argus.models import User, UserSession
from argus.security import hash_password, new_temp_password
from argus.services import audit


async def _find(session, username: str) -> User | None:
    return (
        await session.execute(
            select(User).where(func.lower(User.username) == username.lower())
        )
    ).scalar_one_or_none()


async def users(db: Database) -> int:
    async with db.sessionmaker() as session:
        rows = (
            await session.execute(select(User).order_by(User.username))
        ).scalars()
        print(
            "{0:<20} {1:<8} {2:<7} {3}".format(
                "USERNAME", "ROLE", "ACTIVE", "LAST SIGN-IN"
            )
        )
        for u in rows:
            print(
                "{0:<20} {1:<8} {2:<7} {3}{4}".format(
                    u.username,
                    u.role,
                    "yes" if u.is_active else "no",
                    u.last_login_at.strftime("%Y-%m-%d %H:%M")
                    if u.last_login_at
                    else "never",
                    "  (locked)" if u.locked_until else "",
                )
            )
    return 0


async def reset_password(db: Database, username: str) -> int:
    async with db.sessionmaker() as session:
        user = await _find(session, username)
        if user is None:
            print(
                "No user called {0!r}. ./argus users lists them.".format(
                    username
                )
            )
            return 1
        temp = new_temp_password()
        user.password_hash = hash_password(temp)
        user.must_change_password = True
        user.failed_logins = 0
        user.locked_until = None
        user.is_active = True
        await session.execute(
            delete(UserSession).where(UserSession.user_id == user.id)
        )
        await audit(
            session, "users.reset_password_cli", None, None, target=user.id
        )
        await session.commit()
    print("Temporary password for {0}: {1}".format(user.username, temp))
    print("They'll choose a new one when they sign in.")
    return 0


async def unlock(db: Database, username: str) -> int:
    async with db.sessionmaker() as session:
        user = await _find(session, username)
        if user is None:
            print("No user called {0!r}.".format(username))
            return 1
        user.failed_logins = 0
        user.locked_until = None
        await audit(session, "users.unlock_cli", None, None, target=user.id)
        await session.commit()
    print("{0} can sign in again.".format(user.username))
    return 0


USAGE = """usage: python -m argus.cli COMMAND
  users                     list accounts
  reset-password USERNAME   set a temporary password (and unlock)
  unlock USERNAME           clear a sign-in lockout"""


async def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(USAGE)
        return 0
    db = Database(get_settings().database_url)
    try:
        if argv[0] == "users":
            return await users(db)
        if argv[0] in ("reset-password", "unlock") and len(argv) == 2:
            fn = reset_password if argv[0] == "reset-password" else unlock
            return await fn(db, argv[1])
        print(USAGE)
        return 2
    finally:
        await db.dispose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
