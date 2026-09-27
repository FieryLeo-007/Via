"""Request-scoped, RLS-respecting Supabase access. Never uses a service key."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import logging
import os
from pathlib import Path
from uuid import UUID

import httpx
from dotenv import dotenv_values

log = logging.getLogger(__name__)


class AuthenticationError(Exception):
    pass


class UserData:
    def __init__(self, token, *, client=None):
        config = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
        setting = lambda key: (os.getenv(key) or config.get(key) or "").strip()
        self.url = setting("SUPABASE_URL").rstrip("/").removesuffix("/rest/v1")
        key = setting("SUPABASE_PUBLISHABLE_KEY") or setting("SUPABASE_ANON_KEY")
        if not self.url or not key:
            raise RuntimeError("Account service unavailable")
        self.client = client or httpx.Client(timeout=8, headers={
            "apikey": key, "Authorization": f"Bearer {token}",
        })
        self.user_id = None

    def authenticate(self):
        response = self.client.get(f"{self.url}/auth/v1/user")
        if response.status_code in (401, 403):
            raise AuthenticationError("Please sign in again")
        response.raise_for_status()
        try:
            self.user_id = str(UUID(response.json()["id"]))
        except (KeyError, ValueError, TypeError) as exc:
            raise AuthenticationError("Invalid account") from exc
        return self.user_id

    def rows(self, table, params):
        response = self.client.get(f"{self.url}/rest/v1/{table}", params=params)
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, list):
            raise ValueError("Expected rows")
        return data

    def load(self):
        if not self.user_id:
            raise AuthenticationError("Authentication required")
        since = (datetime.now(timezone.utc) - timedelta(days=180)).isoformat()
        specs = {
            "onboarding_preferences": (100, "category,preference_key,preference_value,importance,created_at,updated_at"),
            "user_preferences": (100, "category,preference_key,preference_value,importance,created_at,updated_at"),
            "user_events": (600, "event_type,event_weight,category,product_data,created_at"),
            "impressions": (40, "event_type,event_weight,category,product_data,created_at"),
            "search_sessions": (40, "id,query,category,parsed_intent,created_at"),
            "recommendation_sessions": (20, "id,created_at"),
            "chat_turns": (20, "id,query,intent,products,created_at"),
            "saved_products": (80, "product_key,product_data,created_at"),
        }
        def fetch(item):
            table, (limit, select) = item
            params = {"select": select, "user_id": f"eq.{self.user_id}",
                      "order": "created_at.desc", "limit": str(limit)}
            if table in ("user_events", "search_sessions", "chat_turns"):
                params["created_at"] = f"gte.{since}"
            actual_table = table
            if table == "user_events":
                params["event_type"] = "neq.impression"
            elif table == "impressions":
                actual_table = "user_events"
                params["event_type"] = "eq.impression"
                params["created_at"] = f"gte.{since}"
            elif table == "search_sessions":
                params["or"] = "(parsed_intent->>source.is.null,parsed_intent->>source.neq.discover)"
            elif table == "recommendation_sessions":
                actual_table = "search_sessions"
            try:
                return table, self.rows(actual_table, params), False
            except (httpx.HTTPError, ValueError):
                log.warning("Discover could not load %s", table)
                return table, [], True
        data, unavailable = {}, []
        with ThreadPoolExecutor(max_workers=4) as pool:
            for table, rows, failed in pool.map(fetch, specs.items()):
                data[table] = rows
                if failed:
                    unavailable.append(table)
        # recommendation_results has no user_id: only query verified owned sessions.
        data["user_events"].extend(data.pop("impressions"))
        ids = [str(UUID(row["id"])) for row in data.pop("recommendation_sessions") if row.get("id")]
        data["recommendation_results"] = []
        if ids:
            try:
                data["recommendation_results"] = self.rows("recommendation_results", {
                    "select": "product_id,product_data,created_at,final_score",
                    "search_session_id": f"in.({','.join(ids)})", "order": "created_at.desc", "limit": "160",
                })
            except (httpx.HTTPError, ValueError):
                unavailable.append("recommendation_results")
        return data, unavailable

    def load_discover_feed(self):
        """A missing row is a cache miss; a database error must not trigger search."""
        if not self.user_id:
            raise AuthenticationError("Authentication required")
        rows = self.rows("discover_feeds", {
            "select": "payload,updated_at", "user_id": f"eq.{self.user_id}", "limit": "1",
        })
        return rows[0] if rows else None

    def save_discover_feed(self, payload):
        """Persist the complete display snapshot before reporting a successful load."""
        if not self.user_id:
            raise AuthenticationError("Authentication required")
        response = self.client.post(f"{self.url}/rest/v1/discover_feeds",
            params={"on_conflict": "user_id"},
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            json={"user_id": self.user_id, "payload": payload,
                  "updated_at": datetime.now(timezone.utc).isoformat()})
        response.raise_for_status()

    def remember(self, sections):
        """Record real recommendations; failed history writes never fail shopping."""
        products = [p for section in sections for p in section["products"]]
        if not products:
            return
        try:
            response = self.client.post(f"{self.url}/rest/v1/search_sessions", headers={"Prefer": "return=representation"}, json={
                "user_id": self.user_id, "query": "Discover recommendations",
                "parsed_intent": {"source": "discover"},
            })
            response.raise_for_status()
            session = response.json()[0]["id"]
            response = self.client.post(f"{self.url}/rest/v1/recommendation_results", json=[{
                "search_session_id": session, "product_id": p["id"], "product_data": p,
                "rank": index + 1, "final_score": p.get("score", 0),
            } for index, p in enumerate(products)])
            response.raise_for_status()
        except (httpx.HTTPError, ValueError, KeyError, IndexError):
            log.warning("Discover recommendation history could not be saved")

    def close(self):
        self.client.close()
