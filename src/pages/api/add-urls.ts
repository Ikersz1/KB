import type { NextApiRequest, NextApiResponse } from "next";
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const r = await fetch(`${process.env.N8N_BASE_URL}/webhook/ingest-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": process.env.N8N_WEBHOOK_KEY ?? "" },
    body: JSON.stringify(req.body)
  });
  const data = await r.json().catch(() => ({}));
  res.status(r.status).json(data);
}
