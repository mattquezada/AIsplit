"""M6 endpoints: song library, mix presets, routing presets, setlists, export."""
from tests.conftest import auth_header, register


def _org_id(client, token):
    me = client.get("/auth/me", headers=auth_header(token))
    return me.json()["memberships"][0]["org_id"]


def _make_song(client, token, org_id, title="Song", filename="s.wav"):
    up = client.post(
        "/songs/upload-url",
        json={"org_id": org_id, "filename": filename},
        headers=auth_header(token),
    )
    key = up.json()["storage_key"]
    return client.post(
        "/songs",
        json={
            "org_id": org_id,
            "title": title,
            "original_filename": filename,
            "storage_key": key,
        },
        headers=auth_header(token),
    ).json()


# ─── Song library ────────────────────────────────────────────
def test_song_update_and_filters(client):
    token = register(client)
    org = _org_id(client, token)
    a = _make_song(client, token, org, title="Alpha")
    b = _make_song(client, token, org, title="Beta")

    # Favorite Beta, archive Alpha, rename via PATCH.
    r = client.patch(
        f"/songs/{b['id']}", json={"is_favorite": True}, headers=auth_header(token)
    )
    assert r.status_code == 200 and r.json()["is_favorite"] is True
    client.patch(f"/songs/{a['id']}", json={"archived": True}, headers=auth_header(token))

    # Default list excludes archived; favorites float to top.
    listed = client.get(f"/songs?org_id={org}", headers=auth_header(token)).json()
    ids = [s["id"] for s in listed]
    assert a["id"] not in ids and b["id"] in ids
    assert listed[0]["id"] == b["id"]

    # include_archived brings Alpha back.
    all_songs = client.get(
        f"/songs?org_id={org}&include_archived=true", headers=auth_header(token)
    ).json()
    assert {a["id"], b["id"]} <= {s["id"] for s in all_songs}

    # favorites_only + search.
    favs = client.get(
        f"/songs?org_id={org}&favorites_only=true", headers=auth_header(token)
    ).json()
    assert [s["id"] for s in favs] == [b["id"]]
    found = client.get(f"/songs?org_id={org}&q=bet", headers=auth_header(token)).json()
    assert [s["id"] for s in found] == [b["id"]]


# ─── Mix presets ─────────────────────────────────────────────
def test_mix_presets_crud_and_upsert(client):
    token = register(client)
    org = _org_id(client, token)
    song = _make_song(client, token, org)

    payload = {"name": "Drummer Mix", "data": {"drums": {"volume": 1.3, "muted": False}}}
    created = client.post(
        f"/songs/{song['id']}/mixes", json=payload, headers=auth_header(token)
    )
    assert created.status_code == 201

    # Re-saving the same name overwrites (upsert), not duplicates.
    payload["data"] = {"drums": {"volume": 0.8}}
    client.post(f"/songs/{song['id']}/mixes", json=payload, headers=auth_header(token))
    mixes = client.get(f"/songs/{song['id']}/mixes", headers=auth_header(token)).json()
    assert len(mixes) == 1 and mixes[0]["data"]["drums"]["volume"] == 0.8

    mid = mixes[0]["id"]
    assert (
        client.delete(
            f"/songs/{song['id']}/mixes/{mid}", headers=auth_header(token)
        ).status_code
        == 204
    )
    assert client.get(f"/songs/{song['id']}/mixes", headers=auth_header(token)).json() == []


# ─── Routing presets ─────────────────────────────────────────
def test_routing_presets_and_isolation(client):
    token_a = register(client, org_name="A")
    org_a = _org_id(client, token_a)
    body = {
        "name": "Main Sanctuary",
        "data": {"assignments": {"click": {"output": 1, "channel": 1}}},
    }
    created = client.post(
        f"/orgs/{org_a}/routing-presets", json=body, headers=auth_header(token_a)
    )
    assert created.status_code == 201

    # Another org cannot read org A's presets.
    token_b = register(client, org_name="B")
    resp = client.get(f"/orgs/{org_a}/routing-presets", headers=auth_header(token_b))
    assert resp.status_code == 403

    presets = client.get(
        f"/orgs/{org_a}/routing-presets", headers=auth_header(token_a)
    ).json()
    assert len(presets) == 1
    pid = presets[0]["id"]
    assert (
        client.delete(
            f"/orgs/{org_a}/routing-presets/{pid}", headers=auth_header(token_a)
        ).status_code
        == 204
    )


# ─── Setlists ────────────────────────────────────────────────
def test_setlist_build_and_reorder(client):
    token = register(client)
    org = _org_id(client, token)
    s1 = _make_song(client, token, org, title="One")
    s2 = _make_song(client, token, org, title="Two")

    setlist = client.post(
        "/setlists",
        json={"org_id": org, "name": "Sunday AM", "service_date": "2026-06-14"},
        headers=auth_header(token),
    ).json()
    sid = setlist["id"]

    client.post(
        f"/setlists/{sid}/items",
        json={"song_id": s1["id"], "semitones": 0},
        headers=auth_header(token),
    )
    after = client.post(
        f"/setlists/{sid}/items",
        json={"song_id": s2["id"], "semitones": 2},
        headers=auth_header(token),
    ).json()
    assert [i["song_title"] for i in after["items"]] == ["One", "Two"]
    assert after["items"][1]["semitones"] == 2

    # Reorder: Two before One.
    ids = [after["items"][1]["id"], after["items"][0]["id"]]
    reordered = client.post(
        f"/setlists/{sid}/reorder", json={"item_ids": ids}, headers=auth_header(token)
    ).json()
    assert [i["song_title"] for i in reordered["items"]] == ["Two", "One"]

    # Remove an item.
    item_id = reordered["items"][0]["id"]
    pruned = client.delete(
        f"/setlists/{sid}/items/{item_id}", headers=auth_header(token)
    ).json()
    assert len(pruned["items"]) == 1


def test_setlist_rejects_foreign_song(client):
    token_a = register(client, org_name="A")
    org_a = _org_id(client, token_a)
    setlist = client.post(
        "/setlists", json={"org_id": org_a, "name": "A list"}, headers=auth_header(token_a)
    ).json()

    token_b = register(client, org_name="B")
    org_b = _org_id(client, token_b)
    foreign = _make_song(client, token_b, org_b, title="Foreign")

    resp = client.post(
        f"/setlists/{setlist['id']}/items",
        json={"song_id": foreign["id"]},
        headers=auth_header(token_a),
    )
    assert resp.status_code == 404


# ─── Export package ──────────────────────────────────────────
def test_package_requires_stems_then_builds(client, monkeypatch):
    import app.db as app_db
    import app.routers.export as export_router
    from app.models import Stem

    monkeypatch.setattr(export_router, "presigned_get_url", lambda key, **k: f"http://fake/{key}")

    token = register(client)
    org = _org_id(client, token)
    song = _make_song(client, token, org, title="Package Me")

    # No stems yet → 404.
    empty = client.get(f"/songs/{song['id']}/package", headers=auth_header(token))
    assert empty.status_code == 404

    # Insert original stems directly, then the package builds.
    db = app_db.SessionLocal()
    for st in ("vocals", "drums"):
        db.add(
            Stem(
                song_id=song["id"],
                name=st.capitalize(),
                stem_type=st,
                storage_key=f"orgs/{org}/songs/{song['id']}/stems/{st}.wav",
                duration_sec=120.0,
                pitch_semitones=0,
            )
        )
    db.commit()
    db.close()

    pkg = client.get(f"/songs/{song['id']}/package", headers=auth_header(token)).json()
    assert pkg["title"] == "Package Me"
    assert {s["stem_type"] for s in pkg["stems"]} == {"vocals", "drums"}
    assert all(s["url"].startswith("http://fake/") for s in pkg["stems"])
