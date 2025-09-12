import json
import os
import shutil
import sqlite3
import tempfile
import uuid
import zipfile
from typing import Dict, List, Optional, Tuple

from flask import Flask, jsonify, request, send_file, send_from_directory, abort


app = Flask(
    __name__,
    static_folder="static",
    static_url_path="/",
)


# App configuration
UPLOADS_ROOT = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOADS_ROOT, exist_ok=True)

app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024 * 500  # 500 MB


class UploadedPackage:
    """Holds metadata about an extracted .apkg package."""

    def __init__(
        self,
        upload_id: str,
        extract_dir: str,
        db_path: str,
        media_num_to_name: Dict[str, str],
        deck_id_to_name: Dict[int, str],
    ) -> None:
        self.upload_id = upload_id
        self.extract_dir = extract_dir
        self.db_path = db_path
        self.media_num_to_name = media_num_to_name
        # Reverse mapping for quick lookup by filename
        self.media_name_to_num = {v: k for k, v in media_num_to_name.items()}
        self.deck_id_to_name = deck_id_to_name


# In-memory registry for uploaded packages (ephemeral; resets on server restart)
UPLOADED: Dict[str, UploadedPackage] = {}


def secure_extract_zip(zip_path: str, dest_dir: str) -> None:
    """
    Safely extract a ZIP file to dest_dir without allowing path traversal.
    """
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.infolist():
            # Normalize the target path
            extracted_path = os.path.normpath(os.path.join(dest_dir, member.filename))
            if not extracted_path.startswith(os.path.abspath(dest_dir)):
                # Skip suspicious paths
                continue
            # Create directories as needed
            if member.is_dir():
                os.makedirs(extracted_path, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(extracted_path), exist_ok=True)
            with zf.open(member, "r") as src, open(extracted_path, "wb") as dst:
                shutil.copyfileobj(src, dst)


def find_collection_db_path(extract_dir: str) -> Optional[str]:
    """Return path to Anki collection SQLite DB inside an extracted package."""
    candidates = [
        os.path.join(extract_dir, "collection.anki21"),
        os.path.join(extract_dir, "collection.anki2"),
        os.path.join(extract_dir, "collection.sqlite"),
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    # Fallback: search for .anki2* anywhere (defensive)
    for root, _dirs, files in os.walk(extract_dir):
        for name in files:
            if name.startswith("collection.anki2") or name.startswith("collection.anki21"):
                return os.path.join(root, name)
    return None


def parse_media_mapping(extract_dir: str) -> Dict[str, str]:
    """
    Parse the media mapping from the "media" JSON file in the extracted package.
    Returns a mapping of numeric-string -> filename, e.g. {"0": "img.png"}.
    """
    media_json_path = os.path.join(extract_dir, "media")
    if not os.path.exists(media_json_path):
        return {}
    try:
        with open(media_json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        # Ensure keys are strings and values are strings
        return {str(k): str(v) for k, v in data.items()}
    except Exception:
        return {}


def open_sqlite(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def load_deck_names(conn: sqlite3.Connection) -> Dict[int, str]:
    """
    Anki stores deck definitions in the `col.decks` JSON field (even on modern schemas).
    This function returns a mapping from deck_id to deck_name.
    """
    try:
        cur = conn.execute("SELECT decks FROM col LIMIT 1")
        row = cur.fetchone()
        if not row:
            return {}
        decks_json = row[0]
        decks = json.loads(decks_json) if isinstance(decks_json, str) else decks_json
        result: Dict[int, str] = {}
        for deck_id_str, deck_obj in decks.items():
            try:
                deck_id_int = int(deck_id_str)
            except Exception:
                # Some schemas may already have integer keys
                try:
                    deck_id_int = int(deck_id_str)  # Will still raise
                except Exception:
                    continue
            name = deck_obj.get("name") if isinstance(deck_obj, dict) else None
            if name:
                result[deck_id_int] = name
        return result
    except Exception:
        return {}


def compute_deck_counts(conn: sqlite3.Connection) -> Dict[int, int]:
    """Return a mapping of deck_id -> card_count."""
    counts: Dict[int, int] = {}
    try:
        for row in conn.execute("SELECT did, COUNT(*) as cnt FROM cards GROUP BY did"):
            counts[int(row[0])] = int(row[1])
    except Exception:
        pass
    return counts


def extract_apkg_to_upload(apkg_path: str) -> UploadedPackage:
    upload_id = str(uuid.uuid4())
    dest_dir = os.path.join(UPLOADS_ROOT, upload_id)
    os.makedirs(dest_dir, exist_ok=True)

    secure_extract_zip(apkg_path, dest_dir)
    db_path = find_collection_db_path(dest_dir)
    if not db_path:
        # Clean up on failure
        shutil.rmtree(dest_dir, ignore_errors=True)
        raise ValueError("Could not find Anki collection database inside package.")

    media_map = parse_media_mapping(dest_dir)

    with open_sqlite(db_path) as conn:
        deck_names = load_deck_names(conn)

    uploaded = UploadedPackage(
        upload_id=upload_id,
        extract_dir=dest_dir,
        db_path=db_path,
        media_num_to_name=media_map,
        deck_id_to_name=deck_names,
    )
    UPLOADED[upload_id] = uploaded
    return uploaded


def get_uploaded(upload_id: str) -> UploadedPackage:
    pkg = UPLOADED.get(upload_id)
    if not pkg:
        abort(404, description="Upload not found")
    return pkg


def list_decks(upload_id: str) -> List[Dict[str, object]]:
    pkg = get_uploaded(upload_id)
    with open_sqlite(pkg.db_path) as conn:
        deck_counts = compute_deck_counts(conn)
    result: List[Dict[str, object]] = []
    for deck_id, name in pkg.deck_id_to_name.items():
        result.append(
            {
                "id": deck_id,
                "name": name,
                "cardCount": deck_counts.get(deck_id, 0),
            }
        )
    # Sort by name for stable UI
    result.sort(key=lambda d: str(d.get("name", "")))
    return result


def fetch_cards_for_deck(upload_id: str, deck_id: int) -> List[Dict[str, object]]:
    pkg = get_uploaded(upload_id)
    with open_sqlite(pkg.db_path) as conn:
        cur = conn.execute(
            """
            SELECT
              c.id AS card_id,
              n.id AS note_id,
              n.flds AS fields,
              n.tags AS tags,
              c.ord AS ord
            FROM cards c
            JOIN notes n ON n.id = c.nid
            WHERE c.did = ?
            ORDER BY c.id
            """,
            (deck_id,),
        )
        rows = cur.fetchall()

    cards: List[Dict[str, object]] = []
    for row in rows:
        fields_raw: str = row["fields"] if isinstance(row["fields"], str) else ""
        field_values = fields_raw.split("\x1f") if fields_raw else []
        front = field_values[0] if len(field_values) >= 1 else ""
        if len(field_values) >= 2:
            back = field_values[1]
        elif len(field_values) > 2:
            back = " ".join(field_values[1:])
        else:
            back = ""

        cards.append(
            {
                "id": int(row["card_id"]),
                "noteId": int(row["note_id"]),
                "ord": int(row["ord"]) if row["ord"] is not None else 0,
                "front": front,
                "back": back,
                "tags": (row["tags"] or "").strip(),
            }
        )
    return cards


@app.route("/api/upload", methods=["POST"])
def api_upload():
    if "file" not in request.files:
        return jsonify({"error": "No file provided under 'file'"}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "Empty filename"}), 400
    filename_lower = file.filename.lower()
    if not (filename_lower.endswith(".apkg") or filename_lower.endswith(".colpkg")):
        return jsonify({"error": "Unsupported file type. Please upload an .apkg/.colpkg"}), 400

    # Save to a temp file first
    with tempfile.NamedTemporaryFile(delete=False, suffix=".apkg") as tmp:
        file.save(tmp.name)
        temp_path = tmp.name

    try:
        uploaded = extract_apkg_to_upload(temp_path)
    except Exception as e:
        os.unlink(temp_path)
        return jsonify({"error": str(e)}), 400
    finally:
        # Remove temp file regardless of success/failure; we extracted already
        try:
            os.unlink(temp_path)
        except Exception:
            pass

    return jsonify({
        "uploadId": uploaded.upload_id,
        "decks": list_decks(uploaded.upload_id),
    })


@app.route("/api/<upload_id>/decks", methods=["GET"])
def api_list_decks(upload_id: str):
    return jsonify(list_decks(upload_id))


@app.route("/api/<upload_id>/decks/<int:deck_id>/cards", methods=["GET"])
def api_get_deck_cards(upload_id: str, deck_id: int):
    return jsonify(fetch_cards_for_deck(upload_id, deck_id))


@app.route("/media/<upload_id>/<path:filename>")
def serve_media(upload_id: str, filename: str):
    pkg = get_uploaded(upload_id)

    # Anki note content refers to media by declared filename (e.g., "image.png").
    # In the .apkg package, the actual file is usually stored with a numeric name (e.g., "0").
    num = pkg.media_name_to_num.get(filename)
    if num is None:
        # If not found, try direct file access by filename as a fallback (rare but safe)
        direct_path = os.path.join(pkg.extract_dir, filename)
        if os.path.exists(direct_path):
            return send_file(direct_path)
        abort(404)

    numeric_path = os.path.join(pkg.extract_dir, str(num))
    if not os.path.exists(numeric_path):
        abort(404)
    return send_file(numeric_path)


@app.route("/")
def index():
    # Serve the static index.html
    return app.send_static_file("index.html")


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port, debug=True)


if __name__ == "__main__":
    main()

