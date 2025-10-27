import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/lib/db";
import { ChatbotConfig, ChatbotReply, QuestionRun, TestRun } from "@/types";
import { generateId, formatDuration } from "@/utils";

async function callBot(cfg: ChatbotConfig, question: string, contextHint?: string): Promise<ChatbotReply> {
  const body = cfg.bodyTemplate
    .replaceAll("{{question}}", question)
    .replaceAll("{{context}}", contextHint ?? "");

  const ctrl = new AbortController();
  const t = setTimeout(()=> ctrl.abort(), cfg.timeoutMs || 30000);

  const r = await fetch(cfg.apiUrl, {
    method: cfg.method,
    headers: cfg.headers,
    body: cfg.method === "POST" ? body : undefined,
    signal: ctrl.signal
  }).catch(e => { throw e; });
  clearTimeout(t);

  const httpStatus = r.status;
  const raw = await r.text();
  try {
    const parsed = JSON.parse(raw);
    return parsed as ChatbotReply;
  } catch {
    // si tu bot no devuelve JSON, crea un wrapper
    return { answer: raw };
  }
}

export default async function handler(req:NextApiRequest, res:NextApiResponse){
  if (req.method !== "POST") return res.status(405).end();
  const { sourceId, config } = req.body as { sourceId: string; config: ChatbotConfig };
  const questions = db.questions.get(sourceId) || [];
  if (!questions.length) return res.status(400).json({ error: "No hay preguntas generadas" });

  const runId = generateId("run");
  const runs: QuestionRun[] = [];

  for (const q of questions) {
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    try {
      const reply = await callBot(config, q.text);
      const latencyMs = Math.round(performance.now() - t0);
      runs.push({
        questionId: q.id,
        attempt: 1,
        status: "ok",
        startedAt,
        endedAt: new Date().toISOString(),
        latencyMs,
        replyRaw: reply,
        replyParsed: reply,
      });
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - t0);
      runs.push({
        questionId: q.id, attempt: 1, status: err.name === "AbortError" ? "timeout":"http_error",
        httpStatus: undefined, startedAt, endedAt: new Date().toISOString(), latencyMs, replyRaw: { error: String(err) }
      });
    }
  }

  const testRun: TestRun = {
    id: runId,
    name: `Run ${new Date().toLocaleString()}`,
    status: "running",
    createdAt: new Date().toISOString(),
    questions,
    runs,
    evaluations: [],
    config: { concurrency: 1, retries: 0, seed: 0 },
  };
  db.testRuns.set(runId, testRun);
  return res.json({ ok:true, runId, questions: questions.length, runs: runs.length });
}
