"""Himalaya bridge — full mail client API"""
import os
import json
import subprocess
import tempfile
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/himalaya", tags=["himalaya"])
HIMALAYA = os.path.expanduser("~/.local/bin/himalaya")


def _run(args: list[str], timeout: int = 20, stdin: str = None) -> str:
    cmd = [HIMALAYA, *args]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, input=stdin)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or f"himalaya failed: {' '.join(cmd)}")
    return res.stdout


def _as_json(text: str):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to find JSON in the output (skip WARN/INFO lines)
        for line in text.splitlines():
            line = line.strip()
            if line.startswith('{') or line.startswith('['):
                try:
                    return json.loads(line)
                except json.JSONDecodeError:
                    continue
        # Try to find JSON anywhere in the text
        import re
        m = re.search(r'[\{\[].*[\}\]]', text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except json.JSONDecodeError:
                pass
        return None


def _parse_envelopes(text: str) -> list[dict]:
    data = _as_json(text)
    if isinstance(data, list):
        return data
    rows: list[dict] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("|--") or set(line.strip()) == set("|-"):
            continue
        if line.startswith("|"):
            parts = [p.strip() for p in line.strip().strip("|").split("|")]
            if len(parts) >= 5 and parts[0].isdigit():
                rows.append({
                    "id": parts[0],
                    "flags": parts[1].replace("*", "Seen").split(),
                    "subject": parts[2],
                    "from": parts[3],
                    "date": parts[4],
                })
    return rows


def _normalize_envelope(item: dict) -> dict:
    sender = item.get("from") or item.get("From") or ""
    if isinstance(sender, dict):
        sender = sender.get("name") or sender.get("addr") or ""
    flags = item.get("flags") or item.get("FLAGS") or []
    if isinstance(flags, str):
        flags = flags.split()
    return {
        "id": str(item.get("id") or item.get("ID") or ""),
        "subject": item.get("subject") or item.get("Subject") or "",
        "from": sender,
        "date": item.get("date") or item.get("Date") or "",
        "flags": flags,
    }


# ─── Models ───

class ComposeMsg(BaseModel):
    to: str
    subject: str = ""
    body: str = ""

class MoveMsg(BaseModel):
    folder: str

class FlagAction(BaseModel):
    flags: list[str]  # ["Seen"], ["Flagged"], ["Deleted"], etc.


# ─── Folders ───

@router.get("/folders")
async def list_folders():
    stdout = _run(["folder", "list", "--output", "json"])
    data = _as_json(stdout)
    if isinstance(data, list):
        return JSONResponse(content={"folders": data})
    return JSONResponse(content={"folders": [{"name": line.strip()} for line in stdout.splitlines() if line.strip()]})


# ─── Envelopes ───

@router.get("/envelopes")
async def list_envelopes(limit: int = Query(20, ge=1, le=200), folder: str = "INBOX"):
    args = ["envelope", "list", "--folder", folder, "--page", "1", "--page-size", str(limit), "--output", "json"]
    stdout = _run(args, timeout=20)
    data = _as_json(stdout)
    items = data if isinstance(data, list) else _parse_envelopes(stdout)
    return JSONResponse(content={"envelopes": [_normalize_envelope(x) for x in items]})


# ─── Message read / thread ───

@router.get("/message/{message_id}")
async def read_message(message_id: str):
    # Try JSON first, fall back to plain
    try:
        stdout = _run(["message", "read", "--output", "json", message_id])
        data = _as_json(stdout)
        if isinstance(data, dict):
            return JSONResponse(content={**data, "message_id": message_id})
    except Exception:
        pass
    stdout = _run(["message", "read", message_id])
    data = _as_json(stdout)
    body = json.dumps(data, ensure_ascii=False) if isinstance(data, dict) else stdout
    return JSONResponse(content={"message_id": message_id, "body": body})


@router.get("/message/{message_id}/html")
async def read_message_html(message_id: str):
    """Fetch the raw MIME message and extract the HTML part."""
    import email
    import email.policy
    import glob as globmod
    import tempfile
    try:
        # himalaya message export writes to a temp file, we need to read it
        tmpdir = tempfile.mkdtemp(prefix="boubane-mime-")
        _run(["message", "export", "-F", "-d", tmpdir, message_id], timeout=30)
        # Read the exported file
        files = globmod.glob(f"{tmpdir}/*")
        if not files:
            return JSONResponse(content={"message_id": message_id, "html": None, "text": None, "error": "No exported file"})
        raw = open(files[0], "r", encoding="utf-8", errors="replace").read()
        # Clean up
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)

        msg = email.message_from_string(raw, policy=email.policy.default)
        html_body = None
        text_body = None

        if msg.is_multipart():
            for part in msg.walk():
                ct = part.get_content_type()
                if ct == "text/html" and html_body is None:
                    try:
                        payload = part.get_payload(decode=True)
                        if payload:
                            charset = part.get_content_charset() or "utf-8"
                            html_body = payload.decode(charset, errors="replace")
                        else:
                            html_body = str(part.get_payload())
                    except Exception:
                        pass
                elif ct == "text/plain" and text_body is None:
                    try:
                        payload = part.get_payload(decode=True)
                        if payload:
                            charset = part.get_content_charset() or "utf-8"
                            text_body = payload.decode(charset, errors="replace")
                        else:
                            text_body = str(part.get_payload())
                    except Exception:
                        pass
        else:
            ct = msg.get_content_type()
            try:
                payload = msg.get_payload(decode=True)
                if payload:
                    charset = msg.get_content_charset() or "utf-8"
                    content = payload.decode(charset, errors="replace")
                else:
                    content = str(msg.get_payload())
            except Exception:
                content = str(msg.get_payload())
            if ct == "text/html":
                html_body = content
            else:
                text_body = content

        return JSONResponse(content={
            "message_id": message_id,
            "html": html_body,
            "text": text_body,
            "has_html": html_body is not None,
        })
    except Exception as e:
        return JSONResponse(content={"message_id": message_id, "html": None, "text": None, "error": str(e)})


@router.get("/message/{message_id}/thread")
async def read_thread(message_id: str):
    stdout = _run(["message", "thread", message_id])
    return JSONResponse(content={"message_id": message_id, "thread": stdout})


# ─── Flags ───

@router.post("/message/{message_id}/flag/add")
async def flag_add(message_id: str, body: FlagAction):
    _run(["flag", "add", *body.flags, message_id])
    return JSONResponse(content={"ok": True, "flags": body.flags, "action": "add"})


@router.post("/message/{message_id}/flag/remove")
async def flag_remove(message_id: str, body: FlagAction):
    _run(["flag", "remove", *body.flags, message_id])
    return JSONResponse(content={"ok": True, "flags": body.flags, "action": "remove"})


@router.post("/message/{message_id}/flag/set")
async def flag_set(message_id: str, body: FlagAction):
    _run(["flag", "set", *body.flags, message_id])
    return JSONResponse(content={"ok": True, "flags": body.flags, "action": "set"})


# ─── Actions ───

@router.post("/message/{message_id}/delete")
async def delete_message(message_id: str):
    _run(["message", "delete", message_id])
    return JSONResponse(content={"ok": True, "action": "delete", "message_id": message_id})


@router.post("/message/{message_id}/move")
async def move_message(message_id: str, body: MoveMsg):
    _run(["message", "move", body.folder, message_id])
    return JSONResponse(content={"ok": True, "action": "move", "message_id": message_id, "folder": body.folder})


@router.post("/message/{message_id}/copy")
async def copy_message(message_id: str, body: MoveMsg):
    _run(["message", "copy", body.folder, message_id])
    return JSONResponse(content={"ok": True, "action": "copy", "message_id": message_id, "folder": body.folder})


# ─── Reply / Forward ───

@router.get("/message/{message_id}/reply")
async def reply_message(message_id: str):
    """Get a reply template for the message."""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.eml', delete=False) as f:
        try:
            # Write will open $EDITOR, we can't use that. Instead compose manually.
            # Return the message so the frontend can build the reply.
            stdout = _run(["message", "read", message_id])
            data = _as_json(stdout)
            body = json.dumps(data, ensure_ascii=False) if isinstance(data, dict) else stdout
            return JSONResponse(content={"message_id": message_id, "body": body, "action": "reply"})
        finally:
            try:
                os.unlink(f.name)
            except OSError:
                pass


@router.get("/message/{message_id}/forward")
async def forward_message(message_id: str):
    """Get a forward template for the message."""
    stdout = _run(["message", "read", message_id])
    data = _as_json(stdout)
    body = json.dumps(data, ensure_ascii=False) if isinstance(data, dict) else stdout
    return JSONResponse(content={"message_id": message_id, "body": body, "action": "forward"})


# ─── Compose / Send ───

@router.post("/send")
async def send_message(msg: ComposeMsg):
    """Send a message via SMTP directly."""
    SMTP_HOST = "smtp.gmail.com"
    SMTP_PORT = 587
    EMAIL = "saillgentowl@gmail.com"
    # Read password from config
    import tomllib
    cfg_path = os.path.expanduser("~/.config/himalaya/config.toml")
    password = ""
    try:
        with open(cfg_path, "rb") as f:
            cfg = tomllib.load(f)
        password = cfg.get("accounts", {}).get("personal", {}).get("message", {}).get("send", {}).get("backend", {}).get("auth", {}).get("raw", "")
        if not password:
            password = cfg.get("accounts", {}).get("personal", {}).get("backend", {}).get("auth", {}).get("raw", "")
    except Exception:
        pass

    try:
        mime = MIMEMultipart()
        mime["From"] = EMAIL
        mime["To"] = msg.to
        mime["Subject"] = msg.subject or ""
        mime.attach(MIMEText(msg.body or "", "plain", "utf-8"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as s:
            s.ehlo()
            s.starttls()
            s.ehlo()
            s.login(EMAIL, password)
            s.send_message(mime)

        return JSONResponse(content={"ok": True, "action": "send", "to": msg.to})
    except Exception as e:
        raise RuntimeError(f"Send failed: {e}")


@router.post("/message/{message_id}/reply/send")
async def reply_send(message_id: str, msg: ComposeMsg):
    """Send a reply to a message."""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.eml', delete=False) as f:
        try:
            f.write(f"To: {msg.to}\n")
            f.write(f"Subject: {msg.subject}\n")
            f.write("\n")
            f.write(msg.body)
            f.flush()
            _run(["message", "send", f.name])
            return JSONResponse(content={"ok": True, "action": "reply", "to": msg.to})
        finally:
            try:
                os.unlink(f.name)
            except OSError:
                pass


# ─── Attachments ───

@router.get("/message/{message_id}/attachments")
async def list_attachments(message_id: str):
    """List attachments by reading the raw message headers."""
    try:
        stdout = _run(["message", "export", message_id])
        # Parse MIME for attachment info
        attachments = []
        lines = stdout.splitlines()
        i = 0
        while i < len(lines):
            line = lines[i]
            if line.startswith("Content-Disposition: attachment") or line.startswith("Content-Disposition: Attachment"):
                name = "attachment"
                for part in line.split(";"):
                    part = part.strip()
                    if part.startswith("filename="):
                        name = part.split("=", 1)[1].strip().strip('"').strip("'")
                ct = "application/octet-stream"
                # Look back for Content-Type
                for j in range(max(0, i-3), i):
                    if lines[j].lower().startswith("content-type:"):
                        ct = lines[j].split(":", 1)[1].strip().split(";")[0].strip()
                attachments.append({"filename": name, "content_type": ct, "index": len(attachments)})
            i += 1
        return JSONResponse(content={"message_id": message_id, "attachments": attachments})
    except Exception as e:
        return JSONResponse(content={"message_id": message_id, "attachments": [], "error": str(e)})


@router.post("/message/{message_id}/attachments/download")
async def download_attachments(message_id: str):
    """Download all attachments for a message to a temp dir and return paths."""
    tmpdir = tempfile.mkdtemp(prefix="boubane-attach-")
    try:
        _run(["attachment", "download", "--dir", tmpdir, message_id])
        import glob
        files = glob.glob(f"{tmpdir}/*")
        return JSONResponse(content={
            "message_id": message_id,
            "files": [os.path.basename(f) for f in files],
            "dir": tmpdir,
        })
    except Exception as e:
        return JSONResponse(content={"error": str(e)})


@router.post("/message/{message_id}/attachments/save")
async def save_attachments_to_files(message_id: str):
    """Download attachments and save them as analyzed files"""
    import glob
    from pathlib import Path
    from app.modules.config import settings

    tmpdir = tempfile.mkdtemp(prefix="boubane-attach-")
    try:
        _run(["attachment", "download", "--dir", tmpdir, message_id])
        files = glob.glob(f"{tmpdir}/*")
        saved = []
        for fpath in files:
            fname = os.path.basename(fpath)
            fsize = os.path.getsize(fpath)
            ext = Path(fname).suffix.lower()
            # Copy to uploads
            dest = Path(settings.UPLOAD_DIR) / f"msg{message_id}_{fname}"
            import shutil
            shutil.copy2(fpath, dest)
            saved.append({
                "filename": fname,
                "size": fsize,
                "type": ext.lstrip("."),
                "saved_as": str(dest),
            })
        return JSONResponse(content={
            "message_id": message_id,
            "saved": saved,
            "count": len(saved),
        })
    except Exception as e:
        return JSONResponse(content={"error": str(e)})
