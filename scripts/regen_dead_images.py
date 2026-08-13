"""Regenerate dead xAI images using prompts from linked session messages.

Run inside the API container:
    python /app/regen_dead_images.py
"""

import json
import re
import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import db as database
from tools.media_tool import generate_from_prompt
from tools.image_store import _download_bytes, _upload_to_gcs


def get_dead_images():
    conn = database.get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT gi.id, gi.topic, gi.capsule_name, gi.learning_session_message_id,
                       lsm.content as msg_content
                FROM generated_images gi
                LEFT JOIN learning_session_messages lsm ON lsm.id = gi.learning_session_message_id
                WHERE gi.gcs_url LIKE '%%imgen.x.ai%%'
                ORDER BY gi.id
            """)
            return cur.fetchall()
    finally:
        conn.close()


def extract_image_prompt(content):
    if not content:
        return None
    match = re.search(r'<EDUCATIONAL_IMAGE>\s*(.*?)\s*</EDUCATIONAL_IMAGE>', content, re.DOTALL)
    if match:
        return match.group(1).strip()
    match = re.search(r'<EDUCATIONAL_IMAGE>\s*(.+)', content, re.DOTALL)
    if match:
        prompt = match.group(1).strip()
        if len(prompt) > 10:
            return prompt
    return None


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
    rows = get_dead_images()
    total = len(rows)
    print(f"Found {total} dead images to regenerate")

    fixed = 0
    skipped = 0
    failed = 0

    for i, row in enumerate(rows):
        image_id = row['id']
        topic = row['topic'] or ''

        prompt = extract_image_prompt(row.get('msg_content', ''))
        if not prompt:
            print(f"[{i+1}/{total}] SKIP {image_id} - no prompt in message (topic: {topic})")
            skipped += 1
            continue

        print(f"[{i+1}/{total}] Regenerating (topic: {topic})")
        print(f"  Prompt: {prompt[:100]}...")

        try:
            result = json.loads(generate_from_prompt(prompt, aspect_ratio="16:9"))
        except Exception as e:
            print(f"  FAILED generate: {e}")
            failed += 1
            time.sleep(2)
            continue

        if not result.get("success"):
            print(f"  FAILED generate: {result.get('error', 'unknown')}")
            failed += 1
            time.sleep(2)
            continue

        image_bytes, ext = _download_bytes(result["image_url"])
        if image_bytes is None:
            print(f"  FAILED download new image")
            failed += 1
            continue

        gcs_url, blob_name = _upload_to_gcs(image_bytes, topic, ext)
        if not gcs_url:
            print(f"  FAILED GCS upload")
            failed += 1
            continue

        update_gcs_url(image_id, gcs_url, blob_name)
        print(f"  OK -> {gcs_url}")
        fixed += 1

        # Rate limit xAI API
        time.sleep(1.5)

    print(f"\nDone! Regenerated: {fixed}, Skipped (no prompt): {skipped}, Failed: {failed}, Total: {total}")


if __name__ == "__main__":
    main()
