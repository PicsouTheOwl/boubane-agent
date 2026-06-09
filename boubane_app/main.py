"""Boubane Agent — Main FastAPI Application"""
import os
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from boubane_app.modules.database import init_db
from boubane_app.modules.config import settings

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
from boubane_app.modules.files import router as files_router
from boubane_app.modules.web import router as web_router
from boubane_app.modules.agent import router as agent_router

app.include_router(files_router, prefix="/api/files", tags=["files"])
app.include_router(web_router, prefix="/api/web", tags=["web"])
app.include_router(agent_router, prefix="/api/agent", tags=["agent"])

# ─── Himalaya Mail Bridge ───
from boubane_app.modules.himalaya_mail import router as himalaya_router
app.include_router(himalaya_router, tags=["himalaya"])

# ─── Auto-process (tri IA + brouillon réponse) ───
from boubane_app.modules.auto_process import router as auto_router
app.include_router(auto_router, tags=["auto-process"])

# ─── Hermes Agent Routes ───
from boubane_app.modules.hermes.routes import router as hermes_router
app.include_router(hermes_router, tags=["hermes"])

# ─── Business Module ───
from boubane_app.modules.business import router as business_router
app.include_router(business_router, prefix="/api/business", tags=["business"])

# ─── Calendar Module ───
from boubane_app.modules.calendar import router as calendar_router
app.include_router(calendar_router, prefix="/api/calendar", tags=["calendar"])

# ─── Kanban Module ───
from boubane_app.modules.kanban import router as kanban_router
app.include_router(kanban_router, tags=["kanban"])


# ─── Health ───
@app.get("/health")
async def health():
    return {"status": "ok", "agent": "boubane", "version": "1.0.0"}