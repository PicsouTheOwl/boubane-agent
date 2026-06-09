"""Business module — KPIs, clients, subscriptions, site monitoring"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date

from boubane_app.modules.database import get_db
from boubane_app.modules.models import BusinessMetric, Client, Subscription, SiteStatus

router = APIRouter()


# ─── Schemas ───

class ClientCreate(BaseModel):
    name: str
    email: str
    company: str = ""
    plan: str = "starter"  # starter, pro, enterprise
    status: str = "active"  # active, trial, churned, paused
    mrr: float = 0.0  # Monthly Recurring Revenue
    notes: str = ""


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    company: Optional[str] = None
    plan: Optional[str] = None
    status: Optional[str] = None
    mrr: Optional[float] = None
    notes: Optional[str] = None


# ─── Overview / KPIs ───

@router.get("/overview")
async def business_overview(db: AsyncSession = Depends(get_db)):
    """Get business KPIs overview"""
    # Clients
    total_clients = await db.execute(select(func.count(Client.id)).where(Client.status == "active"))
    total_clients = total_clients.scalar() or 0

    trial_clients = await db.execute(select(func.count(Client.id)).where(Client.status == "trial"))
    trial_clients = trial_clients.scalar() or 0

    churned_clients = await db.execute(select(func.count(Client.id)).where(Client.status == "churned"))
    churned_clients = churned_clients.scalar() or 0

    # MRR
    mrr_result = await db.execute(
        select(func.sum(Client.mrr)).where(Client.status.in_(["active", "trial"]))
    )
    total_mrr = mrr_result.scalar() or 0.0

    # ARR (Annual)
    arr = total_mrr * 12

    # By plan
    plans = {}
    for plan in ["starter", "pro", "enterprise"]:
        count = await db.execute(
            select(func.count(Client.id)).where(Client.plan == plan, Client.status == "active")
        )
        plans[plan] = count.scalar() or 0

    # Site status
    site = await db.execute(select(SiteStatus).order_by(SiteStatus.checked_at.desc()).limit(1))
    site = site.scalar_one_or_none()

    return {
        "clients": {
            "total": total_clients,
            "trial": trial_clients,
            "churned": churned_clients,
            "by_plan": plans,
        },
        "revenue": {
            "mrr": round(total_mrr, 2),
            "arr": round(arr, 2),
        },
        "site": {
            "status": site.status if site else "unknown",
            "last_deploy": site.last_deploy.isoformat() if site and site.last_deploy else None,
            "version": site.version if site else "—",
            "uptime_pct": site.uptime_pct if site else 0,
            "checked_at": site.checked_at.isoformat() if site else None,
        },
    }


# ─── Clients CRUD ───

@router.get("/clients")
async def list_clients(status: str = None, plan: str = None, db: AsyncSession = Depends(get_db)):
    """List all clients with optional filters"""
    q = select(Client).order_by(Client.created_at.desc())
    if status:
        q = q.where(Client.status == status)
    if plan:
        q = q.where(Client.plan == plan)
    result = await db.execute(q)
    clients = result.scalars().all()
    return {
        "clients": [
            {
                "id": c.id,
                "name": c.name,
                "email": c.email,
                "company": c.company,
                "plan": c.plan,
                "status": c.status,
                "mrr": c.mrr,
                "notes": c.notes,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in clients
        ],
        "total": len(clients),
    }


@router.post("/clients")
async def create_client(data: ClientCreate, db: AsyncSession = Depends(get_db)):
    """Create a new client"""
    client = Client(**data.model_dump())
    db.add(client)
    await db.flush()
    return {"id": client.id, "message": "Client créé"}


@router.get("/clients/{client_id}")
async def get_client(client_id: int, db: AsyncSession = Depends(get_db)):
    """Get client details"""
    client = await db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client non trouvé")
    return {
        "id": client.id,
        "name": client.name,
        "email": client.email,
        "company": client.company,
        "plan": client.plan,
        "status": client.status,
        "mrr": client.mrr,
        "notes": client.notes,
        "created_at": client.created_at.isoformat() if client.created_at else None,
    }


@router.patch("/clients/{client_id}")
async def update_client(client_id: int, data: ClientUpdate, db: AsyncSession = Depends(get_db)):
    """Update a client"""
    client = await db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client non trouvé")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(client, k, v)
    return {"message": "Client mis à jour"}


@router.delete("/clients/{client_id}")
async def delete_client(client_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a client"""
    client = await db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client non trouvé")
    await db.delete(client)
    return {"message": "Client supprimé"}


# ─── Site monitoring ───

@router.get("/site/status")
async def site_status(db: AsyncSession = Depends(get_db)):
    """Get latest site status"""
    site = await db.execute(select(SiteStatus).order_by(SiteStatus.checked_at.desc()).limit(1))
    site = site.scalar_one_or_none()
    if not site:
        return {"status": "unknown", "message": "Pas de données"}
    return {
        "status": site.status,
        "url": site.url,
        "version": site.version,
        "last_deploy": site.last_deploy.isoformat() if site.last_deploy else None,
        "uptime_pct": site.uptime_pct,
        "response_time_ms": site.response_time_ms,
        "checked_at": site.checked_at.isoformat() if site.checked_at else None,
    }


@router.post("/site/check")
async def site_check(db: AsyncSession = Depends(get_db)):
    """Trigger a site health check (ping the site)"""
    import aiohttp
    url = "https://boubane.com"  # configurable
    try:
        start = datetime.utcnow()
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                elapsed = (datetime.utcnow() - start).total_seconds() * 1000
                status = "up" if resp.status == 200 else "degraded"
                site = SiteStatus(
                    url=url,
                    status=status,
                    response_time_ms=round(elapsed, 1),
                    http_code=resp.status,
                )
                db.add(site)
                return {"status": status, "response_time_ms": round(elapsed, 1), "http_code": resp.status}
    except Exception as e:
        site = SiteStatus(url=url, status="down", error=str(e))
        db.add(site)
        return {"status": "down", "error": str(e)}
