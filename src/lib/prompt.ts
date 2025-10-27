export const genQuestionsPrompt = (sectionText:string, n:number) => `
Eres un generador de exámenes. A partir del texto siguiente, crea ${n} preguntas diversas:
- 40% básicas (definiciones/hechos), 40% comprensión/aplicación, 20% análisis/crítica.
- Diversifica formatos (abierta, opción múltiple, VF, completar).
- Cubre conceptos distintos; no repitas.
Devuelve JSON: [{"question":"...", "difficulty":"easy|med|hard"}].
TEXTO:
${sectionText}
`;
export const ragAnswerPrompt = (q:string, ctx:string) => `
Responde a la pregunta usando EXCLUSIVAMENTE estos fragmentos. Si falta info, di "No está en el documento".
Cita ids como ["c1","c7"].
Devuelve JSON: {"answer":"...", "citations":["c..."]}

PREGUNTA: ${q}
FRAGMENTOS:
${ctx}
`;
export const judgePrompt = (q:string, answer:string, ctx:string, gold?:string) => `
Evalúa la respuesta según:
- correctness (0-1) vs ${gold? "gold": "contexto"}
- completeness (0-1)
- groundedness (0-1) (¿todo está soportado por citas/contexto?)
- clarity (0-1)
Devuelve JSON:
{"scores":{"correctness":0,"completeness":0,"groundedness":0,"clarity":0},"overall":0,"feedback":""}
PREGUNTA: ${q}
RESPUESTA: ${answer}
${gold? "GOLD: "+gold : ""}
CONTEXTO:
${ctx}
`;
