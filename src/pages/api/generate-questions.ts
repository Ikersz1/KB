import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/lib/db";
import { KBQuestion, QuestionGenConfig } from "@/types";
import { generateId } from "@/utils";
import { llmJSON } from "@/lib/llm";

const defaultCfg: QuestionGenConfig = {
  totalQuestions: 50,
  difficulty: { easy: 20, medium: 20, hard: 10 },
  types: { open: 25, mcq: 15, boolean: 5, citation: 5 },
  balanceBySource: true,
};

export default async function handler(req:NextApiRequest, res:NextApiResponse){
  if (req.method !== "POST") return res.status(405).end();
  const { sourceId, config } = req.body as { sourceId: string; config?: Partial<QuestionGenConfig> };
  const src = db.sources.get(sourceId);
  const chunks = db.chunks.get(sourceId) || [];
  if (!src || !chunks.length) return res.status(400).json({ error: "source sin chunks" });

  const cfg: QuestionGenConfig = { ...defaultCfg, ...config };
  const perChunk = Math.max(1, Math.ceil(cfg.totalQuestions / chunks.length));

  const all: KBQuestion[] = [];
  for (const ch of chunks) {
    const prompt = `
Eres un generador de preguntas. A partir del TEXTO, crea hasta ${perChunk} preguntas variadas.
Devuelve JSON: [{"text":"...","difficulty":"easy|medium|hard","type":"open|mcq|boolean|citation","options":["A","B","C","D"],"correctOptionIndex":0,"expectedAnswer":"...", "tags":["..."]}]
TEXTO:
${ch.content}
`;
    try {
      const out = await llmJSON<any[]>(prompt);
      for (const q of out ?? []) {
        all.push({
          id: generateId("q"),
          type: (q.type ?? "open"),
          difficulty: (q.difficulty ?? "medium"),
          text: q.text,
          options: q.options,
          correctOptionIndex: q.correctOptionIndex,
          expectedAnswer: q.expectedAnswer,
          references: [{ sourceId, chunkIds: [ch.id] }],
          tags: q.tags ?? [],
        });
        if (all.length >= cfg.totalQuestions) break;
      }
      if (all.length >= cfg.totalQuestions) break;
    } catch { /* si falla este chunk, seguimos */ }
  }

  // Fallback: si quedó corto, completa con preguntas simples
  while (all.length < cfg.totalQuestions) {
    all.push({
      id: generateId("q"),
      type: "open",
      difficulty: "easy",
      text: "Resume el concepto principal del fragmento.",
      expectedAnswer: "Respuesta basada en el documento.",
      references: [{ sourceId, chunkIds: [chunks[Math.floor(Math.random()*chunks.length)].id] }],
      tags: ["fallback"]
    });
  }

  db.questions.set(sourceId, all.slice(0, cfg.totalQuestions));
  return res.json({ ok:true, total: cfg.totalQuestions, questions: db.questions.get(sourceId) });
}
