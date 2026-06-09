"""Email module — IMAP receive, SMTP send"""
import asyncio
from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from boubane_app.modules.database import get_db
from boubane_app.modules.models import EmailRecord, AgentLog
from boubane_app.modules.config import settings

router = APIRouter()


class EmailConfig(BaseModel):
    imap_host: str
    imap_port: int = 993
    imap_user: str
    imap_pass: str
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_pass: str = ""


class SendEmail(BaseModel):
    to: str
    subject: str
    body: str
    body_html: Optional[str] = None


@router.post("/config")
async def configure_email(config: EmailConfig):
    """Configure email credentials"""
    # Update settings (in production, save to encrypted config)
    settings.IMAP_HOST = config.imap_host
    settings.IMAP_PORT = config.imap_port
    settings.IMAP_USER = config.imap_user
    settings.IMAP_PASS = config.imap_pass
    settings.SMTP_HOST = config.smtp_host or config.imap_host
    settings.SMTP_PORT = config.smtp_port
    settings.SMTP_USER = config.smtp_user or config.imap_user
    settings.SMTP_PASS = config.smtp_pass or config.imap_pass
    
    return {"status": "configured", "imap": config.imap_host}


@router.post("/fetch")
async def fetch_emails(
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """Fetch emails from IMAP"""
    if not settings.IMAP_HOST or not settings.IMAP_USER:
        raise HTTPException(400, "Email not configured. POST /api/email/config first.")
    
    try:
        emails = await _fetch_imap(limit)
    except Exception as e:
        raise HTTPException(500, f"IMAP error: {e}")
    
    # Store in DB
    stored = 0
    for email_data in emails:
        # Check if already exists
        existing = await db.execute(
            select(EmailRecord).where(EmailRecord.message_id == email_data["message_id"])
        )
        if existing.scalar_one_or_none():
            continue
        
        record = EmailRecord(
            message_id=email_data["message_id"],
            sender=email_data["sender"],
            recipient=email_data["recipient"],
            subject=email_data["subject"],
            body=email_data["body"],
            body_html=email_data.get("body_html"),
            is_read=False,
            received_at=email_data.get("date"),
        )
        db.add(record)
        stored += 1
    
    # Log
    log = AgentLog(
        action="email_fetch",
        status="success",
        details=f"Fetched {len(emails)} emails, {stored} new",
    )
    db.add(log)
    
    return {"fetched": len(emails), "new": stored}


@router.get("/list")
async def list_emails(
    limit: int = 50,
    offset: int = 0,
    unread_only: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """List emails"""
    query = select(EmailRecord).order_by(desc(EmailRecord.received_at))
    if unread_only:
        query = query.where(EmailRecord.is_read == False)
    query = query.offset(offset).limit(limit)
    
    result = await db.execute(query)
    emails = result.scalars().all()
    
    return {
        "emails": [
            {
                "id": e.id,
                "sender": e.sender,
                "subject": e.subject,
                "body_preview": (e.body or "")[:200],
                "is_read": e.is_read,
                "is_important": e.is_important,
                "category": e.category,
                "ai_summary": e.ai_summary,
                "received_at": e.received_at.isoformat() if e.received_at else None,
            }
            for e in emails
        ]
    }


@router.get("/{email_id}")
async def get_email(email_id: int, db: AsyncSession = Depends(get_db)):
    """Get email details"""
    result = await db.execute(select(EmailRecord).where(EmailRecord.id == email_id))
    email = result.scalar_one_or_none()
    if not email:
        raise HTTPException(404, "Email not found")
    
    # Mark as read
    email.is_read = True
    
    return {
        "id": email.id,
        "sender": email.sender,
        "recipient": email.recipient,
        "subject": email.subject,
        "body": email.body,
        "body_html": email.body_html,
        "is_read": True,
        "category": email.category,
        "ai_summary": email.ai_summary,
        "ai_response": email.ai_response,
        "received_at": email.received_at.isoformat() if email.received_at else None,
    }


@router.post("/send")
async def send_email(
    email: SendEmail,
    db: AsyncSession = Depends(get_db)
):
    """Send an email via SMTP"""
    if not settings.SMTP_HOST or not settings.SMTP_USER:
        raise HTTPException(400, "SMTP not configured")
    
    try:
        await _send_smtp(email)
    except Exception as e:
        raise HTTPException(500, f"SMTP error: {e}")
    
    log = AgentLog(
        action="email_send",
        status="success",
        details=f"Sent to {email.to}: {email.subject}",
    )
    db.add(log)
    
    return {"status": "sent", "to": email.to, "subject": email.subject}


@router.post("/{email_id}/ai-response")
async def generate_ai_response(
    email_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Generate AI response suggestion for an email"""
    result = await db.execute(select(EmailRecord).where(EmailRecord.id == email_id))
    email = result.scalar_one_or_none()
    if not email:
        raise HTTPException(404, "Email not found")
    
    # Basic rule-based response (LLM integration would go here)
    response = _generate_basic_response(email.subject, email.body or "")
    email.ai_response = response
    
    return {"response": response}


async def _fetch_imap(limit: int = 50) -> List[dict]:
    """Fetch emails from IMAP server"""
    import imaplib
    import email
    from email.header import decode_header
    
    mail = imaplib.IMAP4_SSL(settings.IMAP_HOST, settings.IMAP_PORT)
    mail.login(settings.IMAP_USER, settings.IMAP_PASS)
    mail.select("INBOX")
    
    _, message_numbers = mail.search(None, "ALL")
    msg_ids = message_numbers[0].split()
    
    # Get last N emails
    msg_ids = msg_ids[-limit:]
    
    emails = []
    for msg_id in reversed(msg_ids):
        _, msg_data = mail.fetch(msg_id, "(RFC822)")
        raw_email = msg_data[0][1]
        msg = email.message_from_bytes(raw_email)
        
        # Decode subject
        subject = ""
        if msg["Subject"]:
            decoded = decode_header(msg["Subject"])
            subject = "".join(
                part.decode(encoding or "utf-8") if isinstance(part, bytes) else part
                for part, encoding in decoded
            )
        
        # Sender
        sender = msg.get("From", "")
        recipient = msg.get("To", "")
        date = msg.get("Date", "")
        message_id = msg.get("Message-ID", "")
        
        # Body
        body = ""
        body_html = ""
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                if content_type == "text/plain" and not body:
                    body = part.get_payload(decode=True).decode("utf-8", errors="replace")
                elif content_type == "text/html" and not body_html:
                    body_html = part.get_payload(decode=True).decode("utf-8", errors="replace")
        else:
            body = msg.get_payload(decode=True).decode("utf-8", errors="replace")
        
        emails.append({
            "message_id": message_id,
            "sender": sender,
            "recipient": recipient,
            "subject": subject,
            "body": body[:10000],
            "body_html": body_html[:10000] if body_html else None,
            "date": date,
        })
    
    mail.logout()
    return emails


async def _send_smtp(email: SendEmail):
    """Send email via SMTP"""
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    
    msg = MIMEMultipart("alternative")
    msg["Subject"] = email.subject
    msg["From"] = settings.SMTP_USER
    msg["To"] = email.to
    
    msg.attach(MIMEText(email.body, "plain", "utf-8"))
    if email.body_html:
        msg.attach(MIMEText(email.body_html, "html", "utf-8"))
    
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
        server.starttls()
        server.login(settings.SMTP_USER, settings.SMTP_PASS)
        server.send_message(msg)


def _generate_basic_response(subject: str, body: str) -> str:
    """Generate a basic response (placeholder for LLM)"""
    if "rendez-vous" in subject.lower() or "rdv" in subject.lower():
        return "Merci pour votre demande de rendez-vous. Je vous propose un créneau cette semaine. Quel jour vous conviendrait le mieux ?"
    elif "facture" in subject.lower():
        return "Bien reçu, je prends note. Je traite votre demande dans les plus brefs délais."
    elif "urgent" in subject.lower():
        return "J'ai bien noté le caractère urgent de votre message. Je m'en occupe immédiatement."
    else:
        return "Merci pour votre message. Je reviens vers vous rapidement."
