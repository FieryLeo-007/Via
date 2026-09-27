"""WebAuthn ceremonies. Only public keys and single-use challenges are stored."""
import json
import ipaddress
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
from flask import request
from webauthn import (generate_authentication_options, generate_registration_options,
                      verify_authentication_response, verify_registration_response)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url, options_to_json
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor, ResidentKeyRequirement, UserVerificationRequirement)

from .service import CommerceError, settings


def relying_party():
    # Never trust a production Host or forwarded header to choose the RP/origin.
    origin = os.getenv("PASSKEY_ORIGIN", "").rstrip("/")
    if request.host.split(":")[0] == "127.0.0.1":
        raise CommerceError("Open ProjectV on localhost instead of 127.0.0.1, then sign in to use passkeys.", 400)
    if not origin and request.host.split(":")[0] == "localhost":
        origin = request.host_url.rstrip("/")
    parsed = urlsplit(origin)
    if (not parsed.hostname or parsed.username or parsed.password or parsed.path
            or parsed.query or parsed.fragment
            or (parsed.scheme != "https" and not (
                parsed.scheme == "http" and parsed.hostname == "localhost"))):
        raise CommerceError("Passkeys need a configured HTTPS site origin.", 503)
    try:
        ipaddress.ip_address(parsed.hostname)
    except ValueError:
        pass
    else:
        raise CommerceError("Passkeys require a hostname, not an IP address.", 503)
    if request.headers.get("Origin") != origin:
        raise CommerceError("Open this page on the configured passkey site and try again.", 403)
    return parsed.hostname, origin


class Passkeys:
    def __init__(self, user_id):
        config = settings()
        if not config["database_key"] or not config["database_url"]:
            raise CommerceError("Passkey storage is not configured.", 503)
        self.user_id = user_id
        self.url = config["database_url"] + "/rest/v1/"
        self.headers = {"apikey": config["database_key"],
                        "Authorization": f'Bearer {config["database_key"]}',
                        "Prefer": "return=representation"}

    def call(self, table, method, params=None, body=None, upsert=False):
        headers = dict(self.headers)
        if upsert:
            headers["Prefer"] += ",resolution=merge-duplicates"
        try:
            response = httpx.request(method, self.url + table, headers=headers,
                params={**(params or {}), "user_id": f"eq.{self.user_id}"},
                json=body, timeout=12)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise CommerceError("Passkey storage is unavailable. Please try again.", 503) from None

    def credentials(self):
        return self.call("passkey_credentials", "GET")

    def challenge(self, purpose, options, order=None):
        challenge_id = str(uuid4())
        payload = {"user_id": self.user_id, "purpose": purpose, "id": challenge_id,
            "challenge": bytes_to_base64url(options.challenge),
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
            "order_id": order["id"] if order else None,
            "request_hash": order["request_hash"] if order else None}
        self.call("passkey_challenges", "POST", {"on_conflict": "user_id,purpose"}, payload, upsert=True)
        return {"challengeId": challenge_id, "publicKey": json.loads(options_to_json(options))}

    def consume(self, challenge_id, purpose, order=None):
        try:
            challenge_id = str(UUID(str(challenge_id)))
        except (TypeError, ValueError):
            raise CommerceError("Verify your passkey to approve this purchase.", 403) from None
        params = {"id": f"eq.{challenge_id}", "purpose": f"eq.{purpose}",
                  "expires_at": f"gt.{datetime.now(timezone.utc).isoformat()}"}
        if order:
            params.update(order_id=f'eq.{order["id"]}', request_hash=f'eq.{order["request_hash"]}')
        # DELETE ... RETURNING is atomic across workers. A challenge is used once,
        # including failed verification attempts; altered baskets cannot consume it.
        rows = self.call("passkey_challenges", "DELETE", params)
        if not rows:
            raise CommerceError("Passkey approval expired or changed. Please approve again.", 403)
        return base64url_to_bytes(rows[0]["challenge"])

    def registration_options(self):
        rp_id, _ = relying_party()
        credentials = self.credentials()
        if len(credentials) >= 10:
            raise CommerceError("This account already has the maximum number of passkeys.", 409)
        options = generate_registration_options(rp_id=rp_id, rp_name="ProjectV",
            user_id=UUID(self.user_id).bytes, user_name=f"ProjectV {self.user_id[:8]}",
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.REQUIRED,
                user_verification=UserVerificationRequirement.REQUIRED),
            exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(c["id"])) for c in credentials])
        return self.challenge("registration", options)

    def register(self, data):
        rp_id, origin = relying_party()
        if not isinstance(data.get("credential"), dict):
            raise CommerceError("A passkey credential is required.", 400)
        challenge = self.consume(data.get("challengeId"), "registration")
        try:
            verified = verify_registration_response(credential=data.get("credential"),
                expected_challenge=challenge, expected_rp_id=rp_id,
                expected_origin=origin, require_user_verification=True)
        except (WebAuthnException, ValueError, TypeError, KeyError):
            raise CommerceError("Could not verify this passkey. Please try creating it again.", 403) from None
        self.call("passkey_credentials", "POST", body={"user_id": self.user_id,
            "id": bytes_to_base64url(verified.credential_id),
            "public_key": bytes_to_base64url(verified.credential_public_key),
            "sign_count": verified.sign_count})

    def approval_options(self, order):
        rp_id, _ = relying_party()
        credentials = self.credentials()
        if not credentials:
            raise CommerceError("Create a passkey before approving checkout.", 409, "passkey_required")
        options = generate_authentication_options(rp_id=rp_id,
            allow_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(c["id"])) for c in credentials],
            user_verification=UserVerificationRequirement.REQUIRED)
        return self.challenge("demo_approval", options, order)

    def verify_approval(self, data, order):
        rp_id, origin = relying_party()
        proof = data.get("passkey")
        if (not isinstance(proof, dict) or not isinstance(proof.get("credential"), dict)
                or not isinstance(proof["credential"].get("response"), dict)):
            raise CommerceError("Verify your passkey to approve this purchase.", 403, "passkey_required")
        credential = proof["credential"]
        stored = next((c for c in self.credentials() if c["id"] == credential.get("id")), None)
        if not stored:
            raise CommerceError("Use a passkey registered to this account.", 403)
        challenge = self.consume(proof.get("challengeId"), "demo_approval", order)
        try:
            handle = credential.get("response", {}).get("userHandle")
            if handle and base64url_to_bytes(handle) != UUID(self.user_id).bytes:
                raise ValueError("Wrong user handle")
            verified = verify_authentication_response(credential=credential,
                expected_challenge=challenge, expected_rp_id=rp_id, expected_origin=origin,
                credential_public_key=base64url_to_bytes(stored["public_key"]),
                credential_current_sign_count=stored["sign_count"], require_user_verification=True)
        except (WebAuthnException, ValueError, TypeError, KeyError):
            raise CommerceError("Passkey verification failed. Please approve again.", 403) from None
        updated = self.call("passkey_credentials", "PATCH",
            {"id": f'eq.{stored["id"]}', "sign_count": f'eq.{stored["sign_count"]}'},
            {"sign_count": verified.new_sign_count})
        if not updated:
            raise CommerceError("Your passkey was used elsewhere. Please approve again.", 409)
