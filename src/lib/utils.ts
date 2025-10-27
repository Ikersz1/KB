import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { QuestionEval, TestRun, RunReport } from '../types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Generate unique IDs
export function generateId(prefix: string = ''): string {
  return `${prefix}${prefix ? '-' : ''}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Format file size
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format duration
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

// Calculate percentile
export function calculatePercentile(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index % 1;
  
  if (upper >= sorted.length) return sorted[sorted.length - 1];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

// Mock evaluation function
export function evaluateAnswer(questionId: string, expectedAnswer: string, actualAnswer: string): QuestionEval {
  // Simplified rule-based evaluation for demo
  const expected = expectedAnswer.toLowerCase();
  const actual = actualAnswer.toLowerCase();
  
  // Basic keyword matching
  const expectedKeywords = expected.split(' ').filter(word => word.length > 3);
  const actualKeywords = actual.split(' ');
  
  const matchedKeywords = expectedKeywords.filter(keyword => 
    actualKeywords.some(actualWord => actualWord.includes(keyword) || keyword.includes(actualWord))
  );
  
  const correctness = Math.min(matchedKeywords.length / Math.max(expectedKeywords.length, 1), 1);
  const coverage = actual.length > expected.length * 0.5 ? 0.8 : 0.5;
  const contextUse = actual.includes('analytics') || actual.includes('api') || actual.includes('oauth') ? 0.9 : 0.6;
  const hallucination = Math.random() * 0.3; // Random for demo
  const citations = actual.includes('source') || actual.includes('documentation') ? 0.8 : 0.4;
  
  const finalScore = 0.35 * correctness + 0.25 * coverage + 0.15 * contextUse + 0.15 * (1 - hallucination) + 0.10 * citations;
  
  let verdict: "ACIERTO" | "PARCIAL" | "FALLO";
  if (finalScore >= 0.8) verdict = "ACIERTO";
  else if (finalScore >= 0.5) verdict = "PARCIAL";
  else verdict = "FALLO";
  
  const notes: string[] = [];
  if (correctness < 0.7) notes.push("Respuesta incompleta o imprecisa");
  if (coverage < 0.6) notes.push("Falta cobertura de puntos clave");
  if (hallucination > 0.4) notes.push("Posible información no respaldada");
  if (citations < 0.5) notes.push("Faltan referencias o citas");
  
  return {
    questionId,
    correctness,
    coverage,
    contextUse,
    hallucination,
    citations,
    finalScore,
    verdict,
    notes
  };
}

// Generate report from test run
export function generateReport(testRun: TestRun): RunReport {
  const evaluations = testRun.evaluations;
  const runs = testRun.runs;
  
  const totals = {
    questions: evaluations.length,
    ok: evaluations.filter(e => e.verdict === "ACIERTO").length,
    partial: evaluations.filter(e => e.verdict === "PARCIAL").length,
    fail: evaluations.filter(e => e.verdict === "FALLO").length,
    accuracy: 0,
    avgScore: 0,
    latencyAvgMs: 0,
    latencyP95Ms: 0,
    hallucinationRate: 0,
    citationValidity: 0
  };
  
  totals.accuracy = totals.ok / totals.questions;
  totals.avgScore = evaluations.reduce((sum, e) => sum + e.finalScore, 0) / evaluations.length;
  
  const latencies = runs.filter(r => r.status === 'ok').map(r => r.latencyMs);
  totals.latencyAvgMs = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
  totals.latencyP95Ms = calculatePercentile(latencies, 95);
  
  totals.hallucinationRate = evaluations.filter(e => e.hallucination > 0.3).length / evaluations.length;
  totals.citationValidity = evaluations.filter(e => e.citations >= 0.7).length / evaluations.length;
  
  // Breakdowns
  const breakdowns = {
    byDifficulty: {} as Record<string, {count: number; accuracy: number}>,
    byType: {} as Record<string, {count: number; accuracy: number}>,
    bySource: [] as Array<{sourceId: string; count: number; accuracy: number}>
  };
  
  // Group by difficulty
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const questionIds = testRun.questions.filter(q => q.difficulty === difficulty).map(q => q.id);
    const evals = evaluations.filter(e => questionIds.includes(e.questionId));
    breakdowns.byDifficulty[difficulty] = {
      count: evals.length,
      accuracy: evals.filter(e => e.verdict === "ACIERTO").length / Math.max(evals.length, 1)
    };
  }
  
  // Group by type
  for (const type of ['open', 'mcq', 'boolean', 'citation']) {
    const questionIds = testRun.questions.filter(q => q.type === type).map(q => q.id);
    const evals = evaluations.filter(e => questionIds.includes(e.questionId));
    breakdowns.byType[type] = {
      count: evals.length,
      accuracy: evals.filter(e => e.verdict === "ACIERTO").length / Math.max(evals.length, 1)
    };
  }
  
  // Worst questions
  const worstQuestions = evaluations
    .filter(e => e.finalScore < 0.7)
    .sort((a, b) => a.finalScore - b.finalScore)
    .slice(0, 5)
    .map(e => ({
      questionId: e.questionId,
      finalScore: e.finalScore,
      notes: e.notes
    }));
  
  // Mock KB gaps
  const kbGaps = [
    "Añadir más ejemplos prácticos sobre configuración de API",
    "Ampliar documentación sobre casos de error y troubleshooting",
    "Incluir más detalles sobre límites y restricciones del sistema"
  ];
  
  return {
    runId: testRun.id,
    createdAt: testRun.completedAt || testRun.createdAt,
    totals,
    breakdowns,
    worstQuestions,
    kbGaps,
    exports: {
      jsonPath: `/exports/${testRun.id}_report.json`,
      csvPath: `/exports/${testRun.id}_report.csv`,
      htmlPath: `/exports/${testRun.id}_report.html`
    }
  };
}

// Export data functions
export function exportToJSON(data: any): string {
  return JSON.stringify(data, null, 2);
}

export function exportToCSV(data: any[]): string {
  if (!data.length) return '';
  
  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map(row => 
      headers.map(header => {
        const value = row[header];
        return typeof value === 'string' && value.includes(',') 
          ? `"${value}"` 
          : value;
      }).join(',')
    )
  ].join('\n');
  
  return csvContent;
}

// Download file utility
export function downloadFile(content: string, filename: string, contentType: string = 'text/plain') {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}