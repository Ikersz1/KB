// src/components/ExecutionScreen.tsx
import { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Progress } from "./ui/progress";
import { Separator } from "./ui/separator";
import { useAppStore } from "../lib/store";
import { Zap, Play, RotateCcw, BarChart3, Timer, Eye } from "lucide-react";
import { formatDuration } from "../lib/utils";

type TranscriptRow = {
  id: string;
  question: string;
  expected: string;
  answer: string;
  latencyMs: number;
  verdict?: string;
  score?: number;
};

export function ExecutionScreen() {
  const {
    questions,
    questionSetId,
    chatbotConfig,
    setCurrentScreen,
    setCurrentRun,
    setCurrentReport,
    addReport,
  } = useAppStore();

  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [runId, setRunId] = useState("");
  const [transcript, setTranscript] = useState<TranscriptRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleStart = useCallback(async () => {
    try {
      if (!questionSetId || questions.length === 0) {
        alert("Primero genera preguntas.");
        return;
      }
      setIsRunning(true);
      setProgress(0);
      setTranscript([]);
      setErrorMsg(null);

      // subimos timeouts
      const tuned = { ...chatbotConfig, timeoutMs: Math.max(120000, chatbotConfig.timeoutMs || 0) };

      // 1) start-run
      const s = await fetch("/api/start-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionSetId }),
      });
      const sdata = await s.json();
      if (!s.ok || !sdata?.ok) throw new Error(sdata?.error || "No se pudo iniciar el run");
      setRunId(sdata.runId);

      // ---- parámetro: cuántas vacías seguidas disparan el abort ----
      const ABORT_AFTER_EMPTY_CONSEC = 1; // ← si quieres tolerar 2 o 3, cambia aquí
      let emptyStreak = 0;
      let i = 0;

      for (i = 0; i < questions.length; i++) {
        const q = questions[i];

        const r = await fetch("/api/ask-one", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: sdata.runId, questionId: q.id, config: tuned }),
        });
        const ans = await r.json();

        const answer =
          ans?.answer ??
          ans?.run?.replyParsed?.answer ??
          ans?.run?.replyRaw?.answer ??
          (typeof ans?.run?.replyRaw === "string" ? ans.run.replyRaw : "") ??
          "";

        const expected =
          q.expectedAnswer ??
          (q.options && Number.isInteger(q.correctOptionIndex) ? q.options[q.correctOptionIndex!] : "") ??
          "";

        setTranscript(prev => [
          ...prev,
          {
            id: q.id,
            question: q.text || "",
            expected,
            answer: String(answer || ""),
            latencyMs: ans?.run?.latencyMs ?? 0,
          },
        ]);

        // progreso visual
        setProgress(Math.round(((i + 1) / questions.length) * 100));

        // --- aborta si vacío (según racha) ---
        const isEmpty = Boolean(ans?.empty) || String(answer).trim() === "";
        if (isEmpty) emptyStreak++; else emptyStreak = 0;
        if (emptyStreak >= ABORT_AFTER_EMPTY_CONSEC) {
          setErrorMsg("Respuesta vacía detectada: se detiene el run para no saturar el endpoint.");
          break; // ← sal del bucle
        }

        // pausa opcional
        // await new Promise(r => setTimeout(r, 600));
      }

      // 3) finalizar y evaluar (con lo que haya)
      const fin = await fetch(`/api/finalize-run?runId=${encodeURIComponent(sdata.runId)}&mode=llm`);
      const finData = await fin.json();
      if (!fin.ok || !finData?.ok) throw new Error(finData?.error || "No se pudo finalizar el run");

      setCurrentRun({
        id: sdata.runId,
        name: `Run ${new Date().toLocaleString()}`,
        status: "completed",
        createdAt: new Date().toISOString(),
        config: { concurrency: 1, retries: 0, seed: 0 },
        questions: [...questions],
        runs: finData.runs,
        evaluations: finData.evaluations,
      });
      setCurrentReport(finData.report);
      addReport(finData.report);

      setProgress(Math.round((Math.max(i, 1) / questions.length) * 100));
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || "Error ejecutando");
      alert(e?.message || "Error ejecutando");
    } finally {
      setIsRunning(false);
      setTimeout(() => setProgress(0), 800);
    }
  }, [questionSetId, questions, chatbotConfig, setCurrentRun, setCurrentReport, addReport]);


  const handleRetry = useCallback(() => {
    setTranscript([]);
    setErrorMsg(null);
    setRunId("");
    handleStart();
  }, [handleStart]);

  if (questions.length === 0) {
    return (
      <div className="container mx-auto px-4 py-6">
        <Card>
          <CardContent className="pt-6 text-center">
            <BarChart3 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3>No hay preguntas disponibles</h3>
            <p className="text-muted-foreground mb-4">
              Primero debes generar preguntas en la sección correspondiente.
            </p>
            <Button onClick={() => setCurrentScreen('questions')}>Ir a Generación de Preguntas</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Ejecución contra el Agente
          </CardTitle>
          <CardDescription>
            Preguntas listas: {questions.length} • Endpoint: {chatbotConfig.apiUrl}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Run ID</Label>
              <Input value={runId} readOnly placeholder="Se rellena al ejecutar" />
            </div>
            <div>
              <Label>Question Set</Label>
              <Input value={questionSetId} readOnly />
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleStart} disabled={isRunning}>
              <Play className="w-4 h-4 mr-2" />
              Lanzar Test
            </Button>
            <Button variant="outline" onClick={handleRetry} disabled={isRunning}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Reintentar
            </Button>
            <Button variant="outline" onClick={() => setCurrentScreen("audit")} disabled={!runId}>
              <Eye className="w-4 h-4 mr-2" />
              Ver Auditoría
            </Button>
          </div>

          {isRunning && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Enviando preguntas al agente…</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          {errorMsg && (
            <p className="text-sm text-red-600">{errorMsg}</p>
          )}
        </CardContent>
      </Card>

      {/* TRANSCRIPT (Q ↔ A) */}
      {transcript.length > 0 && (
        <>
          <Separator />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Preguntas y Respuestas del Bot
              </CardTitle>
              <CardDescription>
                Muestra cada pregunta, la respuesta esperada y lo que contestó el bot.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {transcript.map((row) => (
                  <div key={row.id} className="border rounded p-3">
                    <div className="text-sm text-muted-foreground">ID: {row.id}</div>
                    <div className="mt-1">
                      <div className="font-medium">Pregunta</div>
                      <div>{row.question}</div>
                    </div>
                    {row.expected && (
                      <div className="mt-2">
                        <div className="font-medium">Esperada</div>
                        <div className="text-sm">{row.expected}</div>
                      </div>
                    )}
                    <div className="mt-2">
                      <div className="font-medium">Respuesta del bot</div>
                      <div className="whitespace-pre-wrap">{row.answer || <em>(vacía)</em>}</div>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground flex items-center gap-3">
                      <span className="flex items-center gap-1"><Timer className="w-3 h-3" />{formatDuration(row.latencyMs)}</span>
                      {row.verdict && <span>• {row.verdict}{typeof row.score === "number" ? ` (${(row.score*100).toFixed(1)}%)` : ""}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
