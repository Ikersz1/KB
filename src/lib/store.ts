import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { 
  Source, 
  KBQuestion, 
  ChatbotConfig, 
  TestRun, 
  QuestionGenConfig,
  RunReport 
} from '../types';

type GenerationMethod = 'mock' | 'llm' | 'manual';

interface KBSnapshot {
  id: string;             // p.ej. qset-... o run-...
  sourceIds: string[];    // fuentes usadas para generar la suite
  createdAt: string;      // ISO
}

interface AppState {
  // Current screen
  currentScreen: 'ingestion' | 'questions' | 'config' | 'execution' | 'audit';
  setCurrentScreen: (screen: AppState['currentScreen']) => void;

  // Sources
  sources: Source[];
  addSource: (source: Source) => void;
  updateSource: (id: string, updates: Partial<Source>) => void;
  clearSources: () => void;

  // Questions
  questions: KBQuestion[];
  setQuestions: (questions: KBQuestion[]) => void;
  updateQuestion: (id: string, updates: Partial<KBQuestion>) => void;
  removeQuestion: (id: string) => void;
  resetQuestions: () => void; // 🔹 nuevo

  // 🔹 ID del set de preguntas generado en backend (nullable)
  questionSetId: string | null;
  setQuestionSetId: (id: string | null) => void;

  // 🔹 Snapshot de KB (para DoD “KB snapshot lock”)
  kbSnapshot: KBSnapshot | null;
  lockKBSnapshot: (snapshot: KBSnapshot) => void;

  // (opcional) último método de generación
  lastGeneration: { method: GenerationMethod; total: number } | null;
  setLastGeneration: (g: { method: GenerationMethod; total: number } | null) => void;

  // Question generation config
  questionConfig: QuestionGenConfig;
  setQuestionConfig: (config: QuestionGenConfig) => void;

  // Chatbot config
  chatbotConfig: ChatbotConfig;
  setChatbotConfig: (config: ChatbotConfig) => void;

  // Test runs
  testRuns: TestRun[];
  addTestRun: (run: TestRun) => void;
  updateTestRun: (id: string, updates: Partial<TestRun>) => void;
  currentRun: TestRun | null;
  setCurrentRun: (run: TestRun | null) => void;

  // Reports
  reports: RunReport[];
  addReport: (report: RunReport) => void;
  currentReport: RunReport | null;
  setCurrentReport: (report: RunReport | null) => void;

  // Chunking config
  chunkingConfig: {
    chunkSize: number;
    chunkOverlap: number;
  };
  setChunkingConfig: (config: { chunkSize: number; chunkOverlap: number }) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentScreen: 'ingestion',
      setCurrentScreen: (screen) => set({ currentScreen: screen }),

      sources: [],
      addSource: (source) => set((state) => ({ 
        sources: [...state.sources, source] 
      })),
      updateSource: (id, updates) => set((state) => ({
        sources: state.sources.map(s => s.id === id ? { ...s, ...updates } : s)
      })),
      clearSources: () => set({ sources: [] }),

      questions: [],
      setQuestions: (questions) => set({ questions }),
      updateQuestion: (id, updates) => set((state) => ({
        questions: state.questions.map(q => q.id === id ? { ...q, ...updates } : q)
      })),
      removeQuestion: (id) => set((state) => ({
        questions: state.questions.filter(q => q.id !== id)
      })),
      resetQuestions: () => set({ questions: [], questionSetId: null }),

      // questionSetId + setter (nullable)
      questionSetId: null,
      setQuestionSetId: (id) => set({ questionSetId: id }),

      // KB snapshot lock
      kbSnapshot: null,
      lockKBSnapshot: (snapshot) => set({ kbSnapshot: snapshot }),

      // último método de generación
      lastGeneration: null,
      setLastGeneration: (g) => set({ lastGeneration: g }),

      questionConfig: {
        totalQuestions: 30,
        difficulty: { easy: 40, medium: 40, hard: 20 },
        types: { open: 40, mcq: 30, boolean: 20, citation: 10 },
        balanceBySource: true
      },
      setQuestionConfig: (config) => set({ questionConfig: config }),

      chatbotConfig: {
        apiUrl: 'https://api.example.com/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer YOUR_API_KEY_HERE'
        },
        bodyTemplate: JSON.stringify({
          question: '{{question}}',
          conversation_id: '{{conversation_id}}',
          metadata: '{{metadata}}'
        }, null, 2),
        timeoutMs: 30000
      },
      setChatbotConfig: (config) => set({ chatbotConfig: config }),

      testRuns: [],
      addTestRun: (run) => set((state) => ({ 
        testRuns: [...state.testRuns, run] 
      })),
      updateTestRun: (id, updates) => set((state) => ({
        testRuns: state.testRuns.map(r => r.id === id ? { ...r, ...updates } : r)
      })),
      currentRun: null,
      setCurrentRun: (run) => set({ currentRun: run }),

      reports: [],
      addReport: (report) => set((state) => ({ 
        reports: [...state.reports, report] 
      })),
      currentReport: null,
      setCurrentReport: (report) => set({ currentReport: report }),

      chunkingConfig: {
        chunkSize: 1000,
        chunkOverlap: 200
      },
      setChunkingConfig: (config) => set({ chunkingConfig: config })
    }),
    {
      name: 'kb-agent-tester-storage',
      partialize: (state) => ({
        sources: state.sources,
        questions: state.questions,
        questionSetId: state.questionSetId,   // persistimos también el ID del set
        kbSnapshot: state.kbSnapshot,        // persistimos snapshot
        lastGeneration: state.lastGeneration,
        questionConfig: state.questionConfig,
        chatbotConfig: state.chatbotConfig,
        testRuns: state.testRuns,
        reports: state.reports,
        chunkingConfig: state.chunkingConfig
      })
    }
  )
);
