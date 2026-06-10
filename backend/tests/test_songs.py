from tests.conftest import auth_header, register


def _org_id(client, token):
    me = client.get("/auth/me", headers=auth_header(token))
    return me.json()["memberships"][0]["org_id"]


def test_upload_url_and_create_song(client):
    token = register(client)
    org_id = _org_id(client, token)

    up = client.post(
        "/songs/upload-url",
        json={"org_id": org_id, "filename": "song.wav"},
        headers=auth_header(token),
    )
    assert up.status_code == 200
    key = up.json()["storage_key"]
    assert key.startswith(f"orgs/{org_id}/songs/")

    created = client.post(
        "/songs",
        json={
            "org_id": org_id,
            "title": "Amazing Grace",
            "original_filename": "song.wav",
            "storage_key": key,
        },
        headers=auth_header(token),
    )
    assert created.status_code == 201
    body = created.json()
    assert body["title"] == "Amazing Grace"
    assert body["status"] == "processing"


def test_org_isolation(client):
    # User A owns a song; user B (different org) must not see or fetch it.
    token_a = register(client, org_name="Church A")
    org_a = _org_id(client, token_a)
    up = client.post(
        "/songs/upload-url",
        json={"org_id": org_a, "filename": "a.wav"},
        headers=auth_header(token_a),
    )
    key = up.json()["storage_key"]
    song = client.post(
        "/songs",
        json={"org_id": org_a, "title": "A song", "original_filename": "a.wav", "storage_key": key},
        headers=auth_header(token_a),
    ).json()

    token_b = register(client, org_name="Church B")
    resp = client.get(f"/songs/{song['id']}", headers=auth_header(token_b))
    assert resp.status_code == 403


def test_cannot_upload_to_foreign_org(client):
    token_a = register(client, org_name="A")
    org_a = _org_id(client, token_a)
    token_b = register(client, org_name="B")
    resp = client.post(
        "/songs/upload-url",
        json={"org_id": org_a, "filename": "x.wav"},
        headers=auth_header(token_b),
    )
    assert resp.status_code == 403
