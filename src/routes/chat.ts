import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { retrieveTopK } from "../rag/retrieve.js";
import { buildStrictPrompt } from "../rag/prompt.js";
import {
  askLlm,
  getDefaultLlmProvider,
  getUiChatModels,
  getUiProviders,
} from "../rag/llm.js";

const ChatIn = z.object({
  question: z.string().min(3).max(2000),
  conversation_id: z.string().optional(),
  provider: z.enum(["ollama", "gemini"]).optional(),
  model: z.string().min(2).max(120).optional(),
});

export async function chatRoutes(app: FastifyInstance) {
  app.get("/v1/models", async () => {
    const defaultProvider = getDefaultLlmProvider();
    const providers = getUiProviders();

    const modelsByProvider = Object.fromEntries(
      providers.map((provider) => [provider, getUiChatModels(provider)]),
    );

    const currentByProvider = {
      ollama: process.env.OLLAMA_CHAT_MODEL ?? modelsByProvider.ollama?.[0] ?? "",
      gemini: process.env.GEMINI_CHAT_MODEL ?? modelsByProvider.gemini?.[0] ?? "",
    };

    const models = modelsByProvider[defaultProvider] ?? [];
    const current = currentByProvider[defaultProvider] ?? models[0] ?? "";

    return {
      provider: defaultProvider,
      current,
      models,
      providers,
      models_by_provider: modelsByProvider,
      current_by_provider: currentByProvider,
    };
  });

  app.post("/v1/chat", async (req, reply) => {
    const defaultProvider = getDefaultLlmProvider();
    const enabledProviders = getUiProviders();
    const parsed = ChatIn.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten(),
      });
    }

    const { question, provider: requestedProvider, model: requestedModel } = parsed.data;
    const provider =
      requestedProvider && enabledProviders.includes(requestedProvider)
        ? requestedProvider
        : defaultProvider;
    const requested = requestedModel?.trim();
    const allowedModels = getUiChatModels(provider);
    const selectedModel =
      requested && allowedModels.includes(requested) ? requested : undefined;

    // 1) Recuperar contexto
    let top: Awaited<ReturnType<typeof retrieveTopK>>;
    try {
      top = await retrieveTopK(question);
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (
        msg.includes("Embedding request timeout") ||
        msg.includes("Ollama embeddings error") ||
        msg.includes("Gemini embeddings error") ||
        msg.includes("ECONNREFUSED") ||
        msg.includes("fetch failed")
      ) {
        return {
          answer:
            "No pude consultar el servicio de embeddings en este momento.\n\n" +
            "Si usas Ollama, verifica que esté corriendo. Si usas Gemini, revisa GEMINI_API_KEY. También puedes usar EMBED_PROVIDER=local para evitar depender de embeddings remotos.",
          sources: [],
          confidence: "low",
        } as const;
      }
      throw err;
    }

    // Regla estricta: si no hay evidencia suficiente -> no inventar
    if (!top.ok) {
      return {
        answer:
          "No encontré información suficiente en la base de conocimiento para responder esa consulta.\n\n" +
          "Si quieres, puedes crear un ticket de soporte y te ayudamos.",
        sources: [],
        confidence: "low",
      } as const;
    }

    const { context, sources, topScore } = top;

    // 2) Modo sin LLM (útil para debug del RAG)
    if (process.env.NO_LLM === "1") {
      return {
        answer:
          "Encontré información relacionada en la base de conocimiento, pero el modo IA está desactivado (NO_LLM=1).\n\n" +
          "Fuentes:\n" +
          sources.map((s) => `- ${s.title}: ${s.url}`).join("\n"),
        sources,
        confidence: "low",
      } as const;
    }

    // 3) Armar prompt estricto
    const prompt = buildStrictPrompt({
      question,
      context,
    });

    // 4) Llamar al modelo local con manejo de errores
    let answer: string;

    try {
      answer = await askLlm(prompt, { provider, model: selectedModel });
    } catch (err: any) {
      const msg = String(err?.message ?? err);

      if (
        (provider === "ollama" || provider === "gemini") &&
        (
          msg.includes("ECONNREFUSED") ||
          msg.includes("fetch failed") ||
          msg.includes("LLM request timeout") ||
          msg.includes("Ollama chat error") ||
          msg.includes("Gemini chat error") ||
          msg.toLowerCase().includes("model")
        )
      ) {
        return {
          answer:
            "No pude consultar el modelo de IA configurado en este momento.\n\n" +
            "Aun así, encontré información relacionada en la base de conocimiento. Revisa estas fuentes:\n" +
            sources.map((s) => `- ${s.title}: ${s.url}`).join("\n"),
          sources,
          confidence: "low",
        } as const;
      }

      if (msg.includes("Unsupported LLM_PROVIDER")) {
        return {
          answer:
            "El proveedor de IA configurado no es válido. Usa LLM_PROVIDER=ollama o LLM_PROVIDER=gemini, o activa NO_LLM=1.\n\n" +
            "Mientras tanto, revisa estas fuentes:\n" +
            sources.map((s) => `- ${s.title}: ${s.url}`).join("\n"),
          sources,
          confidence: "low",
        } as const;
      }

      // Otros errores: mantener 500 para que se detecte y se arregle
      throw err;
    }

    // 5) Confianza (MVP): depende del score del mejor chunk
    const confidence =
      topScore >= 0.85 ? "high" : topScore >= 0.8 ? "medium" : "low";

    return {
      answer,
      sources,
      confidence,
    } as const;
  });
}
