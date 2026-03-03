export function buildStrictPrompt(opts: {
  question: string;
  context: string;
  conversationHistory?: string;
}) {
  const { question, context, conversationHistory } = opts;
  const historyBlock = conversationHistory
    ? `
CONTEXTO DE CONVERSACION PREVIA (solo para continuidad; no inventar datos nuevos):
${conversationHistory}
`
    : "";

  return `
Eres un asistente de soporte de Boxful.

REGLAS (estrictas):
- Responder SOLO usando la información del CONTEXTO.
- Usa la conversación previa solo para mantener continuidad y referencias (por ejemplo: "eso", "lo anterior").
- Si el CONTEXTO no contiene la respuesta, decir explícitamente que no hay información suficiente en la base de conocimiento.
- No inventar pasos, pantallas, endpoints, ni comportamientos.
- Responder en español (LatAm), claro y directo.

${historyBlock}
CONTEXTO (extractos de la base de conocimiento):
${context}

PREGUNTA:
${question}

RESPUESTA:
`.trim();
}
