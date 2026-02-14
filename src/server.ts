// src/server.ts  (solo para asegurar dotenv; si ya lo tenías, dejalo igual)
import "dotenv/config";

import Fastify from "fastify";
// @ts-ignore
import cors from "@fastify/cors";
// @ts-ignore
import helmet from "@fastify/helmet";
// @ts-ignore
import rateLimit from "@fastify/rate-limit";
import { healthRoutes } from "./routes/health.js";
import { chatRoutes } from "./routes/chat.js";
import { uiRoutes } from "./routes/ui.js";
import { loadVectorsIntoMemory } from "./store/vectors.js";

function getEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function main() {
  const app = Fastify({
    logger: true,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet);

  const originsRaw = getEnv("CORS_ORIGINS", "*");
  const origins = originsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
      if (!origin) return cb(null, true);
      if (origins.includes("*")) return cb(null, true);
      cb(null, origins.includes(origin));
    },
  });

  await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });

  await loadVectorsIntoMemory();

  await app.register(healthRoutes);
  await app.register(chatRoutes);
  await app.register(uiRoutes);

  const port = Number(getEnv("PORT", "3000"));
  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
