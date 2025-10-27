import { useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Progress } from "./ui/progress";
import { useAppStore } from "../lib/store";
import { exportToJSON, exportToCSV, downloadFile, formatDuration } from "../lib/utils";
import { RunReport } from "../types";
import { 
  BarChart3, 
  Download, 
  FileText, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle,
  CheckCircle,
  Clock,
  Target,
  Lightbulb,
  Filter
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";

export function AuditScreen() {
  const {
    currentReport,
    currentRun,
    testRuns,
    questions,
    sources,
    setCurrentScreen
  } = useAppStore();

  const [selectedFilter, setSelectedFilter] = useState<{
    difficulty?: string;
    type?: string;
    verdict?: string;
    source?: string;
  }>({});

  // Filter questions based on current filters
  const filteredQuestions = useMemo(() => {
    if (!currentRun) return [];
    
    return currentRun.questions.filter(question => {
      const evaluation = currentRun.evaluations.find(e => e.questionId === question.id);
      
      if (selectedFilter.difficulty && question.difficulty !== selectedFilter.difficulty) return false;
      if (selectedFilter.type && question.type !== selectedFilter.type) return false;
      if (selectedFilter.verdict && evaluation?.verdict !== selectedFilter.verdict) return false;
      if (selectedFilter.source && !question.references.some(ref => ref.sourceId === selectedFilter.source)) return false;
      
      return true;
    });
  }, [currentRun, selectedFilter]);

  const exportJSON = useCallback(() => {
    if (!currentReport) return;
    const content = exportToJSON(currentReport);
    downloadFile(content, `${currentReport.runId}_report.json`, 'application/json');
  }, [currentReport]);

  const exportCSV = useCallback(() => {
    if (!currentRun) return;
    
    const csvData = currentRun.questions.map(question => {
      const run = currentRun.runs.find(r => r.questionId === question.id);
      const evaluation = currentRun.evaluations.find(e => e.questionId === question.id);
      
      return {
        question_id: question.id,
        question_text: question.text,
        question_type: question.type,
        difficulty: question.difficulty,
        status: run?.status || 'pending',
        latency_ms: run?.latencyMs || 0,
        verdict: evaluation?.verdict || 'N/A',
        final_score: evaluation ? (evaluation.finalScore * 100).toFixed(1) : 'N/A',
        correctness: evaluation ? (evaluation.correctness * 100).toFixed(1) : 'N/A',
        coverage: evaluation ? (evaluation.coverage * 100).toFixed(1) : 'N/A',
        context_use: evaluation ? (evaluation.contextUse * 100).toFixed(1) : 'N/A',
        hallucination: evaluation ? (evaluation.hallucination * 100).toFixed(1) : 'N/A',
        citations: evaluation ? (evaluation.citations * 100).toFixed(1) : 'N/A'
      };
    });
    
    const content = exportToCSV(csvData);
    downloadFile(content, `${currentRun.id}_detailed_results.csv`, 'text/csv');
  }, [currentRun]);

  const exportHTML = useCallback(() => {
    if (!currentReport || !currentRun) return;
    
    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>KB Agent Test Report - ${currentRun.name}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
        .metric { display: inline-block; margin: 10px; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
        .success { color: #22c55e; }
        .warning { color: #f59e0b; }
        .error { color: #ef4444; }
        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f5f5f5; }
    </style>
</head>
<body>
    <div class="header">
        <h1>KB Agent Test Report</h1>
        <p><strong>Run:</strong> ${currentRun.name}</p>
        <p><strong>Date:</strong> ${new Date(currentReport.createdAt).toLocaleString()}</p>
    </div>
    
    <h2>Summary</h2>
    <div class="metrics">
        <div class="metric">
            <h3>Total Questions</h3>
            <p>${currentReport.totals.questions}</p>
        </div>
        <div class="metric">
            <h3>Accuracy</h3>
            <p class="success">${(currentReport.totals.accuracy * 100).toFixed(1)}%</p>
        </div>
        <div class="metric">
            <h3>Average Score</h3>
            <p>${(currentReport.totals.avgScore * 100).toFixed(1)}%</p>
        </div>
        <div class="metric">
            <h3>Average Latency</h3>
            <p>${formatDuration(currentReport.totals.latencyAvgMs)}</p>
        </div>
    </div>
    
    <h2>Worst Performing Questions</h2>
    <table>
        <thead>
            <tr>
                <th>Question ID</th>
                <th>Score</th>
                <th>Issues</th>
            </tr>
        </thead>
        <tbody>
            ${currentReport.worstQuestions.map(q => `
                <tr>
                    <td>${q.questionId}</td>
                    <td class="error">${(q.finalScore * 100).toFixed(1)}%</td>
                    <td>${q.notes.join(', ')}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
    
    <h2>Knowledge Base Gaps</h2>
    <ul>
        ${currentReport.kbGaps.map(gap => `<li>${gap}</li>`).join('')}
    </ul>
</body>
</html>`;
    
    downloadFile(htmlContent, `${currentReport.runId}_report.html`, 'text/html');
  }, [currentReport, currentRun]);

  if (!currentReport || !currentRun) {
    return (
      <div className="container mx-auto px-4 py-6">
        <Card>
          <CardContent className="pt-6 text-center">
            <BarChart3 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3>No hay reportes disponibles</h3>
            <p className="text-muted-foreground mb-4">
              Primero debes completar una ejecución de test para generar un reporte.
            </p>
            <Button onClick={() => setCurrentScreen('execution')}>
              Ir a Ejecución
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Chart data preparation
  const difficultyData = Object.entries(currentReport.breakdowns.byDifficulty).map(([key, value]) => ({
    name: key.charAt(0).toUpperCase() + key.slice(1),
    count: value.count,
    accuracy: Math.round(value.accuracy * 100)
  }));

  const typeData = Object.entries(currentReport.breakdowns.byType).map(([key, value]) => ({
    name: key.toUpperCase(),
    count: value.count,
    accuracy: Math.round(value.accuracy * 100)
  }));

  const verdictData = [
    { name: 'Acierto', value: currentReport.totals.ok, color: '#22c55e' },
    { name: 'Parcial', value: currentReport.totals.partial, color: '#f59e0b' },
    { name: 'Fallo', value: currentReport.totals.fail, color: '#ef4444' }
  ];

  const latencyData = currentRun.runs
    .filter(r => r.status === 'ok')
    .map((run, index) => ({
      index: index + 1,
      latency: run.latencyMs
    }));

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Reporte de Auditoría
          </CardTitle>
          <CardDescription>
            Análisis detallado del test: {currentRun.name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              Generado el {new Date(currentReport.createdAt).toLocaleString()}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportJSON}>
                <Download className="w-4 h-4 mr-2" />
                JSON
              </Button>
              <Button variant="outline" size="sm" onClick={exportCSV}>
                <Download className="w-4 h-4 mr-2" />
                CSV
              </Button>
              <Button variant="outline" size="sm" onClick={exportHTML}>
                <Download className="w-4 h-4 mr-2" />
                HTML
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Target className="w-8 h-8 text-blue-600" />
              <div>
                <div className="text-2xl font-semibold">{currentReport.totals.questions}</div>
                <div className="text-sm text-muted-foreground">Total Preguntas</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-8 h-8 text-green-600" />
              <div>
                <div className="text-2xl font-semibold text-green-600">
                  {(currentReport.totals.accuracy * 100).toFixed(1)}%
                </div>
                <div className="text-sm text-muted-foreground">Precisión</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Clock className="w-8 h-8 text-purple-600" />
              <div>
                <div className="text-2xl font-semibold">
                  {formatDuration(currentReport.totals.latencyAvgMs)}
                </div>
                <div className="text-sm text-muted-foreground">Latencia Media</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-8 h-8 text-orange-600" />
              <div>
                <div className="text-2xl font-semibold">
                  {(currentReport.totals.avgScore * 100).toFixed(1)}%
                </div>
                <div className="text-sm text-muted-foreground">Score Promedio</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Advanced Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Métricas Avanzadas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span>Tasa de Alucinación</span>
              <div className="flex items-center gap-2">
                <Progress 
                  value={currentReport.totals.hallucinationRate * 100} 
                  className="w-20" 
                />
                <Badge variant={currentReport.totals.hallucinationRate > 0.3 ? "destructive" : "secondary"}>
                  {(currentReport.totals.hallucinationRate * 100).toFixed(1)}%
                </Badge>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span>Validez de Citas</span>
              <div className="flex items-center gap-2">
                <Progress 
                  value={currentReport.totals.citationValidity * 100} 
                  className="w-20" 
                />
                <Badge variant={currentReport.totals.citationValidity > 0.7 ? "default" : "secondary"}>
                  {(currentReport.totals.citationValidity * 100).toFixed(1)}%
                </Badge>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span>Latencia P95</span>
              <Badge variant="outline">
                {formatDuration(currentReport.totals.latencyP95Ms)}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Distribución de Resultados</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={verdictData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={80}
                  dataKey="value"
                >
                  {verdictData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-4 mt-2">
              {verdictData.map((entry) => (
                <div key={entry.name} className="flex items-center gap-1">
                  <div 
                    className="w-3 h-3 rounded" 
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="text-sm">{entry.name}: {entry.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Tabs */}
      <Card>
        <CardHeader>
          <CardTitle>Análisis Detallado</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="difficulty" className="w-full">
            <TabsList>
              <TabsTrigger value="difficulty">Por Dificultad</TabsTrigger>
              <TabsTrigger value="type">Por Tipo</TabsTrigger>
              <TabsTrigger value="latency">Latencia</TabsTrigger>
              <TabsTrigger value="sources">Por Fuente</TabsTrigger>
            </TabsList>
            
            <TabsContent value="difficulty" className="space-y-4">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={difficultyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="accuracy" fill="#3b82f6" name="Precisión %" />
                </BarChart>
              </ResponsiveContainer>
            </TabsContent>
            
            <TabsContent value="type" className="space-y-4">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={typeData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="accuracy" fill="#10b981" name="Precisión %" />
                </BarChart>
              </ResponsiveContainer>
            </TabsContent>
            
            <TabsContent value="latency" className="space-y-4">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={latencyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="index" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="latency" stroke="#8b5cf6" name="Latencia (ms)" />
                </LineChart>
              </ResponsiveContainer>
            </TabsContent>
            
            <TabsContent value="sources" className="space-y-4">
              <div className="grid gap-4">
                {currentReport.breakdowns.bySource.map((source, index) => (
                  <div key={source.sourceId} className="flex items-center justify-between p-3 border rounded">
                    <div>
                      <div className="font-medium">
                        {sources.find(s => s.id === source.sourceId)?.name || source.sourceId}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {source.count} preguntas
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress value={source.accuracy * 100} className="w-20" />
                      <Badge variant="outline">
                        {(source.accuracy * 100).toFixed(1)}%
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Worst Questions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            Preguntas Problemáticas
          </CardTitle>
          <CardDescription>
            Preguntas con menor rendimiento que requieren atención
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pregunta</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Problemas Identificados</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentReport.worstQuestions.map((worstQ) => {
                const question = currentRun.questions.find(q => q.id === worstQ.questionId);
                return (
                  <TableRow key={worstQ.questionId}>
                    <TableCell className="max-w-md">
                      <div className="truncate">{question?.text}</div>
                      <div className="text-xs text-muted-foreground">
                        {question?.type} • {question?.difficulty}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="destructive">
                        {(worstQ.finalScore * 100).toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ul className="list-disc list-inside text-sm">
                        {worstQ.notes.map((note, idx) => (
                          <li key={idx}>{note}</li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* KB Gaps and Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5" />
            Recomendaciones de Mejora
          </CardTitle>
          <CardDescription>
            Sugerencias automáticas para mejorar la knowledge base
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {currentReport.kbGaps.map((gap, index) => (
              <div key={index} className="flex items-start gap-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                <Lightbulb className="w-5 h-5 text-yellow-600 mt-0.5" />
                <span className="text-sm">{gap}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Filtered Questions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 justify-between">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5" />
              Análisis Detallado por Pregunta
            </div>
            <div className="flex gap-2">
              <Select 
                value={selectedFilter.difficulty || "all"} 
                onValueChange={(value) => setSelectedFilter({
                  ...selectedFilter, 
                  difficulty: value === "all" ? undefined : value
                })}
              >
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Dificultad" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="easy">Fácil</SelectItem>
                  <SelectItem value="medium">Media</SelectItem>
                  <SelectItem value="hard">Difícil</SelectItem>
                </SelectContent>
              </Select>
              
              <Select 
                value={selectedFilter.type || "all"} 
                onValueChange={(value) => setSelectedFilter({
                  ...selectedFilter, 
                  type: value === "all" ? undefined : value
                })}
              >
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="open">Abierta</SelectItem>
                  <SelectItem value="mcq">Opción múltiple</SelectItem>
                  <SelectItem value="boolean">V/F</SelectItem>
                  <SelectItem value="citation">Cita</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardTitle>
          <CardDescription>
            {filteredQuestions.length} de {currentRun.questions.length} preguntas mostradas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pregunta</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Dificultad</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Latencia</TableHead>
                <TableHead>Feedback</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredQuestions.map((question) => {
                const run = currentRun.runs.find(r => r.questionId === question.id);
                const evaluation = currentRun.evaluations.find(e => e.questionId === question.id);
                
                return (
                  <TableRow key={question.id}>
                    <TableCell className="max-w-md">
                      <div className="truncate">{question.text}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{question.type.toUpperCase()}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        question.difficulty === 'easy' ? 'default' :
                        question.difficulty === 'medium' ? 'secondary' : 'destructive'
                      }>
                        {question.difficulty}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {evaluation ? (
                        <Badge className={
                          evaluation.verdict === 'ACIERTO' ? 'bg-green-100 text-green-800' :
                          evaluation.verdict === 'PARCIAL' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }>
                          {evaluation.verdict}
                        </Badge>
                      ) : (
                        <Badge variant="outline">N/A</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {evaluation ? (
                        <span className="font-mono">
                          {(evaluation.finalScore * 100).toFixed(1)}%
                        </span>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>{run ? formatDuration(run.latencyMs) : '-'}</TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground line-clamp-2">
                        {evaluation?.notes?.[0] || '-'}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}