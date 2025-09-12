### Anki .apkg Flashcard Viewer (Local)

This is a minimal Flask web app (files: `app.py`, `static/`) to upload and study Anki `.apkg`/`.colpkg` files locally. It extracts the package, reads the SQLite collection, and serves a simple browser UI to pick a deck and flip through cards. Embedded media is resolved through the package's `media` map.

### Features

- Upload `.apkg`/`.colpkg`
- List decks with card counts
- Show front/back fields for cards
- Render images and play audio (including `[sound:...]` syntax)

### Requirements

- Python 3.9+

### Run locally

Option A: Virtual environment (recommended)

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

Option B: System Python (if venv unavailable)

```bash
python -m pip install --break-system-packages -r requirements.txt
python app.py
```

Then open `http://localhost:8000/`.

### Notes

- Uploads are stored in `uploads/` using a random `uploadId`. In-memory registry means a server restart clears uploaded state.
- Notes fields come from `notes.flds` split by the unit separator (\x1f). The viewer uses field[0] for front and field[1] (or remaining joined) for back.
- Scheduling/reviews are not implemented; this is a simple flip-and-browse viewer.

### Security

- ZIP extraction uses normalized paths to prevent traversal.
- Intended for local use only. Do not deploy publicly without hardening.

