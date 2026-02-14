function getLlmTimeoutMs(): number {
  const raw = Number(process.env.LLM_HTTP_TIMEOUT_MS ?? "20000");
  if (!Number.isFinite(raw)) return 20000;
  return Math.max(1000, Math.trunc(raw));
}

export type LlmProvider = "ollama" | "gemini";

function normalizeProvider(raw?: string | null): LlmProvider | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "ollama" || v === "gemini") return v;
  return null;
}

export function getDefaultLlmProvider(): LlmProvider {
  return normalizeProvider(process.env.LLM_PROVIDER) ?? "ollama";
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
      throw new Error(`LLM request timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function splitUniqueCsv(raw: string): string[] {
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

export function getUiProviders(): LlmProvider[] {
  const explicit = (process.env.UI_LLM_PROVIDERS ?? "").trim();
  if (explicit) {
    const providers = splitUniqueCsv(explicit)
      .map((p) => normalizeProvider(p))
      .filter((p): p is LlmProvider => p !== null);
    if (providers.length) return providers;
  }
  return [getDefaultLlmProvider()];
}

export function getUiChatModels(providerInput?: string): string[] {
  const provider = normalizeProvider(providerInput) ?? getDefaultLlmProvider();

  if (provider === "ollama") {
    const raw =
      process.env.UI_CHAT_MODELS_OLLAMA ??
      process.env.UI_CHAT_MODELS ??
      process.env.OLLAMA_CHAT_MODELS ??
      process.env.OLLAMA_CHAT_MODEL ??
      "qwen2.5:1.5b-instruct,llama3.2:3b-instruct,phi3:3.8b-mini-instruct";
    return splitUniqueCsv(raw);
  }

  if (provider === "gemini") {
    const raw =
      process.env.UI_CHAT_MODELS_GEMINI ??
      process.env.GEMINI_CHAT_MODELS ??
      process.env.GEMINI_CHAT_MODEL ??
      "gemini-2.5-flash,gemini-2.5-pro";
    return splitUniqueCsv(raw);
  }

  return [];
}

async function askLlmOllama(prompt: string, model: string): Promise<string> {
  const timeoutMs = getLlmTimeoutMs();
  const base = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(
    /\/$/,
    "",
  );

  const res = await fetchWithTimeout(
    `${base}/api/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        options: {
          temperature: 0.2,
        },
      }),
    },
    timeoutMs,
  );

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Ollama chat error (${model}): ${res.status} ${res.statusText}. ${raw}`);
  }

  const data = JSON.parse(raw) as any;
  const out = data?.message?.content ?? "";
  return (
    String(out).trim() ||
    "No encontré información suficiente en la base de conocimiento."
  );
}

async function askLlmGemini(prompt: string, model: string): Promise<string> {
  const timeoutMs = getLlmTimeoutMs();
  const apiKey = (process.env.GEMINI_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("Gemini chat error: missing GEMINI_API_KEY");
  }

  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
        },
      }),
    },
    timeoutMs,
  );

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini chat error (${model}): ${res.status} ${res.statusText}. ${raw}`);
  }

  const data = JSON.parse(raw) as any;
  const parts = data?.candidates?.[0]?.content?.parts;
  const out = Array.isArray(parts)
    ? parts
        .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
        .join("\n")
        .trim()
    : "";

  return out || "No encontré información suficiente en la base de conocimiento.";
}

export async function askLlm(
  prompt: string,
  opts?: { model?: string; provider?: string },
): Promise<string> {
  const provider = normalizeProvider(opts?.provider) ?? getDefaultLlmProvider();

  if (provider === "ollama") {
    const model =
      opts?.model?.trim() ||
      process.env.OLLAMA_CHAT_MODEL ||
      "llama3.1:8b-instruct-q4_K_M";
    return askLlmOllama(prompt, model);
  }

  if (provider === "gemini") {
    const model =
      opts?.model?.trim() ||
      process.env.GEMINI_CHAT_MODEL ||
      "gemini-2.5-flash";
    return askLlmGemini(prompt, model);
  }

  throw new Error(
    `Unsupported LLM_PROVIDER='${provider}'. Use 'ollama', 'gemini' or enable NO_LLM=1.`,
  );
}
