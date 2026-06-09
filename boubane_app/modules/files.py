"""File analysis module — upload, extract, summarize"""
import os
import shutil
import uuid
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from boubane_app.modules.database import get_db
from boubane_app.modules.models import FileRecord, AgentLog
from boubane_app.modules.config import settings
from boubane_app.modules.analyzer import FileAnalyzer

router = APIRouter()


class FileSummary(BaseModel):
    id: int
    filename: str
    original_name: str
    file_type: str
    file_size: int
    summary: Optional[str] = None
    tags: Optional[str] = None
    created_at: str


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    """Upload and analyze a file"""
    if not file.filename:
        raise HTTPException(400, "No filename provided")
    
    # Determine file type
    ext = Path(file.filename).suffix.lower()
    allowed = {".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv", ".txt", ".md", ".png", ".jpg", ".jpeg", ".webp"}
    if ext not in allowed:
        raise HTTPException(400, f"File type {ext} not supported. Allowed: {', '.join(allowed)}")
    
    # Save file
    file_id = str(uuid.uuid4())[:8]
    safe_name = f"{file_id}_{file.filename}"
    file_path = Path(settings.UPLOAD_DIR) / safe_name
    
    try:
        with open(file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as e:
        raise HTTPException(500, f"Failed to save file: {e}")
    
    file_size = os.path.getsize(file_path)
    
    # Analyze
    analyzer = FileAnalyzer()
    try:
        result = await analyzer.analyze(str(file_path), ext)
    except Exception as e:
        result = {"summary": f"File saved but analysis failed: {e}", "text": "", "tags": []}
    
    # Store in DB
    record = FileRecord(
        filename=safe_name,
        original_name=file.filename,
        file_type=ext.lstrip("."),
        file_size=file_size,
        summary=result.get("summary", ""),
        extracted_text=result.get("text", "")[:50000],  # Limit stored text
        tags=",".join(result.get("tags", [])),
    )
    db.add(record)
    await db.flush()
    
    # Log
    log = AgentLog(
        action="file_analysis",
        status="success",
        details=f"Analyzed {file.filename} ({file_size} bytes)",
        duration_ms=0,
    )
    db.add(log)
    
    return {
        "id": record.id,
        "filename": file.filename,
        "type": ext.lstrip("."),
        "size": file_size,
        "summary": result.get("summary", ""),
        "tags": result.get("tags", []),
    }


@router.get("/list")
async def list_files(
    limit: int = 50,
    offset: int = 0,
    file_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """List analyzed files"""
    query = select(FileRecord).order_by(desc(FileRecord.created_at))
    if file_type:
        query = query.where(FileRecord.file_type == file_type)
    query = query.offset(offset).limit(limit)
    
    result = await db.execute(query)
    files = result.scalars().all()
    
    return {
        "files": [
            {
                "id": f.id,
                "filename": f.original_name,
                "type": f.file_type,
                "size": f.file_size,
                "summary": f.summary,
                "tags": f.tags.split(",") if f.tags else [],
                "created_at": f.created_at.isoformat() if f.created_at else None,
            }
            for f in files
        ],
        "total": len(files),
    }


@router.get("/{file_id}")
async def get_file(file_id: int, db: AsyncSession = Depends(get_db)):
    """Get file details"""
    result = await db.execute(select(FileRecord).where(FileRecord.id == file_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(404, "File not found")
    
    return {
        "id": record.id,
        "filename": record.original_name,
        "type": record.file_type,
        "size": record.file_size,
        "summary": record.summary,
        "text": record.extracted_text,
        "tags": record.tags.split(",") if record.tags else [],
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


@router.get("/download/{file_id}")
async def download_file(file_id: int, db: AsyncSession = Depends(get_db)):
    """Download a file"""
    result = await db.execute(select(FileRecord).where(FileRecord.id == file_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(404, "File not found")
    file_path = Path(settings.UPLOAD_DIR) / record.filename
    if not file_path.exists():
        raise HTTPException(404, "File not found on disk")
    from fastapi.responses import FileResponse
    return FileResponse(
        str(file_path),
        filename=record.original_name,
        media_type="application/octet-stream",
    )


@router.get("/")
async def list_files_root(
    limit: int = 50,
    offset: int = 0,
    file_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """List analyzed files (root endpoint)"""
    return await list_files(limit, offset, file_type, db)
async def delete_file(file_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a file"""
    result = await db.execute(select(FileRecord).where(FileRecord.id == file_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(404, "File not found")
    
    # Delete from disk
    file_path = Path(settings.UPLOAD_DIR) / record.filename
    if file_path.exists():
        file_path.unlink()
    
    await db.delete(record)
    return {"status": "deleted", "id": file_id}
