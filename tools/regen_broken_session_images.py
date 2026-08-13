"""Regenerate expired xAI image URLs in learning_sessions.execution_log.

For each affected session, walks the IMAGE_REQUEST/IMAGE_GENERATE_RESULT pairs
in execution_log. Where the result still points at imgen.x.ai (expired), takes
the prompt from the matching request, generates a new image via xAI, uploads
to GCS, and patches the session's execution_log via SQL REPLACE.

Run from inside the api container (has GCS auth + xAI key + DB access):

    python tools/regen_broken_session_images.py --dry-run
    python tools/regen_broken_session_images.py
    python tools/regen_broken_session_images.py --session-id <uuid>
"""

import argparse
import json
import sys
import time
from pathlib import Path

# Allow running as a script from /app inside the container
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))

import db as database
from tools import media_tool
from tools.image_store import persist_image

XAI_HOST_PATTERN = "imgen.x.ai"


def find_broken_pairs(execution_log):
    """Return list of (image_url, imagine_prompt, aspect_ratio) for broken images."""
    requests = [e.get("details", {}) for e in execution_log if e.get("step") == "IMAGE_REQUEST"]
    results = [e.get("details", {}) for e in execution_log if e.get("step") == "IMAGE_GENERATE_RESULT"]
    if len(requests) != len(results):
        print(f"  WARN: mismatched req/res counts ({len(requests)} vs {len(results)}) — skipping session")
        return []
    pairs = []
    for req, res in zip(requests, results):
        url = res.get("image_url", "") or ""
        if XAI_HOST_PATTERN in url:
            pairs.append((url, req.get("imagine_prompt", "") or "", req.get("aspect_ratio", "16:9") or "16:9"))
    return pairs


def regen_one(session_id, old_url, prompt, aspect_ratio, dry_run=False):
    if not prompt:
        return False, "no prompt available in IMAGE_REQUEST"
    if dry_run:
        return True, f"dry-run (would regen with prompt[:60]={prompt[:60]!r})"
    raw = media_tool.generate_from_prompt(image_prompt=prompt, aspect_ratio=aspect_ratio)
    try:
        result = json.loads(raw)
    except Exception as exc:
        return False, f"xAI response parse error: {exc}"
    if not result.get("success"):
        return False, f"xAI gen failed: {result.get('error')}"
    new_xai_url = result.get("image_url")
    if not new_xai_url:
        return False, "xAI returned no image_url"
    permanent_url = persist_image(image_url=new_xai_url, topic="rescued")
    if XAI_HOST_PATTERN in permanent_url:
        return False, "GCS upload failed (persist_image returned xAI URL)"
    try:
        database.replace_image_url_in_session(session_id, old_url, permanent_url)
    except Exception as exc:
        return False, f"DB replace failed: {exc}"
    return True, permanent_url


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="enumerate pairings, no xAI/GCS calls")
    ap.add_argument("--session-id", default=None, help="restrict to a single session UUID")
    ap.add_argument("--sleep", type=float, default=1.5, help="seconds between xAI calls")
    args = ap.parse_args()

    where = "execution_log::text LIKE %s"
    params = [f"%{XAI_HOST_PATTERN}%"]
    if args.session_id:
        where += " AND id = %s"
        params.append(args.session_id)

    rows = database.fetchall(
        f"SELECT id, execution_log FROM learning_sessions WHERE {where} ORDER BY start_time",
        tuple(params),
    )
    print(f"[REGEN] {len(rows)} session(s) to process. dry_run={args.dry_run}")

    total_ok = 0
    total_fail = 0
    for row in rows:
        sid = str(row["id"])
        log = row["execution_log"] or []
        pairs = find_broken_pairs(log)
        print(f"[REGEN] session={sid}: {len(pairs)} broken image(s)")
        for old_url, prompt, ar in pairs:
            t0 = time.time()
            ok, msg = regen_one(sid, old_url, prompt, ar, dry_run=args.dry_run)
            dt = time.time() - t0
            tag = "OK" if ok else "FAIL"
            print(f"  [{tag}] {old_url[:90]}  ({dt:.1f}s)  -> {msg}")
            if ok:
                total_ok += 1
            else:
                total_fail += 1
            if not args.dry_run:
                time.sleep(args.sleep)

    print(f"[REGEN] DONE  ok={total_ok}  fail={total_fail}")


if __name__ == "__main__":
    main()
