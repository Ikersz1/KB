import { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { useAppStore } from "../lib/store";
import { generateId, formatFileSize } from "../lib/utils";
import { Source } from "../types";
import { 
  Upload, 
  Link, 
  FileText, 
  Globe, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  Plus,
  Trash2,
  Bug,
  Download
} from "lucide-react";

export function IngestionScreen() {
  const {
    sources,
    addSource,
    updateSource,
    clearSources,
    chunkingConfig,
    setChunkingConfig,
    setCurrentScreen
  } = useAppStore();

  const [urls, setUrls] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // --- Crawl UI state ---
  const [crawlUrl, setCrawlUrl] = useState("");
  const [crawlMaxPages, setCrawlMaxPages] = useState(30);
  const [crawlMaxDepth, setCrawlMaxDepth] = useState(2);
  const [deny, setDeny] = useState<string>("/login\n/signup\n/cart\n/account");
  const [isCrawling, setIsCrawling] = useState(false);

  const handleFileUpload = useCallback(async (files: FileList) => {
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));
    form.append("chunkSize", String(chunkingConfig.chunkSize));
    form.append("chunkOverlap", String(chunkingConfig.chunkOverlap));
  
    try {
      const r = await fetch("/api/upload", { method: "POST", body: form });
      const raw = await r.text();
      const ct = r.headers.get("content-type") || "";
      const data = raw && ct.includes("application/json") ? JSON.parse(raw) : raw;
  
      if (!r.ok) {
        const msg = typeof data === "string" ? data : (data?.error || `HTTP ${r.status} upload`);
        throw new Error(msg);
      }
  
      clearSources();
      (data.sources || []).forEach((src: any) => addSource(src));
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Error subiendo archivos");
    }
  }, [chunkingConfig, clearSources, addSource]);

  // Añade URLs a la UI (pending). El procesamiento real lo hará /api/process-sources
  const handleProcessUrls = useCallback(() => {
    const urlList = urls.split('\n').map(u => u.trim()).filter(Boolean);
    if (urlList.length === 0) return;
    urlList.forEach(url => {
      const source: Source = {
        id: generateId('src'),
        type: 'url',
        name: (() => { try { return new URL(url).hostname; } catch { return url; } })(),
        url: url.trim(),
        status: 'pending',
        chunks: [],
        createdAt: new Date().toISOString()
      };
      addSource(source);
    });
    setUrls("");
  }, [urls, addSource]);

  // Procesar URLs pendientes (descarga y chunking 1:1)
  const processNow = useCallback(async () => {
    setIsProcessing(true);
    try {
      const pending = sources.filter(s => s.status === "pending");
      if (pending.length === 0) {
        alert("No hay fuentes pendientes");
        return;
      }

      const payload = {
        sources: pending.map(s => ({
          id: s.id,
          type: s.type,
          name: s.name,
          url: s.url,
          size: s.size,
        })),
        chunkingConfig,
      };

      const resp = await fetch("/api/process-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let data: any = null;
      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        data = await resp.json();
      } else {
        const txt = await resp.text();
        throw new Error(txt || `HTTP ${resp.status} procesando fuentes`);
      }

      if (!resp.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${resp.status} procesando fuentes`);
      }

      const processed: Source[] = (data.sources || []).map((s: any) => ({
        id: s.id,
        type: s.type || "url",
        name: s.name || s.url,
        url: s.url,
        size: s.size,
        status: "completed",
        chunks: Array.isArray(s.chunks) ? s.chunks : [],
        createdAt: s.createdAt ?? new Date().toISOString(),
      }));

      const nonPending = sources.filter(s => s.status !== "pending");
      clearSources();
      [...nonPending, ...processed].forEach(src => addSource(src));
    } catch (e: any) {
      console.error("process-sources failed:", e);
      alert(e?.message || "Error procesando las fuentes");
    } finally {
      setIsProcessing(false);
    }
  }, [sources, chunkingConfig, clearSources, addSource]);

  // --- Crawling con /api/crawl (siempre Crawl4AI por defecto en backend) ---
  const handleCrawl = useCallback(async () => {
    if (!crawlUrl.trim()) return;
    setIsCrawling(true);
    try {
      const resp = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: crawlUrl.trim(),
          // engine OMITIDO -> el backend usa "crawl4ai" por defecto
          limit: crawlMaxPages,
          maxDepth: crawlMaxDepth,
          deny: deny
            .split("\n")
            .map(s => s.trim())
            .filter(Boolean),
          chunkSize: chunkingConfig.chunkSize,
          chunkOverlap: chunkingConfig.chunkOverlap
        })
      });

      const ct = resp.headers.get("content-type") || "";
      const data = ct.includes("application/json") ? await resp.json() : { ok: false, error: await resp.text() };
      if (!resp.ok || !data?.ok) throw new Error(data?.error || `HTTP ${resp.status} crawl`);

      (data.sources || []).forEach((s: any) => {
        const src: Source = {
          id: s.id,
          type: s.type || "crawl",
          name: s.name || `Crawl: ${crawlUrl}`,
          url: s.url || crawlUrl,
          size: s.size,
          status: "completed",
          chunks: Array.isArray(s.chunks) ? s.chunks : [],
          createdAt: s.createdAt ?? new Date().toISOString()
        };
        addSource(src);
      });
    } catch (e: any) {
      console.error("crawl failed:", e);
      alert(e?.message || "Error haciendo crawl");
    } finally {
      setIsCrawling(false);
    }
  }, [crawlUrl, crawlMaxPages, crawlMaxDepth, deny, chunkingConfig, addSource]);

  const getStatusIcon = (status: Source['status']) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'processing': return <Clock className="w-4 h-4 text-blue-600" />;
      case 'error': return <AlertCircle className="w-4 h-4 text-red-600" />;
      default: return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getTypeIcon = (type: Source['type']) => {
    switch (type) {
      case 'url': return <Globe className="w-4 h-4" />;
      case 'crawl': return <Bug className="w-4 h-4" />;
      default: return <FileText className="w-4 h-4" />;
    }
  };

  const canProceed = sources.length > 0 && sources.every(s => s.status === 'completed');

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* File Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Subir Documentos
          </CardTitle>
          <CardDescription>
            Soporta PDF, TXT, MD. Máximo 20MB por archivo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
            <input
              type="file"
              multiple
              accept=".pdf,.txt,.md"
              onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
              className="hidden"
              id="file-upload"
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              <Upload className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
              <p>Arrastra archivos aquí o haz clic para seleccionar</p>
              <p className="text-sm text-muted-foreground mt-2">
                PDF, TXT, MD hasta 20MB
              </p>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* URLs (cola manual para /api/process-sources) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link className="w-5 h-5" />
            URLs para Procesar (1:1)
          </CardTitle>
          <CardDescription>
            Una URL por línea. Máximo 50 URLs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="https://example.com/docs&#10;https://example.com/faq"
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            rows={4}
          />
          <Button onClick={handleProcessUrls} disabled={!urls.trim()}>
            <Plus className="w-4 h-4 mr-2" />
            Añadir URLs
          </Button>
        </CardContent>
      </Card>

      {/* Crawl sitio (multi-página) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bug className="w-5 h-5" />
            Crawl sitio (multi-página)
          </CardTitle>
          <CardDescription>
            Descubre y extrae varias páginas empezando desde una URL. Usa Crawl4AI local.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          {/* URL */}
          <div className="md:col-span-2 space-y-2">
            <Label htmlFor="crawl-url">URL inicial</Label>
            <Input
              id="crawl-url"
              type="url"
              placeholder="https://docs.tu-dominio.com"
              value={crawlUrl}
              onChange={(e) => setCrawlUrl(e.target.value)}
            />
          </div>

          {/* Máx. páginas */}
          <div className="space-y-2">
            <Label htmlFor="crawl-pages">Máx. páginas</Label>
            <Input
              id="crawl-pages"
              type="number"
              min={1}
              max={200}
              value={crawlMaxPages}
              onChange={(e) => setCrawlMaxPages(parseInt(e.target.value) || 1)}
            />
          </div>

          {/* Profundidad */}
          <div className="space-y-2">
            <Label htmlFor="crawl-depth">Profundidad</Label>
            <Input
              id="crawl-depth"
              type="number"
              min={0}
              max={5}
              value={crawlMaxDepth}
              onChange={(e) => setCrawlMaxDepth(parseInt(e.target.value) || 0)}
            />
          </div>

          {/* Deny list */}
          <div className="md:col-span-2 space-y-2">
            <Label htmlFor="crawl-deny">Excluir rutas (una por línea)</Label>
            <Textarea
              id="crawl-deny"
              rows={3}
              placeholder="/login\n/signup\n/cart"
              value={deny}
              onChange={(e) => setDeny(e.target.value)}
            />
          </div>

          <div className="md:col-span-2">
            <Button onClick={handleCrawl} disabled={!crawlUrl.trim() || isCrawling}>
              {isCrawling ? (
                <>
                  <Clock className="w-4 h-4 mr-2 animate-spin" />
                  Crawleando...
                </>
              ) : (
                <>
                  <Bug className="w-4 h-4 mr-2" />
                  Iniciar Crawl
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Configuración de Chunking */}
      <Card>
        <CardHeader>
          <CardTitle>Configuración de Chunking</CardTitle>
          <CardDescription>
            Parámetros para dividir el contenido en fragmentos.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="chunk-size">Tamaño de Chunk</Label>
            <Input
              id="chunk-size"
              type="number"
              value={chunkingConfig.chunkSize}
              onChange={(e) => setChunkingConfig({
                ...chunkingConfig,
                chunkSize: parseInt(e.target.value) || 1000
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="chunk-overlap">Overlap</Label>
            <Input
              id="chunk-overlap"
              type="number"
              value={chunkingConfig.chunkOverlap}
              onChange={(e) => setChunkingConfig({
                ...chunkingConfig,
                chunkOverlap: parseInt(e.target.value) || 200
              })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Processing Controls */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Procesamiento</CardTitle>
          <Button
            variant="outline"
            onClick={() => window.open("/api/export-all", "_blank")}
            className="flex items-center gap-2"
            title="Descargar todas las fuentes en un único .md"
          >
            <Download className="w-4 h-4" />
            Descargar TODO (.md)
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button 
              onClick={processNow} 
              disabled={isProcessing || sources.filter(s => s.status === "pending").length === 0}
            >
              {isProcessing ? (
                <>
                  <Clock className="w-4 h-4 mr-2 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4 mr-2" />
                  Procesar Fuentes (pendientes)
                </>
              )}
            </Button>
            {/* Eliminado: botón de datos demo */}
            <Button variant="outline" onClick={clearSources} disabled={sources.length === 0}>
              <Trash2 className="w-4 h-4 mr-2" />
              Limpiar Todo
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sources Table */}
      {sources.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Fuentes Procesadas</CardTitle>
            <CardDescription>
              {sources.length} fuentes, {sources.reduce((acc, s) => acc + s.chunks.length, 0)} chunks totales
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Nombre/URL</TableHead>
                  <TableHead>Tamaño</TableHead>
                  <TableHead>Chunks</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Descargar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getTypeIcon(source.type)}
                        <Badge variant="outline">{source.type.toUpperCase()}</Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div>{source.name}</div>
                        {source.url && (
                          <div className="text-sm text-muted-foreground">{source.url}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {source.size ? formatFileSize(source.size) : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{source.chunks.length}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(source.status)}
                        <span className="capitalize">{source.status}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const u = `/api/export-source?sourceId=${encodeURIComponent(source.id)}&format=md`;
                            window.open(u, "_blank");
                          }}
                          className="flex items-center gap-1"
                          title="Descargar esta fuente como Markdown"
                        >
                          <Download className="w-3 h-3" />
                          .md
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const u = `/api/export-source?sourceId=${encodeURIComponent(source.id)}&format=json`;
                            window.open(u, "_blank");
                          }}
                          className="flex items-center gap-1"
                          title="Descargar esta fuente como JSON"
                        >
                          <Download className="w-3 h-3" />
                          .json
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Next Step */}
      {canProceed && (
        <>
          <Separator />
          <div className="flex justify-end">
            <Button onClick={() => setCurrentScreen('questions')}>
              Continuar a Generación de Preguntas
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
