from functools import wraps
from urllib.parse import quote
from uuid import UUID

import httpx
from flask import Blueprint, jsonify, request
from discovery.user_data import AuthenticationError, UserData
from .service import (CommerceError, Crossmint, Orders, TERMINAL, checkout_input,
                      public_config, sync_order)
from .demo import change_demo_order, demo_order_input

bp = Blueprint("commerce", __name__, url_prefix="/api/commerce")


def authenticated(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        token = request.headers.get("Authorization", "")
        if not token.startswith("Bearer "):
            return jsonify(error="Sign in to manage checkout.", code="authentication_required"), 401
        account = None
        try:
            account = UserData(token[7:])
            user_id = account.authenticate()
            return fn(user_id, *args, **kwargs)
        except AuthenticationError:
            return jsonify(error="Your session expired. Sign in again.", code="authentication_required"), 401
        except CommerceError as exc:
            return jsonify(error=str(exc), code=exc.code), exc.status
        except (httpx.HTTPError, RuntimeError):
            return jsonify(error="Account service is unavailable. Please try again.", code="account_unavailable"), 503
        finally:
            if account:
                account.close()
    return wrapped


def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise CommerceError("A JSON object is required.")
    if request.content_length and request.content_length > 20000:
        raise CommerceError("Request too large.", 413)
    return data


def uuid(value):
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError):
        raise CommerceError("Invalid request identifier.") from None


@bp.after_request
def private_response(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@bp.get("/config")
@authenticated
def config(user_id):
    return jsonify(public_config())


@bp.get("/orders")
@authenticated
def list_orders(user_id):
    return jsonify(orders=Orders(user_id).list())


@bp.post("/orders")
@authenticated
def create_order(user_id):
    data = body()
    order_id = uuid(data.get("id"))
    item, limit, payload, fingerprint = checkout_input(data)
    if not public_config()["ready"]:
        raise CommerceError("Checkout configuration is incomplete. Open Wallet for setup status.", 503)
    store = Orders(user_id)
    provider = Crossmint(user_id)
    row = store.create({"id": order_id, "item": item, "max_cost": limit,
                        "request_hash": fingerprint, "status": "starting"})
    if row is None:
        try:
            row = store.get(order_id)
        except CommerceError as exc:
            if exc.status != 404:
                raise
            row = store.active_request(fingerprint)
            if row is None:
                raise CommerceError("This checkout is already reserved. Refresh Orders.", 409) from None
        if row["request_hash"] != fingerprint:
            raise CommerceError("This checkout ID already belongs to a different purchase.", 409)
        return jsonify(order=row), 200
    payload["request"]["task"] += f" [ProjectV order reference: {order_id}]"
    try:
        run = provider.call("POST", "/agent-checkouts", payload)
    except CommerceError as exc:
        uncertain = exc.code == "provider_uncertain"
        store.update(order_id, {"status": "unknown" if uncertain else "failed",
                              "reason": "Start confirmation missing; do not start another purchase. Contact support." if uncertain else str(exc)})
        # Never retry a create: Crossmint does not document an idempotency key here.
        raise
    if not run.get("runId"):
        store.update(order_id, {"status": "unknown", "reason": "Missing checkout confirmation. Contact support before retrying."})
        raise CommerceError("Checkout confirmation is missing. Check Orders before starting again.", 502)
    try:
        row = store.update(order_id, {"provider_run_id": run["runId"], "status": run["status"],
                                      "provider_revision": run["revision"]})
    except CommerceError:
        # The reservation exists but attaching the run failed. Stop the run before payment.
        try:
            provider.call("POST", f'/agent-checkouts/{quote(run["runId"], safe="")}/cancel')
        except CommerceError:
            pass
        raise
    return jsonify(order={**row, "run": run}), 201


@bp.post("/demo-orders")
@authenticated
def create_demo_order(user_id):
    data = body()
    order_id = uuid(data.get("id"))
    values = demo_order_input(data, order_id)
    store = Orders(user_id)
    row = store.create(values)
    if row is None:
        row = store.get(order_id)
        if not row.get("is_demo") or row["request_hash"] != values["request_hash"]:
            raise CommerceError("This order ID belongs to a different checkout.", 409)
        # A retry must never revive an order already cancelled or refunded.
        return jsonify(order=row), 200
    return jsonify(order=row), 201


@bp.get("/orders/<order_id>")
@authenticated
def get_order(user_id, order_id):
    store = Orders(user_id)
    row = store.get(uuid(order_id))
    return jsonify(order=row if row.get("is_demo") else sync_order(store, Crossmint(user_id), row))


@bp.post("/orders/<order_id>/cancel")
@authenticated
def cancel_order(user_id, order_id):
    store = Orders(user_id)
    row = store.get(uuid(order_id))
    if row.get("is_demo"):
        return jsonify(order=change_demo_order(store, row, "cancellation"), message="Demo order cancelled. No real order or payment was affected.")
    provider = Crossmint(user_id)
    row = sync_order(store, provider, row)
    if not row.get("provider_run_id"):
        raise CommerceError("The checkout start is not confirmed. Contact support before retrying.", 409)
    if row["status"] in TERMINAL:
        if row["status"] == "cancelled":
            return jsonify(order=row)
        raise CommerceError("This checkout has finished. For a placed order, request cancellation from the merchant.", 409)
    provider.call("POST", f'/agent-checkouts/{quote(row["provider_run_id"], safe="")}/cancel')
    row = store.update(row["id"], {"cancel_requested": True})
    return jsonify(order=row, message="Cancellation requested. Waiting for Crossmint confirmation."), 202


@bp.get("/orders/<order_id>/messages")
@authenticated
def messages(user_id, order_id):
    row = Orders(user_id).get(uuid(order_id))
    if row.get("is_demo") or not row.get("provider_run_id"):
        return jsonify(messages=[])
    cursor = request.args.get("cursor")
    params = {"cursor": cursor} if cursor else None
    return jsonify(Crossmint(user_id).call("GET", f'/agent-checkouts/{quote(row["provider_run_id"], safe="")}/messages', params=params))


@bp.post("/orders/<order_id>/messages")
@authenticated
def respond(user_id, order_id):
    data = body()
    message_id = uuid(data.get("id"))
    store = Orders(user_id)
    row = store.get(uuid(order_id))
    if row.get("is_demo"):
        raise CommerceError("Manage this demo order from Orders.", 409)
    provider = Crossmint(user_id)
    row = sync_order(store, provider, row)
    run = row.get("run") or {}
    if run.get("status") in TERMINAL or not row.get("provider_run_id"):
        raise CommerceError("This checkout is no longer accepting input.", 409)
    action = run.get("requiredAction") or {}
    if data.get("requestId") != action.get("requestId") or not action.get("requestId"):
        raise CommerceError("This request changed. Refresh the checkout before responding.", 409)
    interaction = action["request"]["interaction"]
    kind, decision = interaction["kind"], data.get("action", "submit")
    part = {"type": "input_response", "requestId": action["requestId"], "action": decision}
    if decision == "decline":
        pass
    elif decision == "alternative":
        # A fixed alternative keeps passwords/card details out of free-text messages.
        part["text"] = "Check out as a guest instead."
    elif decision == "submit":
        if kind == "payment":
            intent_id = uuid(data.get("orderIntentId"))
            provider.verify_payment(intent_id, request.headers["Authorization"][7:], interaction, row["max_cost"])
            part["response"] = {"kind": kind, "orderIntentId": intent_id}
        elif kind == "protected":
            part["response"] = {"kind": kind, "protectedInputId": uuid(data.get("protectedInputId"))}
        elif kind == "form":
            values = data.get("values")
            schema = interaction.get("responseSchema") or action["request"].get("responseSchema") or {}
            if not isinstance(values, dict) or set(values) - set(schema.get("properties", {})):
                raise CommerceError("The response does not match the requested fields.")
            # Validate the provider's schema on the server, too.
            from jsonschema import Draft202012Validator, ValidationError, SchemaError
            try:
                Draft202012Validator(schema).validate(values)
            except (ValidationError, SchemaError):
                raise CommerceError("Complete the requested fields with valid values.") from None
            def has_secret_field(value):
                if isinstance(value, dict):
                    return any(any(word in key.lower().replace("_", "").replace("-", "")
                                   for word in ("password", "cvc", "cvv", "cardnumber"))
                               or has_secret_field(child) for key, child in value.items())
                return isinstance(value, list) and any(has_secret_field(child) for child in value)
            if has_secret_field(values):
                raise CommerceError("Sensitive payment and password fields must use Crossmint's secure form.")
            part["response"] = {"kind": kind, "values": values}
        else:
            raise CommerceError("Unsupported checkout request.")
    else:
        raise CommerceError("Invalid response action.")
    result = provider.call("POST", f'/agent-checkouts/{quote(row["provider_run_id"], safe="")}/messages',
                           {"id": message_id, "parts": [part]})
    return jsonify(result), 202


@bp.post("/orders/<order_id>/service-request")
@authenticated
def service_request(user_id, order_id):
    data = body()
    kind = data.get("kind")
    if kind not in ("refund", "cancellation"):
        raise CommerceError("Choose refund or cancellation.")
    store = Orders(user_id)
    row = store.get(uuid(order_id))
    if row.get("is_demo"):
        updated = change_demo_order(store, row, kind)
        return jsonify(order=updated, message="Demo refund completed. No real money moved." if kind == "refund" else "Demo order cancelled. No real order or payment was affected.")
    provider = Crossmint(user_id)
    row = sync_order(store, provider, row)
    if row["status"] != "succeeded":
        raise CommerceError("Merchant requests are available after a purchase is confirmed.", 409)
    row = store.update(row["id"], {"service_request": {"kind": kind, "status": "needs_merchant_action"}})
    return jsonify(order=row, message="Saved. Open the merchant to submit your request. Approval and timing depend on the merchant.")
