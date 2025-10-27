// Simple in-memory DB that survives hot-reloads
import { Source, Chunk, KBQuestion, TestRun, QuestionRun, QuestionEval } from "@/types";

type DB = {
  sources: Map<string, Source>;
  chunks: Map<string, Chunk[]>;            // by sourceId
  questions: Map<string, KBQuestion[]>;    // by sourceId
  testRuns: Map<string, TestRun>;          // by runId
};

const g = globalThis as any;
if (!g.__KB_DB__) {
  g.__KB_DB__ = {
    sources: new Map(),
    chunks: new Map(),
    questions: new Map(),
    testRuns: new Map(),
  } as DB;
}
export const db: DB = g.__KB_DB__;
