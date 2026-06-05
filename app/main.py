"""Boubane Agent — Main FastAPI Application"""
import os
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

from app.modules.database import init_db
from app.modules.config import settings

# Create directories
Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
Path(settings.DB_DIR).mkdir(parents=True, exist_ok=True)
Path(settings.CACHE_DIR).mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="Boubane Agent",
    description="Votre IA locale — fichiers, web, emails",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static & templates
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")


@app.on_event("startup")
async def startup():
    await init_db()


# ─── Dashboard (main page) ───
@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})


# ─── API Routes ───
from app.modules.files import router as files_router
from app.modules.web import router as web_router
from app.modules.email import router as email_router
from app.modules.agent import router as agent_router

app.include_router(files_router, prefix="/api/files", tags=["files"])
app.include_router(web_router, prefix="/api/web", tags=["web"])
app.include_router(email_router, prefix="/api/email", tags=["email"])
app.include_router(agent_router, prefix="/api/agent", tags=["agent"])


# ─── Health ───
@app.get("/health")
async def health():
    return {"status": "ok", "agent": "boubane", "version": "1.0.0"}
