"""Hermes Agent client — enhanced with full API proxy support"""
import httpx
import os
from typing import Optional, Dict, Any, List

HERMES_GATEWAY_URL = os.getenv("HERMES_GATEWAY_URL", "http://127.0.0.1:8642")
HERMES_API_KEY = ""

def _get_api_key() -> str:
    global HERMES_API_KEY
    if not HERMES_API_KEY:
        env_path = os.path.expanduser("~/.hermes/.env")
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("API_SERVER_KEY="):
                        HERMES_API_KEY = line.split("=", 1)[1].strip()
                        break
    return HERMES_API_KEY

class HermesClient:
    """Client for interacting with local Hermes agent gateway"""

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)

    def _headers(self) -> dict:
        key = _get_api_key()
        headers = {"Content-Type": "application/json"}
        if key:
            headers["Authorization"] = f"Bearer {key}"
        return headers

    async def health(self) -> dict:
        """Check Hermes gateway health (no auth needed)"""
        try:
            resp = await self.client.get(f"{HERMES_GATEWAY_URL}/health")
            return resp.json()
        except Exception as e:
            return {"status": "error", "message": str(e)}

    async def get_sessions(self, limit: int = 20, offset: int = 0) -> dict:
        """List recent sessions"""
        try:
            resp = await self.client.get(
                f"{HERMES_GATEWAY_URL}/api/sessions?limit={limit}&offset={offset}",
                headers=self._headers()
            )
            return resp.json()
        except Exception as e:
            return {"error": str(e)}

    async def get_session_messages(self, session_id: str, limit: int = 50) -> dict:
        """Get messages for a specific session"""
        try:
            resp = await self.client.get(
                f"{HERMES_GATEWAY_URL}/api/sessions/{session_id}/messages?limit={limit}",
                headers=self._headers()
            )
            return resp.json()
        except Exception as e:
            return {"error": str(e)}

    async def run_skill(self, skill_name: str, **kwargs) -> dict:
        """Run a Hermes skill"""
        try:
            payload = {"skill": skill_name, "params": kwargs}
            resp = await self.client.post(
                f"{HERMES_GATEWAY_URL}/skills/run",
                json=payload,
                headers=self._headers()
            )
            return resp.json()
        except Exception as e:
            return {"status": "error", "message": str(e)}

    async def list_skills(self) -> dict:
        """List available skills from local filesystem"""
        import glob
        skills_dir = os.path.expanduser("~/.hermes/skills")
        skills = []
        if os.path.isdir(skills_dir):
            for skill_file in glob.glob(f"{skills_dir}/**/SKILL.md", recursive=True):
                rel_path = os.path.relpath(os.path.dirname(skill_file), skills_dir)
                skills.append({
                    "name": rel_path.split("/")[-1] if "/" in rel_path else os.path.basename(os.path.dirname(skill_file)),
                    "path": rel_path,
                })
        return {"skills": skills, "count": len(skills)}

    async def get_gateway_stats(self) -> dict:
        """Get aggregated stats from the gateway"""
        try:
            sessions = await self.get_sessions(limit=100)
            data = sessions.get("data", [])
            total = len(data)
            active = sum(1 for s in data if s.get("ended_at") is None and s.get("source") == "telegram")
            total_cost = sum(s.get("estimated_cost_usd", 0) or 0 for s in data)
            total_tokens = sum(s.get("input_tokens", 0) or 0 + s.get("output_tokens", 0) or 0 for s in data)
            session_sources = {}
            for s in data:
                src = s.get("source", "unknown")
                session_sources[src] = session_sources.get(src, 0) + 1
            return {
                "total_sessions": total,
                "active_sessions": active,
                "total_cost_usd": round(total_cost, 4),
                "total_tokens": total_tokens,
                "by_source": session_sources,
            }
        except Exception as e:
            return {"error": str(e)}

    async def chat(self, messages: list, model: str = "default", max_tokens: int = 512, temperature: float = 0.3) -> dict:
        """Send a chat request to Hermes gateway"""
        try:
            resp = await self.client.post(
                f"{HERMES_GATEWAY_URL}/v1/chat/completions",
                json={"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature},
                headers=self._headers(),
                timeout=60.0,
            )
            return resp.json()
        except Exception as e:
            return {"error": str(e)}

    async def close(self):
        await self.client.aclose()

# Singleton
hermes_client = HermesClient()