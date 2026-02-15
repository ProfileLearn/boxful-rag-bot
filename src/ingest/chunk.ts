function getEnvNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function chunkText(text: string): string[] {
  const rawSize = getEnvNum("CHUNK_SIZE_CHARS", 950);
  const rawOverlap = getEnvNum("CHUNK_OVERLAP_CHARS", 200);
  const size = Math.max(1, Math.trunc(rawSize));
  const overlap = Math.min(
    Math.max(0, Math.trunc(rawOverlap)),
    Math.max(0, size - 1),
  );

  const cleaned = text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned) return [];
  if (cleaned.length <= size) return [cleaned];

  const chunks: string[] = [];
  let start = 0;

  while (start < cleaned.length) {
    const end = Math.min(start + size, cleaned.length);
    const slice = cleaned.slice(start, end).trim();
    if (slice) chunks.push(slice);

    if (end === cleaned.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}
