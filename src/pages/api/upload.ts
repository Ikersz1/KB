import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/lib/db";
import { Source } from "@/types";
import { generateId } from "@/utils";

export default async function handler(req:NextApiRequest, res:NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const { name, text } = req.body as { name: string; text: string };
  if (!name || !text) return res.status(400).json({ error: "name y text requeridos" });

  const sourceId = generateId("src");
  const src: Source = {
    id: sourceId,
    type: "txt",
    name,
    status: "processing",
    chunks: [],
    createdAt: new Date().toISOString(),
  };
  db.sources.set(sourceId, src);
  (globalThis as any)[`__RAW_${sourceId}`] = text;
  return res.json({ ok: true, sourceId });
}
