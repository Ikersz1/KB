export async function llmJSON<T=any>(prompt: string): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY no configurada");

  const r = await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":`Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role:"system", content:"Responde SOLO JSON válido." },
                 { role:"user", content: prompt }],
      temperature: 0.2
    })
  });
  const j = await r.json();
  const txt = j.choices?.[0]?.message?.content ?? "[]";
  try { return JSON.parse(txt); } catch { throw new Error("No se pudo parsear JSON del LLM"); }
}
