"""Test fixtures.

Spins up an isolated `<db>_test` database (created on demand) so tests never
touch dev data. Storage and Celery are stubbed so no MinIO/Redis is required for
the API/unit tests.
"""
from __future__ import annotations

import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings


def _admin_url(database_url: str) -> tuple[str, str, str]:
    """Return (server_dsn_to_postgres_db, test_db_name, test_sqlalchemy_url)."""
    # settings url is sqlalchemy form: postgresql+psycopg://user:pw@host:port/db
    raw = database_url.replace("postgresql+psycopg", "postgresql")
    base, db_name = raw.rsplit("/", 1)
    test_db = f"{db_name}_test"
    server_dsn = f"{base}/postgres"
    test_url = f"postgresql+psycopg://{base.split('://', 1)[1]}/{test_db}"
    return server_dsn, test_db, test_url


@pytest.fixture(scope="session")
def engine():
    server_dsn, test_db, test_url = _admin_url(settings.database_url)
    # (Re)create the test database.
    with psycopg.connect(server_dsn, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{test_db}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{test_db}"')

    eng = create_engine(test_url, future=True)

    # Build schema from model metadata (equivalent to running migrations).
    import app.models  # noqa: F401
    from app.db import Base

    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture()
def client(engine, monkeypatch):
    TestSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    # Point app DB at the test engine.
    import app.db as app_db

    monkeypatch.setattr(app_db, "engine", engine)
    monkeypatch.setattr(app_db, "SessionLocal", TestSession)

    from app.db import get_db
    from app.main import app

    def _override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_get_db

    # Stub storage so no MinIO is needed.
    import app.routers.songs as songs_router

    monkeypatch.setattr(songs_router, "presigned_put_url", lambda key, **k: f"http://fake/{key}")
    monkeypatch.setattr(songs_router, "object_exists", lambda key: True)
    monkeypatch.setattr(songs_router, "delete_prefix", lambda prefix: None)

    # Stub Celery enqueue so no Redis/worker is needed.
    import app.worker.tasks as tasks

    monkeypatch.setattr(tasks.process_song, "delay", lambda *a, **k: None)

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


def register(client, email: str | None = None, org_name: str = "Grace Church") -> str:
    email = email or f"user_{uuid.uuid4().hex[:8]}@example.com"
    resp = client.post(
        "/auth/register",
        json={"email": email, "password": "password123", "org_name": org_name},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
