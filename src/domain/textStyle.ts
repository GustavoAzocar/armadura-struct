import type { Primitive, TextFont } from './types';

/**
 * Typography shared by canvas, PDF, sheets and DXF. Each output resolves the
 * requested family explicitly; nothing is converted into geometry.
 */
export const TEXT_FONT_FAMILIES = [
  {
    id: 'sans',
    label: 'Sans (Helvetica/Arial)',
    css: 'Helvetica, Arial, "Liberation Sans", sans-serif',
    pdf: 'helvetica',
    dxf: { file: 'arial.ttf', family: 'Arial' },
  },
  {
    id: 'serif',
    label: 'Serif (Times)',
    css: '"Times New Roman", Times, "Liberation Serif", serif',
    pdf: 'times',
    dxf: { file: 'times.ttf', family: 'Times New Roman' },
  },
  {
    id: 'mono',
    label: 'Mono (Courier)',
    css: '"Courier New", Courier, "Liberation Mono", monospace',
    pdf: 'courier',
    dxf: { file: 'cour.ttf', family: 'Courier New' },
  },
] as const;
export type PdfFontFamily = (typeof TEXT_FONT_FAMILIES)[number]['pdf'];
export const DEFAULT_TEXT_FONT: TextFont = {
  family: 'sans',
  weight: 'normal',
  style: 'normal',
};
export const MAX_FREE_TEXT_LENGTH = 500;
const FAMILY = /^[\p{L}\p{N} ._-]{1,64}$/u;
/**
 * Characters every current output carries unchanged: printable ASCII and
 * Latin-1 (accents, Ø, ±, °, ², µ). Dashes and quotes outside Latin-1 are
 * refused instead of being silently rewritten by the paper/PDF path.
 */
export function unsupportedTextChars(text: string): string[] {
  const out = new Set<string>();
  for (const c of text.replace(/%%c/gi, 'Ø')) {
    const n = c.codePointAt(0)!;
    if (!((n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff))) out.add(c);
  }
  return [...out];
}
/** DXF TEXT treats these characters as controls or markup. */
export function hasReservedDxfText(text: string): boolean {
  return /[\x00-\x1f\x7f]|%%|\\U\+[\dA-F]{4}/iu.test(text);
}

export function validateTextFont(font: unknown): TextFont {
  const f = font as Partial<TextFont> | undefined;
  if (
    !f ||
    typeof f.family !== 'string' ||
    !FAMILY.test(f.family) ||
    f.family.trim() !== f.family ||
    !['normal', 'bold'].includes(f.weight as string) ||
    !['normal', 'italic'].includes(f.style as string)
  )
    throw new Error(
      'Fonte inválida: família de 1 a 64 letras, números, espaço, ponto, hífen ou sublinhado; peso normal/negrito; estilo normal/itálico.',
    );
  return { family: f.family, weight: f.weight!, style: f.style! };
}
/** Single-line content that the canvas, PDF and DXF can carry without loss. */
export function validateTextContent(text: unknown): string {
  if (typeof text !== 'string' || !text.trim())
    throw new Error('Informe o conteúdo do texto.');
  if (text.length > MAX_FREE_TEXT_LENGTH)
    throw new Error(`Texto: até ${MAX_FREE_TEXT_LENGTH} caracteres.`);
  if (/[\r\n\t]/.test(text))
    throw new Error('Texto livre tem uma linha; quebras não são suportadas.');
  const bad = unsupportedTextChars(text);
  if (bad.length)
    throw new Error(
      `Caractere sem suporte nos documentos de impressão: ${bad.join(' ')}. Use letras acentuadas, Ø, ±, ° e símbolos do conjunto Latin-1 (hífen comum no lugar de travessão).`,
    );
  return text;
}
export function validateFreeTextPrimitive(p: Primitive) {
  validateTextContent(p.text);
  if (
    p.textHeight === undefined ||
    !Number.isFinite(p.textHeight) ||
    p.textHeight <= 0 ||
    p.textHeight > 1e6
  )
    throw new Error('Altura do texto deve ser positiva e finita.');
  if (p.textRotation !== undefined && !Number.isFinite(p.textRotation))
    throw new Error('Rotação do texto inválida.');
  if (p.textFont) validateTextFont(p.textFont);
  if (
    p.textPaperScale !== undefined &&
    (!Number.isFinite(p.textPaperScale) ||
      p.textPaperScale < 1 ||
      p.textPaperScale > 10000)
  )
    throw new Error('Escala de papel do texto: 1:1 a 1:10000.');
}
const known = (family: string) =>
  TEXT_FONT_FAMILIES.find((f) => f.id === family);
export type ResolvedTextFont = {
  requested: TextFont;
  css: string;
  cssWeight: 400 | 700;
  cssStyle: 'normal' | 'italic';
  pdf: PdfFontFamily;
  pdfStyle: 'normal' | 'bold' | 'italic' | 'bolditalic';
  dxf: { style: string; file: string; family: string; flags: number };
  /** Families the PDF base fonts do not have are drawn with Helvetica. */
  pdfSubstituted: boolean;
  label: string;
};
export function resolveTextFont(font?: TextFont): ResolvedTextFont {
  const f = font ?? DEFAULT_TEXT_FONT,
    k = known(f.family);
  const pdfStyle =
    f.weight === 'bold'
      ? f.style === 'italic'
        ? 'bolditalic'
        : 'bold'
      : f.style === 'italic'
        ? 'italic'
        : 'normal';
  const family = k?.dxf.family ?? f.family;
  return {
    requested: f,
    css: k ? k.css : `"${f.family.replace(/"/g, '')}", ${known('sans')!.css}`,
    cssWeight: f.weight === 'bold' ? 700 : 400,
    cssStyle: f.style,
    pdf: k?.pdf ?? 'helvetica',
    pdfStyle,
    dxf: {
      style:
        `AS_${family}${f.weight === 'bold' ? '_B' : ''}${f.style === 'italic' ? '_I' : ''}`
          .toUpperCase()
          .replace(/[^A-Z0-9_-]/g, '_')
          .slice(0, 255),
      file: k?.dxf.file ?? `${f.family}.ttf`,
      family,
      // TrueType style flags used by AutoCAD's ACAD XDATA on STYLE records.
      flags:
        (f.style === 'italic' ? 0x1000000 : 0) |
        (f.weight === 'bold' ? 0x2000000 : 0),
    },
    pdfSubstituted: !k,
    label: `${k?.label ?? f.family}${f.weight === 'bold' ? ' · negrito' : ''}${f.style === 'italic' ? ' · itálico' : ''}`,
  };
}
/**
 * Explicit substitution notice. `available` answers whether this system has
 * the family (document.fonts.check in the browser); omitted means unknown.
 */
export function textFontNotice(
  font: TextFont | undefined,
  available?: (family: string) => boolean,
): string {
  if (!font || known(font.family)) return '';
  const screen =
    available && !available(font.family)
      ? ` Não encontrada neste sistema: a tela usa Sans (Helvetica/Arial).`
      : '';
  return `Fonte "${font.family}":${screen} PDF usa Helvetica; o DXF grava o nome "${font.family}" e o leitor CAD substitui se não a tiver.`;
}
/** SVG attributes for a typed text; untyped texts keep the inherited UI font. */
export function svgTextFont(p: Pick<Primitive, 'textFont'>) {
  if (!p.textFont) return {};
  const f = resolveTextFont(p.textFont);
  return {
    fontFamily: f.css,
    fontWeight: f.cssWeight,
    fontStyle: f.cssStyle,
    style: { fontSynthesis: 'weight style' },
  };
}
/** Hit test against the approximate (Helvetica-metric) text box, in model units. */
export function insideTextBox(
  at: { x: number; y: number },
  corners: { x: number; y: number }[],
  tolerance = 0,
) {
  if (corners.length < 4) return false;
  const [a, b, , d] = corners;
  const u = { x: b.x - a.x, y: b.y - a.y },
    v = { x: d.x - a.x, y: d.y - a.y };
  const lu = Math.hypot(u.x, u.y),
    lv = Math.hypot(v.x, v.y);
  if (!(lu > 0) || !(lv > 0)) return false;
  const w = { x: at.x - a.x, y: at.y - a.y };
  const s = (w.x * u.x + w.y * u.y) / lu,
    t = (w.x * v.x + w.y * v.y) / lv;
  return (
    s >= -tolerance &&
    s <= lu + tolerance &&
    t >= -tolerance &&
    t <= lv + tolerance
  );
}
