import { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { Alert, AlertDescription } from "./ui/alert";
import { useAppStore } from "../lib/store";
import { mockChatbotResponses } from "../lib/mock-data";
import { 
  Settings, 
  TestTube, 
  CheckCircle, 
  AlertCircle, 
  Code,
  Key,
  Clock,
  Send
} from "lucide-react";

export function ConfigScreen() {
  const {
    chatbotConfig,
    setChatbotConfig,
    questions,
    setCurrentScreen
  } = useAppStore();

  const [testResult, setTestResult] = useState<{
    status: 'success' | 'error' | null;
    message: string;
    response?: any;
  }>({ status: null, message: '' });
  const [isTesting, setIsTesting] = useState(false);

  const handleConfigUpdate = useCallback((field: keyof typeof chatbotConfig, value: any) => {
    setChatbotConfig({
      ...chatbotConfig,
      [field]: value
    });
  }, [chatbotConfig, setChatbotConfig]);

  const handleHeaderUpdate = useCallback((key: string, value: string) => {
    const newHeaders = { ...chatbotConfig.headers };
    if (value) {
      newHeaders[key] = value;
    } else {
      delete newHeaders[key];
    }
    setChatbotConfig({
      ...chatbotConfig,
      headers: newHeaders
    });
  }, [chatbotConfig, setChatbotConfig]);

  const testConnection = useCallback(async () => {
    setIsTesting(true);
    setTestResult({ status: null, message: '' });
  
    try {
      const r = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatbotConfig })
      });
  
      // Leer SIEMPRE como texto, y luego intentar parsear
      const raw = await r.text();
      const ct = r.headers.get("content-type") || "";
      const data = ct.includes("application/json") ? JSON.parse(raw) : raw;
  
      if (!r.ok) {
        const msg = typeof data === "string" ? data : (data?.error || "Error test-connection");
        throw new Error(msg);
      }
  
      setTestResult({
        status: 'success',
        message: 'Conexión exitosa. El chatbot respondió correctamente.',
        response: data
      });
    } catch (error: any) {
      setTestResult({
        status: 'error',
        message: `Error de conexión. ${error?.message || ''}`
      });
    } finally {
      setIsTesting(false);
    }
  }, [chatbotConfig]);
  
  

  const addHeader = useCallback(() => {
    const newKey = `Custom-Header-${Object.keys(chatbotConfig.headers).length + 1}`;
    handleHeaderUpdate(newKey, 'value');
  }, [chatbotConfig.headers, handleHeaderUpdate]);

  const commonTemplates = {
    openai: {
      name: 'OpenAI Chat Completions',
      bodyTemplate: JSON.stringify({
        model: "gpt-4",
        messages: [
          {
            role: "user",
            content: "{{question}}"
          }
        ],
        temperature: 0.1
      }, null, 2),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_OPENAI_API_KEY'
      }
    },
    custom: {
      name: 'Custom API',
      bodyTemplate: JSON.stringify({
        question: "{{question}}",
        conversation_id: "{{conversation_id}}",
        metadata: "{{metadata}}"
      }, null, 2),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_API_KEY_HERE'
      }
    }
  };

  const loadTemplate = useCallback((templateKey: keyof typeof commonTemplates) => {
    const template = commonTemplates[templateKey];
    setChatbotConfig({
      ...chatbotConfig,
      bodyTemplate: template.bodyTemplate,
      headers: template.headers
    });
  }, [chatbotConfig, setChatbotConfig]);

  const canProceed = chatbotConfig.apiUrl && testResult.status === 'success';

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* API Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Configuración del API
          </CardTitle>
          <CardDescription>
            Configura la conexión con el chatbot a evaluar
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="api-url">URL del API</Label>
              <Input
                id="api-url"
                type="url"
                placeholder="https://api.example.com/chat"
                value={chatbotConfig.apiUrl}
                onChange={(e) => handleConfigUpdate('apiUrl', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="method">Método HTTP</Label>
              <Select
                value={chatbotConfig.method}
                onValueChange={(value) => handleConfigUpdate('method', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="GET">GET</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="timeout">Timeout (ms)</Label>
            <Input
              id="timeout"
              type="number"
              min="1000"
              max="120000"
              value={chatbotConfig.timeoutMs}
              onChange={(e) => handleConfigUpdate('timeoutMs', parseInt(e.target.value))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Headers Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="w-5 h-5" />
            Headers HTTP
          </CardTitle>
          <CardDescription>
            Configura los headers necesarios para la autenticación
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(chatbotConfig.headers).map(([key, value]) => (
            <div key={key} className="grid grid-cols-2 gap-4">
              <Input
                placeholder="Header Name"
                value={key}
                onChange={(e) => {
                  const newHeaders = { ...chatbotConfig.headers };
                  delete newHeaders[key];
                  if (e.target.value) {
                    newHeaders[e.target.value] = value;
                  }
                  setChatbotConfig({ ...chatbotConfig, headers: newHeaders });
                }}
              />
              <Input
                placeholder="Header Value"
                value={value}
                onChange={(e) => handleHeaderUpdate(key, e.target.value)}
                type={key.toLowerCase().includes('authorization') ? 'password' : 'text'}
              />
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addHeader}>
            Añadir Header
          </Button>
        </CardContent>
      </Card>

      {/* Body Template */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="w-5 h-5" />
            Plantilla del Body
          </CardTitle>
          <CardDescription>
            Define la estructura JSON del request. Usa placeholders: {`{{question}}, {{conversation_id}}, {{metadata}}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadTemplate('openai')}
            >
              Plantilla OpenAI
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadTemplate('custom')}
            >
              Plantilla Custom
            </Button>
          </div>
          
          <Textarea
            value={chatbotConfig.bodyTemplate}
            onChange={(e) => handleConfigUpdate('bodyTemplate', e.target.value)}
            rows={10}
            className="font-mono text-sm"
            placeholder={JSON.stringify({
              question: "{{question}}",
              conversation_id: "{{conversation_id}}",
              metadata: "{{metadata}}"
            }, null, 2)}
          />
          
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Los placeholders serán reemplazados automáticamente durante el test:
              <br />• <code>{`{{question}}`}</code> - Texto de la pregunta
              <br />• <code>{`{{conversation_id}}`}</code> - ID único de conversación  
              <br />• <code>{`{{metadata}}`}</code> - Metadatos adicionales
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Test Connection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TestTube className="w-5 h-5" />
            Test de Conexión
          </CardTitle>
          <CardDescription>
            Prueba la configuración con una pregunta de ejemplo
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button 
            onClick={testConnection} 
            disabled={!chatbotConfig.apiUrl || isTesting}
          >
            {isTesting ? (
              <>
                <Clock className="w-4 h-4 mr-2 animate-spin" />
                Probando...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Probar Conexión
              </>
            )}
          </Button>

          {testResult.status && (
            <Alert className={testResult.status === 'success' ? 'border-green-200' : 'border-red-200'}>
              {testResult.status === 'success' ? (
                <CheckCircle className="h-4 w-4 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4 text-red-600" />
              )}
              <AlertDescription>
                {testResult.message}
                {testResult.response && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-medium">
                      Ver respuesta del chatbot
                    </summary>
                    <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
                      {JSON.stringify(testResult.response, null, 2)}
                    </pre>
                  </details>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* cURL Example */}
      <Card>
        <CardHeader>
          <CardTitle>Ejemplo cURL</CardTitle>
          <CardDescription>
            Comando equivalente para probar manualmente
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded text-sm overflow-auto">
            {`curl -X ${chatbotConfig.method} "${chatbotConfig.apiUrl}" \\
${Object.entries(chatbotConfig.headers).map(([key, value]) => 
  `  -H "${key}: ${value}"`
).join(' \\\n')} \\
  -d '${chatbotConfig.bodyTemplate.replace(/\{\{question\}\}/g, 'What is your purpose?').replace(/\{\{conversation_id\}\}/g, 'test-123').replace(/\{\{metadata\}\}/g, 'test')}'`}
          </pre>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Resumen de Configuración</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">URL:</span>
                <Badge variant="outline">{chatbotConfig.apiUrl || 'No configurada'}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Método:</span>
                <Badge variant="outline">{chatbotConfig.method}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Timeout:</span>
                <Badge variant="outline">{chatbotConfig.timeoutMs}ms</Badge>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Headers:</span>
                <Badge variant="outline">{Object.keys(chatbotConfig.headers).length}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Test Status:</span>
                <Badge variant={testResult.status === 'success' ? 'default' : 'secondary'}>
                  {testResult.status === 'success' ? 'Conectado' : 'Pendiente'}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Next Step */}
      {questions.length > 0 && (
        <>
          <Separator />
          <div className="flex justify-end">
            <Button 
              onClick={() => setCurrentScreen('execution')}
              disabled={!canProceed}
            >
              {canProceed ? 'Continuar a Ejecución' : 'Configura y prueba la conexión primero'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}