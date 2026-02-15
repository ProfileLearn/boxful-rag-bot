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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateVectorsFile(raw: unknown, filePath: string): VectorsFile {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid vectors file format in ${filePath}: expected an object root`);
  }

  const obj = raw as { created_at?: unknown; items?: unknown };
  if (typeof obj.created_at !== "string" || !obj.created_at.trim()) {
    throw new Error(`Invalid vectors file format in ${filePath}: missing created_at`);
  }
  if (!Array.isArray(obj.items)) {
    throw new Error(`Invalid vectors file format in ${filePath}: items must be an array`);
  }
  if (obj.items.length === 0) {
    throw new Error(
      `Vectors file has no items in ${filePath}. Run ingest before starting the server.`,
    );
  }

  let expectedDim: number | null = null;

  obj.items.forEach((entry, idx) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Invalid vectors file format in ${filePath}: item ${idx} is not an object`);
    }

    const item = entry as Partial<VectorItem>;
    if (typeof item.id !== "string" || !item.id) {
      throw new Error(`Invalid vectors file format in ${filePath}: item ${idx} missing id`);
    }
    if (typeof item.url !== "string" || !item.url) {
      throw new Error(`Invalid vectors file format in ${filePath}: item ${idx} missing url`);
    }
    if (typeof item.title !== "string") {
      throw new Error(`Invalid vectors file format in ${filePath}: item ${idx} missing title`);
    }
    if (typeof item.chunk !== "string" || !item.chunk) {
      throw new Error(`Invalid vectors file format in ${filePath}: item ${idx} missing chunk`);
    }
    if (
      !Array.isArray(item.embedding) ||
      item.embedding.length === 0 ||
      !item.embedding.every((n) => isFiniteNumber(n))
    ) {
      throw new Error(`Invalid vectors file format in ${filePath}: item ${idx} invalid embedding`);
    }

    const dim = item.embedding.length;
    if (expectedDim === null) {
      expectedDim = dim;
    } else if (dim !== expectedDim) {
      throw new Error(
        `Invalid vectors file format in ${filePath}: item ${idx} embedding dimension ${dim} does not match expected ${expectedDim}`,
      );
    }
  });

  return obj as VectorsFile;
}

export async function loadVectorsIntoMemory() {
  const file = getEnv("VECTORS_FILE", "./data/vectors.json");
  const abs = path.resolve(file);

  let raw: string;
  try {
    raw = await fs.readFile(abs, "utf8");
  } catch (err: unknown) {
    const code = typeof err === "object" && err && "code" in err ? (err as { code?: string }).code : "";
    if (code === "ENOENT") {
      throw new Error(`Vectors file not found at ${abs}. Run ingest before starting the server.`);
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to read vectors file at ${abs}: ${detail}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in vectors file ${abs}: ${detail}`);
  }

  cache = validateVectorsFile(parsed, abs);
}

export function getVectorsIndex(): VectorsFile | null {
  return cache;
}
