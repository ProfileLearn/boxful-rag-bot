(function () {
  const globalObject = window;

  if (globalObject.__BOXFUL_WIDGET_LOADED__) {
    if (
      globalObject.BoxfulSupportWidget &&
      typeof globalObject.BoxfulSupportWidget.mount === "function"
    ) {
      globalObject.BoxfulSupportWidget.mount();
    }
    return;
  }
  globalObject.__BOXFUL_WIDGET_LOADED__ = true;

  function firstDefined(candidates) {
    for (const value of candidates) {
      if (value === undefined || value === null) continue;
      if (typeof value === "string" && value.trim() === "") continue;
      return value;
    }
    return undefined;
  }

  function normalizeApiBase(rawValue) {
    const raw = String(rawValue ?? "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw, window.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      return url.toString().replace(/\/$/, "");
    } catch {
      return "";
    }
  }

  function getBootScript() {
    if (document.currentScript && document.currentScript.tagName === "SCRIPT") {
      return document.currentScript;
    }

    const scripts = document.getElementsByTagName("script");
    for (let i = scripts.length - 1; i >= 0; i -= 1) {
      const src = String(scripts[i].getAttribute("src") || "");
      if (/\/widget\.js(?:[?#]|$)/i.test(src)) return scripts[i];
    }
    return null;
  }

  function readScriptOption(scriptEl, params, dataAttr, queryKey) {
    if (scriptEl) {
      const dataValue = scriptEl.getAttribute(`data-${dataAttr}`);
      if (typeof dataValue === "string" && dataValue.trim()) return dataValue.trim();
    }
    const queryValue = params.get(queryKey);
    if (typeof queryValue === "string" && queryValue.trim()) return queryValue.trim();
    return undefined;
  }

  function inferApiBaseFromScriptUrl(scriptUrl) {
    if (!scriptUrl) return "";
    const cleanPath = scriptUrl.pathname.replace(/\/+$/, "");
    const basePath = cleanPath.replace(/\/widget\.js$/i, "");
    return normalizeApiBase(`${scriptUrl.origin}${basePath}`);
  }

  const bootScript = getBootScript();
  const bootScriptUrl = (() => {
    if (!bootScript) return null;
    const src = String(bootScript.getAttribute("src") || "").trim();
    if (!src) return null;
    try {
      return new URL(src, window.location.href);
    } catch {
      return null;
    }
  })();
  const bootParams = bootScriptUrl ? bootScriptUrl.searchParams : new URLSearchParams();
  const widgetConfig = globalObject.BOXFUL_WIDGET_CONFIG || {};

  const API_BASE =
    normalizeApiBase(
      firstDefined([
        readScriptOption(bootScript, bootParams, "api-base", "api_base"),
        widgetConfig.apiBase,
        globalObject.BOXFUL_RAG_API_BASE,
      ]),
    ) ||
    inferApiBaseFromScriptUrl(bootScriptUrl) ||
    normalizeApiBase(window.location.origin);

  function getValidAnchor(rawValue) {
    const anchor = String(rawValue || "").trim().toLowerCase();
    if (
      anchor === "bottom-right" ||
      anchor === "bottom-left" ||
      anchor === "top-right" ||
      anchor === "top-left"
    ) {
      return anchor;
    }
    return "bottom-right";
  }

  function toCssPixel(value, fallback) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return `${Math.max(0, value)}px`;
    }
    const text = String(value ?? "").trim();
    if (!text) return `${fallback}px`;
    if (/^\d+(\.\d+)?px$/.test(text)) return text;
    if (/^\d+(\.\d+)?$/.test(text)) return `${text}px`;
    return `${fallback}px`;
  }

  function toZIndex(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(fallback);
    return String(Math.max(1, Math.trunc(n)));
  }

  function toPositiveInt(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.trunc(n));
  }

  const anchor = getValidAnchor(
    firstDefined([
      readScriptOption(bootScript, bootParams, "anchor", "anchor"),
      widgetConfig.anchor,
      globalObject.BOXFUL_WIDGET_ANCHOR,
    ]),
  );
  const vertical = anchor.startsWith("top-") ? "top" : "bottom";
  const horizontal = anchor.endsWith("-left") ? "left" : "right";
  const offsetX = toCssPixel(
    firstDefined([
      readScriptOption(bootScript, bootParams, "offset-x", "offset_x"),
      widgetConfig.offsetX,
      globalObject.BOXFUL_WIDGET_OFFSET_X,
    ]),
    16,
  );
  const offsetY = toCssPixel(
    firstDefined([
      readScriptOption(bootScript, bootParams, "offset-y", "offset_y"),
      widgetConfig.offsetY,
      globalObject.BOXFUL_WIDGET_OFFSET_Y,
    ]),
    16,
  );
  const zIndex = toZIndex(
    firstDefined([
      readScriptOption(bootScript, bootParams, "z-index", "z_index"),
      widgetConfig.zIndex,
      globalObject.BOXFUL_WIDGET_Z_INDEX,
    ]),
    2147483000,
  );

  const storagePrefixRaw = String(
    firstDefined([
      readScriptOption(bootScript, bootParams, "storage-key-prefix", "storage_prefix"),
      widgetConfig.storageKeyPrefix,
      globalObject.BOXFUL_WIDGET_STORAGE_PREFIX,
      "boxful_widget_v1",
    ]),
  ).trim();
  const storagePrefix = storagePrefixRaw || "boxful_widget_v1";
  const storageConversationKey = `${storagePrefix}:conversation_id`;
  const storageMessagesKey = `${storagePrefix}:messages`;
  const maxPersistedMessages = toPositiveInt(
    firstDefined([
      readScriptOption(bootScript, bootParams, "max-persisted-messages", "max_messages"),
      widgetConfig.maxPersistedMessages,
      globalObject.BOXFUL_WIDGET_MAX_MESSAGES,
    ]),
    40,
  );
  const greetingText = String(
    firstDefined([
      readScriptOption(bootScript, bootParams, "greeting-text", "greeting"),
      widgetConfig.greetingText,
      globalObject.BOXFUL_WIDGET_GREETING,
      "Hola. Soy el asistente de soporte de Boxful. ¿En qué te ayudo?",
    ]),
  ).trim();

  const hostId = "bf-widget-host";
  const state = {
    conversationId: "",
    messages: [],
  };

  function storageGet(key) {
    try {
      return globalObject.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      globalObject.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function createConversationId() {
    if (globalObject.crypto && typeof globalObject.crypto.randomUUID === "function") {
      return globalObject.crypto.randomUUID();
    }
    return `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }

  function isValidConversationId(raw) {
    return /^[A-Za-z0-9._:-]{8,120}$/.test(String(raw || "").trim());
  }

  function setConversationId(rawId) {
    const candidate = String(rawId || "").trim();
    if (!isValidConversationId(candidate)) return;
    state.conversationId = candidate;
    storageSet(storageConversationKey, candidate);
  }

  function ensureConversationId() {
    if (isValidConversationId(state.conversationId)) return state.conversationId;
    const stored = String(storageGet(storageConversationKey) || "").trim();
    if (isValidConversationId(stored)) {
      state.conversationId = stored;
      return state.conversationId;
    }
    state.conversationId = createConversationId();
    storageSet(storageConversationKey, state.conversationId);
    return state.conversationId;
  }

  function sanitizeHttpUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""), window.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  function normalizeSources(rawSources) {
    if (!Array.isArray(rawSources)) return [];
    const normalized = [];

    for (const source of rawSources) {
      const href = sanitizeHttpUrl(source?.url);
      if (!href) continue;
      const title = String(source?.title || href).trim() || href;
      normalized.push({ title, url: href });
      if (normalized.length >= 8) break;
    }

    return normalized;
  }

  function loadPersistedMessages() {
    const raw = storageGet(storageMessagesKey);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      const out = [];
      for (const item of parsed) {
        const who = item?.who === "user" ? "user" : item?.who === "bot" ? "bot" : "";
        const text = String(item?.text || "").trim();
        if (!who || !text) continue;
        out.push({
          who,
          text,
          sources: normalizeSources(item?.sources),
        });
      }

      if (out.length > maxPersistedMessages) {
        return out.slice(out.length - maxPersistedMessages);
      }
      return out;
    } catch {
      return [];
    }
  }

  function persistMessages() {
    const latest = state.messages.slice(-maxPersistedMessages);
    state.messages = latest;
    storageSet(storageMessagesKey, JSON.stringify(latest));
  }

  function getMountedHost() {
    return document.getElementById(hostId);
  }

  function hideMountedPanel() {
    const host = getMountedHost();
    if (!host || !host.shadowRoot) return;
    const panel = host.shadowRoot.querySelector(".bf-chat-panel");
    const input = host.shadowRoot.querySelector(".bf-inp");
    if (panel) panel.hidden = true;
    if (input && typeof input.blur === "function") input.blur();
  }

  function openMountedPanel() {
    const host = getMountedHost();
    if (!host || !host.shadowRoot) return;
    const panel = host.shadowRoot.querySelector(".bf-chat-panel");
    const input = host.shadowRoot.querySelector(".bf-inp");
    if (panel) panel.hidden = false;
    if (input && typeof input.focus === "function") input.focus();
  }

  function escapeHtml(rawText) {
    return String(rawText ?? "").replace(/[&<>"']/g, (char) => {
      if (char === "&") return "&amp;";
      if (char === "<") return "&lt;";
      if (char === ">") return "&gt;";
      if (char === '"') return "&quot;";
      return "&#39;";
    });
  }

  function escapeHtmlAttr(rawText) {
    return escapeHtml(rawText).replace(/`/g, "&#96;");
  }

  function renderInlineMarkdown(rawText) {
    const stashed = [];
    const stash = (html) => {
      const marker = "@@MD_TOKEN_" + stashed.length + "@@";
      stashed.push(html);
      return marker;
    };

    let html = escapeHtml(rawText);

    html = html.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label, rawUrl) => {
      const href = sanitizeHttpUrl(rawUrl);
      if (!href) return label;
      return stash(
        '<a href="' +
          escapeHtmlAttr(href) +
          '" target="_blank" rel="noreferrer noopener">' +
          label +
          "</a>",
      );
    });

    html = html.replace(/`([^`\n]+)`/g, (_, code) => {
      return stash("<code>" + code + "</code>");
    });
    html = html.replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^\w])\*([^\n*]+?)\*(?=[^\w]|$)/g, "$1<em>$2</em>");

    return html.replace(/@@MD_TOKEN_(\d+)@@/g, (match, index) => {
      return stashed[Number(index)] || match;
    });
  }

  function apiUrl(path) {
    const normalizedPath = "/" + String(path || "").replace(/^\/+/, "");
    if (!API_BASE) return normalizedPath;
    return API_BASE + normalizedPath;
  }

  function resetConversation() {
    state.conversationId = createConversationId();
    storageSet(storageConversationKey, state.conversationId);
    state.messages = greetingText
      ? [{ who: "bot", text: greetingText, sources: [] }]
      : [];
    persistMessages();

    const host = getMountedHost();
    if (host) host.remove();
    mountWidget();
    openMountedPanel();
  }

  function mountWidget() {
    if (getMountedHost()) return;
    if (!document.body) return;

    ensureConversationId();
    state.messages = loadPersistedMessages();
    if (!state.messages.length && greetingText) {
      state.messages = [{ who: "bot", text: greetingText, sources: [] }];
      persistMessages();
    }

    const host = document.createElement("div");
    host.id = hostId;
    host.setAttribute("data-v", vertical);
    host.setAttribute("data-h", horizontal);
    host.style.position = "fixed";
    host.style.zIndex = zIndex;
    host.style.width = "0";
    host.style.height = "0";
    host.style.overflow = "visible";

    if (vertical === "top") host.style.top = offsetY;
    else host.style.bottom = offsetY;

    if (horizontal === "left") host.style.left = offsetX;
    else host.style.right = offsetX;

    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host {
        box-sizing: border-box;
        font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
        color: #111;
      }
      *,
      *::before,
      *::after {
        box-sizing: inherit;
      }
      .bf-chat-btn,
      .bf-chat-panel {
        position: absolute;
      }
      :host([data-h="right"]) .bf-chat-btn,
      :host([data-h="right"]) .bf-chat-panel {
        right: 0;
      }
      :host([data-h="left"]) .bf-chat-btn,
      :host([data-h="left"]) .bf-chat-panel {
        left: 0;
      }
      :host([data-v="bottom"]) .bf-chat-btn {
        bottom: 0;
      }
      :host([data-v="bottom"]) .bf-chat-panel {
        bottom: 56px;
      }
      :host([data-v="top"]) .bf-chat-btn {
        top: 0;
      }
      :host([data-v="top"]) .bf-chat-panel {
        top: 56px;
      }
      .bf-chat-btn {
        padding: 12px 14px;
        border-radius: 999px;
        border: 0;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
        background: #111;
        color: #fff;
        font: inherit;
        white-space: nowrap;
      }
      .bf-chat-panel {
        width: 340px;
        max-width: min(340px, calc(100vw - 32px));
        height: 440px;
        max-height: calc(100vh - 100px);
        border-radius: 14px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
        background: #fff;
        overflow: hidden;
        color: #111;
      }
      .bf-chat-panel[hidden] {
        display: none;
      }
      .bf-chat-head {
        padding: 12px;
        border-bottom: 1px solid #eee;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }
      .bf-chat-title {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
      }
      .bf-chat-subtitle {
        margin: 2px 0 0;
        font-size: 12px;
        color: #666;
      }
      .bf-chat-body {
        padding: 12px;
        height: calc(100% - 110px);
        overflow: auto;
      }
      .bf-msg {
        margin: 0 0 10px;
        white-space: pre-wrap;
      }
      .bf-msg a {
        color: #0a5f89;
        text-decoration: underline;
      }
      .bf-msg code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.93em;
        background: #f0f4f6;
        border-radius: 4px;
        padding: 1px 4px;
      }
      .bf-msg-prefix {
        font-weight: 700;
      }
      .bf-msg-user {
        color: #111;
        font-weight: 600;
      }
      .bf-msg-bot {
        color: #222;
      }
      .bf-chat-foot {
        padding: 10px;
        border-top: 1px solid #eee;
        display: flex;
        gap: 8px;
      }
      .bf-inp {
        flex: 1;
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: 10px;
        outline: none;
        font: inherit;
      }
      .bf-send {
        padding: 10px 12px;
        border: 0;
        border-radius: 10px;
        background: #111;
        color: #fff;
        cursor: pointer;
        font: inherit;
      }
      .bf-src {
        margin-top: 6px;
        font-size: 12px;
        color: #666;
      }
      .bf-src a {
        color: #0a5f89;
        text-decoration: underline;
      }
      .bf-x {
        border: 0;
        background: transparent;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        padding: 2px;
      }
      @media (max-width: 480px) {
        .bf-chat-panel {
          width: min(340px, calc(100vw - 24px));
          max-width: calc(100vw - 24px);
          height: min(440px, calc(100vh - 90px));
          max-height: calc(100vh - 90px);
        }
      }
    `;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bf-chat-btn";
    btn.textContent = "Soporte";

    const panel = document.createElement("section");
    panel.className = "bf-chat-panel";
    panel.setAttribute("aria-label", "Chat de soporte");
    panel.hidden = true;
    panel.innerHTML = `
      <div class="bf-chat-head">
        <div>
          <p class="bf-chat-title">Asistente Boxful</p>
          <p class="bf-chat-subtitle">Responde con la base de conocimiento</p>
        </div>
        <button type="button" class="bf-x" aria-label="Cerrar">x</button>
      </div>
      <div class="bf-chat-body"></div>
      <div class="bf-chat-foot">
        <input class="bf-inp" placeholder="Escribe tu consulta..." />
        <button type="button" class="bf-send">Enviar</button>
      </div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(btn);
    shadow.appendChild(panel);
    document.body.appendChild(host);

    const body = panel.querySelector(".bf-chat-body");
    const inp = panel.querySelector(".bf-inp");
    const send = panel.querySelector(".bf-send");
    const close = panel.querySelector(".bf-x");

    if (!body || !inp || !send || !close) return;

    function appendMsg(who, text, sources, opts) {
      const safeWho = who === "user" ? "user" : "bot";
      const safeText = String(text || "").trim();
      if (!safeText) return;

      const safeSources = normalizeSources(sources);
      const shouldPersist = !(opts && opts.persist === false);

      const p = document.createElement("div");
      p.className = "bf-msg " + (safeWho === "user" ? "bf-msg-user" : "bf-msg-bot");
      p.innerHTML =
        '<span class="bf-msg-prefix">' +
        (safeWho === "user" ? "Tu: " : "Bot: ") +
        "</span>" +
        renderInlineMarkdown(safeText);

      if (safeSources.length) {
        const s = document.createElement("div");
        s.className = "bf-src";

        const label = document.createElement("span");
        label.textContent = "Fuentes: ";
        s.appendChild(label);

        let hasLinks = false;
        for (const source of safeSources) {
          if (hasLinks) s.appendChild(document.createTextNode(" · "));

          const link = document.createElement("a");
          link.href = source.url;
          link.target = "_blank";
          link.rel = "noreferrer noopener";
          link.textContent = source.title;
          s.appendChild(link);
          hasLinks = true;
        }

        if (hasLinks) p.appendChild(s);
      }

      body.appendChild(p);
      body.scrollTop = body.scrollHeight;

      if (!shouldPersist) return;

      state.messages.push({
        who: safeWho,
        text: safeText,
        sources: safeSources,
      });
      persistMessages();
    }

    for (const msg of state.messages) {
      appendMsg(msg.who, msg.text, msg.sources, { persist: false });
    }

    let isSending = false;

    async function ask(rawQuestion) {
      const q = String(rawQuestion || "").trim();
      if (!q || isSending) return;

      appendMsg("user", q, []);
      isSending = true;
      send.disabled = true;
      inp.disabled = true;

      try {
        const res = await fetch(apiUrl("/v1/chat"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: q,
            conversation_id: ensureConversationId(),
          }),
        });

        const raw = await res.text();
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          data = {};
        }

        if (typeof data?.conversation_id === "string") {
          setConversationId(data.conversation_id);
        }

        if (!res.ok) {
          const details =
            typeof data?.error === "string"
              ? data.error
              : typeof data?.message === "string"
                ? data.message
                : raw.slice(0, 240);
          throw new Error(details || "chat_error");
        }

        appendMsg(
          "bot",
          typeof data?.answer === "string" ? data.answer : "No pude responder.",
          Array.isArray(data?.sources) ? data.sources : [],
        );
      } catch {
        appendMsg(
          "bot",
          "Hubo un error al consultar el servicio. Intenta de nuevo.",
          [],
        );
      } finally {
        isSending = false;
        send.disabled = false;
        inp.disabled = false;
        inp.focus();
      }
    }

    function open() {
      panel.hidden = false;
      inp.focus();
    }

    function hide() {
      panel.hidden = true;
      inp.blur();
    }

    btn.addEventListener("click", () => {
      if (panel.hidden) open();
      else hide();
    });

    close.addEventListener("click", hide);

    send.addEventListener("click", () => {
      const q = inp.value.trim();
      if (!q) return;
      inp.value = "";
      ask(q);
    });

    inp.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      send.click();
    });
  }

  globalObject.BoxfulSupportWidget = {
    mount: mountWidget,
    open: () => {
      mountWidget();
      openMountedPanel();
    },
    hide: hideMountedPanel,
    resetConversation,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountWidget, { once: true });
  } else {
    mountWidget();
  }

  document.addEventListener("turbo:load", mountWidget);
  document.addEventListener("turbo:render", mountWidget);
  document.addEventListener("turbo:before-cache", hideMountedPanel);
})();
