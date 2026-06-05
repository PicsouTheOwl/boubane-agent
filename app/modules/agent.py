"""Agent module — orchestration, activity log, stats"""
from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from datetime import datetime, timedelta

from app.modules.database import get_db
from app.modules.models import AgentLog, FileRecord, WebTask, EmailRecord

router = APIRouter()


@router.get("/stats")
async def get_stats(db: AsyncSession = Depends(get_db)):
    """Get agent statistics"""
    # File stats
    file_count = await db.execute(select(func.count(FileRecord.id)))
    file_total = file_count.scalar()
    
    # Web task stats
    web_count = await db.execute(select(func.count(WebTask.id)))
    web_total = web_count.scalar()
    
    web_done = await db.execute(
        select(func.count(WebTask.id)).where(WebTask.status == "done")
    )
    web_done_count = web_done.scalar()
    
    # Email stats
    email_count = await db.execute(select(func.count(EmailRecord.id)))
    email_total = email_count.scalar()
    
    unread = await db.execute(
        select(func.count(EmailRecord.id)).where(EmailRecord.is_read == False)
    )
    unread_count = unread.scalar()
    
    # Recent activity
    recent_logs = await db.execute(
        select(AgentLog).order_by(desc(AgentLog.created_at)).limit(10)
    )
    logs = recent_logs.scalars().all()
    
    return {
        "files": {"total": file_total},
        "web": {"total": web_total, "completed": web_done_count},
        "emails": {"total": email_total, "unread": unread_count},
        "recent_activity": [
            {
                "action": log.action,
                "status": log.status,
                "details": log.details,
                "time": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ],
    }


@router.get("/activity")
async def get_activity(
    limit: int = 50,
    action: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get activity log"""
    query = select(AgentLog).order_by(desc(AgentLog.created_at))
    if action:
        query = query.where(AgentLog.action == action)
    query = query.limit(limit)
    
    result = await db.execute(query)
    logs = result.scalars().all()
    
    return {
        "activity": [
            {
                "id": log.id,
                "action": log.action,
                "status": log.status,
                "details": log.details,
                "duration_ms": log.duration_ms,
                "time": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ]
    }


@router.get("/status")
async def get_status():
    """Get agent status"""
    return {
        "agent": "boubane",
        "version": "1.0.0",
        "status": "running",
        "capabilities": [
            "file_analysis",
            "web_browsing",
            "email_management",
        ],
        "timestamp": datetime.utcnow().isoformat(),
    }
