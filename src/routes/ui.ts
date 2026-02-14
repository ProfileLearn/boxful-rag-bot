import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { getUiChatModels } from "../rag/llm.js";

function getUiDefaultModels(): string[] {
  return getUiChatModels();
}

const uiDefaultModels = JSON.stringify(getUiDefaultModels());
const uiAssetVersion = Date.now().toString(36);
const widgetFileUrl = new URL("../../public/widget.ts", import.meta.url);

const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Boxful AI Support</title>
    <style>
      :root {
        --bg-a: #f3f7f8;
        --bg-b: #e7efe8;
        --panel: #ffffff;
        --ink: #1b2226;
        --muted: #5d6771;
        --brand: #116f63;
        --brand-2: #0b534a;
        --line: #dbe3e7;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Segoe UI", "Trebuchet MS", "Noto Sans", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(1200px 500px at -10% -20%, #d4ece9 0%, transparent 60%),
          radial-gradient(900px 450px at 110% 0%, #dbeadd 0%, transparent 60%),
          linear-gradient(135deg, var(--bg-a), var(--bg-b));
      }
      .page {
        width: min(980px, 100%);
        margin: 0 auto;
        padding: 24px 16px;
      }
      .hero {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 14px;
      }
      .title {
        margin: 0;
        font-size: clamp(22px, 4vw, 34px);
        letter-spacing: 0.3px;
      }
      .subtitle {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 14px;
      }
      .badge {
        background: #e0f0ed;
        color: var(--brand-2);
        border-radius: 999px;
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 700;
      }
      .chat {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 18px;
        box-shadow: 0 18px 50px rgba(19, 30, 41, 0.09);
        overflow: hidden;
      }
      .messages {
        height: min(68vh, 650px);
        overflow-y: auto;
        padding: 18px;
      }
      .msg {
        max-width: 85%;
        margin-bottom: 12px;
        padding: 11px 13px;
        border-radius: 12px;
        white-space: pre-wrap;
        line-height: 1.45;
        font-size: 14px;
      }
      .msg.user {
        margin-left: auto;
        color: #fff;
        background: linear-gradient(140deg, var(--brand), var(--brand-2));
      }
      .msg.bot {
        border: 1px solid var(--line);
        background: #f9fcfd;
      }
      .sources {
        margin-top: 8px;
        font-size: 12px;
      }
      .sources a {
        color: var(--brand-2);
      }
      .composer {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        padding: 12px;
        border-top: 1px solid var(--line);
        background: #fcfefe;
      }
      .tools {
        grid-column: 1 / -1;
        display: flex;
        justify-content: flex-end;
      }
      .model-wrap {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: var(--muted);
      }
      .model-wrap select {
        border: 1px solid #cad6de;
        border-radius: 9px;
        padding: 6px 8px;
        background: #fff;
        color: var(--ink);
        font: inherit;
      }
      .composer textarea {
        width: 100%;
        resize: none;
        min-height: 54px;
        max-height: 170px;
        border: 1px solid #cad6de;
        border-radius: 12px;
        padding: 10px 12px;
        font: inherit;
      }
      .composer button {
        border: 0;
        border-radius: 12px;
        background: var(--ink);
        color: #fff;
        font: inherit;
        font-weight: 700;
        padding: 0 18px;
        cursor: pointer;
      }
      .composer button:disabled {
        opacity: 0.6;
        cursor: default;
      }
      @media (max-width: 720px) {
        .hero { flex-direction: column; align-items: flex-start; }
        .messages { height: min(62vh, 560px); }
        .composer { grid-template-columns: 1fr; }
        .composer button { min-height: 42px; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="hero">
        <div>
          <h1 class="title">Asistente Boxful</h1>
          <p class="subtitle">Responde usando la base de conocimiento de soporte.</p>
        </div>
        <span class="badge">RAG</span>
      </header>

      <section class="chat" aria-label="Chat de soporte">
        <div id="messages" class="messages"></div>
        <form id="chat-form" class="composer">
          <div class="tools">
            <label class="model-wrap">Embeddings
              <select id="embed-provider-select">
                <option value="gemini">Gemini API</option>
              </select>
            </label>
            <label class="model-wrap">Modelo
              <select id="model-select">
                <option value="">Cargando...</option>
              </select>
            </label>
          </div>
          <textarea id="question" placeholder="Escribe tu consulta..." required></textarea>
          <button id="send" type="submit">Enviar</button>
        </form>
      </section>
    </main>

    <script src="ui.js?v=${uiAssetVersion}" defer></script>
  </body>
</html>
`;

const uiJs = `
const form = document.getElementById("chat-form");
const messages = document.getElementById("messages");
const question = document.getElementById("question");
const send = document.getElementById("send");
const modelSelect = document.getElementById("model-select");
const embedProviderSelect = document.getElementById("embed-provider-select");
const API_BASE = String(window.BOXFUL_RAG_API_BASE || "").trim().replace(/\\/$/, "");
const DEFAULT_MODELS = ${uiDefaultModels};
const DEFAULT_EMBED_PROVIDERS = ["gemini", "huggingface_api", "local_cpu"];

function apiUrl(path) {
  const normalizedPath = "/" + String(path || "").replace(/^\\/+/, "");
  if (API_BASE) return API_BASE + normalizedPath;
  return normalizedPath;
}

async function fetchWithTimeout(url, options, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(options || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (m) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]
  ));
}

function appendMessage(role, text, sources) {
  const node = document.createElement("article");
  node.className = "msg " + role;

  let content = esc(text || "");
  if (Array.isArray(sources) && sources.length) {
    const links = sources.map((s) =>
      '<a href="' + esc(s.url) + '" target="_blank" rel="noreferrer">' +
      esc(s.title || s.url) + "</a>"
    );
    content += '<div class="sources"><strong>Fuentes:</strong> ' + links.join(" · ") + "</div>";
  }

  node.innerHTML = content;
  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
}

appendMessage("bot", "Hola. Soy el asistente de soporte de Boxful. ¿En qué te ayudo?");
function fillModels(models, currentModel) {
  const safeModels = Array.isArray(models) ? models : [];
  modelSelect.innerHTML = "";

  if (!safeModels.length) {
    modelSelect.innerHTML = '<option value="">Sin modelos</option>';
    return;
  }

  for (const model of safeModels) {
    const opt = document.createElement("option");
    opt.value = model;
    opt.textContent = model;
    if (model === currentModel) opt.selected = true;
    modelSelect.appendChild(opt);
  }
}

function prettyEmbedProviderName(value) {
  if (value === "gemini") return "Gemini API";
  if (value === "huggingface_api") return "Hugging Face API";
  if (value === "local_cpu") return "CPU local";
  return value;
}

function fillEmbedProviders(providers, currentProvider) {
  const safeProviders = Array.isArray(providers) ? providers : [];
  embedProviderSelect.innerHTML = "";

  if (!safeProviders.length) {
    embedProviderSelect.innerHTML = '<option value="gemini">Gemini API</option>';
    return;
  }

  for (const provider of safeProviders) {
    const opt = document.createElement("option");
    opt.value = provider;
    opt.textContent = prettyEmbedProviderName(provider);
    if (provider === currentProvider) opt.selected = true;
    embedProviderSelect.appendChild(opt);
  }
}

async function loadModels() {
  try {
    const res = await fetchWithTimeout(apiUrl("v1/models"));
    if (!res.ok) throw new Error("models_http_" + res.status);
    const data = await res.json();
    const models = Array.isArray(data?.models) ? data.models : [];
    const currentModel = typeof data?.current === "string" ? data.current : "";
    const embedProviders = Array.isArray(data?.embed_providers) ? data.embed_providers : [];
    const currentEmbedProvider =
      typeof data?.current_embed_provider === "string" ? data.current_embed_provider : "";
    fillModels(models, currentModel);
    fillEmbedProviders(embedProviders, currentEmbedProvider);
  } catch {
    fillModels(DEFAULT_MODELS, "");
    fillEmbedProviders(DEFAULT_EMBED_PROVIDERS, "gemini");
  }
}

loadModels();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = question.value.trim();
  if (!q) return;

  appendMessage("user", q);
  question.value = "";
  send.disabled = true;

  try {
    const res = await fetchWithTimeout(
      apiUrl("v1/chat"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: q,
          model: modelSelect.value || undefined,
          embed_provider: embedProviderSelect.value || undefined,
        })
      },
      60000,
    );
    const raw = await res.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {}

    if (!res.ok) {
      const details = data?.error || data?.message || raw.slice(0, 300);
      throw new Error("chat_http_" + res.status + (details ? ": " + details : ""));
    }

    appendMessage("bot", data.answer || "No pude generar una respuesta.", data.sources || []);
  } catch (err) {
    const details = String(err?.message || "").replace(/^Error:\\s*/, "").trim();
    appendMessage(
      "bot",
      "Ocurrió un error consultando el servicio." + (details ? "\\n\\nDetalle: " + details : ""),
    );
  } finally {
    send.disabled = false;
    question.focus();
  }
});

question.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});
`.trim();

export async function uiRoutes(app: FastifyInstance) {
  app.get("/", async (_, reply) => {
    reply
      .header("Cache-Control", "no-store, max-age=0")
      .type("text/html; charset=utf-8")
      .send(html);
  });
  app.get("/ui.js", async (_, reply) => {
    reply
      .header("Cache-Control", "no-store, max-age=0")
      .type("application/javascript; charset=utf-8")
      .send(uiJs);
  });
  app.get("/widget.js", async (_, reply) => {
    const widgetJs = await readFile(widgetFileUrl, "utf8");
    reply
      .header("Cache-Control", "no-store, max-age=0")
      .type("application/javascript; charset=utf-8")
      .send(widgetJs);
  });
}
