# KB Agent Tester

Una aplicación web completa para evaluar agentes y chatbots de knowledge base. Permite ingestar documentos, generar preguntas automáticamente, testear agentes externos y generar reportes detallados con métricas avanzadas.

## 🚀 Características

- **Ingesta Multimedia**: Soporte para PDF, DOCX, TXT, MD y crawling de URLs
- **Generación Inteligente**: Genera preguntas balanceadas por dificultad y tipo
- **Testing Flexible**: Configura cualquier API de chatbot con plantillas personalizables
- **Evaluación Avanzada**: Sistema híbrido rule-based con métricas detalladas
- **Reportes Exportables**: JSON, CSV y HTML con visualizaciones interactivas
- **Reproducibilidad**: Tests reproducibles con semillas configurables

## 🛠️ Stack Tecnológico

- **Frontend**: React + TypeScript + Tailwind CSS
- **Componentes**: shadcn/ui
- **Estado**: Zustand con persistencia
- **Gráficos**: Recharts
- **Iconos**: Lucide React

## 📦 Instalación

```bash
# Clonar el repositorio
git clone <repository-url>
cd kb-agent-tester

# Instalar dependencias
npm install

# Ejecutar en desarrollo
npm run dev
```

## 📋 Flujo de Uso

### 1. Ingesta de Datos
- **Subir Archivos**: Arrastra documentos PDF, DOCX, TXT o MD
- **URLs**: Añade URLs para crawling automático (máximo 50)
- **Configuración**: Ajusta parámetros de chunking (tamaño y overlap)
- **Procesamiento**: Procesa fuentes y genera chunks indexados

### 2. Generación de Preguntas
- **Configuración**: Define número total, distribución por dificultad y tipos
- **Tipos Soportados**:
  - Abiertas: Respuesta libre
  - Opción múltiple: 1 correcta + 3 distractores
  - Verdadero/Falso: Con base textual
  - Cita/Fuente: Requiere referencia específica
- **Balance**: Opción para equilibrar por fuente
- **Edición**: Revisa y modifica preguntas generadas

### 3. Configuración del Agente
- **API Endpoint**: URL del chatbot a evaluar
- **Autenticación**: Headers personalizables (Bearer, API Key, etc.)
- **Plantilla de Request**: Body JSON con placeholders
- **Test de Conexión**: Validar configuración antes del test
- **Plantillas Comunes**: OpenAI, Custom API

### 4. Ejecución de Tests
- **Parámetros**: Concurrencia, reintentos, seed para reproducibilidad
- **Monitoreo en Vivo**: Progreso, latencias, respuestas expandibles
- **Control**: Pausar, reanudar, reintentar tests
- **Estadísticas**: Métricas en tiempo real

### 5. Auditoría y Reportes
- **KPIs Globales**: Precisión, score promedio, latencias, alucinación
- **Breakdowns**: Por dificultad, tipo, fuente
- **Visualizaciones**: Gráficos interactivos con Recharts
- **Preguntas Problemáticas**: Identificación automática
- **Recomendaciones**: Sugerencias de mejora de KB
- **Exportación**: JSON, CSV, HTML

## 🔧 Configuración de Chatbots

### Estructura del Request

```json
{
  "question": "{{question}}",
  "conversation_id": "{{conversation_id}}",
  "metadata": "{{metadata}}"
}
```

### Placeholders Disponibles
- `{{question}}`: Texto de la pregunta
- `{{conversation_id}}`: ID único de conversación
- `{{metadata}}`: Metadatos adicionales

### Ejemplo cURL

```bash
curl -X POST "https://api.example.com/chat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "question": "¿Cuáles son las características del producto?",
    "conversation_id": "test-123",
    "metadata": "testing"
  }'
```

### Respuesta Esperada

```json
{
  "answer": "El producto ofrece...",
  "citations": [
    {
      "url": "https://docs.example.com",
      "quote": "fragmento citado"
    }
  ],
  "meta": {
    "tokensIn": 15,
    "tokensOut": 45,
    "model": "gpt-4"
  }
}
```

## 📊 Sistema de Evaluación

### Dimensiones de Scoring

1. **Corrección Factual** (35%): Precisión vs ground truth
2. **Cobertura** (25%): Completitud de la respuesta
3. **Uso de Contexto** (15%): Referencia a chunks relevantes
4. **Alucinación** (15%): Penaliza información no soportada
5. **Citas** (10%): Formato y correspondencia de referencias

### Fórmula Final
```
Score = 0.35×Corrección + 0.25×Cobertura + 0.15×Contexto + 0.15×(1-Alucinación) + 0.10×Citas
```

### Veredictos
- **ACIERTO**: Score ≥ 0.8
- **PARCIAL**: Score 0.5-0.79
- **FALLO**: Score < 0.5

## 🎯 Personalización del Scoring

Puedes ajustar los pesos de evaluación modificando la función `evaluateAnswer` en `/lib/utils.ts`:

```typescript
const finalScore = 0.35 * correctness + 
                   0.25 * coverage + 
                   0.15 * contextUse + 
                   0.15 * (1 - hallucination) + 
                   0.10 * citations;
```

## 📁 Estructura del Proyecto

```
kb-agent-tester/
├── components/
│   ├── ui/                 # Componentes shadcn/ui
│   ├── Navigation.tsx      # Navegación principal
│   ├── IngestionScreen.tsx # Ingesta de documentos
│   ├── QuestionsScreen.tsx # Generación de preguntas
│   ├── ConfigScreen.tsx    # Configuración de API
│   ├── ExecutionScreen.tsx # Ejecución de tests
│   └── AuditScreen.tsx     # Reportes y auditoría
├── lib/
│   ├── store.ts           # Estado global Zustand
│   ├── utils.ts           # Utilidades y evaluación
│   └── mock-data.ts       # Datos de demostración
├── types/
│   └── index.ts           # Definiciones TypeScript
└── App.tsx                # Componente principal
```

## 🔍 Datos de Demo

La aplicación incluye datos de demostración:
- 2 fuentes de ejemplo (PDF + URL)
- 5 preguntas pre-generadas
- Respuestas mock del chatbot
- Evaluaciones de ejemplo

Utiliza el botón "Cargar Datos Demo" en cada sección para poblar con contenido de prueba.

## 🚦 Características Avanzadas

### Reproducibilidad
- Los tests utilizan seeds configurables
- Misma seed = mismos resultados
- Útil para debugging y comparaciones

### Gestión de Errores
- Reintentos exponenciales
- Timeouts configurables  
- Logging detallado de errores HTTP

### Concurrencia
- Procesamiento paralelo configurable
- Control de rate limiting
- Gestión de recursos optimizada

### Exportación
- **JSON**: Datos estructurados completos
- **CSV**: Tabla plana para análisis estadístico
- **HTML**: Reporte visual autocontenido

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una branch para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la branch (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver `LICENSE` para más detalles.

## 🆘 Soporte

Para preguntas o problemas:
1. Revisa la documentación
2. Busca en Issues existentes
3. Crea un nuevo Issue con detalles específicos

---

**KB Agent Tester** - Evaluación integral de agentes de knowledge base 🚀