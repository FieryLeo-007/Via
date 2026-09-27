"""ElevenLabs boundary. The API key stays on the server; browsers only receive short-lived tokens."""
import os
from pathlib import Path

import httpx
from dotenv import dotenv_values

API_BASE = "https://api.elevenlabs.io"


class VoiceError(Exception):
    def __init__(self, message, status=503, code="voice_unavailable", missing=None):
        super().__init__(message)
        self.status, self.code, self.missing = status, code, missing or []


def settings():
    # Read on each call so rotating keys in .env does not require a restart.
    local = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
    get = lambda name: str(os.getenv(name) or local.get(name) or "").strip()
    return {"api_key": get("ELEVENLABS_API_KEY"), "agent_id": get("ELEVENLABS_AGENT_ID"),
            "api_base": (get("ELEVENLABS_API_BASE") or API_BASE).rstrip("/")}


def missing_settings(config):
    return [name for name, key in (("ELEVENLABS_API_KEY", "api_key"), ("ELEVENLABS_AGENT_ID", "agent_id"))
            if not config[key]]


def conversation_token(config, *, client=None):
    """Mint a WebRTC conversation token for the configured (auth-protected) agent."""
    missing = missing_settings(config)
    if missing:
        raise VoiceError("Voice mode is not configured yet.", missing=missing)
    owned = client is None
    client = client or httpx.Client(timeout=6)
    try:
        response = client.get(f'{config["api_base"]}/v1/convai/conversation/token',
                              params={"agent_id": config["agent_id"]},
                              headers={"xi-api-key": config["api_key"]})
    except httpx.HTTPError:
        raise VoiceError("The voice service did not respond. Please try again.", 502, "voice_upstream") from None
    finally:
        if owned:
            client.close()
    if response.status_code in (401, 403):
        raise VoiceError("The voice service rejected our credentials.", 502, "voice_upstream")
    if response.status_code == 429:
        raise VoiceError("Voice mode is busy right now. Please try again in a moment.", 503, "voice_busy")
    if not response.is_success:
        raise VoiceError("The voice service could not start a conversation.", 502, "voice_upstream")
    try:
        token = response.json()["token"]
    except (ValueError, KeyError, TypeError):
        token = None
    if not isinstance(token, str) or not token:
        raise VoiceError("The voice service returned an invalid session.", 502, "voice_upstream")
    return token
