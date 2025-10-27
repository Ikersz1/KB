import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/lib/db";
import { Chunk } from "@/types";

function chunkText(txt: string, max=1200, overlap=150) {
  const paras = txt.split(/\n{2,}/);
  const res:string[]=[]; let cur="";
  for (const p of paras){
    if ((cur+p).length>max){ if(cur) res.push(cur); cur=p; }
    else cur += (cur? "\n\n":"") + p;
  }
  if (cur) res.push(cur);
  // overlap “suave”
  const out:string[]=[];
  for (let i=0;i<res.length;i++){
    const prevTail = i>0 ? res[i-1].slice(-overlap) : "";
    out.push(prevTail + res[i]);
  }
  return out;
}

export default async function handler(req:NextApiRequest, res:NextApiResponse){
  if (req.method !== "POST") return res.status(405).end();
  const { sourceId } = req.body as { sourceId: string };
  const raw = (globalThis as any)[`__RAW_${sourceId}`];
  const src = db.sources.get(sourceId);
  if (!src || !raw) return res.status(404).json({ error: "source no encontrado" });

  const pieces = chunkText(raw);
  const chunks: Chunk[] = pieces.map((content, i) => ({
    id: `c${i+1}`,
    sourceId,
    content,
    index: i,
  }));

  db.chunks.set(sourceId, chunks);
  db.sources.set(sourceId, { ...src, status: "completed", chunks });
  return res.json({ ok:true, sourceId, chunks: chunks.length });
}
