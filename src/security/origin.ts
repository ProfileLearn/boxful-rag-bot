import type { FastifyRequest } from "fastify";

type OriginCheckResult =
  | { ok: true }
  | { ok: false; code: number; error: string; message: string };

function splitCsv(raw: string): string[] {
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

function normalizeOrigin(raw: string | undefined): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (text === "null") return "null";

  try {
    const url = new URL(text);
    return url.origin;
  } catch {
    return "";
  }
}

function getAllowedOrigins(): string[] {
  const raw = process.env.CHAT_ALLOWED_ORIGINS ?? process.env.CORS_ORIGINS ?? "*";
  const parsed = splitCsv(raw);
  if (parsed.length === 0) return ["*"];
  return parsed;
}

function getEnforceOriginCheck(): boolean {
  const raw = (process.env.CHAT_ENFORCE_ORIGIN ?? "1").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return true;
}

export function ensureAllowedOrigin(req: FastifyRequest): OriginCheckResult {
  if (!getEnforceOriginCheck()) return { ok: true };

  const allowed = getAllowedOrigins();
  if (allowed.includes("*")) return { ok: true };

  const allowedSet = new Set(allowed.map((value) => normalizeOrigin(value)).filter(Boolean));
  if (allowedSet.size === 0) {
    return {
      ok: false,
      code: 500,
      error: "server_misconfigured",
      message: "Invalid CHAT_ALLOWED_ORIGINS/CORS_ORIGINS configuration.",
    };
  }

  const origin = normalizeOrigin(req.headers.origin as string | undefined);
  if (origin && allowedSet.has(origin)) return { ok: true };

  const refererRaw = String(req.headers.referer ?? "").trim();
  const refererOrigin = normalizeOrigin(refererRaw);
  if (refererOrigin && allowedSet.has(refererOrigin)) return { ok: true };

  return {
    ok: false,
    code: 403,
    error: "forbidden_origin",
    message: "Request origin is not allowed for this widget.",
  };
}
