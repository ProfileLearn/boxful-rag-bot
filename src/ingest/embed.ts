type RetrievalTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

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
    const aborted = err?.name === "AbortError";
    if (aborted) {
      throw new Error(`Embedding request timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function getLocalDim(): number {
  const v = Number(process.env.EMBED_LOCAL_DIM ?? "512");
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 512;
}

function normalize(vec: number[]): number[] {
  let norm = 0;
  for (const x of vec) norm += x * x;
  const denom = Math.sqrt(norm) || 1;
  return vec.map((x) => x / denom);
}

// Embeddings locales simples (hashing trick) para correr todo el retrieval en CPU local.
function embedTextLocal(text: string): number[] {
  const dim = getLocalDim();
  const vec = new Array<number>(dim).fill(0);
  const tokens = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

  for (const t of tokens) {
    let h1 = 2166136261;
    let h2 = 2166136261;
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 16777619);
      h2 ^= c + 13;
      h2 = Math.imul(h2, 16777619);
    }
    const idx = Math.abs(h1) % dim;
    const sign = (h2 & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
  }

  return normalize(vec);
}

async function embedTextOllama(text: string): Promise<number[]> {
  const base = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(
    /\/$/,
    "",
  );
  const timeoutMs = getEmbedTimeoutMs();
  const model = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text:latest";
  const maxCharsRaw = Number(process.env.OLLAMA_EMBED_MAX_CHARS ?? "1200");
  const initialMaxChars =
    Number.isFinite(maxCharsRaw) && maxCharsRaw > 0 ? Math.floor(maxCharsRaw) : 1200;
  let currentMaxChars = initialMaxChars;

  while (currentMaxChars >= 120) {
    const prompt = text.length > currentMaxChars ? text.slice(0, currentMaxChars) : text;
    const res = await fetchWithTimeout(
      `${base}/api/embeddings`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
        }),
      },
      timeoutMs,
    );

    const raw = await res.text();
    if (!res.ok) {
      const tooLong = raw.toLowerCase().includes("input length exceeds the context length");
      if (res.status === 500 && tooLong) {
        currentMaxChars = Math.floor(currentMaxChars / 2);
        continue;
      }
      throw new Error(`Ollama embeddings error (${model}): ${res.status} ${res.statusText}. ${raw}`);
    }

    const data = JSON.parse(raw) as any;
    const vec = data?.embedding;
    if (!Array.isArray(vec) || !vec.every((x) => typeof x === "number")) {
      throw new Error(`Ollama embedding response missing vector (${model})`);
    }
    return vec as number[];
  }

  throw new Error(`Ollama embeddings error (${model}): input too long even after truncation`);
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

export async function embedText(
  text: string,
  taskType: RetrievalTaskType = "RETRIEVAL_DOCUMENT",
): Promise<number[]> {
  const provider = (process.env.EMBED_PROVIDER ?? "ollama").toLowerCase();
  if (provider === "local") {
    return embedTextLocal(text);
  }
  if (provider === "ollama") {
    return embedTextOllama(text);
  }
  if (provider === "gemini") {
    return embedTextGemini(text, taskType);
  }

  throw new Error(
    `Unsupported EMBED_PROVIDER='${provider}'. Use 'ollama', 'gemini' or 'local'.`,
  );
}
