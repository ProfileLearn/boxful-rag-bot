import { parse } from "node-html-parser";

function getEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getEnvNum(
  name: string,
  fallback: number,
  opts?: { min?: number; max?: number; integer?: boolean },
): number {
  const raw = process.env[name];
  const parsed = Number(raw);
  let out = raw == null || !Number.isFinite(parsed) ? fallback : parsed;
  if (opts?.integer) out = Math.trunc(out);
  if (opts?.min !== undefined) out = Math.max(opts.min, out);
  if (opts?.max !== undefined) out = Math.min(opts.max, out);
  return out;
}

const UA = getEnv(
  "USER_AGENT",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 BoxfulRAGBot/0.1",
);
const maxPages = getEnvNum("KB_MAX_PAGES", 240, { min: 1, max: 5000, integer: true });
const retryCount = getEnvNum("SCRAPE_RETRIES", 5, { min: 0, max: 20, integer: true });
const minDelayMs = getEnvNum("SCRAPE_MIN_DELAY_MS", 250, { min: 0, max: 30000, integer: true });
const maxDelayMs = Math.max(
  minDelayMs,
  getEnvNum("SCRAPE_MAX_DELAY_MS", 2500, { min: 1, max: 120000, integer: true }),
);
const requestTimeoutMs = getEnvNum("SCRAPE_HTTP_TIMEOUT_MS", 20000, {
  min: 1000,
  max: 120000,
  integer: true,
});

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
  let lastError = "";
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    if (attempt > 0) {
      const exp = Math.min(maxDelayMs, minDelayMs * 2 ** (attempt - 1));
      await sleep(jitter(exp));
    }

    let res: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1000, requestTimeoutMs));
      try {
        res = await fetch(url, {
          signal: controller.signal,
          headers: {
            "user-agent": UA,
            accept: "text/html,*/*",
            "accept-language": "es-AR,es;q=0.9,en;q=0.7",
            pragma: "no-cache",
            "cache-control": "no-cache",
          },
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      lastError = msg;
      if (attempt === retryCount) {
        throw new Error(`Fetch failed for ${url}: ${msg}`);
      }
      continue;
    }

    if (res.ok) return await res.text();

    lastStatus = res.status;
    const retriable =
      res.status === 403 ||
      res.status === 408 ||
      res.status === 409 ||
      res.status === 425 ||
      res.status === 429 ||
      (res.status >= 500 && res.status <= 599);
    if (!retriable || attempt === retryCount) {
      throw new Error(`Fetch failed ${res.status} for ${url}`);
    }

    const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
    if (retryAfterMs !== null) {
      await sleep(Math.min(maxDelayMs * 4, retryAfterMs));
    }
  }

  if (lastStatus > 0) {
    throw new Error(`Fetch failed ${lastStatus} for ${url}`);
  }
  throw new Error(`Fetch failed for ${url}${lastError ? `: ${lastError}` : ""}`);
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
    } catch (err: any) {
      console.warn("Discover failed:", pageUrl, err?.message ?? err);
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
