(function () {
  const API_BASE =
    window.BOXFUL_RAG_API_BASE || "https://TU-API-EN-RENDER.onrender.com";

  const style = document.createElement("style");
  style.textContent = `
    .bf-chat-btn{position:fixed;right:16px;bottom:16px;z-index:99999;padding:12px 14px;border-radius:999px;border:0;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.15);background:#111;color:#fff;font:14px/1.2 system-ui}
    .bf-chat-panel{position:fixed;right:16px;bottom:72px;width:340px;max-width:calc(100vw - 32px);height:440px;max-height:calc(100vh - 100px);z-index:99999;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.2);background:#fff;display:none;overflow:hidden;font:14px system-ui}
    .bf-chat-head{padding:12px 12px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center}
    .bf-chat-body{padding:12px;height:calc(100% - 110px);overflow:auto}
    .bf-msg{margin:0 0 10px 0;white-space:pre-wrap}
    .bf-msg-user{color:#111;font-weight:600}
    .bf-msg-bot{color:#222}
    .bf-chat-foot{padding:10px;border-top:1px solid #eee;display:flex;gap:8px}
    .bf-inp{flex:1;padding:10px;border:1px solid #ddd;border-radius:10px;outline:none}
    .bf-send{padding:10px 12px;border:0;border-radius:10px;background:#111;color:#fff;cursor:pointer}
    .bf-src{margin-top:6px;font-size:12px;color:#666}
    .bf-x{border:0;background:transparent;cursor:pointer;font-size:16px;line-height:1}
  `;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.className = "bf-chat-btn";
  btn.textContent = "Soporte";

  const panel = document.createElement("div");
  panel.className = "bf-chat-panel";
  panel.innerHTML = `
    <div class="bf-chat-head">
      <div><strong>Asistente Boxful</strong><div style="font-size:12px;color:#666">Responde con la base de conocimiento</div></div>
      <button class="bf-x" aria-label="Cerrar">✕</button>
    </div>
    <div class="bf-chat-body"></div>
    <div class="bf-chat-foot">
      <input class="bf-inp" placeholder="Escribe tu consulta..." />
      <button class="bf-send">Enviar</button>
    </div>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  const body = panel.querySelector(".bf-chat-body");
  const inp = panel.querySelector(".bf-inp");
  const send = panel.querySelector(".bf-send");
  const close = panel.querySelector(".bf-x");

  function sanitizeHttpUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""), window.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  function appendMsg(who, text, sources) {
    const p = document.createElement("div");
    p.className = "bf-msg " + (who === "user" ? "bf-msg-user" : "bf-msg-bot");
    p.textContent = (who === "user" ? "Tú: " : "Bot: ") + text;

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
    } catch (e) {
      appendMsg(
        "bot",
        "Hubo un error al consultar el servicio. Intenta de nuevo.",
        [],
      );
    }
  }

  function open() {
    panel.style.display = "block";
    inp.focus();
  }
  function hide() {
    panel.style.display = "none";
  }

  btn.addEventListener("click", () => {
    if (panel.style.display === "block") hide();
    else open();
  });

  close.addEventListener("click", hide);

  send.addEventListener("click", () => {
    const q = inp.value.trim();
    if (!q) return;
    inp.value = "";
    ask(q);
  });

  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send.click();
  });
})();
