"""Persistent image storage (GCS).

Public API:
    persist_image(image_url, topic, ..., learning_session_message_id) -> str

All external calls are wrapped in try/except. Functions never raise --
they degrade gracefully and always return a usable result (or None).
"""

import io
import logging
import os
import re
import ssl
import threading
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
GCS_BUCKET_NAME = os.environ.get("GCS_BUCKET_NAME", "")

# Local fallback directory (existing behavior)
_LOCAL_DIR = Path(__file__).parent.parent / "generated_media"
_LOCAL_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# Lazy-initialized GCS client (thread-safe via double-checked locking)
# ---------------------------------------------------------------------------
_gcs_lock = threading.Lock()
_gcs_client = None
_gcs_bucket = None


def _get_gcs_bucket():
    """Return a GCS Bucket object, initializing on first call."""
    global _gcs_client, _gcs_bucket
    if _gcs_bucket is not None:
        return _gcs_bucket
    with _gcs_lock:
        if _gcs_bucket is not None:
            return _gcs_bucket
        if not GCS_BUCKET_NAME:
            return None
        try:
            from google.cloud import storage as gcs_storage
            _gcs_client = gcs_storage.Client()
            _gcs_bucket = _gcs_client.bucket(GCS_BUCKET_NAME)
            log.info("GCS bucket initialized: %s", GCS_BUCKET_NAME)
            return _gcs_bucket
        except Exception as exc:
            log.warning("GCS client init failed (will use local fallback): %s", exc)
            return None


# ---------------------------------------------------------------------------
# Public: persist_image
# ---------------------------------------------------------------------------

def persist_image(
    image_url: str,
    topic: str = "",
    description: str = "",
    style: str = "",
    full_prompt: str = "",
    capsule_name: str = "",
    learning_session_message_id: str = None,
) -> str:
    """Download an ephemeral image, upload to GCS, and store metadata in PostgreSQL.

    Returns the permanent URL (GCS or original fallback). Never raises.
    """
    import db as database

    # 1) Download image bytes
    image_bytes, ext = _download_bytes(image_url)
    if image_bytes is None:
        log.warning("persist_image: download failed, returning original URL")
        return image_url

    # 2) Try GCS upload
    gcs_url, blob_name = _upload_to_gcs(image_bytes, topic, ext)

    # 3) If GCS failed, keep the original xAI URL (do NOT save locally)
    if not gcs_url:
        log.warning("persist_image: GCS upload failed, keeping original URL: %s", image_url)
        permanent_url = image_url
        blob_name = ""
    else:
        permanent_url = gcs_url
        blob_name = blob_name or ""

    # 4) Insert metadata into PostgreSQL
    try:
        database.insert_generated_image(
            gcs_url=permanent_url,
            gcs_blob_name=blob_name,
            topic=topic,
            description=description,
            style=style,
            full_prompt=full_prompt,
            capsule_name=capsule_name,
            learning_session_message_id=learning_session_message_id,
        )
    except Exception as exc:
        log.warning("persist_image: DB insert failed (image still accessible): %s", exc)

    return permanent_url


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _download_bytes(url: str) -> tuple:
    """Download image bytes from a URL. Returns (bytes, extension) or (None, None)."""
    try:
        from urllib.parse import urlparse
        path = urlparse(url).path.lower()
        if path.endswith((".jpg", ".jpeg")):
            ext = ".jpg"
        elif path.endswith(".webp"):
            ext = ".webp"
        else:
            ext = ".png"
        ctx = ssl.create_default_context()
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            data = resp.read()
        return data, ext
    except Exception as exc:
        log.warning("_download_bytes failed: %s", exc)
        return None, None


def _upload_to_gcs(image_bytes: bytes, topic: str, ext: str) -> tuple:
    """Upload to GCS. Returns (public_url, blob_name) or (None, None)."""
    bucket = _get_gcs_bucket()
    if bucket is None:
        return None, None
    try:
        safe_label = re.sub(r'[^\w\-]', '_', topic)[:50]
        ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        blob_name = f"generated-images/{ts}_{safe_label}{ext}"
        content_type = {".jpg": "image/jpeg", ".webp": "image/webp"}.get(ext, "image/png")
        blob = bucket.blob(blob_name)
        blob.upload_from_file(io.BytesIO(image_bytes), content_type=content_type)
        public_url = f"https://storage.googleapis.com/{GCS_BUCKET_NAME}/{blob_name}"
        log.info("GCS upload OK: %s (%d bytes)", blob_name, len(image_bytes))
        return public_url, blob_name
    except Exception as exc:
        log.warning("GCS upload failed (will fallback to local): %s", exc)
        return None, None


def _save_locally(image_bytes: bytes, topic: str, ext: str) -> tuple:
    """Save to generated_media/ (fallback). Returns (local_url, filename)."""
    safe_label = re.sub(r'[^\w\-]', '_', topic)[:50]
    ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    filename = f"{ts}_{safe_label}{ext}"
    filepath = _LOCAL_DIR / filename
    filepath.write_bytes(image_bytes)
    log.info("Local save OK: %s (%d bytes)", filepath, len(image_bytes))
    local_url = f"/static/generated_media/{filename}"
    return local_url, filename
