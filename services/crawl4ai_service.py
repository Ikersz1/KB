# services/crawl4ai_service.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Set
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode, urljoin
import os, re, asyncio

# ======= Modo y límites por ENV =======
FAST_MODE = os.getenv("FAST_MODE", "0") == "1"          # En Render: 0 si necesitas JS; 1 si quieres solo httpx+lxml
PAGE_TIMEOUT = int(os.getenv("CRAWL_PAGE_TIMEOUT", "20"))  # en segundos (se convierte a ms si usa Playwright)
MIN_TEXT_LEN = int(os.getenv("CRAWL_MIN_TEXT", "300"))
CRAWL_MAX_CONCURRENCY = int(os.getenv("CRAWL_MAX_CONCURRENCY", "2"))

# ======= (Solo si no es FAST_MODE) Crawl4AI =======
if not FAST_MODE:
    from crawl4ai import AsyncWebCrawler, CrawlerRunConfig
    from crawl4ai.content_scraping_strategy import LXMLWebScrapingStrategy

app = FastAPI(title="Crawl Microservice", version="0.2.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True, "fast": FAST_MODE}

# ✅ Evita 404 en / (Render hace HEAD/GET a / a veces)
@app.get("/")
def root():
    return {"ok": True, "service": "crawl", "fast": FAST_MODE}

# =============== Schemas ===============
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

# =============== Normalización / filtros ===============
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
            if kl in QUERY_DENY_KEYS: continue
            if any(kl.startswith(pref) for pref in QUERY_DENY_PREFIXES): continue
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
    return any(low.endswith(ext) for ext in EXT_DENY)

def likely_useless_path(path: str) -> bool:
    low = path.lower()
    return any(s in low for s in PATH_DENY_SUBSTR)

def likely_useless_query(query: str) -> bool:
    if not query: return False
    ql = query.lower()
    if "format=xml" in ql or "feed=" in ql: return True
    if "p=" in ql and "&" not in ql: return True
    return False

def _base_host(x: str) -> str:
    try:
        h = urlparse(x).netloc.lower()
        return h[4:] if h.startswith("www.") else h
    except:
        return ""

def should_visit(seed: str, link: str) -> bool:
    u = normalize_url(link)
    if not u: return False
    P = urlparse(u)
    if has_bad_extension(P.path): return False
    if likely_useless_path(P.path): return False
    if likely_useless_query(P.query): return False
    return _base_host(seed) == _base_host(u) != ""

def _blocked_path(url: str, deny: List[str]) -> bool:
    path = urlparse(url).path or "/"
    return any(path.startswith(d) for d in deny)

# =============== Parsers de texto ===============
def strip_html(html: str) -> str:
    s = re.sub(r"(?is)<(script|style|noscript).*?>.*?</\1>", "", html)
    s = re.sub(r"(?is)<[^>]+>", "\n", s)
    s = re.sub(r"[ \t]+\n", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()

def pick_text_from_obj(page) -> str:
    for attr in ("markdown_v2", "markdown", "cleaned_text", "content", "text"):
        val = getattr(page, attr, None)
        if isinstance(val, str) and val.strip():
            return val
        if attr == "markdown" and val and not isinstance(val, str):
            raw = getattr(val, "raw_markdown", None)
            if isinstance(raw, str) and raw.strip(): return raw
            md2 = getattr(val, "markdown", None)
            if isinstance(md2, str) and md2.strip(): return md2
    html = getattr(page, "html", None)
    if isinstance(html, str) and html.strip():
        return strip_html(html)
    return ""

def _title(res) -> str:
    return getattr(res, "title", "") or ""

def _url(res) -> str:
    return getattr(res, "url", "") or getattr(res, "page_url", "") or ""

# =============== FAST MODE (httpx + lxml) ===============
if FAST_MODE:
    import httpx
    from lxml import html as lxml_html

    async def http_get(url: str, timeout=PAGE_TIMEOUT) -> str:
        try:
            async with httpx.AsyncClient(
                timeout=timeout,
                headers={
                    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                                  "(KHTML, like Gecko) Chrome/131 Safari/537.36"
                },
                follow_redirects=True,
            ) as client:
                r = await client.get(url)
                if r.status_code >= 400:
                    return ""
                return r.text
        except:
            return ""

    def extract_links_html(html_text: str, base_url: str) -> Set[str]:
        out: Set[str] = set()
        try:
            doc = lxml_html.fromstring(html_text)
            for a in doc.xpath("//a[@href]/@href"):
                if not a: continue
                out.add(urljoin(base_url, a.strip()))
        except:
            for m in re.finditer(r'href\s*=\s*["\']([^"\']+)["\']', html_text, flags=re.I):
                out.add(urljoin(base_url, m.group(1).strip()))
        return out

# =============== Endpoints ===============
@app.post("/fetch", response_model=FetchOut)
async def fetch_one(inp: FetchIn):
    if FAST_MODE:
        url = normalize_url(inp.url)
        html_text = await http_get(url)
        txt = strip_html(html_text) if html_text else ""
        return FetchOut(ok=True, data=FetchOutItem(url=url, title="", markdown=txt))

    cfg = CrawlerRunConfig(
    scraping_strategy=LXMLWebScrapingStrategy(),
    wait_until="domcontentloaded",
    page_timeout=max(60_000, PAGE_TIMEOUT * 1000),  # ms
    )
    async with AsyncWebCrawler(max_concurrency=int(os.getenv("CRAWL_MAX_CONCURRENCY","2"))) as crawler:
        res = await crawler.arun(url=inp.url, config=cfg)


    txt = pick_text_from_obj(res)
    ttl = _title(res)
    url = _url(res) or inp.url
    if not txt:
        pages = getattr(res, "pages", None) or []
        if pages:
            p = pages[0]
            txt = pick_text_from_obj(p)
            ttl = _title(p) or ttl
            url = _url(p) or url
    return FetchOut(ok=True, data=FetchOutItem(url=url, title=ttl, markdown=txt or ""))

@app.post("/crawl", response_model=CrawlOut)
async def crawl_site(inp: CrawlIn):
    seed = normalize_url(inp.url.strip())
    if not seed:
        return CrawlOut(ok=True, data={"items": []})

    limit = max(1, int(inp.limit))
    max_depth = max(0, int(inp.maxDepth))
    deny = list(inp.deny or [])

    seen = set()
    queue = [(seed, 0)]
    items: List[dict] = []

    if FAST_MODE:
        while queue and len(items) < limit:
            url, depth = queue.pop(0)
            if not url or url in seen:
                continue
            seen.add(url)
            if _blocked_path(url, deny): 
                continue
            if not should_visit(seed, url): 
                continue

            await asyncio.sleep(0.15)  # suaviza WAF/CDN
            html_text = await http_get(url, PAGE_TIMEOUT)
            if not html_text:
                continue

            clean = strip_html(html_text)
            if len(clean) >= MIN_TEXT_LEN:
                items.append({"url": url, "title": "", "markdown": clean})
                if len(items) >= limit: 
                    break

            if depth < max_depth:
                for link in extract_links_html(html_text, url):
                    cand = normalize_url(link)
                    if not cand or cand in seen: 
                        continue
                    if _blocked_path(cand, deny): 
                        continue
                    if not should_visit(seed, cand): 
                        continue
                    queue.append((cand, depth + 1))

        return CrawlOut(ok=True, data={"items": items})

    # ==== Modo completo (BFS con Playwright) ====
    cfg = CrawlerRunConfig(
        scraping_strategy=LXMLWebScrapingStrategy(),
        wait_until="domcontentloaded",
        page_timeout=max(60_000, PAGE_TIMEOUT * 1000),  # ms
    )
    async with AsyncWebCrawler(max_concurrency=CRAWL_MAX_CONCURRENCY) as crawler:
        while queue and len(items) < limit:
            url, depth = queue.pop(0)
            if not url or url in seen:
                continue
            seen.add(url)

            if _blocked_path(url, deny):
                continue
            if not should_visit(seed, url):
                continue

            try:
                res = await crawler.arun(url=url, config=cfg)
            except Exception:
                continue

            page_url = normalize_url(_url(res) or url)
            if not should_visit(seed, page_url):
                continue

            title = _title(res)
            text = pick_text_from_obj(res)
            clean = (text or "").strip()

            if len(clean) >= MIN_TEXT_LEN:
                items.append({"url": page_url, "title": title, "markdown": clean})
                if len(items) >= limit:
                    break

            if depth < max_depth:
                links: Set[str] = set()
                for key in ("links", "outlinks", "all_links", "extracted_links"):
                    val = getattr(res, key, None)
                    if isinstance(val, (list, tuple, set)):
                        for it in val:
                            href = (it.get("href") if isinstance(it, dict) else str(it)).strip() if it else ""
                            if href:
                                links.add(urljoin(page_url, href))
                html_raw = getattr(res, "html", None)
                if isinstance(html_raw, str) and "<a" in html_raw:
                    for m in re.finditer(r'href\s*=\s*["\']([^"\']+)["\']', html_raw, flags=re.I):
                        links.add(urljoin(page_url, m.group(1).strip()))

                for link in links:
                    cand = normalize_url(link)
                    if not cand or cand in seen: 
                        continue
                    if _blocked_path(cand, deny): 
                        continue
                    if not should_visit(seed, cand): 
                        continue
                    queue.append((cand, depth + 1))

    return CrawlOut(ok=True, data={"items": items})
