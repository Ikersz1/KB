import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { useAppStore } from "../lib/store";
import { 
  FileText, 
  HelpCircle, 
  Settings, 
  Play, 
  BarChart3,
  CheckCircle,
  Clock,
  AlertCircle
} from "lucide-react";

export function Navigation() {
  const { 
    currentScreen, 
    setCurrentScreen, 
    sources, 
    questions, 
    currentRun 
  } = useAppStore();

  const steps = [
    {
      id: 'ingestion',
      label: 'Ingesta',
      icon: FileText,
      description: 'Documentos y URLs',
      count: sources.length
    },
    {
      id: 'questions',
      label: 'Preguntas',
      icon: HelpCircle,
      description: 'Generación de preguntas',
      count: questions.length
    },
    {
      id: 'config',
      label: 'Configuración',
      icon: Settings,
      description: 'Config del agente',
      completed: true // Always show as available
    },
    {
      id: 'execution',
      label: 'Ejecución',
      icon: Play,
      description: 'Test del agente',
      disabled: questions.length === 0
    },
    {
      id: 'audit',
      label: 'Auditoría',
      icon: BarChart3,
      description: 'Métricas y reportes',
      disabled: !currentRun || currentRun.status !== 'completed'
    }
  ] as const;

  const getStepStatus = (step: typeof steps[0]) => {
    if (step.disabled) return 'disabled';
    if (currentScreen === step.id) return 'active';
    if (step.completed) return 'completed';
    if (step.count && step.count > 0) return 'completed';
    return 'pending';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'active': return <Clock className="w-4 h-4 text-blue-600" />;
      case 'disabled': return <AlertCircle className="w-4 h-4 text-gray-400" />;
      default: return null;
    }
  };

  return (
    <div className="border-b bg-card">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1>KB Agent Tester</h1>
            <p className="text-muted-foreground">
              Evaluación integral de agentes de knowledge base
            </p>
          </div>
          {currentRun && (
            <Badge variant={currentRun.status === 'completed' ? 'default' : 'secondary'}>
              Run: {currentRun.name} ({currentRun.status})
            </Badge>
          )}
        </div>
        
        <div className="flex flex-wrap gap-2">
          {steps.map((step) => {
            const status = getStepStatus(step);
            const Icon = step.icon;
            
            return (
              <Button
                key={step.id}
                variant={status === 'active' ? 'default' : 'outline'}
                size="sm"
                onClick={() => !step.disabled && setCurrentScreen(step.id as any)}
                disabled={step.disabled}
                className="flex items-center gap-2"
              >
                <Icon className="w-4 h-4" />
                <span>{step.label}</span>
                {step.count !== undefined && step.count > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {step.count}
                  </Badge>
                )}
                {getStatusIcon(status)}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}