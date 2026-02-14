import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { retrieveTopK } from "../rag/retrieve.js";
import { buildStrictPrompt } from "../rag/prompt.js";
import { askLlm, getUiChatModels } from "../rag/llm.js";
import { getDefaultEmbedMode, getUiEmbedModes, type EmbedMode } from "../ingest/embed.js";

const ChatIn = z.object({
  question: z.string().min(3).max(2000),
  conversation_id: z.string().optional(),
  model: z.string().min(2).max(120).optional(),
  embed_provider: z.string().min(2).max(120).optional(),
});

export async function chatRoutes(app: FastifyInstance) {
  app.get("/v1/models", async () => {
    const models = getUiChatModels();
    const current = process.env.GEMINI_CHAT_MODEL ?? models[0] ?? "";
    const embedModes = getUiEmbedModes();
    const currentEmbed = getDefaultEmbedMode();
    return {
      provider: "gemini",
      current,
      models,
      embed_providers: embedModes,
      current_embed_provider: currentEmbed,
      providers: ["gemini"],
      models_by_provider: { gemini: models },
      current_by_provider: { gemini: current },
    };
  });

  app.post("/v1/chat", async (req, reply) => {
    const parsed = ChatIn.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        details: parsed.error.flatten(),
      });
    }

    const { question, model: requestedModel, embed_provider: embedProviderRaw } = parsed.data;
    const requested = requestedModel?.trim();
    const allowedModels = getUiChatModels();
    const selectedModel =
      requested && allowedModels.includes(requested) ? requested : undefined;
    const allowedEmbedModes = getUiEmbedModes();
    const requestedEmbedMode = embedProviderRaw?.trim().toLowerCase();
    const selectedEmbedMode = (
      requestedEmbedMode && allowedEmbedModes.includes(requestedEmbedMode as EmbedMode)
        ? requestedEmbedMode
        : getDefaultEmbedMode()
    ) as EmbedMode;

    let top: Awaited<ReturnType<typeof retrieveTopK>>;
    try {
      top = await retrieveTopK(question, { embedMode: selectedEmbedMode });
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (
        msg.includes("Embedding request timeout") ||
        msg.includes("Gemini embeddings error") ||
        msg.includes("Hugging Face embeddings error") ||
        msg.includes("Embedding dimension mismatch") ||
        msg.includes("fetch failed")
      ) {
        return {
          answer:
            "No pude consultar el servicio de embeddings en este momento.\n\n" +
            "Revisa tu configuración de embeddings: si usas Gemini, valida GEMINI_API_KEY; si usas Hugging Face, valida HF_API_TOKEN/HF_EMBED_URL. Si cambiaste proveedor, vuelve a generar vectors.json con ese mismo proveedor.",
          sources: [],
          confidence: "low",
        } as const;
      }
      throw err;
    }

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

    const prompt = buildStrictPrompt({
      question,
      context,
    });

    let answer: string;

    try {
      answer = await askLlm(prompt, { model: selectedModel });
    } catch (err: any) {
      const msg = String(err?.message ?? err);

      if (
        msg.includes("fetch failed") ||
        msg.includes("LLM request timeout") ||
        msg.includes("Gemini chat error") ||
        msg.toLowerCase().includes("model")
      ) {
        return {
          answer:
            "No pude consultar Gemini en este momento.\n\n" +
            "Aun así, encontré información relacionada en la base de conocimiento. Revisa estas fuentes:\n" +
            sources.map((s) => `- ${s.title}: ${s.url}`).join("\n"),
          sources,
          confidence: "low",
        } as const;
      }

      throw err;
    }

    const confidence =
      topScore >= 0.85 ? "high" : topScore >= 0.8 ? "medium" : "low";

    return {
      answer,
      sources,
      confidence,
    } as const;
  });
}
