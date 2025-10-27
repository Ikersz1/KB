// Core types for KB Agent Tester

export interface Source {
  id: string;
  type: 'pdf' | 'docx' | 'txt' | 'md' | 'url';
  name: string;
  url?: string;
  size?: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  chunks: Chunk[];
  createdAt: string;
}

export interface Chunk {
  id: string;
  sourceId: string;
  content: string;
  index: number;
  metadata?: Record<string, any>;
}

export interface KBQuestion {
  id: string;
  type: "open" | "mcq" | "boolean" | "citation";
  difficulty: "easy" | "medium" | "hard";
  text: string;
  options?: string[];
  correctOptionIndex?: number;
  expectedAnswer?: string;
  references: Array<{
    sourceId: string;
    chunkIds: string[];
  }>;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface ChatbotConfig {
  apiUrl: string;
  method: 'POST' | 'GET';
  headers: Record<string, string>;
  bodyTemplate: string;
  timeoutMs: number;
}

export interface ChatbotReply {
  answer: string;
  citations?: Array<{
    url?: string;
    sourceId?: string;
    chunkId?: string;
    quote?: string;
  }>;
  meta?: { 
    tokensIn?: number; 
    tokensOut?: number; 
    model?: string;
  };
}

export interface QuestionRun {
  questionId: string;
  attempt: number;
  status: "ok" | "timeout" | "http_error" | "parse_error";
  httpStatus?: number;
  startedAt: string;
  endedAt: string;
  latencyMs: number;
  replyRaw: any;
  replyParsed?: ChatbotReply;
}

export interface QuestionEval {
  questionId: string;
  correctness: number;
  coverage: number;
  contextUse: number;
  hallucination: number;
  citations: number;
  style?: number;
  finalScore: number;
  verdict: "ACIERTO" | "PARCIAL" | "FALLO";
  notes: string[];
}

export interface TestRun {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  createdAt: string;
  completedAt?: string;
  config: {
    concurrency: number;
    retries: number;
    seed: number;
  };
  questions: KBQuestion[];
  runs: QuestionRun[];
  evaluations: QuestionEval[];
}

export interface RunReport {
  runId: string;
  createdAt: string;
  totals: {
    questions: number;
    ok: number;
    partial: number;
    fail: number;
    accuracy: number;
    avgScore: number;
    latencyAvgMs: number;
    latencyP95Ms: number;
    hallucinationRate: number;
    citationValidity: number;
  };
  breakdowns: {
    byDifficulty: Record<"easy"|"medium"|"hard", {count:number; accuracy:number}>;
    byType: Record<"open"|"mcq"|"boolean"|"citation",{count:number; accuracy:number}>;
    bySource: Array<{sourceId:string; count:number; accuracy:number}>;
  };
  worstQuestions: Array<{questionId:string; finalScore:number; notes:string[]}>;
  kbGaps: string[];
  exports: {
    jsonPath: string;
    csvPath: string;
    htmlPath?: string;
  };
}

export interface QuestionGenConfig {
  totalQuestions: number;
  difficulty: {
    easy: number;
    medium: number;
    hard: number;
  };
  types: {
    open: number;
    mcq: number;
    boolean: number;
    citation: number;
  };
  balanceBySource: boolean;
}