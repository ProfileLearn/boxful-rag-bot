(function () {
  const globalObject = window;

  if (globalObject.__BOXFUL_WIDGET_LOADED__) return;
  globalObject.__BOXFUL_WIDGET_LOADED__ = true;

  const API_BASE =
    globalObject.BOXFUL_RAG_API_BASE || "https://TU-API-EN-RENDER.onrender.com";
  const widgetConfig = globalObject.BOXFUL_WIDGET_CONFIG || {};

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

  const anchor = getValidAnchor(
    widgetConfig.anchor || globalObject.BOXFUL_WIDGET_ANCHOR,
  );
  const vertical = anchor.startsWith("top-") ? "top" : "bottom";
  const horizontal = anchor.endsWith("-left") ? "left" : "right";
  const offsetX = toCssPixel(
    widgetConfig.offsetX ?? globalObject.BOXFUL_WIDGET_OFFSET_X,
    16,
  );
  const offsetY = toCssPixel(
    widgetConfig.offsetY ?? globalObject.BOXFUL_WIDGET_OFFSET_Y,
    16,
  );
  const zIndex = toZIndex(
    widgetConfig.zIndex ?? globalObject.BOXFUL_WIDGET_Z_INDEX,
    2147483000,
  );

  function sanitizeHttpUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""), window.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  function mountWidget() {
    if (document.getElementById("bf-widget-host")) return;

    const host = document.createElement("div");
    host.id = "bf-widget-host";
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
    document.documentElement.appendChild(host);

    const body = panel.querySelector(".bf-chat-body");
    const inp = panel.querySelector(".bf-inp");
    const send = panel.querySelector(".bf-send");
    const close = panel.querySelector(".bf-x");

    function appendMsg(who, text, sources) {
      const p = document.createElement("div");
      p.className = "bf-msg " + (who === "user" ? "bf-msg-user" : "bf-msg-bot");
      p.textContent = (who === "user" ? "Tu: " : "Bot: ") + text;

      if (Array.isArray(sources) && sources.length) {
        const s = document.createElement("div");
        s.className = "bf-src";

        const label = document.createElement("span");
        label.textContent = "Fuentes: ";
        s.appendChild(label);

        let hasLinks = false;
        for (const source of sources) {
          const href = sanitizeHttpUrl(source?.url);
          if (!href) continue;
          const title = String(source?.title || source?.url || href);

          if (hasLinks) s.appendChild(document.createTextNode(" · "));

          const link = document.createElement("a");
          link.href = href;
          link.target = "_blank";
          link.rel = "noreferrer noopener";
          link.textContent = title;
          s.appendChild(link);
          hasLinks = true;
        }

        if (hasLinks) p.appendChild(s);
      }

      body.appendChild(p);
      body.scrollTop = body.scrollHeight;
    }

    async function ask(q) {
      appendMsg("user", q);

      try {
        const res = await fetch(API_BASE.replace(/\/$/, "") + "/v1/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: q }),
        });

        const data = await res.json();
        appendMsg("bot", data.answer || "No pude responder.", data.sources || []);
      } catch {
        appendMsg(
          "bot",
          "Hubo un error al consultar el servicio. Intenta de nuevo.",
          [],
        );
      }
    }

    function open() {
      panel.hidden = false;
      inp.focus();
    }

    function hide() {
      panel.hidden = true;
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountWidget, { once: true });
  } else {
    mountWidget();
  }
})();
