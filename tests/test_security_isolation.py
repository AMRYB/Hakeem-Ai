import uuid
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.db import Base
from backend.models import ChatSession, User
from backend.routers.chat import _owned_session
from fastapi import HTTPException


def test_user_cannot_read_another_users_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    u1 = User(id=str(uuid.uuid4()), email="one@example.com", password_hash="x")
    u2 = User(id=str(uuid.uuid4()), email="two@example.com", password_hash="x")
    session = ChatSession(id=str(uuid.uuid4()), user_id=u1.id, title="private")
    db.add_all([u1, u2, session]); db.commit()

    try:
        _owned_session(db, session.id, u2.id)
        assert False, "Expected a 404 for a different user's session"
    except HTTPException as exc:
        assert exc.status_code == 404
