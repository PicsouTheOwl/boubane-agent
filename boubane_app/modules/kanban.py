"""
Boubane — Kanban Module
Tasks from emails, manual creation, drag & drop
"""
from datetime import datetime
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
import json

router = APIRouter(prefix="/api/kanban", tags=["kanban"])

# ─── In-memory store (will persist via simple JSON file) ───
import os, threading

DATA_DIR = "/home/ubuntu/boubane-agent/data"
KANBAN_FILE = os.path.join(DATA_DIR, "kanban.json")
_lock = threading.Lock()

DEFAULT_COLUMNS = ["À faire", "En cours", "Terminé"]

def _load():
    if os.path.exists(KANBAN_FILE):
        with open(KANBAN_FILE, "r") as f:
            return json.load(f)
    return {"columns": DEFAULT_COLUMNS, "cards": []}

def _save(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    with _lock:
        with open(KANBAN_FILE, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

@router.get("/")
async def kanban_get():
    return _load()

@router.post("/card")
async def kanban_create_card(request: Request):
    body = await request.json()
    data = _load()
    card = {
        "id": f"card_{datetime.now().timestamp()}",
        "title": body.get("title", "Nouvelle tâche"),
        "description": body.get("description", ""),
        "column": body.get("column", "À faire"),
        "mail_id": body.get("mail_id", ""),
        "sender": body.get("sender", ""),
        "subject": body.get("subject", ""),
        "priority": body.get("priority", "normal"),  # low, normal, high, urgent
        "created_at": datetime.now().isoformat(),
    }
    data["cards"].append(card)
    _save(data)
    return card

@router.patch("/card/{card_id}")
async def kanban_update_card(card_id: str, request: Request):
    body = await request.json()
    data = _load()
    for card in data["cards"]:
        if card["id"] == card_id:
            for k, v in body.items():
                if k in ("title", "description", "column", "priority"):
                    card[k] = v
            break
    _save(data)
    return {"ok": True}

@router.delete("/card/{card_id}")
async def kanban_delete_card(card_id: str):
    data = _load()
    data["cards"] = [c for c in data["cards"] if c["id"] != card_id]
    _save(data)
    return {"ok": True}

@router.post("/move")
async def kanban_move_card(request: Request):
    body = await request.json()
    card_id = body.get("card_id")
    column = body.get("column")
    data = _load()
    for card in data["cards"]:
        if card["id"] == card_id:
            card["column"] = column
            break
    _save(data)
    return {"ok": True}
