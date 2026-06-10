# AIsplit — AI Worship Multitrack Platform

Upload legally owned worship songs, automatically detect tempo/key/sections,
split them into stems, play synchronized multitracks, save mixes, route stems to
the sound board, plan services, and export ready-to-use playback packages. The
core pipeline (M1) plus the **production layer (M6)** — saved mixes, routing
presets, setlists, and export — are implemented; see the [Roadmap](#roadmap).

## What works today

A complete, real pipeline running locally:

1. **Auth + multi-tenancy** — register a church (organization), JWT auth, all data
   org-scoped.
2. **Upload** — drag-and-drop WAV/MP3/FLAC/AIFF/M4A directly to object storage via
   presigned URLs, with progress.
3. **Async processing** — a Celery worker analyzes the song (BPM, beat grid,
   downbeats, key, sections — each with a confidence score) and separates it into
   stems.
4. **Playback** — sample-accurate synchronized multi-stem playback in the browser
   with per-stem mute / solo / volume / pan, waveform scrub, and per-stem WAV
   download.

5. **Real separation (Demucs) + worship stems** — `htdemucs_6s` splits the mix,
   then a refinement pass produces the finer tracks a worship rig expects:
   **Kick, Drums, Bass, Electric, Keys, Synth/Pad, Lead Vocal, BGV**. Vocals are
   split center-vs-sides (lead vs harmonies) and drums on a kick/kit crossover —
   see [`backend/app/worker/refine.py`](backend/app/worker/refine.py).
   Configurable via `SEPARATION_MODEL` (`htdemucs_6s` | `htdemucs` | `stub`).
6. **Click track** — a clap (the bundled `Perc_Clap_lo` sample) scheduled on the
   song's *actual* detected beat grid, so it locks to the recording instead of a
   rigid BPM line. One sound for every beat (downbeats a touch louder). BPM,
   tap-tempo, and a ±ms latency nudge are editable live and saved to the song.
7. **Custom sections** — drop your own parts (Intro, Verse, Pre-Chorus, Chorus,
   Bridge, Instrumental, Tag, Outro), rename them, and pin each to a position.
   They persist server-side (`/songs/{id}/markers`) and drive both the timeline
   ribbon and the guide.
8. **Guide track** — `/songs/{id}/guide` returns the spoken-cue schedule from
   your sections; toggle Guide and an AI voice announces each part a bar before it
   lands. The optional count-in claps *and* counts you in ("one, two, three…").
9. **Key change** — transpose ±12 semitones; each pitched stem is re-rendered with
   Rubber Band (tempo preserved); drums/kick pass through unshifted.
10. **Console UI** — a Playback/Prime-style transport (BPM, key, time, click/guide/
    count-in toggles, master) over a section ribbon and color-coded track lanes
    with mute/solo/volume/pan and per-track waveform.
11. **Practice loop** — drag-select any region on the overview waveform and loop
    it to rehearse a part.
12. **Saved mixes** — store and recall per-song rehearsal/console mixes (Drummer
    Mix, Vocalist Mix, …); presets are keyed by stem type so they survive key
    changes.
13. **Sound-board routing** — assign each stem to an interface output and console
    channel, saved as reusable per-venue presets (Main Sanctuary, Youth Room, …).
14. **Service planning** — build setlists of songs, each pinned to a chosen key,
    reorderable, deep-linking to the player.
15. **Library management** — search, favorite, and archive songs.
16. **Export** — assemble a playback package (stems at any rendered key + tempo /
    key / section markers) as a downloadable manifest with signed stem links.

### Performance note

`htdemucs_6s` runs on CPU here (no GPU in Docker Desktop), so a full 3–5 min song
takes several minutes to separate; the ~250 MB model downloads once into a cached
volume. For fast iteration set `SEPARATION_MODEL=stub` in `.env`. Cloud-GPU
separation is the future path (the `Separator` interface is unchanged).

## Architecture

```
Next.js 15 (frontend)  ──HTTP/JWT──>  FastAPI (backend)
        │  presigned PUT/GET                  │ enqueue (Celery)
        ▼                                      ▼
   MinIO (S3)  <──────────────────────  Celery worker
   Postgres (state)        Redis (broker + result backend)
```

| Layer    | Tech |
|----------|------|
| Frontend | Next.js 15, TypeScript, Tailwind, React Query, Zustand, WaveSurfer.js, Web Audio API |
| Backend  | FastAPI, SQLAlchemy 2, Alembic, JWT |
| Worker   | Celery, librosa, soundfile, scipy, numpy |
| Infra    | Postgres, Redis, MinIO (S3), all via docker-compose |

The backend and worker share one codebase/image (`backend/`); the worker just runs
the Celery command instead of uvicorn, keeping the ORM models a single source of
truth.

## Quick start

```bash
cp .env.example .env
docker compose up --build
```

Then:

- Frontend: http://localhost:3000
- API docs: http://localhost:8000/docs
- MinIO console: http://localhost:9001 (user/pass from `.env`)

Register an account (creates your organization), drag in a `.wav`, watch it move
from **processing → ready**, then open it to see the analysis and play the stems.

## Supabase (managed Postgres)

The database runs on a dedicated Supabase project (**AIsplit**, region us-east-1);
Redis and object storage (MinIO) run locally. The schema is already applied to
Supabase, every table has RLS enabled (the backend connects as the `postgres`
role and bypasses RLS; the public PostgREST API is default-deny), and the Alembic
baseline is stamped so startup migrations are a no-op.

Run it:

```bash
docker compose -f docker-compose.supabase.yml up --build
```

**One value you must supply** (Supabase never exposes the DB password via API):

1. Dashboard → **Project Settings → Database → Reset database password**, copy it.
2. Paste it into `DATABASE_URL` in `.env`, replacing `<DB-PASSWORD>`. Confirm the
   pooler host matches the dashboard's *Connect → Session pooler* string.

`.env` is gitignored — never commit it. To later move object storage to Supabase
Storage, generate an S3 key in *Storage → S3 Connection*, create a private
`aisplit` bucket, and repoint the `S3_*` vars at the
`https://<ref>.storage.supabase.co/storage/v1/s3` endpoint.

## Running tests

```bash
docker compose run --rm backend pytest
```

Tests cover auth, organization isolation, the upload→register flow, and the audio
analyzer/separator on synthetic signals. They use an isolated `<db>_test` database
and stub storage/Celery, so no MinIO or Redis is required.

Frontend typecheck:

```bash
docker compose run --rm frontend npm run typecheck
```

## Project layout

```
backend/   FastAPI app + Celery worker (shared package `app`)
  app/routers/        auth, orgs, songs, jobs, analysis, stems, guide,
                      mixes, routing, setlists, export
  app/worker/         celery_app, tasks, pipeline, analyze, separate, refine, transpose
  app/alembic/        migrations
  tests/
frontend/  Next.js App Router
  src/app/            /login, /songs, /songs/[id], /setlists, /setlists/[id]
  src/components/     UploadDropzone, SongList, AnalysisPanel, MultitrackPlayer,
                      SectionManager, SectionEditor, MixPresets, RoutingPanel,
                      ExportPanel
  src/lib/            api client, audio engine (transport + clap click), stems, types
  public/sounds/      click.wav (the bundled clap used for the metronome)
  src/stores/         auth + player (Zustand)
```

## Roadmap

- **M1 (this repo):** upload → analyze → stub-separate → synced playback/download.
- **M2:** real Demucs (htdemucs) on a GPU worker.
- **M3:** full waveform editor — marker/section/BPM/time-signature editing, tap tempo.
- **M4:** key transposition (Rubber Band, ±12 semitones, formant correction).
- **M5 (done):** steady editable click + spoken guide-track cues + count-in.
- **M6 (done):** mix presets, sound-board routing presets, setlists, library
  management, export packages.
- **M7:** multi-output audio, digital mixer integration (OSC/MIDI, scene recall).
- **M8+:** CCLI / Planning Center / ProPresenter, Ableton/MainStage export, mobile.

## Notes & limitations

- Separation is real (Demucs `htdemucs_6s`) but CPU-bound locally — see the
  performance note above. `SEPARATION_MODEL=stub` gives instant DSP approximations.
- User-defined sections persist in browser localStorage (per song); server-side
  persistence is a follow-up.
- Resumable uploads are single-PUT presigned for now; multipart/resumable is later.
- The waveform cursor uses WaveSurfer for visuals; transport/mixing is Web Audio.
- Cloud deploy configs (Vercel/RunPod/Modal) are documented but the stack is
  local-first via docker-compose.
