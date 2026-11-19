from sqlalchemy import select

from argus import cli
from argus.models import User
from argus.security import verify_password


async def test_reset_password_and_unlock(app, admin_client, capsys):
    from argus.db import utcnow

    db = app.state.db
    async with db.sessionmaker() as s:
        u = (
            await s.execute(select(User).where(User.username == "admin"))
        ).scalar_one()
        u.failed_logins, u.locked_until = 9, utcnow()
        await s.commit()
    assert await cli.reset_password(db, "ADMIN") == 0
    temp = capsys.readouterr().out.split(": ", 1)[1].splitlines()[0]
    async with db.sessionmaker() as s:
        u = (
            await s.execute(select(User).where(User.username == "admin"))
        ).scalar_one()
        assert verify_password(u.password_hash, temp)
        assert u.must_change_password and u.locked_until is None
    assert await cli.unlock(db, "nobody") == 1
    assert await cli.users(db) == 0
    assert "admin" in capsys.readouterr().out
