"""Calendar module — Google Calendar, Apple Calendar (CalDAV), Outlook"""
import asyncio
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, and_

from app.modules.database import get_db
from app.modules.models import CalendarEvent, CalendarAccount

router = APIRouter()


# ─── Schemas ───

class CalendarAccountCreate(BaseModel):
    provider: str  # google, apple, outlook, caldav
    name: str
    email: str = ""
    # Google OAuth
    google_refresh_token: str = ""
    google_calendar_id: str = "primary"
    # CalDAV (Apple, Fastmail, etc.)
    caldav_url: str = ""
    caldav_username: str = ""
    caldav_password: str = ""
    # Outlook/Microsoft
    ms_refresh_token: str = ""


class EventCreate(BaseModel):
    title: str
    description: str = ""
    start_time: str  # ISO format
    end_time: str = ""
    location: str = ""
    attendees: str = ""  # comma-separated emails
    is_all_day: bool = False


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    is_cancelled: Optional[bool] = None


# ─── Calendar Overview ───

@router.get("/overview")
async def calendar_overview(db: AsyncSession = Depends(get_db)):
    """Get calendar overview — upcoming events, connected accounts"""
    now = datetime.utcnow()
    week_later = now + timedelta(days=7)

    # Upcoming events
    events_q = await db.execute(
        select(CalendarEvent)
        .where(CalendarEvent.start_time >= now)
        .where(CalendarEvent.start_time <= week_later)
        .where(CalendarEvent.is_cancelled == False)
        .order_by(CalendarEvent.start_time)
        .limit(10)
    )
    upcoming = events_q.scalars().all()

    # Connected accounts
    accounts_q = await db.execute(select(CalendarAccount).where(CalendarAccount.is_active == True))
    accounts = accounts_q.scalars().all()

    # Stats
    total_events = await db.execute(
        select(CalendarEvent).where(CalendarEvent.start_time >= now)
    )
    total_count = len(total_events.scalars().all())

    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    today_events = await db.execute(
        select(CalendarEvent)
        .where(CalendarEvent.start_time >= today_start)
        .where(CalendarEvent.start_time < today_end)
        .where(CalendarEvent.is_cancelled == False)
    )
    today_count = len(today_events.scalars().all())

    return {
        "upcoming": [
            {
                "id": e.id,
                "title": e.title,
                "description": e.description,
                "start_time": e.start_time.isoformat() if e.start_time else None,
                "end_time": e.end_time.isoformat() if e.end_time else None,
                "location": e.location,
                "provider": e.provider,
                "is_all_day": e.is_all_day,
            }
            for e in upcoming
        ],
        "accounts": [
            {
                "id": a.id,
                "provider": a.provider,
                "name": a.name,
                "email": a.email,
                "is_active": a.is_active,
                "last_sync": a.last_sync.isoformat() if a.last_sync else None,
            }
            for a in accounts
        ],
        "stats": {
            "upcoming_7days": total_count,
            "today": today_count,
            "connected_accounts": len(accounts),
        },
    }


# ─── Events CRUD ───

@router.get("/events")
async def list_events(
    start: str = None,
    end: str = None,
    provider: str = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    """List calendar events with optional date range filter"""
    query = select(CalendarEvent).where(CalendarEvent.is_cancelled == False)

    if start:
        try:
            start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
            query = query.where(CalendarEvent.start_time >= start_dt)
        except ValueError:
            pass

    if end:
        try:
            end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
            query = query.where(CalendarEvent.start_time <= end_dt)
        except ValueError:
            pass

    if provider:
        query = query.where(CalendarEvent.provider == provider)

    query = query.order_by(CalendarEvent.start_time).limit(limit)
    result = await db.execute(query)
    events = result.scalars().all()

    return {
        "events": [
            {
                "id": e.id,
                "title": e.title,
                "description": e.description,
                "start_time": e.start_time.isoformat() if e.start_time else None,
                "end_time": e.end_time.isoformat() if e.end_time else None,
                "location": e.location,
                "attendees": e.attendees,
                "provider": e.provider,
                "is_all_day": e.is_all_day,
                "is_cancelled": e.is_cancelled,
            }
            for e in events
        ],
        "total": len(events),
    }


@router.post("/events")
async def create_event(data: EventCreate, db: AsyncSession = Depends(get_db)):
    """Create a new calendar event"""
    try:
        start_dt = datetime.fromisoformat(data.start_time.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "Invalid start_time format. Use ISO format.")

    end_dt = None
    if data.end_time:
        try:
            end_dt = datetime.fromisoformat(data.end_time.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, "Invalid end_time format.")

    event = CalendarEvent(
        title=data.title,
        description=data.description,
        start_time=start_dt,
        end_time=end_dt,
        location=data.location,
        attendees=data.attendees,
        is_all_day=data.is_all_day,
        provider="local",
    )
    db.add(event)
    await db.flush()

    return {"id": event.id, "message": "Événement créé"}


@router.get("/events/{event_id}")
async def get_event(event_id: int, db: AsyncSession = Depends(get_db)):
    """Get event details"""
    event = await db.get(CalendarEvent, event_id)
    if not event:
        raise HTTPException(404, "Événement non trouvé")
    return {
        "id": event.id,
        "title": event.title,
        "description": event.description,
        "start_time": event.start_time.isoformat() if event.start_time else None,
        "end_time": event.end_time.isoformat() if event.end_time else None,
        "location": event.location,
        "attendees": event.attendees,
        "provider": event.provider,
        "is_all_day": event.is_all_day,
    }


@router.patch("/events/{event_id}")
async def update_event(event_id: int, data: EventUpdate, db: AsyncSession = Depends(get_db)):
    """Update an event"""
    event = await db.get(CalendarEvent, event_id)
    if not event:
        raise HTTPException(404, "Événement non trouvé")

    for k, v in data.model_dump(exclude_unset=True).items():
        if k == "start_time" and v:
            v = datetime.fromisoformat(v.replace("Z", "+00:00"))
        elif k == "end_time" and v:
            v = datetime.fromisoformat(v.replace("Z", "+00:00"))
        setattr(event, k, v)

    return {"message": "Événement mis à jour"}


@router.delete("/events/{event_id}")
async def delete_event(event_id: int, db: AsyncSession = Depends(get_db)):
    """Cancel/delete an event"""
    event = await db.get(CalendarEvent, event_id)
    if not event:
        raise HTTPException(404, "Événement non trouvé")
    event.is_cancelled = True
    return {"message": "Événement annulé"}


# ─── Calendar Accounts ───

@router.get("/accounts")
async def list_accounts(db: AsyncSession = Depends(get_db)):
    """List connected calendar accounts"""
    result = await db.execute(select(CalendarAccount))
    accounts = result.scalars().all()
    return {
        "accounts": [
            {
                "id": a.id,
                "provider": a.provider,
                "name": a.name,
                "email": a.email,
                "is_active": a.is_active,
                "last_sync": a.last_sync.isoformat() if a.last_sync else None,
            }
            for a in accounts
        ]
    }


@router.post("/accounts")
async def add_account(data: CalendarAccountCreate, db: AsyncSession = Depends(get_db)):
    """Connect a new calendar account"""
    account = CalendarAccount(
        provider=data.provider,
        name=data.name,
        email=data.email,
        google_refresh_token=data.google_refresh_token,
        google_calendar_id=data.google_calendar_id,
        caldav_url=data.caldav_url,
        caldav_username=data.caldav_username,
        caldav_password=data.caldav_password,
        ms_refresh_token=data.ms_refresh_token,
        is_active=True,
    )
    db.add(account)
    await db.flush()
    return {"id": account.id, "message": "Compte connecté", "provider": data.provider}


@router.delete("/accounts/{account_id}")
async def remove_account(account_id: int, db: AsyncSession = Depends(get_db)):
    """Disconnect a calendar account"""
    account = await db.get(CalendarAccount, account_id)
    if not account:
        raise HTTPException(404, "Compte non trouvé")
    account.is_active = False
    return {"message": "Compte déconnecté"}


# ─── Sync ───

@router.post("/sync/{account_id}")
async def sync_calendar(account_id: int, db: AsyncSession = Depends(get_db)):
    """Sync events from a connected calendar"""
    account = await db.get(CalendarAccount, account_id)
    if not account:
        raise HTTPException(404, "Compte non trouvé")

    synced = 0
    try:
        if account.provider == "google":
            synced = await _sync_google_calendar(account, db)
        elif account.provider in ("apple", "caldav"):
            synced = await _sync_caldav(account, db)
        elif account.provider == "outlook":
            synced = await _sync_outlook(account, db)
        else:
            raise HTTPException(400, f"Provider {account.provider} not supported yet")

        account.last_sync = datetime.utcnow()
        return {"synced": synced, "provider": account.provider}
    except Exception as e:
        raise HTTPException(500, f"Sync error: {e}")


# ─── Google Calendar Sync ───

async def _sync_google_calendar(account: CalendarAccount, db: AsyncSession) -> int:
    """Sync events from Google Calendar API"""
    if not account.google_refresh_token:
        raise Exception("Google refresh token not configured")

    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        creds = Credentials(
            token=None,
            refresh_token=account.google_refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id="",
            client_secret="",
        )

        service = build("calendar", "v3", credentials=creds)
        now = datetime.utcnow().isoformat() + "Z"

        events_result = service.events().list(
            calendarId=account.google_calendar_id,
            timeMin=now,
            maxResults=50,
            singleEvents=True,
            orderBy="startTime",
        ).execute()

        events = events_result.get("items", [])
        synced = 0

        for g_event in events:
            # Check if already exists
            existing = await db.execute(
                select(CalendarEvent).where(CalendarEvent.external_id == g_event["id"])
            )
            if existing.scalar_one_or_none():
                continue

            start = g_event.get("start", {})
            end = g_event.get("end", {})

            event = CalendarEvent(
                external_id=g_event["id"],
                title=g_event.get("summary", "(Sans titre)"),
                description=g_event.get("description", ""),
                start_time=datetime.fromisoformat(start.get("dateTime", start.get("date", ""))),
                end_time=datetime.fromisoformat(end.get("dateTime", end.get("date", ""))) if end.get("dateTime") else None,
                location=g_event.get("location", ""),
                provider="google",
                is_all_day="date" in start,
                account_id=account.id,
            )
            db.add(event)
            synced += 1

        return synced
    except ImportError:
        raise Exception("Google API client not installed. Run: pip install google-api-python-client google-auth")


# ─── CalDAV Sync (Apple, Fastmail, etc.) ───

async def _sync_caldav(account: CalendarAccount, db: AsyncSession) -> int:
    """Sync events from CalDAV server (Apple iCloud, Fastmail, etc.)"""
    if not account.caldav_url:
        raise Exception("CalDAV URL not configured")

    try:
        import caldav

        client = caldav.DAVClient(
            url=account.caldav_url,
            username=account.caldav_username,
            password=account.caldav_password,
        )
        principal = client.principal()
        calendars = principal.calendars()

        synced = 0
        now = datetime.utcnow()
        later = now + timedelta(days=90)

        for cal in calendars:
            events = cal.date_search(start=now, end=later)
            for e in events:
                vevent = e.vobject_instance.vevent
                uid = str(vevent.uid.value) if hasattr(vevent, "uid") else str(e.id)

                existing = await db.execute(
                    select(CalendarEvent).where(CalendarEvent.external_id == uid)
                )
                if existing.scalar_one_or_none():
                    continue

                start_dt = vevent.dtstart.value if hasattr(vevent, "dtstart") else now
                end_dt = vevent.dtend.value if hasattr(vevent, "dtend") else None

                if isinstance(start_dt, datetime):
                    start_dt = start_dt.replace(tzinfo=None)
                if isinstance(end_dt, datetime):
                    end_dt = end_dt.replace(tzinfo=None)

                event = CalendarEvent(
                    external_id=uid,
                    title=str(vevent.summary.value) if hasattr(vevent, "summary") else "(Sans titre)",
                    description=str(vevent.description.value) if hasattr(vevent, "description") else "",
                    start_time=start_dt,
                    end_time=end_dt,
                    location=str(vevent.location.value) if hasattr(vevent, "location") else "",
                    provider="caldav",
                    is_all_day=not isinstance(start_dt, datetime) or (hasattr(vevent, "dtstart") and not hasattr(vevent.dtstart.value, "hour")),
                    account_id=account.id,
                )
                db.add(event)
                synced += 1

        return synced
    except ImportError:
        raise Exception("caldav library not installed. Run: pip install caldav")


# ─── Outlook/Microsoft Sync ───

async def _sync_outlook(account: CalendarAccount, db: AsyncSession) -> int:
    """Sync events from Microsoft Outlook via Graph API"""
    if not account.ms_refresh_token:
        raise Exception("Microsoft refresh token not configured")

    try:
        import aiohttp

        # Get access token
        token_url = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
        token_data = {
            "client_id": "",
            "client_secret": "",
            "refresh_token": account.ms_refresh_token,
            "grant_type": "refresh_token",
            "scope": "Calendars.Read",
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(token_url, data=token_data) as resp:
                if resp.status != 200:
                    raise Exception(f"Token refresh failed: {resp.status}")
                token_json = await resp.json()
                access_token = token_json["access_token"]

            # Fetch events
            headers = {"Authorization": f"Bearer {access_token}"}
            now = datetime.utcnow().isoformat() + "Z"
            later = (datetime.utcnow() + timedelta(days=90)).isoformat() + "Z"
            events_url = f"https://graph.microsoft.com/v1.0/me/calendarView?startDateTime={now}&endDateTime={later}&$top=50"

            async with session.get(events_url, headers=headers) as resp:
                if resp.status != 200:
                    raise Exception(f"Events fetch failed: {resp.status}")
                data = await resp.json()

        synced = 0
        for ms_event in data.get("value", []):
            existing = await db.execute(
                select(CalendarEvent).where(CalendarEvent.external_id == ms_event["id"])
            )
            if existing.scalar_one_or_none():
                continue

            start_str = ms_event.get("start", {}).get("dateTime", "")
            end_str = ms_event.get("end", {}).get("dateTime", "")

            event = CalendarEvent(
                external_id=ms_event["id"],
                title=ms_event.get("subject", "(Sans titre)"),
                description=ms_event.get("bodyPreview", ""),
                start_time=datetime.fromisoformat(start_str.split(".")[0]) if start_str else datetime.utcnow(),
                end_time=datetime.fromisoformat(end_str.split(".")[0]) if end_str else None,
                location=ms_event.get("location", {}).get("displayName", ""),
                provider="outlook",
                is_all_day=ms_event.get("isAllDay", False),
                account_id=account.id,
            )
            db.add(event)
            synced += 1

        return synced
    except ImportError:
        raise Exception("aiohttp not installed")
