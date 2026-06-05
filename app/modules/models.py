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
