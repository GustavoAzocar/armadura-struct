import type { Point, Primitive } from './types';
import { rotate } from './geometry';
import { jsPDF } from 'jspdf';
import { resolveTextFont } from './textStyle';
export type PaperPrimitive = Primitive & {
  textAlign?: 'left' | 'center' | 'right';
};
export const PAPER_FONT = 'Helvetica, Arial, sans-serif';
// Standard Helvetica advance widths (1/1000 em), also used by the PDF base font.
const advances = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];
export function paperText(value: string) {
  return value
    .replace(/%%c/g, 'Ø')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[–—−]/g, '-');
}
export function paperTextWidth(value: string, height: number) {
  return [...paperText(value)].reduce((sum, char) => {
    const base = char.normalize('NFD')[0],
      code = base.charCodeAt(0);
    const width =
      char === 'Ø'
        ? 778
        : char === 'ø'
          ? 556
          : char === '·'
            ? 278
            : char === '°'
              ? 400
              : char === '×'
                ? 584
                : (advances[code - 32] ?? 1000);
    return sum + (width * height) / 1000;
  }, 0);
}
export function wrapPaperText(value: string, height: number, width: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of paperText(value).split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && paperTextWidth(candidate, height) > width) {
      lines.push(line);
      line = '';
    }
    for (const char of word) {
      if (line && paperTextWidth(line + char, height) > width) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
    line += ' ';
  }
  if (line.trim()) lines.push(line.trim());
  return lines.map((s) => s.trim());
}
export function paperPrimitiveBounds(p: PaperPrimitive): Point[] {
  if (!p.text || !p.points.length) return p.points;
  const h = p.textHeight ?? 2.5,
    w = p.textFont
      ? outputTextWidth(p.text, h, p.textFont)
      : paperTextWidth(p.text, h),
    anchor = p.points[0];
  const align =
    p.textAlign ??
    (['COTAS', 'DISTRIBUICAO'].includes(p.role ?? p.layer) ? 'center' : 'left');
  const left = align === 'center' ? -w / 2 : align === 'right' ? -w : 0;
  return [
    { x: left, y: -h * 0.25 },
    { x: left + w, y: -h * 0.25 },
    { x: left + w, y: h },
    { x: left, y: h },
  ].map((v) => {
    const q = rotate(v, p.textRotation ?? 0);
    return { x: anchor.x + q.x, y: anchor.y + q.y };
  });
}

let measurePdf: jsPDF | undefined;
function outputTextWidth(
  text: string,
  height: number,
  font: NonNullable<Primitive['textFont']>,
) {
  measurePdf ??= new jsPDF();
  const resolved = resolveTextFont(font);
  measurePdf.setFont(resolved.pdf, resolved.pdfStyle);
  return measurePdf.getStringUnitWidth(text) * height;
}
