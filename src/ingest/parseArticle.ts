import { parse } from "node-html-parser";

export type ParsedArticle = {
  title: string;
  bodyText: string;
};

export function parseArticleHtml(html: string): ParsedArticle | null {
  const root = parse(html);

  // Title: intentar h1, fallback title
  const h1 = root.querySelector("h1")?.text?.trim();
  const docTitle = root.querySelector("title")?.text?.trim();
  const title = (h1 || docTitle || "Artículo").replace(/\s+/g, " ").trim();

  for (const noisy of root.querySelectorAll("script,style,noscript,svg")) {
    noisy.remove();
  }

  // Body: priorizar contenedores típicos de Freshdesk
  const candidates = [
    root.querySelector(".solution-article-content"),
    root.querySelector(".article-description"),
    root.querySelector(".solution-article"),
    root.querySelector(".article-content"),
    root.querySelector(".kb-article"),
    root.querySelector("article"),
    root.querySelector("main"),
  ].filter(Boolean) as any[];

  const best = candidates[0] ?? root;

  for (const noisy of best.querySelectorAll("nav,aside,footer,form,button")) {
    noisy.remove();
  }

  // Extraer texto, limpiar
  const bodyText = (best?.text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!bodyText || bodyText.length < 120) return null;

  return { title, bodyText };
}
