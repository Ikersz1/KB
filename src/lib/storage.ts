import { Chunk, Question, Answer, Evaluation, IngestState } from "@/types";

type DB = {
  chunks: Map<string, Chunk[]>;        // por docId
  questions: Map<string, Question[]>;  // por docId
  answers: Map<string, Answer[]>;      // por docId
  evals: Map<string, Evaluation[]>;    // por docId
  ingest: Map<string, {state: IngestState; error?: string}>;
  embeddings: Map<string, number[][]>; // por docId (paralelo a chunks)
};

const g = globalThis as any;
if (!g.__KB_DB__) {
  g.__KB_DB__ = { chunks:new Map(), questions:new Map(), answers:new Map(), evals:new Map(), ingest:new Map(), embeddings:new Map() } as DB;
}
export const db: DB = g.__KB_DB__;
