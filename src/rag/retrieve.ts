import { embedText } from "../ingest/embed.js";
import { cosineSimilarity } from "./score.js";
import { getVectorsIndex } from "../store/vectors.js";

function getEnvNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function retrieveTopK(question: string): Promise<
  | { ok: false }
  | {
      ok: true;
      topScore: number;
      context: string;
      sources: Array<{ title: string; url: string }>;
    }
> {
  const index = getVectorsIndex();
  if (!index) return { ok: false };

  const topK = getEnvNum("TOP_K", 6);
  const minScore = getEnvNum("MIN_SCORE", 0.78);

  const qEmb = await embedText(question, "RETRIEVAL_QUERY");

  // brute-force cosine (MVP)
  const scored = index.items.map((it) => ({
    ...it,
    score: cosineSimilarity(qEmb, it.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  const best = scored.slice(0, topK);

  const topScore = best[0]?.score ?? 0;
  if (topScore < minScore) return { ok: false };

  // construir contexto
  const context = best
    .map((b, i) => {
      return `[#${i + 1}] ${b.title}\nURL: ${b.url}\nEXTRACTO:\n${b.chunk}\n`;
    })
    .join("\n---\n");

  // fuentes únicas
  const seen = new Set<string>();
  const sources = best
    .map((b) => ({ title: b.title, url: b.url }))
    .filter((s) => {
      const key = s.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return { ok: true, topScore, context, sources };
}
