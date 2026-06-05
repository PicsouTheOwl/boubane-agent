"""Configuration — loads from .env or environment variables"""
from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

class Settings(BaseSettings):
    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 3000
    
    # Paths
    UPLOAD_DIR: str = str(BASE_DIR / "data" / "uploads")
    DB_DIR: str = str(BASE_DIR / "data" / "db")
    CACHE_DIR: str = str(BASE_DIR / "data" / "cache")
    
    # Database
    DATABASE_URL: str = f"sqlite+aiosqlite:///{BASE_DIR / 'data' / 'db' / 'boubane.db'}"
    
    # Email (optional — configured per client)
    IMAP_HOST: str = ""
    IMAP_PORT: int = 993
    IMAP_USER: str = ""
    IMAP_PASS: str = ""
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    
    # AI Model (optional — for local LLM)
    MODEL_PATH: str = ""  # Path to GGUF model
    
    class Config:
        env_file = str(BASE_DIR / ".env")
        env_file_encoding = "utf-8"

settings = Settings()
