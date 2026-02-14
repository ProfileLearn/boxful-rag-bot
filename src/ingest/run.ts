// src/ingest/run.ts  (igual que antes; lo incluyo completo por consistencia)
import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { discoverArticleUrls, fetchArticleHtml } from "./crawl.js";
import { parseArticleHtml } from "./parseArticle.js";
import { chunkText } from "./chunk.js";
import { embedText } from "./embed.js";
import type { VectorsFile, VectorItem } from "../store/vectors.js";

function getEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getEnvNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeId(s: string): string {
  return Buffer.from(s).toString("base64url");
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedWithRetries(
  chunk: string,
  retries: number,
): Promise<number[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await embedText(chunk, "RETRIEVAL_DOCUMENT");
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastErr;
}

export async function runIngest() {
  const dataDir = getEnv("DATA_DIR", "./data");
  const vectorsFile = getEnv("VECTORS_FILE", "./data/vectors.json");
  const concurrency = getEnvNum("INGEST_CONCURRENCY", 3);
  const embedRetries = getEnvNum("EMBED_RETRIES", 2);

  await ensureDir(dataDir);

  console.log("Discovering article URLs...");
  const articleUrls = await discoverArticleUrls();
  console.log(`Found ${articleUrls.length} article URLs`);

  const limit = pLimit(concurrency);
  const items: VectorItem[] = [];
  let done = 0;

  await Promise.all(
    articleUrls.map((url) =>
      limit(async () => {
        try {
          let html = "";
          try {
            html = await fetchArticleHtml(url);
          } catch (err: any) {
            console.warn("Failed [crawl]:", url, err?.message ?? err);
            return;
          }

          const parsed = parseArticleHtml(html);
          if (!parsed) return;

          const chunks = chunkText(parsed.bodyText);

          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i]!;
            const id = safeId(`${url}#${i}`);
            const embedding = await embedWithRetries(chunk, embedRetries);

            items.push({
              id,
              url,
              title: parsed.title,
              chunk,
              embedding,
            });
          }
        } catch (e: any) {
          console.warn("Failed [embed]:", url, e?.message ?? e);
        } finally {
          done++;
          if (done % 10 === 0)
            console.log(`Progress: ${done}/${articleUrls.length}`);
        }
      }),
    ),
  );

  const out: VectorsFile = {
    created_at: new Date().toISOString(),
    items,
  };

  const abs = path.resolve(vectorsFile);
  await fs.writeFile(abs, JSON.stringify(out), "utf8");

  console.log(`Saved vectors: ${abs}`);
  console.log(`Chunks total: ${items.length}`);
}

runIngest().catch((err) => {
  console.error(err);
  process.exit(1);
});
