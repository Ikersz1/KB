import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { parse as parseHTML } from "node-html-parser";

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Carga robusta de pdf-parse (soporta ESM/CJS y variantes)
let pdfParse;
try {
  const m = await import("pdf-parse");            // ESM
  pdfParse = m.default ?? m.pdf ?? m.parse ?? m;
} catch {
  const m = require("pdf-parse");                 // CJS fallback
  pdfParse = m.default ?? m.pdf ?? m.parse ?? m;
}
if (typeof pdfParse !== "function") {
  throw new Error("pdf-parse no expone una función compatible");
}

// multer (CJS)
const multer = require("multer");




const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

// --- DB en memoria ---
const RAW = {};
const SOURCES = new Map();
const CHUNKS = new Map();
const QUESTIONS = new Map();
const TEST_RUNS = new Map();

// --- helpers básicos ---
function generateId(prefix = "") {
  return `${prefix}${prefix ? "-" : ""}${Date.now()}-${Math.random()
    .toString(36)
    .substr(2, 9)}`;
}

function textToChunks(text, chunkSize = 1000, overlap = 200) {
  if (!text) return [];

  // Normaliza y blinda parámetros
  chunkSize = Number(chunkSize);
  overlap   = Number(overlap);
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) chunkSize = 1000;
  if (!Number.isFinite(overlap)   || overlap < 0)   overlap   = 200;
  if (overlap >= chunkSize) overlap = Math.max(0, Math.floor(chunkSize / 3)); // evita bucles/índices negativos

  const out = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const slice = text.slice(start, end).trim();
    if (slice) out.push(slice);
    if (end === text.length) break;
    start = end - overlap; // siempre >= 0 por el clamp de arriba
  }
  return out;
}


async function fetchBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} descargando ${url}`);
  const ab = await r.arrayBuffer();
  const buf = Buffer.from(ab);
  const contentType = r.headers.get("content-type") || "";
  return { buf, contentType };
}

function htmlToText(html) {
  const root = parseHTML(html);
  root.querySelectorAll("script,style,noscript").forEach((n) => n.remove());
  const text = root.text
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

// --- Evaluador mock (simplificado) ---
function evaluateAnswer(questionId, expectedAnswer = "", actualAnswer = "") {
  const expected = (expectedAnswer || "").toLowerCase();
  const actual = (actualAnswer || "").toLowerCase();
  const expectedKeywords = expected.split(" ").filter((w) => w.length > 3);
  const actualKeywords = actual.split(" ");
  const matched = expectedKeywords.filter((k) =>
    actualKeywords.some((w) => w.includes(k) || k.includes(w))
  );
  const correctness = Math.min(
    matched.length / Math.max(expectedKeywords.length, 1),
    1
  );
  const coverage = actual.length > expected.length * 0.5 ? 0.8 : 0.5;
  const contextUse =
    actual.includes("source") || actual.includes("doc") ? 0.9 : 0.6;
  const hallucination = Math.random() * 0.3;
  const citations =
    actual.includes("cita") || actual.includes("source") ? 0.8 : 0.4;
  const finalScore =
    0.35 * correctness +
    0.25 * coverage +
    0.15 * contextUse +
    0.15 * (1 - hallucination) +
    0.1 * citations;
  let verdict = "FALLO";
  if (finalScore >= 0.8) verdict = "ACIERTO";
  else if (finalScore >= 0.5) verdict = "PARCIAL";
  return {
    questionId,
    correctness,
    coverage,
    contextUse,
    hallucination,
    citations,
    finalScore,
    verdict,
    notes: [],
  };
}

function generateReport(testRun) {
  const evaluations = testRun.evaluations;
  const runs = testRun.runs;
  const totals = {
    questions: evaluations.length,
    ok: evaluations.filter((e) => e.verdict === "ACIERTO").length,
    partial: evaluations.filter((e) => e.verdict === "PARCIAL").length,
    fail: evaluations.filter((e) => e.verdict === "FALLO").length,
    accuracy: 0,
    avgScore: 0,
    latencyAvgMs: 0,
    latencyP95Ms: 0,
    hallucinationRate: 0,
    citationValidity: 0,
  };
  totals.accuracy = totals.ok / Math.max(totals.questions, 1);
  totals.avgScore =
    evaluations.reduce((s, e) => s + e.finalScore, 0) /
    Math.max(evaluations.length, 1);
  const latencies = runs.filter((r) => r.status === "ok").map((r) => r.latencyMs);
  const avg = latencies.reduce((s, l) => s + l, 0) / Math.max(latencies.length, 1);
  totals.latencyAvgMs = isFinite(avg) ? Math.round(avg) : 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95Index = Math.floor(0.95 * (sorted.length - 1));
  totals.latencyP95Ms = sorted[p95Index] || 0;
  totals.hallucinationRate =
    evaluations.filter((e) => e.hallucination > 0.3).length /
    Math.max(evaluations.length, 1);
  totals.citationValidity =
    evaluations.filter((e) => e.citations >= 0.7).length /
    Math.max(evaluations.length, 1);
  return {
    runId: testRun.id,
    createdAt: testRun.completedAt || testRun.createdAt,
    totals,
    breakdowns: { byDifficulty: {}, byType: {}, bySource: [] },
    worstQuestions: [],
    kbGaps: [],
    exports: { jsonPath: "", csvPath: "" },
  };
}

// --- Salud ---
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// --- Bot falso para pruebas (1 sola definición) ---
app.post("/api/mock-bot", async (req, res) => {
  try {
    const { message } = req.body || {};
    await new Promise((r) => setTimeout(r, 200));
    return res.json({
      answer: `[mock] ${message || "sin pregunta"} (source c1)`,
      meta: { model: "mock", tokensIn: 8, tokensOut: 12 },
    });
  } catch (e) {
    console.error("mock-bot error:", e);
    return res.status(500).json({ error: "mock-bot failed" });
  }
});

// --- Test de conexión ---
app.post("/api/test-connection", async (req, res) => {
  try {
    const { chatbotConfig } = req.body || {};
    if (!chatbotConfig?.apiUrl) {
      return res.status(400).json({ error: "Falta apiUrl en chatbotConfig" });
    }
    const {
      apiUrl,
      method = "POST",
      headers = {},
      bodyTemplate = '{"message":"{{question}}"}',
      timeoutMs = 15000,
    } = chatbotConfig;

    const question = "Ping de prueba";
    const conversationId = `test-${Date.now()}`;
    const metadata = { source: "config-test" };
    const bodyStr = bodyTemplate
      .replace(/{{\s*question\s*}}/g, question)
      .replace(/{{\s*conversation_id\s*}}/g, conversationId)
      .replace(/{{\s*metadata\s*}}/g, JSON.stringify(metadata));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(apiUrl, {
      method: method.toUpperCase(),
      headers,
      body: method.toUpperCase() === "POST" ? bodyStr : undefined,
      signal: controller.signal,
    });

    clearTimeout(timer);

    const text = await resp.text();
    const ct = resp.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? JSON.parse(text) : text;

    if (!resp.ok) {
      return res.status(resp.status).json({
        error:
          typeof data === "string" ? data : data?.error || `HTTP ${resp.status}`,
      });
    }

    return res.json({ ok: true, response: data });
  } catch (err) {
    if (err?.name === "AbortError") {
      return res.status(504).json({ error: "Timeout al llamar al chatbot" });
    }
    console.error("test-connection error:", err);
    return res.status(500).json({ error: "Fallo interno en test-connection" });
  }
});

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB

app.post("/api/upload", upload.array("files", 10), async (req, res) => {
  try {
    const { chunkSize = 1000, chunkOverlap = 200 } = req.body || {};
    const outSources = [];

    for (const file of req.files || []) {
      let text = "";
    
      const isPdf =
        /pdf/i.test(file.mimetype || "") ||
        /\.pdf$/i.test(file.originalname || "");
    
      if (isPdf) {
        const parsed = await pdfParse(file.buffer);
        text = parsed?.text || "";
      } else if (
        /text/i.test(file.mimetype || "") ||
        /\.(md|txt)$/i.test(file.originalname || "")
      ) {
        text = file.buffer.toString("utf8");
      } else {
        // fallback: intenta como texto
        text = file.buffer.toString("utf8");
      }
    
      const parts = textToChunks(text, Number(req.body?.chunkSize), Number(req.body?.chunkOverlap));
      const sourceId = generateId("src");
      const chunks = parts.map((p, i) => ({
        id: `c${i + 1}`,
        sourceId,
        content: p,
        index: i,
      }));
      CHUNKS.set(sourceId, chunks);
    
      outSources.push({
        id: sourceId,
        type: isPdf ? "pdf" : "txt",
        name: file.originalname,
        status: "completed",
        chunks,
        createdAt: new Date().toISOString(),
      });
    }
    

    if (!outSources.length) {
      return res.status(400).json({ error: "No se recibieron archivos" });
    }

    return res.json({ ok: true, sources: outSources });
  } catch (e) {
    console.error("upload error:", e);
    return res.status(500).json({ error: "Error subiendo archivos" });
  }
});


// --- PROCESAR FUENTES (URL → PDF/HTML/TXT real)
app.post("/api/process-sources", async (req, res) => {
  try {
    const {
      sources = [],
      chunkingConfig = { chunkSize: 1000, chunkOverlap: 200 },
    } = req.body || {};
    if (!Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({ error: "No se recibieron fuentes" });
    }

    const processed = [];

    for (const s of sources) {
      if (!s.url && !s.name) continue;

      let text = "";
      if (s.type === "url" && s.url) {
        const { buf, contentType } = await fetchBuffer(s.url);
        if (contentType.includes("pdf") || s.url.toLowerCase().endsWith(".pdf")) {
          const parsed = await pdfParse(buf);
          text = parsed.text || "";
        } else if (contentType.includes("html")) {
          text = htmlToText(buf.toString("utf8"));
        } else {
          text = buf.toString("utf8");
        }
      } else {
        text = s.name || "";
      }

      const parts = textToChunks(
        text,
        Number(chunkingConfig.chunkSize),
        Number(chunkingConfig.chunkOverlap)
      );
      const chunks = parts.map((p, i) => ({
        id: `c${i + 1}`,
        sourceId: s.id,
        content: p,
        index: i,
      }));

      CHUNKS.set(s.id, chunks);
      processed.push({
        id: s.id,
        type: s.type || "url",
        name: s.name || s.url,
        url: s.url,
        size: s.size,
        status: "completed",
        chunks,
        createdAt: new Date().toISOString(),
      });
    }

    if (!processed.length) {
      return res
        .status(400)
        .json({ error: "No se pudieron procesar las fuentes" });
    }
    return res.json({ ok: true, sources: processed });
  } catch (err) {
    console.error("process-sources error:", err);
    return res.status(500).json({ error: "Fallo interno procesando las fuentes" });
  }
});

// --- Generar preguntas desde los CHUNKS ya procesados
app.post("/api/generate-questions", (req, res) => {
  try {
    const { sources = [], total = 50 } = req.body || {};
    const sourceIds =
      Array.isArray(sources) && sources.length
        ? sources.map((s) => s.id)
        : Array.from(CHUNKS.keys());

    const allChunks = sourceIds.flatMap((id) => CHUNKS.get(id) || []);
    if (!allChunks.length) {
      return res.status(400).json({ error: "No hay chunks procesados todavía" });
    }

    const perChunk = Math.max(1, Math.ceil(total / allChunks.length));
    const questions = [];

    for (const ch of allChunks) {
      for (let i = 0; i < perChunk && questions.length < total; i++) {
        questions.push({
          id: generateId("q"),
          type: ["open", "mcq", "boolean", "citation"][i % 4],
          difficulty: ["easy", "medium", "hard"][i % 3],
          text: `Según el fragmento ${ch.id}, ¿cuál es la idea principal?`,
          options: ["Opción A", "Opción B", "Opción C", "Opción D"],
          correctOptionIndex: 0,
          expectedAnswer: "Respuesta basada en el documento.",
          references: [{ sourceId: ch.sourceId, chunkIds: [ch.id] }],
          tags: ["auto"],
        });
      }
      if (questions.length >= total) break;
    }

    const questionSetId = generateId("qset");
    QUESTIONS.set(questionSetId, questions);

    return res
      .status(200)
      .json({ ok: true, questionSetId, total: questions.length, questions });
  } catch (err) {
    console.error("generate-questions error:", err);
    return res.status(500).json({ error: "Fallo interno generando preguntas" });
  }
});

// --- Ejecutar contra el agente
app.post("/api/execute", async (req, res) => {
  const { sourceId, questionSetId, config } = req.body || {};

  const qs = questionSetId
    ? QUESTIONS.get(questionSetId) || []
    : QUESTIONS.get(sourceId) || [];

  if (!qs.length) return res.status(400).json({ error: "No hay preguntas generadas" });

  const callBot = async (cfg, question) => {
    const body = (cfg.bodyTemplate || '{"message":"{{question}}"}')
      .replaceAll("{{question}}", question)
      .replaceAll("{{conversation_id}}", generateId("conv"))
      .replaceAll("{{metadata}}", "{}");

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), cfg.timeoutMs || 15000);

    const resp = await fetch(cfg.apiUrl, {
      method: (cfg.method || "POST").toUpperCase(),
      headers: cfg.headers || { "Content-Type": "application/json" },
      body: (cfg.method || "POST").toUpperCase() === "POST" ? body : undefined,
      signal: ctrl.signal,
    }).catch((e) => {
      throw e;
    });

    clearTimeout(t);
    const raw = await resp.text();
    try {
      return JSON.parse(raw);
    } catch {
      return { answer: raw };
    }
  };

  const runId = generateId("run");
  const runs = [];

  for (const q of qs) {
    const t0 = Date.now();
    try {
      const reply = await callBot(config, q.text);
      const latencyMs = Date.now() - t0;
      runs.push({
        questionId: q.id,
        attempt: 1,
        status: "ok",
        httpStatus: 200,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        latencyMs,
        replyRaw: reply,
        replyParsed: reply,
      });
    } catch (e) {
      const latencyMs = Date.now() - t0;
      runs.push({
        questionId: q.id,
        attempt: 1,
        status: "http_error",
        httpStatus: 500,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        latencyMs,
        replyRaw: { error: String(e) },
      });
    }
  }

  const testRun = {
    id: runId,
    name: `Run ${new Date().toLocaleString()}`,
    status: "running",
    createdAt: new Date().toISOString(),
    questions: qs,
    runs,
    evaluations: [],
    config: { concurrency: 1, retries: 0, seed: 0 },
  };
  TEST_RUNS.set(runId, testRun);
  res.json({ ok: true, runId, questions: qs.length, runs: runs.length });
});

// --- Reporte
app.get("/api/get-report", (req, res) => {
  const runId = String(req.query.runId || "");
  const run = TEST_RUNS.get(runId);
  if (!run) return res.status(404).json({ error: "run no encontrado" });

  const evals = run.runs.map((r) => {
    const q = run.questions.find((x) => x.id === r.questionId);
    const actual = r.replyParsed?.answer || String(r.replyRaw || "");
    const expected =
      q?.expectedAnswer || (q?.options?.[q?.correctOptionIndex ?? -1] || "");
    return evaluateAnswer(q.id, expected, actual);
  });
  run.evaluations = evals;
  run.status = "completed";
  run.completedAt = new Date().toISOString();

  const report = generateReport(run);
  res.json({ ok: true, report });
});

const PORT = process.env.PORT || 4000;

// --- Manejo de errores global (incluye errores de multer) ---
app.use((err, req, res, next) => {
  // Multer (tamaño, número de ficheros, etc.)
  if (err && err.name === "MulterError") {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    console.error("Unhandled server error:", err);
    return res.status(500).json({ error: "Fallo interno en el servidor" });
  }
  next();
});


app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
