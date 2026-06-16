FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY . .

RUN DJANGO_SETTINGS_MODULE=note_keeper.settings \
    uv run python manage.py collectstatic --noinput

EXPOSE 8080

CMD uv run gunicorn note_keeper.wsgi --bind 0.0.0.0:${PORT:-8080} --workers 2 --timeout 120
