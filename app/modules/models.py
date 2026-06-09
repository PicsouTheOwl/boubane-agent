"""SQLAlchemy models"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, Float
from sqlalchemy.sql import func
from app.modules.database import Base


class FileRecord(Base):
    __tablename__ = "files"
    
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(512), nullable=False)
    original_name = Column(String(512), nullable=False)
    file_type = Column(String(50))  # pdf, docx, xlsx, image, etc.
    file_size = Column(Integer)
    summary = Column(Text)  # AI-generated summary
    extracted_text = Column(Text)  # Raw extracted text
    tags = Column(String(500))  # Comma-separated tags
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class WebTask(Base):
    __tablename__ = "web_tasks"
    
    id = Column(Integer, primary_key=True, index=True)
    url = Column(String(2048), nullable=False)
    task_type = Column(String(50))  # scrape, summarize, extract
    status = Column(String(20), default="pending")  # pending, running, done, error
    result = Column(Text)
    error = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True))


class EmailRecord(Base):
    __tablename__ = "emails"
    
    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(String(512), unique=True)
    sender = Column(String(512))
    recipient = Column(String(512))
    subject = Column(String(1024))
    body = Column(Text)
    body_html = Column(Text)
    is_read = Column(Boolean, default=False)
    is_important = Column(Boolean, default=False)
    category = Column(String(100))  # client, supplier, prospect, spam, etc.
    ai_summary = Column(Text)
    ai_response = Column(Text)
    received_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AgentLog(Base):
    __tablename__ = "agent_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    action = Column(String(100))  # file_analysis, web_scrape, email_process
    status = Column(String(20))  # success, error
    details = Column(Text)
    duration_ms = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ═══════════════════════════════════════════
# BUSINESS MODELS
# ═══════════════════════════════════════════

class Client(Base):
    __tablename__ = "clients"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(256), nullable=False)
    email = Column(String(512), nullable=False)
    company = Column(String(256), default="")
    plan = Column(String(50), default="starter")  # starter, pro, enterprise
    status = Column(String(50), default="trial")  # active, trial, churned, paused
    mrr = Column(Float, default=0.0)
    notes = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class SiteStatus(Base):
    __tablename__ = "site_status"

    id = Column(Integer, primary_key=True, index=True)
    url = Column(String(2048), default="")
    status = Column(String(20), default="unknown")  # up, down, degraded, unknown
    version = Column(String(50), default="")
    http_code = Column(Integer, default=0)
    response_time_ms = Column(Float, default=0)
    uptime_pct = Column(Float, default=100.0)
    last_deploy = Column(DateTime(timezone=True))
    error = Column(Text, default="")
    checked_at = Column(DateTime(timezone=True), server_default=func.now())


class BusinessMetric(Base):
    __tablename__ = "business_metrics"

    id = Column(Integer, primary_key=True, index=True)
    metric_name = Column(String(100), nullable=False)  # mrr, clients, churn, etc.
    metric_value = Column(Float, default=0.0)
    recorded_at = Column(DateTime(timezone=True), server_default=func.now())


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, default=0)
    plan = Column(String(50), default="starter")
    status = Column(String(50), default="active")
    start_date = Column(DateTime(timezone=True))
    end_date = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ═══════════════════════════════════════════
# CALENDAR MODELS
# ═══════════════════════════════════════════

class CalendarAccount(Base):
    __tablename__ = "calendar_accounts"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String(50), nullable=False)  # google, apple, caldav, outlook
    name = Column(String(256), default="")
    email = Column(String(512), default="")
    is_active = Column(Boolean, default=True)
    # Google
    google_refresh_token = Column(String(1024), default="")
    google_calendar_id = Column(String(256), default="primary")
    # CalDAV
    caldav_url = Column(String(2048), default="")
    caldav_username = Column(String(512), default="")
    caldav_password = Column(String(512), default="")
    # Outlook
    ms_refresh_token = Column(String(1024), default="")
    # Sync
    last_sync = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CalendarEvent(Base):
    __tablename__ = "calendar_events"

    id = Column(Integer, primary_key=True, index=True)
    external_id = Column(String(512), default="")  # ID from provider
    account_id = Column(Integer, default=0)
    title = Column(String(512), default="")
    description = Column(Text, default="")
    start_time = Column(DateTime(timezone=True))
    end_time = Column(DateTime(timezone=True))
    location = Column(String(512), default="")
    attendees = Column(Text, default="")  # comma-separated
    provider = Column(String(50), default="local")  # local, google, caldav, outlook
    is_all_day = Column(Boolean, default=False)
    is_cancelled = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
