// src/server/index.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { parse as parseHTML } from "node-html-parser";
import "dotenv/config";
// Desactiva timeouts del cliente HTTP de Node (Undici)
// ⬇️ Añade / corrige esto (y elimina cualquier keepAliveTimeout)
import { Agent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(
  new Agent({
    headersTimeout: 0,  // sin límite de espera de cabeceras
    bodyTimeout: 0,     // sin límite de descarga de cuerpo
    connectTimeout: 0,  // sin límite de conexión
  })
);



// --- PDF con pdfjs-dist (compatible ESM en Node)
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

import OpenAI from "openai";

// --- Crawl4AI (microservicio local)
const CRAWL4AI_URL = process.env.CRAWL4AI_URL || "http://127.0.0.1:8002";

// multer (CJS) con ESM
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const multer = require("multer");

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "⚠️  Falta OPENAI_API_KEY en .env; /api/generate-questions-llm devolverá 400."
  );
}

const app = express();
app.use(cors({
  origin: (origin, cb) => {
    const allow = (process.env.CORS_ORIGIN || "*")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    if (allow.includes("*") || !origin) return cb(null, true);
    return cb(null, allow.includes(origin));
  },
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","Accept"],
}));
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

// ---- Helpers de compactado (JS puro) ----
function fastHash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

// normaliza espacios y quita líneas “ruido”
function cleanMarkdown(md) {
  if (!md) return "";
  const lines = md
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n");

  const DROP_IF_CONTAINS = [
    "cookie", "cookies", "consent", "gdpr",
    "accept all", "reject all", "privacy policy",
    "copyright", "all rights reserved",
    "terms of use", "terms & conditions", "legal",
    "newsletter", "subscribe", "sign up", "sign-in", "signin", "login /",
    "language", "español", "english", "français", "deutsch",
    "follow us", "twitter", "facebook", "instagram", "linkedin",
    "site map", "sitemap", "mapa del sitio", "navigation", "nav", "menu",
    "footer", "breadcrumbs", "back to top", "share", "share on",
    "©", "™", "®"
  ];

  const out = [];
  for (let raw of lines) {
    const s = raw.trim();

    // descarta líneas vacías repetidas
    if (!s) {
      if (out.length && out[out.length - 1] === "") continue;
      out.push("");
      continue;
    }

    // poca señal: < 3 letras
    if ((s.match(/[a-zA-ZÀ-ÿ]/g) || []).length < 3) continue;

    // si contiene demasiado símbolo / dígitos => probablemente menú
    const alnum = (s.match(/[a-zA-ZÀ-ÿ0-9]/g) || []).length;
    if (alnum < s.length * 0.4) continue;

    const lower = s.toLowerCase();
    if (DROP_IF_CONTAINS.some(k => lower.includes(k))) continue;

    // líneas muy cortas repetitivas (menús)
    if (s.length <= 35 && (s.match(/\s/g) || []).length <= 6) continue;

    out.push(s);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// dedupe de párrafos entre muchas páginas (exacto)
function dedupeParagraphs(texts) {
  const seen = new Set();
  const out = [];

  for (const t of texts) {
    const paras = t.split(/\n{2,}/g);
    for (let p of paras) {
      const norm = p.replace(/\s+/g, " ").trim().toLowerCase();
      if (norm.length < 60) continue; // descarta fragmentos muy cortos
      const h = fastHash(norm);
      if (seen.has(h)) continue;
      seen.add(h);
      out.push(p.trim());
    }
  }
  return out.join("\n\n").trim();
}

// aplica presupuesto total de caracteres
function applyBudget(str, maxChars = null) {
  if (str.length <= maxChars) return str;
  const head = Math.floor(maxChars * 0.7);
  const tail = maxChars - head;
  return str.slice(0, head) + "\n\n[...] (recortado)\n\n" + str.slice(-tail);
}



function textToChunks(text, chunkSize = 1000, overlap = 200) {
  if (!text) return [];
  const out = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + chunkSize, text.length);
    if (end < text.length) {
      const window = text.slice(i, end);
      // busca un buen corte: doble salto, fin de frase, o heading
      const m = window.match(/(?:\n{2,}|[.!?]["’”)]?\s|\n#+\s[^\n]{1,80}\n)(?![\s\S]*\n)/g);
      if (m) {
        const last = window.lastIndexOf(m[m.length - 1]);
        if (last > chunkSize * 0.5) end = i + last + m[m.length - 1].length;
      }
    }
    const slice = text.slice(i, end).trim();
    if (slice) out.push(slice);
    if (end === text.length) break;
    i = Math.max(0, end - overlap);
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

// -------- helpers para LLM --------
function pickContextChunks(sourceIds, limitPerSource = 6) {
  // coge hasta N chunks por fuente (primeros y una muestra)
  const chosen = [];
  for (const sid of sourceIds) {
    const arr = CHUNKS.get(sid) || [];
    if (!arr.length) continue;
    // prioriza primeros 2, y muestra aleatoria del resto
    const head = arr.slice(0, 2);
    const rest = arr.slice(2);
    const sample = rest
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.max(0, limitPerSource - head.length));
    chosen.push(...head, ...sample);
  }
  return chosen;
}

function buildPromptFromChunks(chunks, quotas, opts) {
  const { total = 50, language = "en" } = opts || {};

  const clamp = (t) => (t.length > 1500 ? t.slice(0, 1500) + " […]" : t);
  const ctx = chunks
    .map(
      (c) => `# Chunk ${c.id} (source:${c.sourceId})
${clamp(c.content)}`
    )
    .join("\n\n");

  return [
    `You are a generator of **validation questions** to evaluate a KB-grounded chatbot.`,
    `Return **VALID JSON only** (no prose outside JSON).`,
    ``,
    `## Hard requirements`,
    `1) Every question **must be answerable strictly from the CONTEXT** and include **real references** with {sourceId, chunkIds}.`,
    `2) Match these quotas as closely as possible:`,
    `   - total: ${total}`,
    `   - types: ${JSON.stringify(quotas.typeQuota)}`,
    `   - difficulty: ${JSON.stringify(quotas.diffQuota)}`,
    `3) **Balance coverage**: distribute questions across different sourceId/chunkIds (do not bias to the first chunk).`,
    `4) **Types**:`,
    `   - "open": short free-form answer (2–3 sentences).`,
    `   - "mcq": 4 options, exactly **1 correct** ("correctOptionIndex"). Distractors must be **plausible** but **clearly wrong** if you read the context carefully (no “All of the above/None of the above”).`,
    `   - "boolean": unambiguous True/False that depends on a **concrete fact** in the context.`,
    `   - "citation": compel the assistant to quote a **specific fragment** (page or chunk).`,
    `5) Provide "expectedAnswer": concise, **verbatim or near-verbatim** from context when possible; avoid paraphrases that lose detail.`,
    `6) Include **"references"** as [{"sourceId":"src-…","chunkIds":["c1","c2"]}] pointing to the exact chunks used.`,
    `7) Safety: no PII, secrets, or content not present in the context. Do **not** invent details.`,
    `8) Language for questions/options/expectedAnswer: **${language}**.`,
    ``,
    `## Output JSON schema`,
    `{`,
    `  "questions": [`,
    `    {`,
    `      "id": "string",`,
    `      "type": "open|mcq|boolean|citation",`,
    `      "difficulty": "easy|medium|hard",`,
    `      "text": "string",`,
    `      "options": ["A","B","C","D"],           // only for type="mcq"`,
    `      "correctOptionIndex": 0,                // only for type="mcq"`,
    `      "expectedAnswer": "string",`,
    `      "references": [{"sourceId":"src-...","chunkIds":["c1","c2"]}],`,
    `      "tags": ["auto"],`,
    `      // optional but encouraged (ignored if unused by the system):`,
    `      "mustCite": true,                       // esp. for type="citation"`,
    `      "rubric": {`,
    `        "keyPoints": ["point1","point2"],     // atomic facts to cover`,
    `        "keywords": ["term1","term2"]         // helps rule-based scorer`,
    `      }`,
    `    }`,
    `  ]`,
    `}`,
    ``,
    `## CONTEXT`,
    ctx,
    ``,
    `## INSTRUCTION`,
    `Generate ${total} questions that satisfy the quotas and constraints above, **balancing sources/chunks**.`,
    `Return **only** the JSON object described in the schema.`,
  ].join("\n");
}


// intenta reparar y parsear json de la LLM
function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {}
  // intenta extraer bloque ```json ... ```
  const m =
    text.match(/```json([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/);
  if (m) {
    try {
      return JSON.parse(m[1]);
    } catch {}
  }
  // ultima oportunidad: recorta desde primer { hasta último }
  const i = text.indexOf("{");
  const j = text.lastIndexOf("}");
  if (i >= 0 && j > i) {
    try {
      return JSON.parse(text.slice(i, j + 1));
    } catch {}
  }
  throw new Error("Respuesta LLM no es JSON válido");
}

// --- cuotas por tipo y dificultad (respeta porcentajes del UI) ---
function computeQuotas(total, typesPct, diffPct) {
  const round = (x) => Math.max(0, Math.round(x));
  const typeKeys = ["open", "mcq", "boolean", "citation"];
  const diffKeys = ["easy", "medium", "hard"];

  // tipos
  let typeQuota = Object.fromEntries(
    typeKeys.map((k) => [k, round((total * (typesPct[k] || 0)) / 100)])
  );
  // corrige redondeos
  let spill = total - Object.values(typeQuota).reduce((a, b) => a + b, 0);
  for (const k of typeKeys) {
    if (spill === 0) break;
    typeQuota[k] += 1;
    spill--;
  }

  // dificultad (total global; el modelo repartirá cruzado)
  let diffQuota = Object.fromEntries(
    diffKeys.map((k) => [k, round((total * (diffPct[k] || 0)) / 100)])
  );
  spill = total - Object.values(diffQuota).reduce((a, b) => a + b, 0);
  for (const k of diffKeys) {
    if (spill === 0) break;
    diffQuota[k] += 1;
    spill--;
  }

  return { typeQuota, diffQuota };
}

// --- muestreo de contexto balanceado por fuente ---
function pickBalancedChunks(sourceIds, perSource = 6) {
  const chosen = [];
  for (const sid of sourceIds) {
    const arr = CHUNKS.get(sid) || [];
    if (!arr.length) continue;
    const head = arr.slice(0, 2);
    const rest = arr
      .slice(2)
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.max(0, perSource - head.length));
    chosen.push(...head, ...rest);
  }
  return chosen;
}

// --- hash simple para snapshot (no críptico, suficiente para bloqueo de suite) ---
function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16);
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

async function extractPdfText(buffer) {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  let fullText = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    fullText +=
      content.items
        .map((it) => (it && it.str ? String(it.str) : ""))
        .join(" ") + "\n\n";
  }
  return fullText.trim();
}

// --- helpers arriba del archivo (puedes ponerlos junto a callBot) ---
function findEventBoundary(buf) {
  // soporta \n\n, \r\r, \r\n\r\n — devuelve el índice donde termina el bloque
  const i1 = buf.indexOf("\n\n");
  const i2 = buf.indexOf("\r\r");
  const i3 = buf.indexOf("\r\n\r\n");
  const idxs = [i1, i2, i3].filter(i => i >= 0);
  return idxs.length ? Math.min.apply(null, idxs) : -1;
}


async function callBot(cfg, question) {
  const method = (cfg.method || "POST").toUpperCase();

  // headers: fuerza SSE si no está especificado
  const headers = {
    "Content-Type": "application/json",
    ...(cfg.headers || {}),
  };
  const accept = String(headers.Accept || headers.accept || "").toLowerCase();
  if (!accept) {
    headers["Accept"] = "text/event-stream";
  }

  // body
  const bodyStr = (cfg.bodyTemplate || '{"message":"{{question}}"}')
    .replaceAll("{{question}}", question)
    .replaceAll("{{conversation_id}}", generateId("conv"))
    .replaceAll("{{metadata}}", "{}");

  // timeout
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs || 60000);

  const resp = await fetch(cfg.apiUrl, {
    method,
    headers,
    body: method === "POST" ? bodyStr : undefined,
    signal: ctrl.signal,
  }).finally(() => clearTimeout(timer));

  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  const isSSE =
    ct.includes("text/event-stream") ||
    String(headers.Accept || "").toLowerCase().includes("text/event-stream");

  // STREAM (SSE)
  if (isSSE && resp.body && resp.body.getReader) {
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let out = "";

    while (true) {
      const r = await reader.read();
      const done = r.done;
      const value = r.value;
      if (done) break;

      buf += dec.decode(value, { stream: true });

      // drena bloques completos
      while (true) {
        const split = findEventBoundary(buf);
        if (split === -1) break;

        const evtBlock = buf.slice(0, split);
        const after = buf.slice(split);
        if (after.startsWith("\r\n\r\n")) buf = after.slice(4);
        else if (after.startsWith("\n\n")) buf = after.slice(2);
        else if (after.startsWith("\r\r")) buf = after.slice(2);
        else buf = after;

        const lines = evtBlock.split(/\r?\n/);
        for (const line of lines) {
          const m = /^data:\s?(.*)$/.exec(line);
          if (!m) continue;
          const payload = m[1];

          if (payload === "[DONE]") {
            return { stream: true, answer: out.trim() };
          }

          let piece = "";
          try {
            const j = JSON.parse(payload);
            piece =
              j && (j.answer || j.message || j.delta || (j.data && (j.data.content || j.data.message)) || j.text) || "";
          } catch {
            piece = payload;
          }

          if (piece) {
            // preserva formato razonable para bullets/citas
            if (out && (/^\s*[*\-•]/.test(piece) || piece.startsWith('"'))) out += "\n";
            else if (out && !out.endsWith("\n")) out += " ";
            out += String(piece);
          }
        }
      }
    }
    return { stream: true, answer: out.trim() };
  }

  // NO-STREAM
  const raw = await resp.text();
  let obj;
  try { obj = JSON.parse(raw); } catch { obj = { raw }; }

  const answer =
    (obj && (obj.answer || obj.message ||
      (obj.data && (obj.data.answer || obj.data.message)) ||
      obj.reply ||
      (obj.choices && obj.choices[0] && obj.choices[0].message && obj.choices[0].message.content))) || "";

  return { ...obj, answer: String(answer || "") };
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
  const latencies = runs
    .filter((r) => r.status === "ok")
    .map((r) => r.latencyMs);
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
// ===== EXPORTS =====

// Devuelve un .md o .json de UNA fuente (por sourceId)
app.get("/api/export-source", (req, res) => {
  try {
    const sourceId = String(req.query.sourceId || "");
    const format = String(req.query.format || "md").toLowerCase(); // "md" | "json"

    if (!sourceId) {
      return res.status(400).json({ error: "Falta sourceId" });
    }
    const chunks = CHUNKS.get(sourceId) || [];
    if (!chunks.length) {
      return res.status(404).json({ error: "No hay chunks para ese sourceId" });
    }

    if (format === "json") {
      const payload = { sourceId, totalChunks: chunks.length, chunks };
      const fname = `export-${sourceId}.json`;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
      return res.send(JSON.stringify(payload, null, 2));
    }

    // default: md
    const md = chunks
      .map((c, i) => `\n\n===== CHUNK ${i + 1} (${c.id}) =====\n${c.content}`)
      .join("\n");
    const fname = `export-${sourceId}.md`;
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    return res.send(md);
  } catch (e) {
    console.error("export-source error:", e);
    return res.status(500).json({ error: "Fallo exportando la fuente" });
  }
});

// Devuelve TODO en un solo archivo (todas las fuentes unidas)
app.get("/api/export-all", (_req, res) => {
  try {
    // Markdown concatenado por fuente
    const all = [];
    for (const [sourceId, chunks] of CHUNKS.entries()) {
      all.push(`\n\n######## SOURCE ${sourceId} ########\n`);
      all.push(
        chunks
          .map((c, i) => `\n\n===== CHUNK ${i + 1} (${c.id}) =====\n${c.content}`)
          .join("\n")
      );
    }
    const md = all.join("\n");
    const fname = `export-all-${Date.now()}.md`;
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    return res.send(md);
  } catch (e) {
    console.error("export-all error:", e);
    return res.status(500).json({ error: "Fallo exportando todo" });
  }
});

app.post("/api/generate-questions-llm", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: "OPENAI_API_KEY no configurada" });
    }

    const {
      sources = [],
      total = 50,
      genConfig = {
        difficulty: { easy: 40, medium: 40, hard: 20 },
        types: { open: 40, mcq: 30, boolean: 20, citation: 10 },
        balanceBySource: true,
      },
    } = req.body || {};

    const sourceIds =
      Array.isArray(sources) && sources.length
        ? sources.map((s) => s.id)
        : Array.from(CHUNKS.keys());

    const allChunks = sourceIds.flatMap((id) => CHUNKS.get(id) || []);
    if (!allChunks.length) {
      return res.status(400).json({ error: "No hay chunks procesados todavía" });
    }

    const quotas = computeQuotas(total, genConfig.types, genConfig.difficulty);
    const sample = genConfig.balanceBySource
      ? pickBalancedChunks(sourceIds, 6)
      : allChunks.slice(0, Math.min(40, allChunks.length));

    // snapshot (para DoD “KB snapshot lock”)
    const snapshot = {
      at: new Date().toISOString(),
      sourceIds,
      chunkIds: sample.map((c) => `${c.sourceId}:${c.id}`),
      hash: simpleHash(
        sample
          .map((c) => c.sourceId + c.id + c.content.slice(0, 128))
          .join("|")
      ),
    };

    const prompt = buildPromptFromChunks(sample, quotas, {
      total,
      language: "en",
    });

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "Sigue estrictamente las instrucciones. Responde SOLO JSON válido.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });

    const raw = resp.choices?.[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = safeParseJson(raw);
    }

    const questions = (parsed?.questions || []).slice(0, total).map((q, i) => ({
      id: q.id || `q-${Date.now()}-${i}`,
      type: q.type || "open",
      difficulty: q.difficulty || "medium",
      text: q.text || "Pregunta",
      options: Array.isArray(q.options) ? q.options.slice(0, 4) : undefined,
      correctOptionIndex: Number.isInteger(q.correctOptionIndex)
        ? q.correctOptionIndex
        : undefined,
      expectedAnswer: q.expectedAnswer || "",
      references: Array.isArray(q.references) ? q.references : [],
      tags: Array.isArray(q.tags) ? q.tags : ["auto"],
    }));

    const questionSetId = `qset-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    QUESTIONS.set(questionSetId, questions);

    // Guarda snapshot junto al set (para trazabilidad)
    QUESTIONS.set(`${questionSetId}::snapshot`, snapshot);

    return res.json({
      ok: true,
      questionSetId,
      total: questions.length,
      questions,
      snapshot,
    });
  } catch (err) {
    console.error("generate-questions-llm error:", err);
    return res.status(500).json({ error: "Fallo interno generando con LLM" });
  }
});

// ===== Firecrawl helper =====
async function crawlWithFirecrawl({ url, limit = 50, maxDepth = 2 }) {
  if (!process.env.FIRECRAWL_API_KEY) {
    throw new Error("Falta FIRECRAWL_API_KEY en .env");
  }

  const resp = await fetch("https://api.firecrawl.dev/v1/crawl", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
    },
    // Body mínimo para v1
    body: JSON.stringify({ url, limit, maxDepth }),
  });

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Firecrawl ${resp.status} – ${text}`);
  }
  if (!resp.ok || data?.success === false) {
    throw new Error(`Firecrawl ${resp.status} – ${text}`);
  }

  const items = data?.data?.items || data?.data || data?.results || [];
  return items;
}

// Llama al microservicio local de Crawl4AI deep crawl
async function crawlWithCrawl4AI({ url, limit = 50, maxDepth = 2, deny = [] }) {
  const resp = await fetch("http://127.0.0.1:8002/crawl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, limit, maxDepth, deny }),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Crawl4AI ${resp.status} – ${text}`); }
  if (!resp.ok || data?.ok === false) {
    throw new Error(`Crawl4AI ${resp.status} – ${text}`);
  }
  const items = data?.data?.items || [];
  return items;
}


async function fetchOneWithCrawl4AI(url) {
  const resp = await fetch(`${CRAWL4AI_URL}/fetch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Crawl4AI ${resp.status} – ${text}`);
  }
  if (!resp.ok || data?.ok === false) {
    throw new Error(`Crawl4AI ${resp.status} – ${text}`);
  }
  const item = data?.data || {};
  return {
    url: item.url || url,
    title: item.title || "",
    markdown: item.markdown || "",
  };
}

// --- Como “subir PDF” pero con URL → UNA sola página vía Crawl4AI/Firecrawl
app.post("/api/process-url", async (req, res) => {
  try {
    const {
      url,
      chunkSize = 1000,
      chunkOverlap = 200,
      engine = "crawl4ai", // "crawl4ai" | "firecrawl"
    } = req.body || {};

    if (!url) return res.status(400).json({ error: "Falta url" });

    let page;
    if (engine === "firecrawl") {
      const items = await crawlWithFirecrawl({ url, limit: 1, maxDepth: 0 });
      const first = items[0] || {};
      page = {
        url,
        title: first.title || "",
        text: first.markdown || first.text || "",
      };
    } else {
      const fetched = await fetchOneWithCrawl4AI(url);
      page = {
        url: fetched.url,
        title: fetched.title || "",
        text: fetched.markdown || "",
      };
    }

    if (!page.text || !page.text.trim()) {
      return res.status(422).json({ error: "No se pudo extraer texto de la URL" });
    }

    const sourceId = generateId("src");
    const parts = textToChunks(page.text, Number(chunkSize), Number(chunkOverlap));
    const chunks = parts.map((p, i) => ({
      id: `c${i + 1}`,
      sourceId,
      content: p,
      index: i,
    }));
    CHUNKS.set(sourceId, chunks);

    return res.json({
      ok: true,
      source: {
        id: sourceId,
        type: "url",
        name: page.title || new URL(url).hostname,
        url,
        status: "completed",
        chunks,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("process-url error:", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/crawl", async (req, res) => {
  try {
    const {
      url,
      engine = "crawl4ai",
      limit = 50,
      maxDepth = 2,
      deny = [],
      chunkSize = 1000,
      chunkOverlap = 200,
      compact = true,          // limpiar/deduplicar
      maxChars = 0,            // presupuesto global (0 = sin límite)
      showPageUrls = false,    // mostrar "URL: ..." en el documento final
      keepInlineLinks = false  // mantener [texto](url) o <a href="...">
    } = req.body || {};

    if (!url) return res.status(400).json({ error: "Falta url" });

    // ----------------- Helpers locales -----------------
    const fastHash = (s) => {
      let h = 2166136261 >>> 0;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return h.toString(16);
    };

    const cleanMarkdown = (md) => {
      if (!md) return "";
    
      // 0) Normaliza sin colapsar en exceso
      let lines = md.replace(/\r/g, "").split("\n");
    
      // -------- Helpers 100% genéricos --------
      const stripMdLinks = (s) => {
        if (!s) return s;
    
        // 1) Quita imágenes Markdown por completo
        s = s.replace(/!\[[^\]]*]\([^)]+\)/g, "");
    
        // 2) Enlaces Markdown [texto](url "títuloOpcional")
        s = s.replace(
          /\[([^\]]*?)\]\(\s*([^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/gi,
          (_, text = "", href = "") => {
            const h = (href || "").trim().toLowerCase();
            const isBad =
              h.startsWith("javascript:") ||
              h.startsWith("data:") ||
              h.startsWith("#") ||
              h.startsWith("mailto:") ||
              h.startsWith("tel:") ||
              h.includes("window.print");
            if (isBad && !text.trim()) return "";
            return text;
          }
        );
    
        // 3) Enlaces HTML <a href="...">texto</a>
        s = s.replace(
          /<a[^>]*href\s*=\s*"(javascript:[^"]+|data:[^"]+|#(?:[^"]*)?|mailto:[^"]+|tel:[^"]+)"[^>]*>.*?<\/a>/gi,
          ""
        );
        s = s.replace(/<a[^>]*href\s*=\s*"[^"]+"[^>]*>(.*?)<\/a>/gi, "$1");
    
        return s;
      };
    
      const wc = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);
      const isTitleCaseWord = (w) => /^[A-Z][\p{L}\p{M}’'’-]*$/u.test(w);
    
      // Señales “estructuradas” (tablas, precios, horarios…)
      const hasMoney = (s) => /[$€£¥]\s*\d/.test(s);
      const isOnlyMoney = (s) => /^\s*[$€£¥]?\s*\d[\d.,]*(?:\s*[-–—]\s*[$€£¥]?\s*\d[\d.,]*)?\s*$/.test(s);
      const hasTime = (s) => /\b\d{1,2}:\d{2}\s*(?:a\.m\.|p\.m\.|am|pm)\b/i.test(s);
      const looksLikeTableRow = (s) =>
        /\|/.test(s) || /^[\s\-|:]+$/.test(s);
    
      const isStructuredLine = (s) =>
        hasMoney(s) || hasTime(s) || looksLikeTableRow(s) ||
        ((s.match(/\d/g) || []).length >= 4 && wc(s) <= 20);
    
      // Encabezado/Sección (genérico)
      const isHeading = (s) =>
        /^#{1,6}\s+/.test(s) ||
        (/^\*\*.+\*\*$/.test(s) && wc(s) <= 12) ||
        (/^[A-Z0-9][A-Za-z0-9\s&/:'’–-]{0,60}$/.test(s) && !/[.!?]$/.test(s) && wc(s) <= 8);
    
      // --- FIX tablas de tarifas: rango de meses NO es heading ---
      const MONTH = "(jan|feb|mar|apr|may|jun|june|jul|aug|sep|sept|oct|nov|dec)";
      const isMonthRange = (s) =>
        new RegExp(`^\\s*${MONTH}\\s*[–-]\\s*${MONTH}\\s*$`, "i").test(s);
    
      // filas con barras o patrones típicos de tabla
      const looksLikeTableLine = (s) =>
        /\|/.test(s) || /^[\s\-|:]+$/.test(s) || /\bM\s*[–-]\s*F\b/i.test(s) || /\bSat\s*[–-]\s*Sun\b/i.test(s);
    
      const isUtility = (t) => {
        const raw = (t || "").trim();
    
        // Normaliza wrappers comunes de UI (#, **, comillas, paréntesis, etc.)
        const s = raw
          .replace(/^#+\s*/, "")
          .replace(/^\*\*|\*\*$/g, "")
          .replace(/^[\s"'“”‘’`()\[\]<>]+/, "")
          .replace(/[\s"'“”‘’`()\[\]<>]+$/, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
    
        // Versión sin puntuación final para matches exactos como "print this page"
        const sNoTrailPunct = s.replace(/[\s"'“”‘’).,:;!?-]+$/g, "");
    
        return (
          // migas tipo "Home > ..."
          /^home\s*>\s*/i.test(raw) ||
    
          // accesibilidad/UI
          s.includes("skip to main content") ||
          s.includes("opens the search dialog") ||
          s.includes("opens a modal dialog") ||
    
          // utilitarios puros (con o sin ':', comillas, #, **, paréntesis…)
          sNoTrailPunct === "share" ||
          sNoTrailPunct === "print this page" ||
    
          // enlaces utilitarios
          /^\s*(tel|mailto):/.test(s) ||
          s === "search" ||
          s === "menu" ||
          s === "navigation"
        );
      };
    
      // Líneas tipo menú (bullets de items cortos en Title Case)
      const isMenuBullet = (t) => {
        if (!/^\s*[-*]\s+/.test(t)) return false;
        const body = t.replace(/^\s*[-*]\s+/, "");
        if (wc(body) <= 6 && !/[.!?]$/.test(body)) return true;
        return false;
      };
    
      // 1) Elimina markdown links globalmente (deja el texto visible)
      lines = lines
        .map(stripMdLinks)
        .map((s) => s.replace(/\[\]\([^)]*\)/g, "")) // restos "[](...)"
        .map((s) => s.replace(/javascript:\s*window\.print\s*\([^)]*\)/gi, ""));
    
      // 2) Barrido con estado: sección + bloque estructurado (+flag de tabla)
      const out = [];
      const seenBySection = new Map(); // key -> Set(lines)
      let sectionKey = "GLOBAL";
      let structuredBlock = false;
      let inTable = false; // <<<<<< flag tabla
    
      const sectSet = (k) => {
        if (!seenBySection.has(k)) seenBySection.set(k, new Set());
        return seenBySection.get(k);
      };
    
      for (let i = 0; i < lines.length; i++) {
        let s = (lines[i] || "").trim();
    
        if (!s) {
          // salir de modo tabla al encontrar línea en blanco
          inTable = false;
          if (out.length && out[out.length - 1] !== "") out.push("");
          structuredBlock = false;
          continue;
        }
    
        if (/^site footer$/i.test(s)) break;
        if (isUtility(s)) continue;
        if (isMenuBullet(s)) continue;
    
        // --- Rango de meses forma parte de la tabla: no es heading ---
        if (isMonthRange(s)) {
          inTable = true;
          structuredBlock = true;
          out.push(s);
          continue;
        }
    
        // Headings normales (solo si no estamos dentro de una tabla)
        if (!inTable && isHeading(s)) {
          sectionKey = s.replace(/\s+/g, " ").slice(0, 80);
          structuredBlock = false;
          const set = sectSet(sectionKey);
          if (!set.has(s)) { out.push(s); set.add(s); }
          continue;
        }
    
        // Detecta líneas de tabla para mantener el modo tabla activo
        if (looksLikeTableLine(s)) {
          inTable = true;
          structuredBlock = true;
        }
    
        if (isStructuredLine(s)) structuredBlock = true;
    
        if (!structuredBlock) {
          const letters = (s.match(/[\p{L}\p{M}]/gu) || []).length;
          const glyphs = s.replace(/\s/g, "").length;
          if (letters < 3 && !hasMoney(s)) continue;
          if (letters < glyphs * 0.4 && !hasMoney(s)) continue;
    
          // items titulo cortos (menú)
          const words = s.split(/\s+/);
          const ratio = words.filter(isTitleCaseWord).length / Math.max(words.length, 1);
          if (words.length <= 5 && !/[.!?]$/.test(s) && ratio >= 0.8 && !hasMoney(s) && !hasTime(s)) {
            continue;
          }
        }
    
        const set = sectSet(sectionKey);
        const isUndedupeableInBlock =
          structuredBlock && (hasMoney(s) || isOnlyMoney(s) || hasTime(s) || looksLikeTableRow(s));
    
        if (!isUndedupeableInBlock) {
          if (set.has(s)) continue;
          set.add(s);
        }
    
        out.push(s);
      }
    
      return out
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\*{2,}\s*([^\*]+?)\s*\*{2,}/g, "**$1**")
        .trim();
    };
    

    const dedupeParagraphs = (texts) => {
      const seen = new Set();
      const out = [];

      const isKeepableShort = (p) => {
        const t = (p || "").trim();
        if (!t) return false;
        if (/^#{1,6}\s+/.test(t)) return true;        // encabezado markdown
        if (/:$/.test(t)) return true;                // termina en ":"
        if (/^[A-Z][A-Za-zÀ-ÿ’'’-]+(?:[ ,\-][A-Za-zÀ-ÿ’'’-]+){0,4}$/.test(t)) return true; // catálogos
        if (t.length >= 20) return true;              // frase normal
        return false;
      };

      for (const t of texts) {
        const paras = String(t || "").split(/\n{2,}/g);
        for (let p of paras) {
          const raw = (p || "").trim();
          if (!raw) continue;

          const norm = raw.replace(/\s+/g, " ").trim().toLowerCase();
          if (norm.length < 10) continue;

          const h = fastHash(norm);
          if (seen.has(h)) continue;

          if (raw.length < 60 && !isKeepableShort(raw)) continue;

          seen.add(h);
          out.push(raw);
        }
      }
      return out.join("\n\n").trim();
    };

    const applyBudget = (str, budget) => {
      const b = Number(budget);
      if (!Number.isFinite(b) || b <= 0) return str;
      if (str.length <= b) return str;
      const head = Math.floor(b * 0.7);
      const tail = b - head;
      return str.slice(0, head) + "\n\n[...] (recortado)\n\n" + str.slice(-tail);
    };

    // NUEVO: pasada final para quitar enlaces inline y líneas URL si procede
    const stripLinksFromText = (s, { stripUrlLines = true } = {}) => {
      if (!s) return s;
      // quita imágenes
      s = s.replace(/!\[[^\]]*]\([^)]+\)/g, "");
      // markdown links -> texto
      s = s.replace(/\[([^\]]*?)\]\(\s*([^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/gi, (_, txt = "") => (txt || "").trim());
      // html links -> texto
      s = s.replace(/<a[^>]*href\s*=\s*"[^"]+"[^>]*>(.*?)<\/a>/gis, "$1").replace(/<\/?a\b[^>]*>/gi, "");
      if (stripUrlLines) {
        s = s
          .split("\n")
          .filter((line) => {
            const t = line.trim();
            if (/^URL:\s*https?:\/\//i.test(t)) return false;
            if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return false;
            return true;
          })
          .join("\n");
      }
      return s;
    };

    // --------------- 1) Pedimos páginas ----------------
    let rawPages = [];
    if (engine === "crawl4ai") {
      rawPages = await crawlWithCrawl4AI({ url, limit, maxDepth, deny }); // microservicio local
    } else {
      rawPages = await crawlWithFirecrawl({ url, limit, maxDepth });       // SaaS
    }

    // --------------- 2) Normalizar SIEMPRE a strings ---------------
    const normalizePage = (p) => {
      const urlStr =
        (p && typeof p.url === "string" && p.url) ||
        (p && typeof p.link === "string" && p.link) ||
        url;

      const titleStr =
        (p && typeof p.title === "string" && p.title) ||
        (p && p.meta && typeof p.meta.title === "string" && p.meta.title) ||
        "";

      const asText = (html) => {
        try {
          const root = parseHTML(html);
          root.querySelectorAll("script,style,noscript").forEach((n) => n.remove());
          return root.text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
        } catch {
          return "";
        }
      };

      let md = "";
      if (p && typeof p.markdown === "string") md = p.markdown;
      else if (p && p.markdown && typeof p.markdown.raw_markdown === "string") md = p.markdown.raw_markdown;

      let txt = "";
      if (!md) {
        if (p && typeof p.text === "string") txt = p.text;
        else if (p && typeof p.cleaned_text === "string") txt = p.cleaned_text;
        else if (p && typeof p.content === "string") txt = p.content;
      }

      let fromHtml = "";
      if (!md && !txt && p && typeof p.html === "string") fromHtml = asText(p.html);

      return {
        url: String(urlStr || url),
        title: String(titleStr || ""),
        markdown: String(md || txt || fromHtml || "")
      };
    };

    const pages = (Array.isArray(rawPages) ? rawPages : []).map(normalizePage);

    // --------------- 3) Limpiar + filtrar usables ---------------
    const cleaned = (compact
      ? pages.map(p => ({ ...p, markdown: cleanMarkdown(p.markdown) }))
      : pages
    ).filter(p => p.markdown && p.markdown.trim().length > 0);

    console.log(`[crawl] pages totales: ${pages.length} | con texto util: ${cleaned.length}`);
    if (cleaned.length === 0) {
      return res.status(422).json({ error: "No se pudo extraer texto del crawl" });
    }

    // --- 4) Dedupe y presupuesto (igual que antes) ---
    const dedupedBody = compact
    ? dedupeParagraphs(cleaned.map(p => p.markdown))
    : cleaned.map(p => p.markdown).join("\n\n");

    // ❗ NUEVO: construir cabeceras sin "===== PAGE N =====" salvo que showPageUrls sea true
    const headers = cleaned
    .map((p, i) => {
      const parts = [];
      if (showPageUrls) parts.push(`===== PAGE ${i + 1} =====`);
      if (p.title) parts.push(`# ${p.title}`);
      if (showPageUrls) parts.push(`URL: ${p.url}`);
      const h = parts.join("\n").trim();
      return h ? h : null;
    })
    .filter(Boolean)
    .join("\n\n");

    let allText = `${headers}\n\n${dedupedBody}`.trim();

    // Pasada final para ocultar enlaces inline / líneas URL (como ya tenías)
    if (!keepInlineLinks || !showPageUrls) {
    allText = stripLinksFromText(allText, { stripUrlLines: !showPageUrls });
    }

    // ❗ NUEVO: por seguridad, si no mostramos URLs, elimina cualquier línea residual "===== PAGE N ====="
    if (!showPageUrls) {
    allText = allText
      .replace(/^\s*===== PAGE \d+ =====\s*$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    }

    if (compact && Number(maxChars) > 0) {
    allText = applyBudget(allText, Number(maxChars));
    }


    // --------------- 5) Chunkificar como un PDF ---------------
    const parts = textToChunks(allText, Number(chunkSize), Number(chunkOverlap));

    // --------------- 6) Guardar en memoria como UNA sola fuente ---------------
    const sourceId = generateId("src");
    const chunks = parts.map((content, i) => ({
      id: `c${i + 1}`,
      sourceId,
      content,
      index: i
    }));
    CHUNKS.set(sourceId, chunks);

    const name = (() => { try { return new URL(url).hostname; } catch { return url; } })();
    const source = {
      id: sourceId,
      type: "crawl",
      name,
      url,
      status: "completed",
      chunks,
      createdAt: new Date().toISOString()
    };

    return res.json({ ok: true, sources: [source] });
  } catch (err) {
    console.error("crawl error:", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});


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
        text = await extractPdfText(file.buffer);
      } else if (
        /text/i.test(file.mimetype || "") ||
        /\.(md|txt)$/i.test(file.originalname || "")
      ) {
        text = file.buffer.toString("utf8");
      } else {
        text = file.buffer.toString("utf8");
      }

      const parts = textToChunks(
        text,
        Number(req.body?.chunkSize),
        Number(req.body?.chunkOverlap)
      );

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
          text = await extractPdfText(buf); // ⬅️ aquí también
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

// 1) Iniciar un run vacío (guarda las preguntas)
app.post("/api/start-run", (req, res) => {
  const { questionSetId } = req.body || {};
  const qs = questionSetId ? (QUESTIONS.get(questionSetId) || []) : [];
  if (!qs.length) return res.status(400).json({ error: "No hay preguntas para ese questionSetId" });

  const runId = generateId("run");
  const testRun = {
    id: runId,
    name: `Run ${new Date().toLocaleString()}`,
    status: "running",
    createdAt: new Date().toISOString(),
    questions: qs,
    runs: [],
    evaluations: [],
    config: { concurrency: 1, retries: 0, seed: 0 },
  };
  TEST_RUNS.set(runId, testRun);
  res.json({ ok: true, runId, total: qs.length });
});

app.post("/api/ask-one", async (req, res) => {
  try {
    const { runId, questionId, config } = req.body || {};
    const run = TEST_RUNS.get(runId);
    if (!run) return res.status(404).json({ error: "run no encontrado" });

    const q = run.questions.find(q => q.id === questionId);
    if (!q) return res.status(404).json({ error: "questionId no encontrado en el run" });

    const t0 = Date.now();
    try {
      const reply = await callBot(config, q.text);
      const latencyMs = Date.now() - t0;

      const answerText = String(reply?.answer ?? "").trim();
      const isEmpty = !answerText; // ← criterio simple (puedes endurecerlo)

      const rec = {
        questionId: q.id,
        attempt: 1,
        status: "ok",
        httpStatus: 200,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        latencyMs,
        replyRaw: reply,
        replyParsed: reply,
        isEmpty, // ← guardamos flag
      };

      run.runs.push(rec);
      return res.json({ ok: true, run: rec, answer: answerText, empty: isEmpty });
    } catch (e) {
      const latencyMs = Date.now() - t0;
      const rec = {
        questionId: q.id,
        attempt: 1,
        status: "http_error",
        httpStatus: 500,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        latencyMs,
        replyRaw: { error: String(e) },
        isEmpty: true, // tratamos error como “vacío” para poder abortar si quieres
      };
      run.runs.push(rec);
      return res.status(200).json({ ok: false, run: rec, error: String(e), empty: true });
    }
  } catch (e) {
    console.error("ask-one error:", e);
    return res.status(500).json({ error: "Fallo en /api/ask-one" });
  }
});


// 3) Finalizar y producir el reporte (reutiliza la lógica de /api/get-report)
app.get("/api/finalize-run", async (req, res) => {
  try {
    const runId = String(req.query.runId || "");
    const mode = String(req.query.mode || "heuristic"); // o "llm"
    const run = TEST_RUNS.get(runId);
    if (!run) return res.status(404).json({ error: "run no encontrado" });

    // Evalúa igual que /api/get-report pero SIN volver a preguntar al bot:
    const evals = [];
    for (const r of run.runs) {
      const q = run.questions.find((x) => x.id === r.questionId);
      const actual = r.replyParsed?.answer || String(r.replyRaw || "");
      const expected =
        q?.expectedAnswer || (q?.options?.[q?.correctOptionIndex ?? -1] || "");

      if (mode === "llm") {
        const context = (q?.references || [])
          .flatMap(ref => (ref.chunkIds || [])
            .map(id => (CHUNKS.get(ref.sourceId) || []).find(c => c.id === id)?.content || ""))
          .filter(Boolean)
          .slice(0, 3)
          .join("\n---\n");

        const g = await gradeWithLLM({
          question: q?.text || "",
          expected,
          actual,
          context
        });

        evals.push({
          questionId: q.id,
          correctness: g.finalScore,
          coverage: 0, contextUse: 0, hallucination: 0, citations: 0,
          finalScore: g.finalScore, verdict: g.verdict, notes: g.notes || [],
        });
      } else {
        evals.push(evaluateAnswer(q.id, expected, actual));
      }
    }

    run.evaluations = evals;
    run.status = "completed";
    run.completedAt = new Date().toISOString();

    const report = generateReport(run);
    return res.json({ ok: true, report, evaluations: run.evaluations, runs: run.runs });
  } catch (e) {
    console.error("finalize-run error:", e);
    return res.status(500).json({ error: "Fallo generando el reporte" });
  }
});


// --- Ejecutar contra el agente
app.post("/api/execute", async (req, res) => {
  const { sourceId, questionSetId, config } = req.body || {};

  const qs = questionSetId
    ? QUESTIONS.get(questionSetId) || []
    : QUESTIONS.get(sourceId) || [];

  if (!qs.length)
    return res.status(400).json({ error: "No hay preguntas generadas" });

// Utilidad de espera
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const interCallDelayMs = Number((config && config.interCallDelayMs) ?? 1500); // 👈 1.5s entre preguntas
const maxRetries = Number((config && config.retries) ?? 1);                  // 👈 reintentos por pregunta
const retryBackoffMs = 1000;

// ===== BUCLE PRINCIPAL =====
const runId = generateId("run");
const runs = [];

for (let i = 0; i < qs.length; i++) {
  const q = qs[i];

  // Cooldown entre preguntas
  if (i > 0 && interCallDelayMs > 0) {
    await wait(interCallDelayMs);
  }

  const t0 = Date.now();

  // Reintentos con backoff (también si Cloudflare 1102)
  let reply = null;
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      reply = await callBot(config, q.text);
      break; // éxito
    } catch (e) {
      lastErr = e;
      // backoff progresivo
      await wait(retryBackoffMs * (attempt + 1));
    }
  }

  const latencyMs = Date.now() - t0;

  if (!reply) {
    runs.push({
      questionId: q.id,
      attempt: maxRetries + 1,
      status: "http_error",
      httpStatus: 500,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      latencyMs,
      replyRaw: { error: String(lastErr?.message || lastErr) },
    });
    continue;
  }

  runs.push({
    questionId: q.id,
    attempt: 1,
    status: "ok",
    httpStatus: 200,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    latencyMs,
    replyRaw: reply,
    replyParsed: reply, // 👈 aquí queda la respuesta del bot
  });
}

const testRun = {
  id: runId,
  name: `Run ${new Date().toLocaleString()}`,
  status: "running",
  createdAt: new Date().toISOString(),
  questions: qs,
  runs,
  evaluations: [],
  config: { concurrency: 1, retries: maxRetries, seed: 0 },
};
TEST_RUNS.set(runId, testRun);
res.json({ ok: true, runId, questions: qs.length, runs: runs.length });
});

const JUDGE_SYSTEM = `
You are an objective grader. Return **VALID JSON only** (no extra text).

Compare the BOT_ANSWER with the EXPECTED_ANSWER, using CONTEXT when provided.
Produce per-dimension scores in [0,1] and a final weighted score.

Fields to return:
{
  "correctness": 0-1,        // factual match to expected/key facts
  "coverage": 0-1,           // does it cover all required key points?
  "groundedness": 0-1,       // supported by the provided context chunks
  "hallucination": 0-1,      // 0 = none, 1 = severe unsupported claims
  "citations": 0-1,          // if the question requires citing, are cites present & aligned?
  "style": 0-1,              // optional clarity/conciseness
  "score": 0-1,              // final weighted
  "verdict": "ACIERTO" | "PARCIAL" | "FALLO",
  "feedback": "short reason (<=2 sentences)"
}

Weights for "score":
score = 0.35*correctness + 0.25*coverage + 0.15*groundedness + 0.15*(1 - hallucination) + 0.10*citations

Verdict rule (override only if obviously mis-scored):
- ACIERTO if score >= 0.80
- PARCIAL if 0.50 <= score < 0.80
- FALLO if score < 0.50

Guidelines:
- Do not penalize style if the essential content is correct.
- Prefer **exact matches** to expected/key facts; minor paraphrase is OK.
- If the user should cite (e.g., type="citation" or "mustCite" true), check that the answer quotes or pinpoints the correct fragment; otherwise set "citations" low.
- If BOT_ANSWER introduces facts absent from CONTEXT/EXPECTED, increase hallucination.
- If BOT_ANSWER is empty, set very low scores and verdict "FALLO".
`;


async function gradeWithLLM({ question, expected, actual, context = "" }) {
  if (!process.env.OPENAI_API_KEY) {
    // fallback si no hay clave (evita romper)
    return { finalScore: 0, verdict: "FALLO", notes: ["Falta OPENAI_API_KEY"] };
  }

  // Recorta para evitar prompts gigantes
  const clamp = (s, n) => (s && s.length > n ? s.slice(0, n) + " ..." : s || "");
  const payload = {
    question: clamp(question, 900),
    expectedAnswer: clamp(expected, 900),
    actualAnswer: clamp(actual, 1800),
    context: clamp(context, 3000)
  };

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",           // puedes cambiarlo si quieres
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: JUDGE_SYSTEM },
      { role: "user", content: JSON.stringify(payload) }
    ],
  });

  let out = {};
  try { out = JSON.parse(resp.choices?.[0]?.message?.content || "{}"); } catch {}

  const score = Math.max(0, Math.min(1, Number(out.score) || 0));
  let verdict = String(out.verdict || "").toUpperCase();
  if (!["ACIERTO","PARCIAL","FALLO"].includes(verdict)) {
    // regla por score si el modelo no fue estricto
    verdict = score >= 0.8 ? "ACIERTO" : score >= 0.5 ? "PARCIAL" : "FALLO";
  }
  const notes = out.feedback ? [String(out.feedback)] : [];
  return { finalScore: score, verdict, notes };
}



app.get("/api/get-report", async (req, res) => {
  try {
    const runId = String(req.query.runId || "");
    const mode = String(req.query.mode || "heuristic"); // "heuristic" | "llm"
    const run = TEST_RUNS.get(runId);
    if (!run) return res.status(404).json({ error: "run no encontrado" });

    const evals = [];

    for (const r of run.runs) {
      const q = run.questions.find((x) => x.id === r.questionId);
      const actual = typeof r.replyParsed?.answer === "string"
        ? r.replyParsed.answer
        : (typeof r.replyRaw === "string" ? r.replyRaw : (() => { try { return JSON.stringify(r.replyRaw); } catch { return ""; } })());
      const expected =
        q?.expectedAnswer || (q?.options?.[q?.correctOptionIndex ?? -1] || "");

      if (mode === "llm") {
        // Construir un CONTEXTO breve a partir de las referencias (opcional)
        const context = (q?.references || [])
          .flatMap(ref => (ref.chunkIds || [])
            .map(id => (CHUNKS.get(ref.sourceId) || []).find(c => c.id === id)?.content || ""))
          .filter(Boolean)
          .slice(0, 3) // limita a 3 trozos para coste/latencia
          .join("\n---\n");

        const g = await gradeWithLLM({
          question: q?.text || "",
          expected,
          actual,
          context
        });

        // Rellenamos campos para que generateReport() funcione igual
        evals.push({
          questionId: q.id,
          correctness: g.finalScore, // compat
          coverage: 0,
          contextUse: 0,
          hallucination: 0,
          citations: 0,
          finalScore: g.finalScore,
          verdict: g.verdict,
          notes: g.notes || [],
        });
      } else {
        // Evaluador heurístico existente
        evals.push(evaluateAnswer(q.id, expected, actual));
      }
    }

    run.evaluations = evals;
    run.status = "completed";
    run.completedAt = new Date().toISOString();

    const report = generateReport(run);
    // al final de /api/get-report, después de generar `report`
    return res.json({
      ok: true,
      report,
      evaluations: run.evaluations,  // ⬅️ añade esto
      runs: run.runs                  // ⬅️ y esto (útil para latencias/estados)
      // , mode
    });
  } catch (e) {
    console.error("get-report (llm) error:", e);
    return res.status(500).json({ error: "Fallo generando el reporte" });
  }
});

// --- Manejo de errores global (incluye errores de multer) ---
app.use((err, req, res, next) => {
  if (err && err.name === "MulterError") {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    console.error("Unhandled server error:", err);
    return res.status(500).json({ error: "Fallo interno en el servidor" });
  }
  next();
});

const PORT = process.env.PORT || 4000;

// ⬇️ Inicia el servidor y quita límites de tiempo para requests largas
const server = app.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT}`);
});

// Node 20+ — desactiva límites (o pon valores grandes si prefieres)
server.requestTimeout = 0;    // 0 = sin límite para la request completa
server.headersTimeout = 0;    // 0 = sin límite esperando headers
server.keepAliveTimeout = 0;  // 0 = sin límite de keep-alive

// Si prefieres límites altos en vez de 0, por ejemplo 10 minutos:
// server.requestTimeout = 10 * 60 * 1000;
// server.headersTimeout = 10 * 60 * 1000;
// server.keepAliveTimeout = 10 * 60 * 1000;

