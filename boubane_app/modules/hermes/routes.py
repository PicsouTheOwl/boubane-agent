"""Hermes Agent API routes — proxy to Hermes gateway + mail insight"""
import json, os
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from boubane_app.modules.hermes.client import hermes_client

HIMALAYA = os.path.expanduser("~/.local/bin/himalaya")

router = APIRouter(prefix="/api/hermes", tags=["hermes"])

class ChatRequest(BaseModel):
    messages: list
    model: str = "default"
    max_tokens: int = 512
    temperature: float = 0.3

@router.post("/chat")
async def hermes_chat(req: ChatRequest):
    """Chat with Hermes AI"""
    try:
        result = await hermes_client.chat(
            messages=req.messages,
            model=req.model,
            max_tokens=req.max_tokens,
            temperature=req.temperature,
        )
        return JSONResponse(content=result)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@router.post("/chat/stream")
async def hermes_chat_stream(req: ChatRequest):
    """Stream chat with Hermes AI — Server-Sent Events"""
    from fastapi.responses import StreamingResponse

    async def _generate():
        try:
            async for chunk in hermes_client.chat_stream(
                messages=req.messages,
                model=req.model,
                max_tokens=req.max_tokens,
                temperature=req.temperature,
            ):
                yield chunk
        except Exception as e:
            yield json.dumps({"error": str(e)}) + "\n"

    return StreamingResponse(_generate(), media_type="text/event-stream")

@router.get("/sessions")
async def list_sessions(limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)):
    """List Hermes gateway sessions"""
    data = await hermes_client.get_sessions(limit=limit, offset=offset)
    return JSONResponse(content=data)

@router.get("/sessions/{session_id}/messages")
async def get_session_messages(session_id: str, limit: int = Query(50, ge=1, le=200)):
    """Get messages for a specific session"""
    data = await hermes_client.get_session_messages(session_id, limit=limit)
    return JSONResponse(content=data)

@router.get("/skills")
async def list_skills():
    """List available Hermes skills"""
    data = await hermes_client.list_skills()
    return JSONResponse(content=data)

@router.get("/stats")
async def gateway_stats():
    """Get Hermes gateway aggregated statistics"""
    data = await hermes_client.get_gateway_stats()
    return JSONResponse(content=data)

@router.get("/health")
async def hermes_health():
    """Check Hermes gateway health"""
    data = await hermes_client.health()
    return JSONResponse(content=data)

@router.get("/status")
async def full_status():
    """Full Hermes status: health + stats + sessions summary"""
    health = await hermes_client.health()
    stats = await hermes_client.get_gateway_stats()
    sessions = await hermes_client.get_sessions(limit=5)

    recent = []
    for s in sessions.get("data", []):
        recent.append({
            "id": s.get("id"),
            "source": s.get("source"),
            "model": s.get("model"),
            "messages": s.get("message_count", 0),
            "cost": s.get("estimated_cost_usd"),
            "last_active": s.get("last_active"),
            "preview": (s.get("preview") or "")[:80],
        })

    return JSONResponse(content={
        "gateway": health,
        "stats": stats,
        "recent_sessions": recent,
    })