import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/lib/db";
import { evaluateAnswer, generateReport } from "@/utils";
import { QuestionEval, TestRun } from "@/types";

export default async function handler(req:NextApiRequest, res:NextApiResponse){
  const { runId } = req.query as { runId: string };
  const run = db.testRuns.get(runId);
  if (!run) return res.status(404).json({ error: "run no encontrado" });

  // Construye evaluaciones usando expectedAnswer cuando exista
  const evals: QuestionEval[] = [];
  for (const r of run.runs) {
    const q = run.questions.find(q => q.id === r.questionId)!;
    const actual = r.replyParsed?.answer ?? String(r.replyRaw ?? "");
    const expected = q.expectedAnswer ?? (q.options?.[q.correctOptionIndex ?? -1] ?? "");
    const e = evaluateAnswer(q.id, expected, actual);
    evals.push(e);
  }
  run.evaluations = evals;
  run.status = "completed";
  run.completedAt = new Date().toISOString();

  const report = generateReport(run);
  return res.json({ ok:true, report });
}
