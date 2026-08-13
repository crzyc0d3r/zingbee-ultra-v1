"""Download still-alive xAI ephemeral images, upload to GCS, update DB.

Run inside the API container:
    python /app/fix_xai_images.py
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import db as database
from tools.image_store import _download_bytes, _upload_to_gcs


def get_xai_images():
    conn = database.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, gcs_url, topic
                FROM generated_images
                WHERE gcs_url LIKE '%%imgen.x.ai%%'
                ORDER BY id
            """)
            return cur.fetchall()
    finally:
        conn.close()


def update_gcs_url(image_id, new_url, blob_name):
    conn = database.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE generated_images
                SET gcs_url = %s, gcs_blob_name = %s
                WHERE id = %s
            """, (new_url, blob_name, image_id))
            conn.commit()
    finally:
        conn.close()


def main():
    rows = get_xai_images()
    total = len(rows)
    print(f"Found {total} images with xAI URLs to migrate to GCS")

    fixed = 0
    failed = 0

    for i, row in enumerate(rows):
        image_id = row['id']
        xai_url = row['gcs_url']
        topic = row['topic'] or ''

        print(f"[{i+1}/{total}] Downloading {image_id} from xAI...")

        image_bytes, ext = _download_bytes(xai_url)
        if image_bytes is None:
            print(f"  FAILED to download (URL may be dead): {xai_url}")
            failed += 1
            continue

        gcs_url, blob_name = _upload_to_gcs(image_bytes, topic, ext)
        if not gcs_url:
            print(f"  FAILED to upload to GCS")
            failed += 1
            continue

        update_gcs_url(image_id, gcs_url, blob_name)
        print(f"  OK -> {gcs_url}")
        fixed += 1

    print(f"\nDone! Fixed: {fixed}, Failed: {failed}, Total: {total}")


if __name__ == "__main__":
    main()
