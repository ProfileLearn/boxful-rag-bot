import { parse } from "node-html-parser";

function getEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var: ${name}`);
  return v;
}

const UA = getEnv("USER_AGENT", "BoxfulRAGBot/0.1");
const maxPages = Number(process.env.KB_MAX_PAGES ?? "120");
const retryCount = Number(process.env.SCRAPE_RETRIES ?? "5");
const minDelayMs = Number(process.env.SCRAPE_MIN_DELAY_MS ?? "250");
const maxDelayMs = Number(process.env.SCRAPE_MAX_DELAY_MS ?? "2500");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(base: number): number {
  const plusMinus = Math.floor(base * 0.2);
  return base + Math.floor(Math.random() * (plusMinus * 2 + 1)) - plusMinus;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n * 1000);
  const when = Date.parse(value);
  if (Number.isFinite(when)) {
    const diff = when - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
}

async function fetchHtml(url: string): Promise<string> {
  let lastStatus = 0;
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    if (attempt > 0) {
      const exp = Math.min(maxDelayMs, minDelayMs * 2 ** (attempt - 1));
      await sleep(jitter(exp));
    }

    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        accept: "text/html,*/*",
      },
    });

    if (res.ok) return await res.text();

    lastStatus = res.status;
    const retriable = res.status === 429 || (res.status >= 500 && res.status <= 599);
    if (!retriable || attempt === retryCount) {
      throw new Error(`Fetch failed ${res.status} for ${url}`);
    }

    const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
    if (retryAfterMs !== null) {
      await sleep(Math.min(maxDelayMs * 4, retryAfterMs));
    }
  }

  throw new Error(`Fetch failed ${lastStatus} for ${url}`);
}

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    if (url.searchParams.has("page")) {
      const page = url.searchParams.get("page");
      url.search = page ? `?page=${page}` : "";
    } else if (url.pathname.includes("/support/solutions/articles/")) {
      // Los artículos suelen tener parámetros de tracking que no aportan.
      url.search = "";
    }
    return url.toString();
  } catch {
    return u;
  }
}

export async function discoverArticleUrls(): Promise<string[]> {
  const kbRoot = getEnv(
    "KB_ROOT",
    "https://boxful.freshdesk.com/support/solutions/",
  );
  const base = new URL(kbRoot);
  const allowedPrefix = "/support/solutions";
  const baseOrigin = base.origin;
  const start = normalizeUrl(base.toString());
  const queue = [start];
  const queued = new Set<string>([start]);
  const visited = new Set<string>();
  const urls = new Set<string>();

  while (queue.length > 0 && visited.size < maxPages) {
    const pageUrl = queue.shift()!;
    visited.add(pageUrl);

    let html = "";
    try {
      html = await fetchHtml(pageUrl);
    } catch {
      continue;
    }

    const root = parse(html);
    const links = root.querySelectorAll("a");

    for (const a of links) {
      const href = a.getAttribute("href")?.trim();
      if (!href) continue;
      if (
        href.startsWith("mailto:") ||
        href.startsWith("javascript:") ||
        href.startsWith("#")
      ) {
        continue;
      }

      let absolute = "";
      try {
        absolute = normalizeUrl(new URL(href, pageUrl).toString());
      } catch {
        continue;
      }

      let candidate: URL;
      try {
        candidate = new URL(absolute);
      } catch {
        continue;
      }

      if (candidate.origin !== baseOrigin) continue;
      if (!candidate.pathname.startsWith(allowedPrefix)) continue;

      if (candidate.pathname.includes("/support/solutions/articles/")) {
        urls.add(absolute);
        continue;
      }

      if (!visited.has(absolute) && !queued.has(absolute)) {
        queue.push(absolute);
        queued.add(absolute);
      }
    }
  }

  return [...urls].sort();
}

export async function fetchArticleHtml(url: string): Promise<string> {
  return fetchHtml(url);
}
