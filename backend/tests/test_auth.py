from tests.conftest import auth_header, register


def test_register_creates_org_and_returns_token(client):
    resp = client.post(
        "/auth/register",
        json={"email": "pastor@grace.org", "password": "password123", "org_name": "Grace"},
    )
    assert resp.status_code == 201
    assert "access_token" in resp.json()


def test_duplicate_email_rejected(client):
    register(client, email="dup@example.com")
    resp = client.post(
        "/auth/register",
        json={"email": "dup@example.com", "password": "password123", "org_name": "X"},
    )
    assert resp.status_code == 409


def test_login_and_me(client):
    token = register(client, email="login@example.com")
    me = client.get("/auth/me", headers=auth_header(token))
    assert me.status_code == 200
    body = me.json()
    assert body["user"]["email"] == "login@example.com"
    assert len(body["memberships"]) == 1
    assert body["memberships"][0]["role"] == "owner"

    login = client.post(
        "/auth/login", json={"email": "login@example.com", "password": "password123"}
    )
    assert login.status_code == 200


def test_bad_login(client):
    register(client, email="real@example.com")
    resp = client.post(
        "/auth/login", json={"email": "real@example.com", "password": "wrongpass"}
    )
    assert resp.status_code == 401


def test_me_requires_auth(client):
    assert client.get("/auth/me").status_code in (401, 403)
