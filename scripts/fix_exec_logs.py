"""Fix execution_log entries where image URLs were replaced with [image-regenerated].

Maps each placeholder back to the correct GCS URL using message timestamps.
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db as database


def main():
    conn = database.get_conn()
    try:
        with conn.cursor() as cur:
            # Get affected sessions
            cur.execute("""
                SELECT id, execution_log
                FROM learning_sessions
                WHERE execution_log::text LIKE '%%image-regenerated%%'
            """)
            sessions = cur.fetchall()
            print(f"Found {len(sessions)} sessions with placeholders")

            for session in sessions:
                sid = session['id']
                log = session['execution_log']
                if isinstance(log, str):
                    log = json.loads(log)

                # Get GCS URLs for this session ordered by image creation time
                cur.execute("""
                    SELECT gi.gcs_url, gi.created_date
                    FROM generated_images gi
                    JOIN learning_session_messages lsm ON lsm.id = gi.learning_session_message_id
                    WHERE lsm.learning_session_id = %s
                    ORDER BY gi.created_date
                """, (sid,))
                gcs_rows = cur.fetchall()
                gcs_urls = [r['gcs_url'] for r in gcs_rows]

                # Find placeholders in log order and replace
                url_idx = 0
                fixed = 0
                for entry in log:
                    if not isinstance(entry, dict):
                        continue
                    details = entry.get('details', {})
                    if not isinstance(details, dict):
                        continue
                    if details.get('image_url') == '[image-regenerated]':
                        if url_idx < len(gcs_urls):
                            details['image_url'] = gcs_urls[url_idx]
                            url_idx += 1
                            fixed += 1
                        else:
                            print(f"  WARNING: ran out of GCS URLs for session {sid}")

                print(f"  Session {sid}: replaced {fixed} placeholders with {len(gcs_urls)} available URLs")

                # Write back
                cur.execute("""
                    UPDATE learning_sessions
                    SET execution_log = %s::json
                    WHERE id = %s
                """, (json.dumps(log), sid))

            conn.commit()
            print("Done!")

            # Verify
            cur.execute("SELECT count(*) as remaining FROM learning_sessions WHERE execution_log::text LIKE '%%image-regenerated%%'")
            r = cur.fetchone()
            print(f"Remaining placeholders: {r['remaining']}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
