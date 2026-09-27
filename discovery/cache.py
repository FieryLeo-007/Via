"""Discovery-result cache. CLAUDE.md specifies a Postgres table (sha256 key, 6h TTL);
for this pass it's local SQLite behind the same key/TTL contract so swapping the
backend later doesn't touch any call site."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Optional, Protocol

DEFAULT_TTL_SECONDS = 6 * 60 * 60
DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "var" / "discovery_cache.sqlite3"


class CacheStore(Protocol):
    def get(self, key: str) -> Optional[dict]: ...
    def set(self, key: str, value: dict, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> None: ...


def make_cache_key(provider: str, params: dict) -> str:
    canonical = json.dumps({"provider": provider, "params": params}, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class SqliteCache:
    def __init__(self, path: Path | str = DEFAULT_DB_PATH):
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS cache ("
                "key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at REAL NOT NULL)"
            )

    @contextmanager
    def _connect(self):
        # sqlite's own context manager commits, but does NOT close the handle.
        # Explicit closure matters on Windows and under concurrent Discover loads.
        conn = sqlite3.connect(self._path, timeout=10)
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def get(self, key: str) -> Optional[dict]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT value, expires_at FROM cache WHERE key = ?", (key,)
            ).fetchone()
        if row is None:
            return None
        value, expires_at = row
        if expires_at < time.time():
            self._delete(key)
            return None
        return json.loads(value)

    def set(self, key: str, value: dict, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> None:
        expires_at = time.time() + ttl_seconds
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
                (key, json.dumps(value), expires_at),
            )

    def _delete(self, key: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM cache WHERE key = ?", (key,))
