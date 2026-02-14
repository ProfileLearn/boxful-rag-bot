type RetrievalTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";
export type EmbedMode = "gemini" | "huggingface_api" | "local_cpu";

function getEmbedTimeoutMs(): number {
  const raw = Number(process.env.EMBED_HTTP_TIMEOUT_MS ?? "15000");
  if (!Number.isFinite(raw)) return 15000;
  return Math.max(1000, Math.trunc(raw));
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`Embedding request timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function embedTextGemini(
  text: string,
  taskType: RetrievalTaskType,
): Promise<number[]> {
  const timeoutMs = getEmbedTimeoutMs();
  const apiKey = (process.env.GEMINI_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("Gemini embeddings error: missing GEMINI_API_KEY");
  }

  const model = (process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-001").trim();
  const maxCharsRaw = Number(process.env.GEMINI_EMBED_MAX_CHARS ?? "8000");
  const maxChars = Number.isFinite(maxCharsRaw) && maxCharsRaw > 0 ? Math.floor(maxCharsRaw) : 8000;
  const safeText = text.length > maxChars ? text.slice(0, maxChars) : text;

  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: {
          parts: [{ text: safeText }],
        },
        taskType,
      }),
    },
    timeoutMs,
  );

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini embeddings error (${model}): ${res.status} ${res.statusText}. ${raw}`);
  }

  const data = JSON.parse(raw) as any;
  const vec = data?.embedding?.values;
  if (!Array.isArray(vec) || !vec.every((x) => typeof x === "number")) {
    throw new Error(`Gemini embedding response missing vector (${model})`);
  }

  return vec as number[];
}

function meanPool(rows: number[][]): number[] {
  if (rows.length === 0) return [];
  const dim = rows[0]?.length ?? 0;
  if (dim === 0) return [];
  const out = new Array<number>(dim).fill(0);
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== dim) continue;
    for (let i = 0; i < dim; i++) out[i] += row[i] ?? 0;
  }
  for (let i = 0; i < dim; i++) out[i] /= rows.length;
  return out;
}

function toNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  if (value.every((x) => typeof x === "number")) return value as number[];
  return null;
}

function parseEmbeddingResponse(data: any): number[] {
  const direct = toNumberArray(data);
  if (direct) return direct;

  if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
    const rows = data.filter((row) =>
      Array.isArray(row) && row.every((x) => typeof x === "number")
    ) as number[][];
    if (rows.length > 0) return meanPool(rows);
  }

  if (data && typeof data === "object") {
    const candidates = [
      data.embedding,
      data.vector,
      data.embeddings,
      data.data?.[0]?.embedding,
      data.data,
    ];
    for (const candidate of candidates) {
      if (candidate == null) continue;
      const vec = parseEmbeddingResponse(candidate);
      if (vec.length > 0) return vec;
    }
  }

  return [];
}

async function embedTextHuggingFace(
  text: string,
  opts?: { urlOverride?: string; disableUrlFromEnv?: boolean },
): Promise<number[]> {
  const timeoutMs = getEmbedTimeoutMs();
  const maxCharsRaw = Number(process.env.HF_EMBED_MAX_CHARS ?? "4000");
  const maxChars = Number.isFinite(maxCharsRaw) && maxCharsRaw > 0 ? Math.floor(maxCharsRaw) : 4000;
  const safeText = text.length > maxChars ? text.slice(0, maxChars) : text;

  const hfEmbedUrl = opts?.disableUrlFromEnv
    ? ""
    : (opts?.urlOverride ?? process.env.HF_EMBED_URL ?? "").trim();
  const hfApiToken = (process.env.HF_API_TOKEN ?? "").trim();
  const hfModel = (process.env.HF_EMBED_MODEL ?? "intfloat/multilingual-e5-small").trim();

  const url = hfEmbedUrl
    ? hfEmbedUrl
    : `https://api-inference.huggingface.co/pipeline/feature-extraction/${encodeURIComponent(hfModel)}`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (hfApiToken) headers.Authorization = `Bearer ${hfApiToken}`;

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        inputs: safeText,
        options: { wait_for_model: true },
      }),
    },
    timeoutMs,
  );

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Hugging Face embeddings error: ${res.status} ${res.statusText}. ${raw}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Hugging Face embeddings error: invalid JSON response");
  }

  const vec = parseEmbeddingResponse(data);
  if (!Array.isArray(vec) || vec.length === 0 || !vec.every((x) => typeof x === "number")) {
    throw new Error("Hugging Face embeddings error: response missing embedding vector");
  }

  return vec;
}

function splitUniqueCsv(raw: string): string[] {
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

function parseEmbedMode(input: string | undefined): EmbedMode | null {
  const mode = (input ?? "").trim().toLowerCase();
  if (mode === "gemini") return "gemini";
  if (mode === "huggingface_api") return "huggingface_api";
  if (mode === "local_cpu") return "local_cpu";
  return null;
}

export function getUiEmbedModes(): EmbedMode[] {
  const raw = process.env.UI_EMBED_MODES ?? "gemini,huggingface_api,local_cpu";
  const parsed = splitUniqueCsv(raw)
    .map((m) => parseEmbedMode(m))
    .filter((m): m is EmbedMode => m !== null);
  return parsed.length > 0 ? parsed : ["gemini"];
}

export function getDefaultEmbedMode(): EmbedMode {
  const envRaw = (process.env.EMBED_PROVIDER ?? "").trim().toLowerCase();
  if (envRaw === "gemini") return "gemini";
  if (envRaw === "huggingface") {
    return (process.env.HF_EMBED_URL ?? "").trim() ? "local_cpu" : "huggingface_api";
  }
  return "gemini";
}

export async function embedText(
  text: string,
  taskType: RetrievalTaskType = "RETRIEVAL_DOCUMENT",
  opts?: { mode?: EmbedMode },
): Promise<number[]> {
  const mode = opts?.mode ?? getDefaultEmbedMode();
  if (mode === "gemini") return embedTextGemini(text, taskType);

  if (mode === "local_cpu") {
    const localUrl =
      (process.env.HF_EMBED_LOCAL_URL ?? "").trim() || (process.env.HF_EMBED_URL ?? "").trim();
    if (!localUrl) {
      throw new Error("Hugging Face embeddings error: missing HF_EMBED_LOCAL_URL/HF_EMBED_URL for local_cpu");
    }
    return embedTextHuggingFace(text, { urlOverride: localUrl });
  }

  if (mode === "huggingface_api") {
    return embedTextHuggingFace(text, { disableUrlFromEnv: true });
  }

  const provider = (process.env.EMBED_PROVIDER ?? "gemini").trim().toLowerCase();
  if (provider === "huggingface") return embedTextHuggingFace(text);
  return embedTextGemini(text, taskType);
}
