import { useState, useCallback, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { Checkbox } from "./ui/checkbox";
import { Progress } from "./ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { useAppStore } from "../lib/store";
import { generateId } from "../lib/utils";
import { mockQuestions } from "../lib/mock-data";
import { KBQuestion } from "../types";
import { 
  Settings, 
  Wand2, 
  Trash2, 
  Edit, 
  Eye,
  FileText,
  Database,
  Plus
} from "lucide-react";

export function QuestionsScreen() {
  const {
    sources,
    questions,
    setQuestions,
    updateQuestion,
    removeQuestion,
    questionConfig,
    setQuestionConfig,
    setCurrentScreen,
    // añade estas si no estaban:
    questionSetId,
    setQuestionSetId,
  } = useAppStore();
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [editingQuestion, setEditingQuestion] = useState<string | null>(null);
  const [previewQuestion, setPreviewQuestion] = useState<string | null>(null);

  // ======== NUEVO: selección de fuentes ========
  const completedSources = useMemo(
    () => sources.filter((s) => s.status === "completed"),
    [sources]
  );

  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(
    () => completedSources.map((s) => s.id) // por defecto: todas las completadas
  );

  // Re-sincroniza selección cuando cambian las fuentes (p.ej., al terminar de procesar)
  useEffect(() => {
    const completedIds = completedSources.map((s) => s.id);
    setSelectedSourceIds((prev) => {
      const validPrev = prev.filter((id) => completedIds.includes(id));
      // si no hay ninguna previa válida, selecciona todas por defecto
      return validPrev.length ? validPrev : completedIds;
    });
  }, [completedSources]);

  const allSelected = selectedSourceIds.length === completedSources.length && completedSources.length > 0;
  const toggleAll = () => {
    setSelectedSourceIds(allSelected ? [] : completedSources.map((s) => s.id));
  };
  const toggleOne = (id: string) => {
    setSelectedSourceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const selectedSourcesPayload = useMemo(
    () => selectedSourceIds.map((id) => ({ id })),
    [selectedSourceIds]
  );

  // ✅ ÚNICA función para generar preguntas (envía fuentes y guarda questionSetId)
  const generateQuestionsNow = useCallback(async () => {
    try {
      setIsGenerating(true);
      setGenerationProgress(10);

      if (completedSources.length === 0) {
        alert("Primero procesa alguna fuente");
        setIsGenerating(false);
        return;
      }

      const chosen = completedSources.filter((s) => selectedSourceIds.includes(s.id));
      if (chosen.length === 0) {
        alert("Selecciona al menos una fuente (en estado 'completed').");
        setIsGenerating(false);
        return;
      }

      const total = Math.max(1, questionConfig.totalQuestions || 50);

      const resp = await fetch("/api/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sources: chosen.map((s) => ({ id: s.id })), // solo las elegidas
          total,
        }),
      });

      setGenerationProgress(60);

      const data = await resp.json();
      if (!resp.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${resp.status} generando preguntas`);
      }

      setQuestionSetId(data.questionSetId);
      setQuestions(data.questions || []);

      setGenerationProgress(100);
      alert(`Generadas ${data.total} preguntas`);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Error generando preguntas");
    } finally {
      setIsGenerating(false);
      setTimeout(() => setGenerationProgress(0), 500);
    }
  }, [completedSources, selectedSourceIds, questionConfig, setQuestions, setQuestionSetId]);

  const loadDemoQuestions = useCallback(() => {
    setQuestions(mockQuestions);
  }, [setQuestions]);

  const addCustomQuestion = useCallback(() => {
    const newQuestion: KBQuestion = {
      id: generateId('q'),
      type: 'open',
      difficulty: 'medium',
      text: 'Nueva pregunta personalizada',
      expectedAnswer: '',
      references: [],
      tags: ['custom']
    };
    setQuestions([...questions, newQuestion]);
    setEditingQuestion(newQuestion.id);
  }, [questions, setQuestions]);

  const generateQuestionsWithLLM = useCallback(async () => {
    try {
      setIsGenerating(true);
      setGenerationProgress(5);
  
      if (completedSources.length === 0) {
        alert("Primero procesa alguna fuente (en estado 'completed').");
        setIsGenerating(false);
        return;
      }

      const chosen = completedSources.filter((s) => selectedSourceIds.includes(s.id));
      if (chosen.length === 0) {
        alert("Selecciona al menos una fuente (en estado 'completed').");
        setIsGenerating(false);
        return;
      }
  
      const resp = await fetch("/api/generate-questions-llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sources: chosen.map((s) => ({ id: s.id })),  // solo las elegidas
          total: questionConfig.totalQuestions,
          genConfig: {
            difficulty: questionConfig.difficulty,
            types: questionConfig.types,
            balanceBySource: !!questionConfig.balanceBySource,
          },
        }),
      });
  
      const data = await resp.json();
      if (!resp.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${resp.status} generando con LLM`);
      }
  
      if (typeof setQuestionSetId === "function") {
        setQuestionSetId(data.questionSetId);
      }
      setQuestions(data.questions || []);
      setGenerationProgress(100);
      alert(`Generadas ${data.total} preguntas con IA`);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Error generando preguntas con IA");
    } finally {
      setIsGenerating(false);
    }
  }, [completedSources, selectedSourceIds, questionConfig, setQuestions, setQuestionSetId, setIsGenerating, setGenerationProgress]);
  
  const handleQuestionUpdate = useCallback((questionId: string, field: keyof KBQuestion, value: any) => {
    updateQuestion(questionId, { [field]: value });
  }, [updateQuestion]);

  const getTypeIcon = (type: KBQuestion['type']) => {
    switch (type) {
      case 'mcq': return '📝';
      case 'boolean': return '✓';
      case 'citation': return '📚';
      default: return '💬';
    }
  };

  const getDifficultyColor = (difficulty: KBQuestion['difficulty']) => {
    switch (difficulty) {
      case 'easy': return 'bg-green-100 text-green-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'hard': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const questionsByType = {
    open: questions.filter(q => q.type === 'open').length,
    mcq: questions.filter(q => q.type === 'mcq').length,
    boolean: questions.filter(q => q.type === 'boolean').length,
    citation: questions.filter(q => q.type === 'citation').length
  };

  const questionsByDifficulty = {
    easy: questions.filter(q => q.difficulty === 'easy').length,
    medium: questions.filter(q => q.difficulty === 'medium').length,
    hard: questions.filter(q => q.difficulty === 'hard').length
  };

  const canProceed = questions.length > 0;

  if (sources.length === 0) {
    return (
      <div className="container mx-auto px-4 py-6">
        <Card>
          <CardContent className="pt-6 text-center">
            <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3>No hay fuentes disponibles</h3>
            <p className="text-muted-foreground mb-4">
              Primero debes procesar documentos o URLs en la sección de Ingesta.
            </p>
            <Button onClick={() => setCurrentScreen('ingestion')}>
              Ir a Ingesta
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* Generation Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Configuración de Generación
          </CardTitle>
          <CardDescription>
            Parámetros para generar preguntas automáticamente
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Total Questions */}
            <div className="space-y-2">
              <Label htmlFor="total-questions">Número total de preguntas</Label>
              <Input
                id="total-questions"
                type="number"
                min="1"
                max="100"
                value={questionConfig.totalQuestions}
                onChange={(e) => setQuestionConfig({
                  ...questionConfig,
                  totalQuestions: parseInt(e.target.value) || 1
                })}
              />
            </div>

            {/* Balance by source */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="balance-sources"
                checked={questionConfig.balanceBySource}
                onCheckedChange={(checked) => setQuestionConfig({
                  ...questionConfig,
                  balanceBySource: !!checked
                })}
              />
              <Label htmlFor="balance-sources">
                Equilibrar por documento/URL
              </Label>
            </div>
          </div>

          {/* NUEVO: Selector de fuentes a usar */}
          <div className="rounded-lg border p-3">
            <div className="mb-2 font-semibold">Fuentes a usar</div>
            {completedSources.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay fuentes en estado <strong>completed</strong>. Ve a Ingesta para procesarlas.
              </p>
            ) : (
              <>
                <label className="flex items-center gap-2 mb-2">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  <span>Seleccionar todas</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {selectedSourceIds.length}/{completedSources.length}
                  </span>
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-56 overflow-auto pr-1">
                  {completedSources.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 rounded-md border px-2 py-1 hover:bg-accent hover:text-accent-foreground cursor-pointer"
                      title={s.url || s.name}
                    >
                      <Checkbox
                        checked={selectedSourceIds.includes(s.id)}
                        onCheckedChange={() => toggleOne(s.id)}
                      />
                      <span className="truncate">
                        {s.name || s.url || s.id}
                        {s.type ? (
                          <span className="ml-2 text-xs text-muted-foreground">({s.type})</span>
                        ) : null}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {Array.isArray(s.chunks) ? s.chunks.length : 0} chunks
                      </span>
                    </label>
                  ))}
                </div>

                <div className="mt-2 text-xs text-muted-foreground">
                  Solo se usarán las fuentes seleccionadas. Si no seleccionas ninguna, se seleccionarán todas por defecto.
                </div>
              </>
            )}
          </div>

          {/* Difficulty Distribution */}
          <div className="space-y-3">
            <Label>Distribución de dificultad (%)</Label>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="diff-easy" className="text-sm">Fácil</Label>
                <Input
                  id="diff-easy"
                  type="number"
                  min="0"
                  max="100"
                  value={questionConfig.difficulty.easy}
                  onChange={(e) => setQuestionConfig({
                    ...questionConfig,
                    difficulty: {
                      ...questionConfig.difficulty,
                      easy: parseInt(e.target.value) || 0
                    }
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="diff-medium" className="text-sm">Medio</Label>
                <Input
                  id="diff-medium"
                  type="number"
                  min="0"
                  max="100"
                  value={questionConfig.difficulty.medium}
                  onChange={(e) => setQuestionConfig({
                    ...questionConfig,
                    difficulty: {
                      ...questionConfig.difficulty,
                      medium: parseInt(e.target.value) || 0
                    }
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="diff-hard" className="text-sm">Difícil</Label>
                <Input
                  id="diff-hard"
                  type="number"
                  min="0"
                  max="100"
                  value={questionConfig.difficulty.hard}
                  onChange={(e) => setQuestionConfig({
                    ...questionConfig,
                    difficulty: {
                      ...questionConfig.difficulty,
                      hard: parseInt(e.target.value) || 0
                    }
                  })}
                />
              </div>
            </div>
          </div>

          {/* Question Types Distribution */}
          <div className="space-y-3">
            <Label>Distribución de tipos (%)</Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="type-open" className="text-sm">Abiertas</Label>
                <Input
                  id="type-open"
                  type="number"
                  min="0"
                  max="100"
                  value={questionConfig.types.open}
                  onChange={(e) => setQuestionConfig({
                    ...questionConfig,
                    types: {
                      ...questionConfig.types,
                      open: parseInt(e.target.value) || 0
                    }
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type-mcq" className="text-sm">Opción múltiple</Label>
                <Input
                  id="type-mcq"
                  type="number"
                  min="0"
                  max="100"
                  value={questionConfig.types.mcq}
                  onChange={(e) => setQuestionConfig({
                    ...questionConfig,
                    types: {
                      ...questionConfig.types,
                      mcq: parseInt(e.target.value) || 0
                    }
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type-boolean" className="text-sm">Verdadero/Falso</Label>
                <Input
                  id="type-boolean"
                  type="number"
                  min="0"
                  max="100"
                  value={questionConfig.types.boolean}
                  onChange={(e) => setQuestionConfig({
                    ...questionConfig,
                    types: {
                      ...questionConfig.types,
                      boolean: parseInt(e.target.value) || 0
                    }
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type-citation" className="text-sm">Cita/Fuente</Label>
                <Input
                  id="type-citation"
                  type="number"
                  min="0"
                  max="100"
                  value={questionConfig.types.citation}
                  onChange={(e) => setQuestionConfig({
                    ...questionConfig,
                    types: {
                      ...questionConfig.types,
                      citation: parseInt(e.target.value) || 0
                    }
                  })}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Generation Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Generación de Preguntas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            {/* Nuevo botón: genera con OpenAI */}
            <Button onClick={generateQuestionsWithLLM} disabled={isGenerating}>
              {isGenerating ? (
                <>
                  <Wand2 className="w-4 h-4 mr-2 animate-spin" />
                  Generando con IA...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4 mr-2" />
                  Generar con IA (OpenAI)
                </>
              )}
            </Button>

            {/* Tu botón anterior (mock/local) */}
            <Button onClick={generateQuestionsNow} disabled={isGenerating} variant="outline">
              <Wand2 className="w-4 h-4 mr-2" />
              Generar (mock)
            </Button>

            <Button variant="outline" onClick={loadDemoQuestions}>
              <Database className="w-4 h-4 mr-2" />
              Cargar Demo
            </Button>
            <Button variant="outline" onClick={addCustomQuestion}>
              <Plus className="w-4 h-4 mr-2" />
              Añadir Manual
            </Button>
          </div>

          {isGenerating && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Generando preguntas...</span>
                <span>{Math.round(generationProgress)}%</span>
              </div>
              <Progress value={generationProgress} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Questions Overview */}
      {questions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Resumen de Preguntas</CardTitle>
            <CardDescription>
              {questions.length} preguntas generadas
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="text-center">
                <div className="text-2xl font-semibold text-blue-600">{questionsByType.open}</div>
                <div className="text-sm text-muted-foreground">Abiertas</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-green-600">{questionsByType.mcq}</div>
                <div className="text-sm text-muted-foreground">Opción múltiple</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-orange-600">{questionsByType.boolean}</div>
                <div className="text-sm text-muted-foreground">V/F</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-purple-600">{questionsByType.citation}</div>
                <div className="text-sm text-muted-foreground">Citas</div>
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-xl font-semibold text-green-600">{questionsByDifficulty.easy}</div>
                <div className="text-sm text-muted-foreground">Fáciles</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-semibold text-yellow-600">{questionsByDifficulty.medium}</div>
                <div className="text-sm text-muted-foreground">Medias</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-semibold text-red-600">{questionsByDifficulty.hard}</div>
                <div className="text-sm text-muted-foreground">Difíciles</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Questions List */}
      {questions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Preguntas Generadas</CardTitle>
            <CardDescription>
              Revisa y edita las preguntas según sea necesario
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Dificultad</TableHead>
                  <TableHead>Pregunta</TableHead>
                  <TableHead>Referencias</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {questions.map((question) => (
                  <TableRow key={question.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{getTypeIcon(question.type)}</span>
                        <Badge variant="outline">{question.type.toUpperCase()}</Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getDifficultyColor(question.difficulty)}>
                        {question.difficulty}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-md">
                      {editingQuestion === question.id ? (
                        <Textarea
                          value={question.text}
                          onChange={(e) => handleQuestionUpdate(question.id, 'text', e.target.value)}
                          onBlur={() => setEditingQuestion(null)}
                          className="min-h-[60px]"
                          autoFocus
                        />
                      ) : (
                        <div className="truncate">{question.text}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {question.references.reduce((acc, ref) => acc + (ref.chunkIds?.length || 0), 0)} chunks
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditingQuestion(question.id)}>
                          <Edit className="w-3 h-3" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setPreviewQuestion(question.id)}>
                          <Eye className="w-3 h-3" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => removeQuestion(question.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Next Step */}
      {canProceed && (
        <>
          <Separator />
          <div className="flex justify-end">
            <Button onClick={() => setCurrentScreen('config')}>
              Continuar a Configuración del Agente
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
