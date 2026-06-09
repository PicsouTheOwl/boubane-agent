"""Web browsing module — navigate, scrape, summarize"""
import asyncio
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from boubane_app.modules.database import get_db
from boubane_app.modules.models import WebTask, AgentLog

router = APIRouter()


class WebRequest(BaseModel):
    url: str
    task_type: str = "scrape"  # scrape, summarize, extract_links
    selector: Optional[str] = None  # CSS selector for extraction


class WebResponse(BaseModel):
    id: int
    url: str
    task_type: str
    status: str
    result: Optional[str] = None


@router.post("/browse")
async def browse_web(
    request: WebRequest,
    db: AsyncSession = Depends(get_db)
):
    """Navigate to a URL and extract content"""
    # Create task
    task = WebTask(
        url=request.url,
        task_type=request.task_type,
        status="pending",
    )
    db.add(task)
    await db.flush()
    
    # Execute
    try:
        result = await _execute_web_task(request.url, request.task_type, request.selector)
        task.status = "done"
        task.result = result.get("content", "")[:50000]
    except Exception as e:
        task.status = "error"
        task.error = str(e)
        result = {"content": f"Error: {e}"}
    
    # Log
    log = AgentLog(
        action="web_scrape",
        status=task.status,
        details=f"{request.task_type} on {request.url}",
        duration_ms=0,
    )
    db.add(log)
    
    return {
        "id": task.id,
        "url": request.url,
        "task_type": request.task_type,
        "status": task.status,
        "result": task.result,
        "error": task.error,
    }


@router.get("/tasks")
async def list_tasks(
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    """List web browsing tasks"""
    result = await db.execute(
        select(WebTask).order_by(desc(WebTask.created_at)).limit(limit)
    )
    tasks = result.scalars().all()
    return {
        "tasks": [
            {
                "id": t.id,
                "url": t.url,
                "type": t.task_type,
                "status": t.status,
                "result": t.result[:500] if t.result else None,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in tasks
        ]
    }


@router.get("/task/{task_id}")
async def get_task(task_id: int, db: AsyncSession = Depends(get_db)):
    """Get full task result"""
    result = await db.execute(select(WebTask).where(WebTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Task not found")
    return {
        "id": task.id,
        "url": task.url,
        "type": task.task_type,
        "status": task.status,
        "result": task.result,
        "error": task.error,
    }


async def _execute_web_task(url: str, task_type: str, selector: Optional[str] = None) -> dict:
    """Execute a web browsing task using Playwright or fallback to httpx"""
    # Try Playwright first
    try:
        from playwright.async_api import async_playwright
        
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page(
                user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
            )
            
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(2000)  # Wait for JS
            
            if task_type == "scrape":
                if selector:
                    elements = await page.query_selector_all(selector)
                    texts = []
                    for el in elements:
                        text = await el.inner_text()
                        if text.strip():
                            texts.append(text.strip())
                    content = "\n\n".join(texts)
                else:
                    # Extract main content
                    content = await page.evaluate("""() => {
                        // Try to get main content
                        const selectors = ['main', 'article', '.content', '#content', '.post', '.entry'];
                        for (const sel of selectors) {
                            const el = document.querySelector(sel);
                            if (el && el.innerText.length > 200) return el.innerText;
                        }
                        // Fallback: body text
                        return document.body.innerText;
                    }""")
            
            elif task_type == "summarize":
                content = await page.evaluate("() => document.body.innerText")
                title = await page.title()
                content = f"# {title}\n\n{content}"
            
            elif task_type == "extract_links":
                links = await page.evaluate("""() => {
                    return Array.from(document.querySelectorAll('a[href]'))
                        .map(a => ({text: a.innerText.trim(), href: a.href}))
                        .filter(l => l.text && l.href.startsWith('http'));
                }""")
                content = "\n".join(f"{l['text']}: {l['href']}" for l in links[:100])
            
            else:
                content = await page.evaluate("() => document.body.innerText")
            
            await browser.close()
            return {"content": content[:30000]}
    
    except ImportError:
        # Fallback: httpx
        import httpx
        from html.parser import HTMLParser
        
        async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
            resp = await client.get(url, headers={
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
            })
            resp.raise_for_status()
            
            # Strip HTML tags
            class TextExtractor(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self.text = []
                    self.skip = False
                    self.skip_tags = {"script", "style", "nav", "footer", "header"}
                
                def handle_starttag(self, tag, attrs):
                    if tag in self.skip_tags:
                        self.skip = True
                
                def handle_endtag(self, tag):
                    if tag in self.skip_tags:
                        self.skip = False
                
                def handle_data(self, data):
                    if not self.skip and data.strip():
                        self.text.append(data.strip())
            
            extractor = TextExtractor()
            extractor.feed(resp.text)
            content = "\n".join(extractor.text)
            
            return {"content": content[:30000]}
