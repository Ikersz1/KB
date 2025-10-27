// src/pages/api/ingest-progress.ts
import type { NextApiRequest, NextApiResponse } from "next";

const REQUIRED_ENV = ["N8N_BASE_URL", "N8N_WEBHOOK_KEY"] as const;

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end("Method Not Allowed");
  }

  // Env checks
  for (const k of REQUIRED_ENV) {
    if (!process.env[k]) {
      return res.status(500).json({ error: `Missing env var ${k}` });
    }
  }

  const jobId = req.query.jobId?.toString();
  if (!jobId) {
    return res.status(400).json({ error: "Missing required query param 'jobId'" });
  }

  const url = new URL(joinUrl(process.env.N8N_BASE_URL as string, "/webhook/ingest-progress"));
  url.searchParams.set("jobId", jobId);

  const controller = new AbortController();
  const timeoutMs = 20000; // 20s debería bastar para polling
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.N8N_WEBHOOK_KEY as string,
      },
      signal: controller.signal,
    });

    const ct = r.headers.get("content-type") || "";
    const text = await r.text();
    const data = ct.includes("application/json") ? JSON.parse(text) : { raw: text };

    if (!r.ok) {
      return res.status(r.status).json({
        error: data?.error || `n8n responded ${r.status}`,
        details: data,
      });
    }

    // Esperado: { progress, done, sources: [...] }
    return res.status(200).json(data);
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return res.status(504).json({ error: `Timeout after ${timeoutMs}ms calling n8n` });
    }
    return res.status(502).json({ error: "Failed to reach n8n", details: String(err?.message || err) });
  } finally {
    clearTimeout(t);
  }
}
