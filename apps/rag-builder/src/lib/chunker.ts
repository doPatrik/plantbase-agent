// Heading-tudatos markdown-chunkoló overlap-pel (SP2).
// 1) szegmentálás markdown-headingek mentén, heading_path breadcrumb-bel
// 2) túl nagy szegmens hard-splitje bekezdés-, majd szóhatáron
// 3) greedy pakolás target token-méretig (apró szekciók összevonása)
// 4) záró, minMerge alatti csonk visszaolvasztása
// 5) dokumentumon belüli overlap két egymást követő chunk közt

import { estimateTokens } from './token-estimate.js';

export interface Chunk {
  readonly chunk_index: number;
  readonly content: string;
  readonly heading_path: string | null;
  readonly token_count: number;
}

export interface ChunkOptions {
  readonly target?: number;
  readonly overlap?: number;
  readonly minMerge?: number;
  readonly hardSplit?: number;
}

const DEFAULTS = {
  target: 512,
  overlap: 64,
  minMerge: 128,
  hardSplit: 800,
} as const;

interface Segment {
  readonly heading_path: string | null;
  readonly text: string;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/** Body → szekciók markdown-headingek mentén, heading_path breadcrumb-bel. */
function segment(body: string): Segment[] {
  const stack: string[] = [];
  const segments: Segment[] = [];
  let currentPath: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text.length > 0) segments.push({ heading_path: currentPath, text });
    buffer = [];
  };

  for (const line of body.split(/\r?\n/)) {
    const match = HEADING_RE.exec(line);
    if (match) {
      flush();
      const level = match[1].length;
      stack.length = level - 1; // a mélyebb szintek eldobása
      stack[level - 1] = match[2].trim();
      const path = stack.filter((s) => Boolean(s)).join(' > ');
      currentPath = path.length > 0 ? path : null;
    } else {
      buffer.push(line);
    }
  }
  flush();
  return segments;
}

/** Szavankénti darabolás ~target token méretű darabokra (végső mentőháló). */
function splitByWords(text: string, target: number): string[] {
  const wordList = text.split(/\s+/).filter((w) => w.length > 0);
  const pieces: string[] = [];
  let current: string[] = [];
  for (const word of wordList) {
    current.push(word);
    if (estimateTokens(current.join(' ')) >= target) {
      pieces.push(current.join(' '));
      current = [];
    }
  }
  if (current.length > 0) pieces.push(current.join(' '));
  return pieces;
}

/** hardSplit fölötti szegmens tördelése bekezdés-, majd szóhatáron. */
function splitLarge(
  seg: Segment,
  hardSplit: number,
  target: number,
): Segment[] {
  if (estimateTokens(seg.text) <= hardSplit) return [seg];
  const out: Segment[] = [];
  let current: string[] = [];

  const flush = () => {
    const text = current.join('\n\n').trim();
    if (text.length > 0) out.push({ heading_path: seg.heading_path, text });
    current = [];
  };

  for (const para of seg.text.split(/\n{2,}/)) {
    if (estimateTokens(para) > hardSplit) {
      flush();
      for (const piece of splitByWords(para, target)) {
        out.push({ heading_path: seg.heading_path, text: piece });
      }
      continue;
    }
    current.push(para);
    if (estimateTokens(current.join('\n\n')) >= target) flush();
  }
  flush();
  return out;
}

interface PackedChunk {
  text: string;
  heading_path: string | null;
}

/** Greedy pakolás: szegmensek chunkokba target token-méretig. */
function pack(segments: readonly Segment[], target: number): PackedChunk[] {
  const chunks: PackedChunk[] = [];
  let current: string[] = [];
  let path: string | null = null;

  const flush = () => {
    const text = current.join('\n\n').trim();
    if (text.length > 0) chunks.push({ text, heading_path: path });
    current = [];
    path = null;
  };

  for (const seg of segments) {
    if (current.length === 0) path = seg.heading_path;
    current.push(seg.text);
    if (estimateTokens(current.join('\n\n')) >= target) flush();
  }
  flush();
  return chunks;
}

/** Záró, minMerge alatti csonk visszaolvasztása az előző chunkba. */
function mergeTrailingSmall(
  chunks: PackedChunk[],
  minMerge: number,
): PackedChunk[] {
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1];
    if (estimateTokens(last.text) < minMerge) {
      const prev = chunks[chunks.length - 2];
      chunks[chunks.length - 2] = {
        text: `${prev.text}\n\n${last.text}`,
        heading_path: prev.heading_path,
      };
      chunks.pop();
    }
  }
  return chunks;
}

/** Dokumentumon belüli overlap: az előző chunk farkának ~overlap tokene a következő elejére. */
function withOverlapText(
  chunks: readonly PackedChunk[],
  overlap: number,
): string[] {
  if (overlap <= 0) return chunks.map((c) => c.text);
  const overlapChars = overlap * 4;
  return chunks.map((chunk, i) => {
    if (i === 0) return chunk.text;
    const prev = chunks[i - 1].text;
    let tail = prev.slice(Math.max(0, prev.length - overlapChars));
    const firstSpace = tail.indexOf(' '); // ne vágjunk szó közepén
    if (firstSpace > 0) tail = tail.slice(firstSpace + 1);
    tail = tail.trim();
    return tail.length > 0 ? `${tail}\n\n${chunk.text}` : chunk.text;
  });
}

/** Nyers body → chunkok (heading-tudatos + overlap). */
export function chunkMarkdown(
  body: string,
  options: ChunkOptions = {},
): Chunk[] {
  const { target, overlap, minMerge, hardSplit } = { ...DEFAULTS, ...options };
  const segments = segment(body).flatMap((s) =>
    splitLarge(s, hardSplit, target),
  );
  const packed = mergeTrailingSmall(pack(segments, target), minMerge);
  const contents = withOverlapText(packed, overlap);
  return contents.map((content, i) => ({
    chunk_index: i,
    content,
    heading_path: packed[i].heading_path,
    token_count: estimateTokens(content),
  }));
}
