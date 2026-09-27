"""Provider and persistence boundaries. No card numbers or CVCs enter this module."""
import hashlib
import ipaddress
import json
import os
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx
from dotenv import dotenv_values

TERMINAL = {"succeeded", "blocked", "failed", "cancelled", "refunded"}
BASE = "https://www.crossmint.com/api/unstable"


class CommerceError(Exception):
    def __init__(self, message, status=400, code="checkout_error"):
        super().__init__(message)
        self.status, self.code = status, code


def settings():
    local = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
    def get(*names):
        return next((str(os.getenv(n) or local.get(n) or "").strip() for n in names
                     if os.getenv(n) or local.get(n)), "")
    return {
        "server": get("CROSSMINT_SERVER_API_KEY", "CROSSMINT_SERVER_SIDE"),
        # Keep compatibility with the existing .env spelling.
        "client": get("CROSSMINT_CLIENT_API_KEY", "CROSSMINT_CLIENT_SIDE", "CORSSMINT_CLIENT_SIDE"),
        "database_key": get("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"),
        "database_url": get("SUPABASE_URL").rstrip("/").removesuffix("/rest/v1"),
    }


def public_config():
    config = settings()
    missing = [name for name, key in (("Crossmint server key", "server"),
               ("Crossmint client key", "client"), ("Supabase server key", "database_key")) if not config[key]]
    client = config["client"]
    if config["server"] and not config["server"].startswith("sk_production_"):
        missing.append("production Crossmint server key")
    if client and not client.startswith("ck_production_"):
        missing.append("production Crossmint client-side key")
        client = ""
    return {"clientKey": client, "ready": not missing, "missing": missing,
            "environment": "production"}


def https_url(value):
    try:
        url = urlsplit(str(value))
        host = (url.hostname or "").lower()
        if url.scheme != "https" or not host or url.username or url.password or url.port not in (None, 443):
            raise ValueError()
        if "." not in host or host.endswith((".local", ".localhost", ".internal", ".test")):
            raise ValueError()
        try:
            ip = ipaddress.ip_address(host)
        except ValueError:
            ip = None
        if ip is not None:
            raise ValueError()
        return url._replace(fragment="").geturl()
    except (ValueError, TypeError):
        raise CommerceError("Choose a product with a public HTTPS store URL.") from None


def money(value):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount <= 0 or amount > 100000 or amount != amount.quantize(Decimal(".01")):
            raise ValueError()
        return format(amount, ".2f")
    except (InvalidOperation, ValueError, TypeError):
        raise CommerceError("Enter a spending limit from $0.01 to $100,000, with at most two decimals.") from None


def checkout_input(data):
    if data.get("consent") is not True:
        raise CommerceError("Confirm the product and spending limit before starting checkout.")
    item = data.get("item")
    if not isinstance(item, dict):
        raise CommerceError("Select a cart product.")
    quantity = item.get("quantity", 1)
    if type(quantity) is not int or not 1 <= quantity <= 99:
        raise CommerceError("Quantity must be between 1 and 99.")
    title = str(item.get("title", "")).strip()[:500]
    if not title:
        raise CommerceError("The product must have a title.")
    url = https_url(item.get("product_page_url") or item.get("merchant_url"))
    # Preserve the opaque cart key exactly; provider IDs can exceed 200 chars.
    clean = {"id": str(item.get("id", "")), "title": title, "quantity": quantity,
             "product_page_url": url, "store_name": urlsplit(url).hostname}
    if item.get("image_url"):
        try:
            clean["image_url"] = https_url(item["image_url"])
        except CommerceError:
            pass
    limit = money(data.get("maxCost"))
    instructions = str(data.get("instructions", "")).strip()[:2000]
    task = (f"Buy exactly {quantity} of the product at the starting URL. Product label: {title}. "
            "Pay by card using a Crossmint Agent Card. Use standard shipping and guest checkout when possible. "
            "Ask the buyer for delivery details and any missing product options. Do not substitute products, "
            "add subscriptions, or purchase extras. The spending cap includes all taxes, shipping and fees.")
    if instructions:
        task += f" Buyer preferences: {instructions}"
    payload = {"request": {"startUrl": url, "task": task},
               "constraints": {"maxCost": {"amount": limit, "currency": "USD"}}}
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    return clean, limit, payload, fingerprint


class Crossmint:
    def __init__(self, user_id):
        key = settings()["server"]
        if not key:
            raise CommerceError("Crossmint checkout is not configured.", 503)
        self.headers = {"X-API-KEY": key, "x-crossmint-user-id": user_id}

    def verify_payment(self, intent_id, token, interaction, limit):
        """The user's JWT makes Crossmint enforce saved-card ownership as well."""
        try:
            response = httpx.get(f"{BASE}/order-intents/{intent_id}", headers={
                "X-API-KEY": settings()["client"], "Authorization": f"Bearer {token}"
            }, timeout=15)
            response.raise_for_status()
            intent = response.json()
            amount = intent["amount"]
            expected = interaction["amount"]
            if (intent["status"] != "active" or amount["currency"] != expected["currency"]
                    or amount["currency"] != "USD"
                    or Decimal(amount["total"]) != Decimal(expected["value"])
                    or Decimal(amount["total"]) > Decimal(str(limit))
                    or Decimal(amount["total"]) <= 0
                    or datetime.fromisoformat(intent["expiresAt"].replace("Z", "+00:00")) <= datetime.now(timezone.utc)
                    or not any(r["status"] == "active" and "card" in r.get("credentialFormats", []) for r in intent["rails"])):
                raise ValueError()
        except (httpx.HTTPError, KeyError, TypeError, ValueError, InvalidOperation):
            raise CommerceError("Payment authorization is not ready, has expired, or does not match this purchase. Verify the card and amount again.", 409) from None

    def call(self, method, path, body=None, params=None):
        try:
            response = httpx.request(method, f"{BASE}{path}", headers=self.headers,
                                     json=body, params=params, timeout=35)
        except httpx.HTTPError:
            raise CommerceError("Crossmint did not confirm the request. Refresh this order before trying again.",
                                502, "provider_uncertain") from None
        if not response.is_success:
            status = response.status_code
            if status in (401, 403):
                raise CommerceError("Crossmint rejected access. Check production keys, API scopes and user authentication.", 503, "provider_access")
            if status == 429:
                raise CommerceError("Crossmint is busy. Wait a moment and refresh this order.", 429, "provider_busy")
            raise CommerceError("Crossmint could not accept this request. Refresh the order to check its current status.",
                                502 if status >= 500 else 409, "provider_uncertain" if status >= 500 else "provider_rejected")
        if response.status_code == 204 or not response.content:
            return {}
        try:
            return response.json()
        except ValueError:
            raise CommerceError("Crossmint returned an unreadable response. Refresh this order.", 502, "provider_uncertain") from None


class Orders:
    """Service-only writes; all reads and writes are additionally scoped to a verified user."""
    def __init__(self, user_id):
        config = settings()
        if not config["database_key"]:
            raise CommerceError("Order storage needs the Supabase server key before checkout can start.", 503)
        self.user_id = user_id
        self.url = f'{config["database_url"]}/rest/v1/checkout_orders'
        self.headers = {"apikey": config["database_key"], "Authorization": f'Bearer {config["database_key"]}',
                        "Prefer": "return=representation"}

    def call(self, method, params=None, body=None):
        query = {"user_id": f"eq.{self.user_id}", **(params or {})}
        try:
            response = httpx.request(method, self.url, headers=self.headers, params=query, json=body, timeout=12)
            if response.status_code == 409:
                return None
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise CommerceError("Order storage is temporarily unavailable. No new purchase will be started until it is available.", 503, "storage_unavailable") from None

    def list(self):
        return self.call("GET", {"order": "created_at.desc", "limit": "100"})

    def get(self, order_id):
        rows = self.call("GET", {"id": f"eq.{order_id}", "limit": "1"})
        if not rows:
            raise CommerceError("Order not found.", 404)
        return rows[0]

    def create(self, row):
        result = self.call("POST", body={**row, "user_id": self.user_id})
        return result[0] if result else None

    def active_request(self, fingerprint):
        rows = self.call("GET", {"request_hash": f"eq.{fingerprint}",
                                 "status": "not.in.(succeeded,blocked,failed,cancelled)", "limit": "1"})
        return rows[0] if rows else None

    def update(self, order_id, values, *, revision=None, expected_status=None):
        params = {"id": f"eq.{order_id}"}
        if revision is not None:
            params["provider_revision"] = f"lt.{revision}"
        if expected_status is not None:
            params["status"] = f"eq.{expected_status}"
        rows = self.call("PATCH", params, {**values, "updated_at": datetime.now(timezone.utc).isoformat()})
        return rows[0] if rows else self.get(order_id)


def sync_order(store, provider, row):
    if row.get("is_demo"):
        return row
    if not row.get("provider_run_id"):
        # Recover a lost create response using the stable reference in the provider's
        # persisted input. Never POST a second run after an ambiguous timeout.
        if row["status"] not in ("starting", "unknown"):
            return row
        created = row.get("created_at")
        if created and (datetime.now(timezone.utc) - datetime.fromisoformat(created.replace("Z", "+00:00"))).total_seconds() < 60:
            return row
        marker = f'[ProjectV order reference: {row["id"]}]'
        cursor = None
        for _ in range(10):
            page = provider.call("GET", "/agent-checkouts", params={"limit": 100, **({"cursor": cursor} if cursor else {})})
            match = next((run for run in page.get("data", [])
                          if run.get("input", {}).get("request", {}).get("task", "").endswith(marker)), None)
            if match:
                row = store.update(row["id"], {"provider_run_id": match["runId"]})
                break
            cursor = page.get("nextCursor")
            if not cursor:
                return row
        if not row.get("provider_run_id"):
            return row
    run = provider.call("GET", f'/agent-checkouts/{quote(row["provider_run_id"], safe="")}')
    # Store only safe order metadata, not browser URLs, messages, shipping forms, or authorizations.
    values = {"status": run["status"], "provider_revision": run["revision"],
              "result": run.get("result") or {}, "reason": run.get("reason"),
              "provider_run_id": run["runId"]}
    row = store.update(row["id"], values, revision=run["revision"])
    return {**row, "run": run}
