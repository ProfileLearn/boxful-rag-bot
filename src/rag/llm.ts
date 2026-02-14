function getLlmTimeoutMs(): number {
  const raw = Number(process.env.LLM_HTTP_TIMEOUT_MS ?? "20000");
  if (!Number.isFinite(raw)) return 20000;
  return Math.max(1000, Math.trunc(raw));
}

export type LlmProvider = "gemini";

export function getDefaultLlmProvider(): LlmProvider {
  return "gemini";
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
  return ["gemini"];
}

export function getUiChatModels(): string[] {
  const raw =
    process.env.UI_CHAT_MODELS_GEMINI ??
    process.env.GEMINI_CHAT_MODELS ??
    process.env.GEMINI_CHAT_MODEL ??
    "gemini-2.5-flash,gemini-2.5-pro";
  return splitUniqueCsv(raw);
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
  opts?: { model?: string },
): Promise<string> {
  const model =
    opts?.model?.trim() ||
    process.env.GEMINI_CHAT_MODEL ||
    "gemini-2.5-flash";
  return askLlmGemini(prompt, model);
}
