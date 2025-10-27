# services/crawl4ai_service.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
import os, asyncio, re

# Crawl4AI 0.7.x
from crawl4ai import AsyncWebCrawler, CrawlerRunConfig
from crawl4ai.content_scraping_strategy import LXMLWebScrapingStrategy

# ================== Config ==================
PAGE_TIMEOUT = int(os.getenv("CRAWL_PAGE_TIMEOUT", "20"))  # segundos
MIN_TEXT_LEN = int(os.getenv("CRAWL_MIN_TEXT", "150"))     # mínimo de caracteres útiles

app = FastAPI(title="Crawl4AI Microservice", version="0.2.0")

# CORS abierto (ajústalo si quieres limitar orígenes)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True}

# ================== Schemas ==================
class FetchIn(BaseModel):
    url: str

class FetchOutItem(BaseModel):
    url: str
    title: str = ""
    markdown: str = ""

class FetchOut(BaseModel):
    ok: bool = True
    data: FetchOutItem

class CrawlIn(BaseModel):
    url: str
    limit: int = 50
    maxDepth: int = 2
    deny: List[str] = Field(default_factory=list)

class CrawlOut(BaseModel):
    ok: bool = True
    data: dict

# ================== Helpers ==================
async def arun_with_timeout(crawler, url: str, cfg, timeout_s: int = PAGE_TIMEOUT):
    """Lanza crawler.arun con un límite duro por URL."""
    try:
        return await asyncio.wait_for(crawler.arun(url=url, config=cfg), timeout=timeout_s)
    except Exception:
        return None

def pick_text(page) -> str:
    # 1) strings directos
    for attr in ("markdown_v2", "markdown", "cleaned_text", "content", "text"):
        val = getattr(page, attr, None)
        if isinstance(val, str) and val.strip():
            return val
        if attr == "markdown" and val and not isinstance(val, str):
            raw = getattr(val, "raw_markdown", None)
            if isinstance(raw, str) and raw.strip():
                return raw
            md2 = getattr(val, "markdown", None)
            if isinstance(md2, str) and md2.strip():
                return md2
    # 2) fallback a html
    html = getattr(page, "html", None)
    if isinstance(html, str) and html.strip():
        s = re.sub(r"(?is)<(script|style|noscript).*?>.*?</\1>", "", html)
        s = re.sub(r"(?is)<[^>]+>", "\n", s)
        s = re.sub(r"[ \t]+\n", "\n", s)
        s = re.sub(r"\n{3,}", "\n\n", s)
        return s.strip()
    return ""

def _title(res) -> str:
    return getattr(res, "title", "") or ""

def _url(res) -> str:
    return getattr(res, "url", "") or getattr(res, "page_url", "") or ""

EXT_DENY = {
    ".css",".js",".map",".ico",".png",".jpg",".jpeg",".webp",".gif",".svg",
    ".pdf",".zip",".rar",".7z",".gz",".mp3",".mp4",".mov",".avi",".mkv",
    ".woff",".woff2",".ttf",".eot",".obj",".glb",".gltf",".csv"
}

PATH_DENY_SUBSTR = [
    "/wp-json/", "/wp-content/", "/wp-includes/", "/xmlrpc.php", "/oembed/",
    "/feed/", "/comments/", "/favicon", "/favicons/", "/static/", "/assets/",
    "/tag/", "/category/", "/author/"
]

QUERY_DENY_KEYS = {"amp","format","feed","fbclid","gclid","yclid","_hsenc","_hsmi"}
QUERY_DENY_PREFIXES = ("utm_", "ga_", "pk_", "mc_")

def normalize_url(u: str) -> str:
    try:
        p = urlparse(u)
        if p.scheme not in ("http","https"):
            return ""
        q = []
        for k, v in parse_qsl(p.query, keep_blank_values=True):
            kl = k.lower()
            if kl in QUERY_DENY_KEYS:
                continue
            if any(kl.startswith(pref) for pref in QUERY_DENY_PREFIXES):
                continue
            q.append((k, v))
        path = p.path or "/"
        while "//" in path:
            path = path.replace("//", "/")
        netloc = p.netloc.lower()
        return urlunparse((p.scheme, netloc, path, "", urlencode(q, doseq=True), ""))
    except:
        return ""

def has_bad_extension(path: str) -> bool:
    low = path.lower()
    for ext in EXT_DENY:
        if low.endswith(ext):
            return True
    return False

def likely_useless_path(path: str) -> bool:
    low = path.lower()
    return any(s in low for s in PATH_DENY_SUBSTR)

def likely_useless_query(query: str) -> bool:
    if not query:
        return False
    ql = query.lower()
    if "format=xml" in ql or "feed=" in ql:
        return True
    if "p=" in ql and "&" not in ql:
        return True
    return False

def should_visit(seed: str, link: str) -> bool:
    u = normalize_url(link)
    if not u:
        return False
    P = urlparse(u)
    if has_bad_extension(P.path):
        return False
    if likely_useless_path(P.path):
        return False
    if likely_useless_query(P.query):
        return False
    def base_host(x: str) -> str:
        try:
            h = urlparse(x).netloc.lower()
            return h[4:] if h.startswith("www.") else h
        except:
            return ""
    return base_host(seed) == base_host(u) != ""

def _coalesce_pages(result):
    for key in ("pages", "page_results", "results", "crawled_pages"):
        val = getattr(result, key, None)
        if val:
            return list(val)
    dcr = getattr(result, "deep_crawl_result", None)
    if dcr:
        for key in ("pages", "page_results", "results", "crawled_pages"):
            val = getattr(dcr, key, None)
            if val:
                return list(val)
    try:
        return list(result)
    except Exception:
        return []

def _blocked_path(url: str, deny: List[str]) -> bool:
    path = urlparse(url).path or "/"
    return any(path.startswith(d) for d in deny)

# ================== Endpoints ==================
@app.post("/fetch", response_model=FetchOut)
async def fetch_one(inp: FetchIn):
    """Fetch de UNA sola URL (sin deep crawl) con timeout por página."""
    cfg = CrawlerRunConfig(scraping_strategy=LXMLWebScrapingStrategy())
    async with AsyncWebCrawler() as crawler:
        res = await arun_with_timeout(crawler, inp.url, cfg, PAGE_TIMEOUT)

    if res is None:
        # Timeout/errores: devolvemos vacío para no bloquear a quien llama
        return FetchOut(ok=True, data=FetchOutItem(url=inp.url, title="", markdown=""))

    txt = pick_text(res)
    ttl = _title(res)
    url = _url(res) or inp.url
    if not txt:
        pages = _coalesce_pages(res)
        if pages:
            p = pages[0]
            txt = pick_text(p)
            ttl = _title(p) or ttl
            url = _url(p) or url

    return FetchOut(ok=True, data=FetchOutItem(url=url, title=ttl, markdown=txt or ""))

@app.post("/crawl", response_model=CrawlOut)
async def crawl_site(inp: CrawlIn):
    """
    BFS con control de límite y filtros. Cuenta solo páginas con texto >= MIN_TEXT_LEN.
    Se aplica timeout por página para evitar bloqueos largos.
    Si no se obtiene nada, hay fallback a la seed.
    """
    from urllib.parse import urljoin

    seed = normalize_url(inp.url.strip())
    if not seed:
        return CrawlOut(ok=True, data={"items": []})

    limit = max(1, int(inp.limit))
    max_depth = max(0, int(inp.maxDepth))
    deny = list(inp.deny or [])

    def extract_links(res, page_url: str):
        out = set()
        for key in ("links", "outlinks", "all_links", "extracted_links"):
            val = getattr(res, key, None)
            if not val:
                continue
            if isinstance(val, (list, tuple, set)):
                for it in val:
                    href = (it.get("href") if isinstance(it, dict) else str(it)).strip() if it else ""
                    if href:
                        out.add(urljoin(page_url, href))
        html = getattr(res, "html", None)
        if isinstance(html, str) and "<a" in html:
            for m in re.finditer(r'href\s*=\s*["\']([^"\']+)["\']', html, flags=re.I):
                href = m.group(1).strip()
                if href:
                    out.add(urljoin(page_url, href))
        return out

    cfg = CrawlerRunConfig(scraping_strategy=LXMLWebScrapingStrategy())

    seen = set()
    queue = [(seed, 0)]
    items: List[dict] = []

    async with AsyncWebCrawler() as crawler:
        while queue and len(items) < limit:
            url, depth = queue.pop(0)
            if not url or url in seen:
                continue
            seen.add(url)

            if _blocked_path(url, deny):
                continue
            if not should_visit(seed, url):
                continue

            # === FETCH con timeout propio ===
            res = await arun_with_timeout(crawler, url, cfg, PAGE_TIMEOUT)
            if res is None:
                continue  # URL lenta o con error: saltamos

            page_url = normalize_url(_url(res) or url)
            if not should_visit(seed, page_url):
                continue

            title = _title(res)
            text = (pick_text(res) or "").strip()

            if len(text) >= MIN_TEXT_LEN:
                items.append({"url": page_url, "title": title, "markdown": text})
                if len(items) >= limit:
                    break

            if depth < max_depth:
                for link in extract_links(res, page_url):
                    cand = normalize_url(link)
                    if not cand or cand in seen:
                        continue
                    if _blocked_path(cand, deny):
                        continue
                    if not should_visit(seed, cand):
                        continue
                    queue.append((cand, depth + 1))

    # ---- Fallback: si no hubo items, intenta devolver al menos la seed ----
    if not items:
        cfg = CrawlerRunConfig(scraping_strategy=LXMLWebScrapingStrategy())
        async with AsyncWebCrawler() as crawler:
            res = await arun_with_timeout(crawler, seed, cfg, PAGE_TIMEOUT)
        if res:
            title = _title(res)
            text = (pick_text(res) or "").strip()
            if len(text) >= max(60, MIN_TEXT_LEN // 2):
                items.append({"url": seed, "title": title, "markdown": text})

    return CrawlOut(ok=True, data={"items": items})
