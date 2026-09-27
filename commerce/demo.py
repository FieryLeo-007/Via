"""Persisted simulations. This module never invokes a payment provider."""
import hashlib
import json
from datetime import datetime, timezone
from decimal import Decimal

from .service import CommerceError, https_url, money


def demo_order_input(data, order_id):
    if data.get("consent") is not True:
        raise CommerceError("Approve this demo purchase before saving it.")
    items = data.get("items")
    if not isinstance(items, list) or not 1 <= len(items) <= 50:
        raise CommerceError("Choose between 1 and 50 demo products.")
    clean = []
    for item in items:
        if not isinstance(item, dict):
            raise CommerceError("Invalid demo product.")
        title, price, quantity = item.get("title"), item.get("price_cents"), item.get("quantity")
        if (not isinstance(title, str) or not title.strip() or len(title) > 500
                or type(price) is not int or not 1 <= price <= 10000000
                or type(quantity) is not int or not 1 <= quantity <= 100):
            raise CommerceError("Demo products need a title, a positive price in cents, and a quantity from 1 to 100.")
        # IDs are opaque cart keys, not display text. Truncation breaks matching
        # for Google Shopping IDs and can merge distinct products. The request
        # body limit already bounds their size.
        product = {"id": str(item.get("id", "")), "title": title.strip(),
                   "price_cents": price, "quantity": quantity,
                   "store_name": str(item.get("store_name") or "Demo store")[:200]}
        if item.get("image_url"):
            try:
                product["image_url"] = https_url(item["image_url"])
            except CommerceError:
                pass
        clean.append(product)
    shipping = data.get("shipping")
    if shipping not in ("standard", "express"):
        raise CommerceError("Choose standard or express demo shipping.")
    limit = money(data.get("maxCost"))
    subtotal = sum(item["price_cents"] * item["quantity"] for item in clean)
    tax, delivery = (subtotal * 8 + 50) // 100, 1295 if shipping == "express" else 0
    total = subtotal + tax + delivery
    if total > int(Decimal(limit) * 100):
        raise CommerceError("The demo total exceeds your approved spending limit.")
    fingerprint = "demo:" + hashlib.sha256(json.dumps({"items": clean, "shipping": shipping, "limit": limit}, sort_keys=True).encode()).hexdigest()
    count = sum(item["quantity"] for item in clean)
    summary = clean[0] if len(clean) == 1 else {"id": order_id, "title": f'{clean[0]["title"]} + {len(clean) - 1} more',
        "quantity": count, "store_name": "Multiple stores" if len({i["store_name"] for i in clean}) > 1 else clean[0]["store_name"],
        "image_url": clean[0].get("image_url")}
    return {"id": order_id, "is_demo": True, "status": "succeeded", "item": summary,
        "max_cost": limit, "request_hash": fingerprint,
        "result": {"summary": "Demo purchase complete. No payment was made or merchant order placed.",
            "items": clean, "shipping": shipping, "subtotal_cents": subtotal, "tax_cents": tax, "shipping_cents": delivery,
            "purchase": {"kind": "demo_receipt", "receipt": {"merchantOrderId": f"DEMO-{order_id[:8].upper()}",
                "total": {"amount": format(Decimal(total) / 100, ".2f"), "currency": "USD"}}}}}


def change_demo_order(store, row, kind):
    target = "refunded" if kind == "refund" else "cancelled"
    if row["status"] == target:
        return row
    if row["status"] != "succeeded":
        raise CommerceError("This demo order has already been cancelled or refunded. Refresh Orders to see its status.", 409)
    request = {"kind": kind, "status": "simulated", "completed_at": datetime.now(timezone.utc).isoformat(),
               "amount": row["result"]["purchase"]["receipt"]["total"]["amount"], "currency": "USD"}
    updated = store.update(row["id"], {"status": target, "service_request": request}, expected_status="succeeded")
    if updated["status"] != target:
        raise CommerceError("This demo order changed while your request was being processed. Refresh Orders.", 409)
    return updated
