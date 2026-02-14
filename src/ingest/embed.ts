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

export async function embedText(
  text: string,
  taskType: RetrievalTaskType = "RETRIEVAL_DOCUMENT",
): Promise<number[]> {
  return embedTextGemini(text, taskType);
}
