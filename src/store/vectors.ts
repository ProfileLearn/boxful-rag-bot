import fs from "node:fs/promises";
import path from "node:path";

export type VectorItem = {
  id: string;
  url: string;
  title: string;
  chunk: string;
  embedding: number[];
};

export type VectorsFile = {
  created_at: string;
  items: VectorItem[];
};

let cache: VectorsFile | null = null;

function getEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function loadVectorsIntoMemory() {
  const file = getEnv("VECTORS_FILE", "./data/vectors.json");
  const abs = path.resolve(file);

  try {
    const raw = await fs.readFile(abs, "utf8");
    cache = JSON.parse(raw) as VectorsFile;
  } catch (e) {
    // Si no existe, queda null (el /v1/chat responderá low)
    cache = null;
  }
}

export function getVectorsIndex(): VectorsFile | null {
  return cache;
}
