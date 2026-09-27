"""Create or update the ElevenLabs voice agent from voice/agent/*.

    python -m voice.sync_agent            # upsert tools, then create or update the agent
    python -m voice.sync_agent --dry-run  # print the payloads without calling ElevenLabs

Tools are upserted by name, so re-running is safe. Set ELEVENLABS_AGENT_ID to update an
existing agent; otherwise a new agent is created and its ID printed for .env.
Optional ELEVENLABS_VOICE_ID and ELEVENLABS_LLM override agent.json.
"""
import argparse
import copy
import json
import os
import sys
from pathlib import Path

import httpx
from dotenv import dotenv_values

from .service import settings

AGENT_DIR = Path(__file__).resolve().parent / "agent"


def load_definition():
    tools = json.loads((AGENT_DIR / "tools.json").read_text())
    agent = json.loads((AGENT_DIR / "agent.json").read_text())
    prompt = (AGENT_DIR / "prompt.md").read_text().strip()
    names = [tool["name"] for tool in tools]
    if len(names) != len(set(names)):
        raise ValueError("Duplicate tool names in tools.json")
    return tools, agent, prompt


def env(name):
    local = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
    return str(os.getenv(name) or local.get(name) or "").strip()


def build_agent_payload(agent, prompt, tool_ids, *, voice_id="", llm=""):
    payload = copy.deepcopy(agent)
    config = payload["conversation_config"]
    config["agent"]["prompt"].update({"prompt": prompt, "tool_ids": list(tool_ids)})
    if llm:
        config["agent"]["prompt"]["llm"] = llm
    if voice_id:
        config["tts"]["voice_id"] = voice_id
    return payload


class ElevenLabs:
    def __init__(self, api_key, api_base, client=None):
        self.client = client or httpx.Client(base_url=api_base, timeout=20, headers={"xi-api-key": api_key})

    def request(self, method, path, **kwargs):
        response = self.client.request(method, path, **kwargs)
        if not response.is_success:
            raise SystemExit(f"ElevenLabs {method} {path} failed ({response.status_code}): {response.text[:500]}")
        return response.json()

    def existing_tools(self, names):
        found = {}
        for name in names:
            data = self.request("GET", "/v1/convai/tools", params={"search": name, "types": "client", "page_size": 100})
            for tool in data.get("tools", []):
                if tool.get("tool_config", {}).get("name") == name:
                    found[name] = tool["id"]
        return found

    def upsert_tools(self, tools):
        existing = self.existing_tools([tool["name"] for tool in tools])
        ids = []
        for tool in tools:
            body = {"tool_config": tool}
            if tool["name"] in existing:
                self.request("PATCH", f'/v1/convai/tools/{existing[tool["name"]]}', json=body)
                ids.append(existing[tool["name"]])
                print(f'  updated tool {tool["name"]}')
            else:
                ids.append(self.request("POST", "/v1/convai/tools", json=body)["id"])
                print(f'  created tool {tool["name"]}')
        return ids

    def upsert_agent(self, agent_id, payload):
        if agent_id:
            self.request("PATCH", f"/v1/convai/agents/{agent_id}", json=payload)
            return agent_id
        return self.request("POST", "/v1/convai/agents/create", json=payload)["agent_id"]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="print payloads without calling ElevenLabs")
    args = parser.parse_args(argv)
    tools, agent, prompt = load_definition()
    config = settings()
    overrides = {"voice_id": env("ELEVENLABS_VOICE_ID"), "llm": env("ELEVENLABS_LLM")}
    if args.dry_run:
        payload = build_agent_payload(agent, prompt, [f'<{t["name"]}>' for t in tools], **overrides)
        print(json.dumps({"tools": [{"tool_config": t} for t in tools], "agent": payload}, indent=2))
        return 0
    if not config["api_key"]:
        print("Set ELEVENLABS_API_KEY in .env first.", file=sys.stderr)
        return 1
    api = ElevenLabs(config["api_key"], config["api_base"])
    print(f"Syncing {len(tools)} client tools…")
    tool_ids = api.upsert_tools(tools)
    payload = build_agent_payload(agent, prompt, tool_ids, **overrides)
    agent_id = api.upsert_agent(config["agent_id"], payload)
    if config["agent_id"]:
        print(f"Updated agent {agent_id}.")
    else:
        print(f"Created agent {agent_id}.\nAdd this line to .env, then restart Flask:\n\nELEVENLABS_AGENT_ID={agent_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
