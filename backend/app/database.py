from __future__ import annotations

import json
from collections.abc import Generator

from sqlalchemy import Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)


connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(
    settings.database_url,
    connect_args=connect_args,
    future=True,
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_setting_json(db: Session, key: str) -> dict | None:
    setting = db.get(Setting, key)
    if setting is None:
        return None
    return json.loads(setting.value)


def set_setting_json(db: Session, key: str, value: dict | None) -> None:
    setting = db.get(Setting, key)
    if value is None:
        if setting is not None:
            db.delete(setting)
            db.commit()
        return

    payload = json.dumps(value)
    if setting is None:
        setting = Setting(key=key, value=payload)
        db.add(setting)
    else:
        setting.value = payload
    db.commit()
