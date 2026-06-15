# NoteKeeper

A personal markdown note-taking app with a split editor and live preview. Built with Django 5 and CodeMirror 6.

## Features

- Three-column layout: note list | markdown editor | live preview
- Auto-save with 1s debounce
- Syntax-highlighted code blocks via highlight.js
- Light and dark mode (persisted across sessions)
- Markdown formatting toolbar
- Publish notes to a public shareable link
- Full-text search across note titles

## Stack

- **Backend**: Django 5.2, SQLite (dev) / PostgreSQL (prod)
- **Editor**: CodeMirror 6 (ES modules via importmap)
- **Markdown**: marked.js v12
- **Syntax highlighting**: highlight.js v11

## Local setup

```bash
# Clone and create a virtual environment
git clone <repo-url>
cd note-keeper

python -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt

# Run migrations and start the server
cd note_keeper
python manage.py migrate
python manage.py runserver
```

Visit `http://localhost:8000` — you'll be redirected to register/login.

## Project structure

```
note_keeper/
├── note_keeper/        # Django configuration (settings, urls, wsgi)
│   ├── settings/
│   │   ├── base.py     # Shared settings
│   │   └── production.py
│   ├── static/
│   │   ├── css/app.css
│   │   └── js/editor.js
│   └── templates/
│       ├── editor.html
│       ├── public_note.html
│       └── registration/
└── notes/              # Notes app (models, views, urls)
    └── migrations/
```

## Production deployment

Set the following environment variables:

| Variable | Description |
|---|---|
| `SECRET_KEY` | Django secret key |
| `DATABASE_URL` | PostgreSQL connection string (optional) |

Use `note_keeper/settings/production.py` which sets `FORCE_SCRIPT_NAME = '/notekeeper'` for subdirectory hosting at `yourdomain.com/notekeeper`.
