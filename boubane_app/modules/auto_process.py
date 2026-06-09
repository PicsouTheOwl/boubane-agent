"""Auto-process inbox — AI tri + brouillon réponse"""
import os
import json
import subprocess
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/himalaya/auto", tags=["auto-process"])

HIMALAYA = os.path.expanduser("~/.local/bin/himalaya")
HERMES_URL = os.getenv("HERMES_GATEWAY_URL", "http://127.0.0.1:8642")
CONFIG_DIR = os.path.expanduser("~/.boubane/auto-mail")
LOG_FILE = os.path.join(CONFIG_DIR, "actions.jsonl")

# Ensure dirs
Path(CONFIG_DIR).mkdir(parents=True, exist_ok=True)


# ─── Config ───

class SortRule(BaseModel):
    category: str           # ex: "sécurité", "vercel", "facturation"
    folder: str             # ex: "[Gmail]/Important", "INBOX"
    senders: list[str] = [] # ex: ["vercel.com", "noreply@github.com"]
    keywords: list[str] = [] # ex: ["alert", "security", "failed deployment"]

class AutoConfig(BaseModel):
    enabled: bool = True
    auto_sort: bool = True
    auto_reply_draft: bool = True
    # Ne pas répondre auto à ces expéditeurs
    reply_ignore_senders: list[str] = ["noreply", "no-reply", "notification", "mailer-daemon"]
    # Ne pas trier — laisser dans INBOX
    sort_ignore_categories: list[str] = []
    sort_rules: list[SortRule] = []
    poll_interval_min: int = 5


CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")

def load_config() -> AutoConfig:
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE) as f:
                return AutoConfig(**json.load(f))
        except Exception:
            pass
    # Default rules
    return AutoConfig(
        sort_rules=[
            SortRule(category="sécurité", folder="[Gmail]/Important", senders=["google.com", "github.com"], keywords=["security", "alerte de sécurité", "sign-in", "access token"]),
            SortRule(category="vercel", folder="INBOX", senders=["vercel.com", "notifications@vercel.com"], keywords=["deployment", "vercel"]),
            SortRule(category="github", folder="INBOX", senders=["github.com", "notifications@github.com"], keywords=["pull request", "issue", "github"]),
            SortRule(category="promo", folder="[Gmail]/Spam", keywords=["unsubscribe", "promo", "offert", "gratuit", "réduction"]),
        ]
    )

def save_config(cfg: AutoConfig):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(cfg.model_dump(), f, indent=2, ensure_ascii=False)


# ─── Logging ───

def log_action(action: str, envelope_id: str, category: str = "", folder: str = "", reply: bool = False, detail: str = ""):
    entry = {
        "ts": datetime.now().isoformat(),
        "action": action,
        "envelope_id": envelope_id,
        "category": category,
        "folder": folder,
        "reply": reply,
        "detail": detail,
    }
    with open(LOG_FILE, 'a') as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _run_himalaya(args: list[str], timeout: int = 20) -> str:
    cmd = [HIMALAYA, *args]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or f"himalaya failed: {' '.join(cmd)}")
    return res.stdout


# ─── AI via Hermes Gateway ───

def _ask_hermes(prompt: str, max_tokens: int = 512) -> str:
    """Call Hermes gateway chat API for classification/reply."""
    import httpx
    try:
        # Get API key
        api_key = ""
        env_path = os.path.expanduser("~/.hermes/.env")
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if line.strip().startswith("API_SERVER_KEY="):
                        api_key = line.strip().split("=", 1)[1].strip()
                        break
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        resp = httpx.post(
            f"{HERMES_URL}/v1/chat/completions",
            headers=headers,
            json={
                "model": "default",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "temperature": 0.3,
            },
            timeout=30,
        )
        data = resp.json()
        # OpenAI-compatible response
        return data.get("choices", [{}])[0].get("message", {}).get("content", "")
    except Exception as e:
        return f"AI_ERROR: {e}"


# ─── Classify email ───

def classify_email(sender: str, subject: str, body_preview: str, rules: list[SortRule]) -> tuple[str, str]:
    """
    Returns (category, target_folder).
    First try rule matching, then fall back to AI.
    """
    sender_lower = sender.lower()
    subject_lower = subject.lower()

    # 1. Rule-based matching
    for rule in rules:
        # Check sender
        if rule.senders and any(s.lower() in sender_lower for s in rule.senders):
            return rule.category, rule.folder
        # Check keywords in subject
        if rule.keywords and any(k.lower() in subject_lower for k in rule.keywords):
            return rule.category, rule.folder

    # 2. AI fallback
    prompt = f"""Classifie cet email en UNE catégorie parmi : sécurité, notification, facturation, promo, personnel, devops, support, autre.
Réponds ONLY avec le nom de la catégorie, rien d'autre.

Expéditeur: {sender}
Objet: {subject}
Aperçu: {body_preview[:200]}"""
    ai_cat = _ask_hermes(prompt, max_tokens=20).strip().lower()
    # Normalize
    valid = ["sécurité", "notification", "facturation", "promo", "personnel", "devops", "support", "autre"]
    if ai_cat not in valid:
        ai_cat = "autre"
    # Map category → folder
    cat_folder_map = {
        "sécurité": "[Gmail]/Important",
        "promo": "[Gmail]/Spam",
        "facturation": "INBOX",
        "devops": "INBOX",
    }
    return ai_cat, cat_folder_map.get(ai_cat, "INBOX")


# ─── Generate draft reply ───

def generate_draft_reply(sender: str, subject: str, body_preview: str) -> str:
    prompt = f"""Tu es l'assistant email de Boubane. Génère une réponse professionnelle et concise en français pour cet email.
La réponse sera enregistrée comme brouillon pour validation humaine. Sois poli, direct, et utile.

Expéditeur: {sender}
Objet: {subject}
Contenu: {body_preview[:800]}

Réponse:"""
    reply = _ask_hermes(prompt, max_tokens=300)
    # Clean up — remove "Réponse:" prefix if present
    if reply.lower().startswith("réponse:"):
        reply = reply[9:].strip()
    return reply


# ─── Process inbox ───

def process_inbox() -> dict:
    cfg = load_config()
    if not cfg.enabled:
        return {"status": "disabled", "processed": 0}

    results = {"processed": 0, "sorted": 0, "replied": 0, "skipped": 0, "errors": [], "actions": []}

    # Get recent unread emails (limited to avoid long processing)
    try:
        stdout = _run_himalaya(["envelope", "list", "--folder", "INBOX", "--page", "1", "--page-size", "10", "--output", "json"])
        envelopes = json.loads(stdout) if stdout.strip().startswith("[") else []
    except Exception as e:
        results["errors"].append(f"fetch_error: {e}")
        return results

    processed = 0
    max_per_run = 5

    for env in envelopes:
        eid = str(env.get("id", ""))
        flags = env.get("flags", [])
        sender = env.get("from", "")
        # Normalize sender — may be dict or string
        if isinstance(sender, dict):
            sender = sender.get("name") or sender.get("addr") or str(sender)
        subject = env.get("subject", "")
        date = env.get("date", "")

        # Skip if already seen
        if "Seen" in flags:
            results["skipped"] += 1
            continue

        if processed >= max_per_run:
            results["skipped"] += 1
            continue

        processed += 1
        results["processed"] += 1
        action_detail = []

        # ── Sort ──
        if cfg.auto_sort:
            try:
                # Get body preview for classification
                body_preview = ""
                try:
                    body_raw = _run_himalaya(["message", "read", eid])
                    body_preview = body_raw[:400]
                except Exception:
                    pass

                category, target_folder = classify_email(sender, subject, body_preview, cfg.sort_rules)

                # Move if not staying in INBOX and different from current
                if target_folder != "INBOX" and category not in cfg.sort_ignore_categories:
                    _run_himalaya(["message", "move", target_folder, eid])
                    results["sorted"] += 1
                    action_detail.append(f"tri→{category}({target_folder})")
                    log_action("sort", eid, category=category, folder=target_folder)
                else:
                    action_detail.append(f"cat={category}(reste INBOX)")
                    log_action("classify", eid, category=category)
            except Exception as e:
                action_detail.append(f"sort_error: {e}")
                log_action("sort_error", eid, detail=str(e))

        # ── Auto reply draft ──
        if cfg.auto_reply_draft:
            # Skip auto-reply for noreply/notification senders
            sender_lower = sender.lower()
            if any(ign in sender_lower for ign in cfg.reply_ignore_senders):
                action_detail.append("reply_skip(noreply)")
            else:
                try:
                    if not body_preview:
                        try:
                            body_raw = _run_himalaya(["message", "read", eid])
                            body_preview = body_raw[:800]
                        except Exception:
                            body_preview = ""

                    reply_text = generate_draft_reply(sender, subject, body_preview)
                    if reply_text and not reply_text.startswith("AI_ERROR"):
                        # Build raw email message
                        reply_subject = f"Re: {subject}" if not subject.startswith("Re:") else subject
                        sender_email = ""
                        import re
                        m = re.search(r'<(.+?)>', sender)
                        if m:
                            sender_email = m.group(1)
                        elif '@' in sender:
                            sender_email = sender

                        raw_msg = f"To: {sender_email}\r\nSubject: {reply_subject}\r\n\r\n{reply_text}"

                        try:
                            _run_himalaya(["message", "save", "-f", "[Gmail]/Drafts", raw_msg])
                            results["replied"] += 1
                            action_detail.append("draft_reply")
                            log_action("draft_reply", eid, reply=True, detail=reply_text[:100])
                        except Exception as e2:
                            action_detail.append(f"save_error: {e2}")
                            log_action("save_error", eid, detail=str(e2))
                    else:
                        action_detail.append("reply_skip(ai_error)")
                except Exception as e:
                    action_detail.append(f"reply_error: {e}")
                    log_action("reply_error", eid, detail=str(e))

        # Mark as read
        try:
            _run_himalaya(["flag", "add", "Seen", eid])
        except Exception:
            pass

        results["actions"].append({"id": eid, "subject": subject, "detail": ", ".join(action_detail)})

    return results


# ─── API Endpoints ───

@router.post("/process")
async def api_process_inbox():
    """Trigger inbox processing (called by cron). Runs in thread pool to avoid blocking."""
    import asyncio
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, process_inbox)
    return JSONResponse(content=result)


@router.get("/config")
async def api_get_config():
    return JSONResponse(content=load_config().model_dump())


@router.post("/config")
async def api_save_config(cfg: AutoConfig):
    save_config(cfg)
    return JSONResponse(content={"ok": True, "config": cfg.model_dump()})


@router.get("/log")
async def api_get_log(limit: int = 50):
    """Get recent auto-actions log."""
    entries = []
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE) as f:
            lines = f.readlines()[-limit:]
        for line in lines:
            try:
                entries.append(json.loads(line.strip()))
            except Exception:
                pass
    return JSONResponse(content={"log": list(reversed(entries)), "count": len(entries)})
