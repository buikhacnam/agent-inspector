// Char-based chunker. ~800 tokens ≈ 3200 chars, 100 token overlap ≈ 400 chars.
// Splits on paragraph boundaries first, then merges paragraphs up to the target size.
// Single oversized paragraphs are hard-split with overlap.

export interface Chunk {
  text: string;
  position: number;
}

const TARGET = 3200;
const OVERLAP = 400;

export function chunkText(input: string): Chunk[] {
  const clean = normalise(input);
  if (!clean) return [];

  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const out: Chunk[] = [];
  let buf = '';

  const flush = () => {
    const t = buf.trim();
    if (t) out.push({ text: t, position: out.length });
    buf = '';
  };

  for (const p of paragraphs) {
    if (p.length > TARGET) {
      flush();
      for (const piece of hardSplit(p)) out.push({ text: piece, position: out.length });
      continue;
    }
    if (buf.length + p.length + 2 > TARGET) flush();
    buf = buf ? `${buf}\n\n${p}` : p;
  }
  flush();

  return out;
}

function normalise(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

function hardSplit(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    out.push(s.slice(i, i + TARGET).trim());
    if (i + TARGET >= s.length) break;
    i += TARGET - OVERLAP;
  }
  return out;
}
