import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const r = await fetch(`${process.env.N8N_BASE_URL}/webhook/test-connection`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": process.env.N8N_WEBHOOK_KEY ?? ""
      },
      body: JSON.stringify(req.body ?? {})
    });

    const ct = r.headers.get("content-type") || "";
    const text = await r.text();

    if (!r.ok) {
      // Propaga texto crudo si n8n no manda JSON
      return res.status(r.status).send(text || "n8n error");
    }

    // En éxito, envía JSON si lo es; si no, texto
    return res
      .status(200)
      .send(ct.includes("application/json") ? JSON.parse(text) : text);

  } catch (e: any) {
    return res.status(500).send(e?.message || "proxy error");
  }
}
