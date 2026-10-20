# Master TestBook Foundation — rules
- User works from an Android phone only. Explain in simple Hindi, short. Never ask for passwords/OTP/secret keys in chat.
- Questions: `pyq` only from official paper / answer key (needs a `sources` row). Everything else is `practice`. Our own solutions only; never copy publisher text/solutions or strip watermarks.
- Grow by data: a new exam / branch / subject / topic = a JSON file in `config/` + a seed row. Code changes only for new *kinds* of behaviour.
- DB migrations are **additive only** (`db/migrations/000N_*.sql`, `IF NOT EXISTS`, never edit an applied file, never DROP/DELETE/rename). Backup before applying to the server. Apply via Supabase connector.
- Release only after `python3 tests/run_all.py` passes. No secret keys in the repo (publishable key only).
- Legacy code lives on tag `legacy-v3.4.1` / branch `main`. Reuse ideas from it by copying files in, not by editing it.
