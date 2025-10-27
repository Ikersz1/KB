# services/crawl4ai_service.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware   # <-- NUEVO
from pydantic import BaseModel, Field
from typing import List
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

# Crawl4AI 0.7.x
from crawl4ai import AsyncWebCrawler, CrawlerRunConfig
from crawl4ai.content_scraping_strategy import LXMLWebScrapingStrategy

app = FastAPI(title="Crawl4AI Microservice", version="0.1.0")

# CORS abierto (ajusta orígenes si quieres limitar)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True}


# ---------- Schemas ----------
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

# ---------- Helpers (globales) ----------
def pick_text(page) -> str:
    """
    Devuelve texto usable desde varios atributos típicos de Crawl4AI.
    """
    # 1) strings directos
    for attr in ("markdown_v2", "markdown", "cleaned_text", "content", "text"):
        val = getattr(page, attr, None)
        if isinstance(val, str) and val.strip():
            return val
        # si es objeto 'markdown' con raw_markdown/markdown internos
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
        # conversión ligera html->texto (sin libs externas)
        import re as _re
        s = _re.sub(r"(?is)<(script|style|noscript).*?>.*?</\1>", "", html)
        s = _re.sub(r"(?is)<[^>]+>", "\n", s)
        s = _re.sub(r"[ \t]+\n", "\n", s)
        s = _re.sub(r"\n{3,}", "\n\n", s)
        return s.strip()

    return ""

def _title(res) -> str:
    return getattr(res, "title", "") or ""

def _url(res) -> str:
    return getattr(res, "url", "") or getattr(res, "page_url", "") or ""

# extensiones no-HTML típicas
EXT_DENY = {
    ".css",".js",".map",".ico",".png",".jpg",".jpeg",".webp",".gif",".svg",
    ".pdf",".zip",".rar",".7z",".gz",".mp3",".mp4",".mov",".avi",".mkv",
    ".woff",".woff2",".ttf",".eot",".obj",".glb",".gltf",".csv"
}

# subrutas/recursos a saltar (genérico para WordPress y similares)
PATH_DENY_SUBSTR = [
    "/wp-json/", "/wp-content/", "/wp-includes/", "/xmlrpc.php", "/oembed/",
    "/feed/", "/comments/", "/favicon", "/favicons/", "/static/", "/assets/",
    "/tag/", "/category/", "/author/"
]

# querys a evitar
QUERY_DENY_KEYS = {"amp","format","feed","fbclid","gclid","yclid","_hsenc","_hsmi"}
QUERY_DENY_PREFIXES = ("utm_", "ga_", "pk_", "mc_")

def normalize_url(u: str) -> str:
    """
    - solo http(s)
    - quita fragmentos #...
    - limpia trackers (utm_*, gclid...)
    - evita dobles // en path
    """
    try:
        p = urlparse(u)
        if p.scheme not in ("http","https"):
            return ""
        # limpia query
        q = []
        for k, v in parse_qsl(p.query, keep_blank_values=True):
            kl = k.lower()
            if kl in QUERY_DENY_KEYS:
                continue
            if any(kl.startswith(pref) for pref in QUERY_DENY_PREFIXES):
                continue
            q.append((k, v))
        # path sin // repetidos
        path = p.path or "/"
        while "//" in path:
            path = path.replace("//", "/")
        # host en minúsculas
        netloc = p.netloc.lower()
        # reconstruye sin fragmento
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
    # ids crudos de WP como ?p=123
    if "p=" in ql and "&" not in ql:
        return True
    return False

def should_visit(seed: str, link: str) -> bool:
    """Filtro central para decidir si se encola/visita"""
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
    # mismo host (normalizando www.)
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

def _same_host(a: str, b: str) -> bool:
    try:
        return urlparse(a).netloc == urlparse(b).netloc
    except:
        return False

def _blocked_path(url: str, deny: List[str]) -> bool:
    path = urlparse(url).path or "/"
    return any(path.startswith(d) for d in deny)

# ---------- Endpoints ----------
@app.post("/fetch", response_model=FetchOut)
async def fetch_one(inp: FetchIn):
    """
    Fetch de UNA sola URL (sin deep crawl).
    """
    cfg = CrawlerRunConfig(scraping_strategy=LXMLWebScrapingStrategy())
    async with AsyncWebCrawler() as crawler:
        res = await crawler.arun(url=inp.url, config=cfg)

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
    BFS manual con control estricto del límite y filtros de URL:
    - Normaliza y filtra recursos inútiles (wp-json, feeds, oembed, assets, extensiones binarias, anclas, utm, etc.)
    - Respeta deny y maxDepth al ENCOLAR
    - Cuenta hacia `limit` solo páginas con TEXTO suficiente (>= 300 chars)
    """
    from urllib.parse import urljoin
    import re

    seed = normalize_url(inp.url.strip())
    if not seed:
        return CrawlOut(ok=True, data={"items": []})

    limit = max(1, int(inp.limit))
    max_depth = max(0, int(inp.maxDepth))
    deny = list(inp.deny or [])

    def base_host(u: str) -> str:
        try:
            h = urlparse(u).netloc.lower()
            return h[4:] if h.startswith("www.") else h
        except:
            return ""

    def same_site(a: str, b: str) -> bool:
        return base_host(a) == base_host(b) != ""

    def blocked(u: str) -> bool:
        p = urlparse(u).path or "/"
        return any(p.startswith(d) for d in deny)

    def extract_links(res, page_url: str):
        out = set()
        # atributos de enlaces
        for key in ("links", "outlinks", "all_links", "extracted_links"):
            val = getattr(res, key, None)
            if not val:
                continue
            if isinstance(val, (list, tuple, set)):
                for it in val:
                    href = (it.get("href") if isinstance(it, dict) else str(it)).strip() if it else ""
                    if not href:
                        continue
                    out.add(urljoin(page_url, href))
        # parse rápido desde html
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

            # filtros rápidos antes de fetch
            if blocked(url):
                continue
            if not should_visit(seed, url):
                continue

            # FETCH controlado
            try:
                res = await crawler.arun(url=url, config=cfg)
            except Exception:
                continue

            page_url = normalize_url(_url(res) or url)
            if not should_visit(seed, page_url):
                continue

            title = _title(res)
            text = pick_text(res)
            clean = (text or "").strip()

            # añade sólo páginas con texto suficiente
            if len(clean) >= 300:
                items.append({"url": page_url, "title": title, "markdown": clean})
                if len(items) >= limit:
                    break

            # ENCOLAR enlaces (si hay profundidad restante)
            if depth < max_depth:
                for link in extract_links(res, page_url):
                    cand = normalize_url(link)
                    if not cand or cand in seen:
                        continue
                    if blocked(cand):
                        continue
                    if not should_visit(seed, cand):
                        continue
                    queue.append((cand, depth + 1))

    return CrawlOut(ok=True, data={"items": items})
