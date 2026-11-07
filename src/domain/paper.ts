import { plotPrimitives } from './plotting';
import { layerProjection } from './layerProfiles';
import { detailTitle } from './detailQuantities';
import type { Point, Primitive, Project, Sheet, SheetPlacement } from './types';
import { bounds, rotate } from './geometry';
import { detailEditorView } from './detailEditing';
import { drawingPrimitives } from './drawingPrimitives';
import { sheetSize, validateSheetLayout } from './paperFormat';

export type PaperRect = { x: number; y: number; width: number; height: number };
export type PaperPrimitive = Primitive & {
  textAlign?: 'left' | 'center' | 'right';
};
export type PaperIssue = { code: string; message: string; viewId?: string };
export type PaperView = {
  placement: SheetPlacement;
  lines: PaperPrimitive[];
  content: PaperPrimitive[];
  frame: Point[];
};
export type PaperComposition = {
  sheet: Sheet;
  size: { width: number; height: number };
  useful: PaperRect;
  seal?: PaperRect;
  decorations: PaperPrimitive[];
  views: PaperView[];
  issues: PaperIssue[];
};
export const PAPER_FONT = 'Helvetica, Arial, sans-serif';
export const paperInk = (layer: string) =>
  layer === 'MASCARA' ? '#8992a4' : layer === 'SELO' ? '#3448d1' : '#263044';
export const paperLineWidth = (layer: string) =>
  ['MARGEM', 'SELO'].includes(layer) ? 0.25 : 0.18;
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
    w = paperTextWidth(p.text, h),
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
export function modelToPaper(point: Point, view: SheetPlacement): Point {
  const v = rotate(
    {
      x: (point.x - view.modelOrigin.x) / view.scale,
      y: (point.y - view.modelOrigin.y) / view.scale,
    },
    view.rotation,
  );
  return { x: view.origin.x + v.x, y: view.origin.y + v.y };
}
export function localToPaper(point: Point, view: SheetPlacement): Point {
  const q = rotate(point, view.rotation);
  return { x: view.origin.x + q.x, y: view.origin.y + q.y };
}
function rectPoints(r: PaperRect) {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}
export function usefulArea(sheet: Sheet): PaperRect {
  const size = sheetSize(sheet),
    m = sheet.margins;
  return {
    x: m.left,
    y: m.bottom,
    width: size.width - m.left - m.right,
    height: size.height - m.top - m.bottom,
  };
}
export function sealArea(sheet: Sheet): PaperRect | undefined {
  if (!sheet.seal.enabled) return;
  const u = usefulArea(sheet);
  return {
    x: u.x + u.width - sheet.seal.width,
    y: u.y,
    width: sheet.seal.width,
    height: sheet.seal.height,
  };
}
export const scaleLabel = (n: number) =>
  `1:${Number(n.toFixed(4)).toLocaleString('pt-BR', { maximumFractionDigits: 4, useGrouping: false })}`;
function sourceLines(project: Project, view: SheetPlacement) {
  const drawing = project.hierarchy.drawings.find(
    (d) => d.id === view.drawingId,
  );
  if (!drawing) throw new Error('Desenho da vista inexistente.');
  return drawingPrimitives(
    layerProjection(
      detailEditorView(project, drawing.detailId),
      `view:${view.id}`,
      'visible',
    ),
    project,
    { minTextHeight: view.textHeight * view.scale },
  );
}
function localContent(
  project: Project,
  view: SheetPlacement,
): PaperPrimitive[] {
  return plotPrimitives(project, sourceLines(project, view)).map((line) => ({
    ...line,
    text: line.text ? paperText(line.text) : undefined,
    points: line.points.map((p) => ({
      x: (p.x - view.modelOrigin.x) / view.scale,
      y: (p.y - view.modelOrigin.y) / view.scale,
    })),
    textHeight: line.text
      ? Math.max(view.textHeight, (line.textHeight ?? 40) / view.scale)
      : undefined,
  }));
}
function viewTitle(project: Project, view: SheetPlacement) {
  const drawing = project.hierarchy.drawings.find(
    (d) => d.id === view.drawingId,
  )!;
  const title = detailTitle(project, drawing.detailId);
  return view.title
    ? project.hierarchy.details.find((d) => d.id === drawing.detailId)
        ?.repetition
      ? `${view.title} · ${title}`
      : view.title
    : title;
}
function titleLines(project: Project, view: SheetPlacement): PaperPrimitive[] {
  const height = Math.max(3, view.textHeight + 0.5);
  return wrapPaperText(
    `${viewTitle(project, view)} | Escala ${scaleLabel(view.scale)}`,
    height,
    Math.max(1, view.frame.width - 6),
  ).map((text, i) => ({
    layer: 'TITULO_VISTA',
    points: [{ x: 3, y: view.frame.height - 4 - i * height * 1.4 }],
    text,
    textHeight: height,
  }));
}
function transformLocal(
  line: PaperPrimitive,
  view: SheetPlacement,
): PaperPrimitive {
  return {
    ...line,
    points: line.points.map((p) => localToPaper(p, view)),
    textRotation: (line.textRotation ?? 0) + view.rotation,
  };
}
function contentBounds(lines: PaperPrimitive[]) {
  const points = lines.flatMap(paperPrimitiveBounds);
  return points.length ? bounds(points) : { x: 0, y: 0, width: 0, height: 0 };
}
/** Center the source within the frame, keeping the explicit scale and paper origin. */
export function alignPlacement(project: Project, id: string): Project {
  const view = project.hierarchy.placements.find((v) => v.id === id);
  if (!view) throw new Error('Vista inexistente.');
  const zero = { ...view, modelOrigin: { x: 0, y: 0 } },
    box = contentBounds(localContent(project, zero));
  const titles = titleLines(project, view),
    titleHeight = Math.max(3, view.textHeight + 0.5) * 1.4 * titles.length + 5;
  const width = view.frame.width - 6,
    height = view.frame.height - titleHeight - 3;
  const x = 3 + Math.max(0, (width - box.width) / 2),
    y = 3 + Math.max(0, (height - box.height) / 2);
  const modelOrigin = {
    x: (box.x - x) * view.scale,
    y: (box.y - y) * view.scale,
  };
  return {
    ...project,
    hierarchy: {
      ...project.hierarchy,
      placements: project.hierarchy.placements.map((v) =>
        v.id === id ? { ...v, modelOrigin } : v,
      ),
    },
  };
}
/** Explicit user command. Resizing paper or a frame never changes a view's scale. */
export function fitPlacement(project: Project, id: string): Project {
  const original = project.hierarchy.placements.find((v) => v.id === id);
  if (!original) throw new Error('Vista inexistente.');
  for (const scale of [
    1, 2, 5, 10, 20, 25, 50, 75, 100, 150, 200, 250, 500, 750, 1000, 2000, 5000,
    10000, 100000, 1000000,
  ]) {
    const view = { ...original, scale, modelOrigin: { x: 0, y: 0 } };
    const box = bounds(
      localContent(project, view).flatMap(paperPrimitiveBounds),
    );
    const titleHeight =
      Math.max(3, view.textHeight + 0.5) *
        1.4 *
        titleLines(project, view).length +
      5;
    if (
      box.width <= view.frame.width - 6 &&
      box.height <= view.frame.height - titleHeight - 3
    ) {
      const next = {
        ...project,
        hierarchy: {
          ...project.hierarchy,
          placements: project.hierarchy.placements.map((v) =>
            v.id === id ? view : v,
          ),
        },
      };
      return alignPlacement(next, id);
    }
  }
  throw new Error(
    'O conteúdo não cabe no quadro com textos legíveis. Aumente a vista ou reduza a altura dos textos.',
  );
}
function contained(points: Point[], rect: PaperRect) {
  const eps = 0.05;
  return points.every(
    (p) =>
      p.x >= rect.x - eps &&
      p.y >= rect.y - eps &&
      p.x <= rect.x + rect.width + eps &&
      p.y <= rect.y + rect.height + eps,
  );
}
function overlaps(a: Point[], b: Point[]) {
  if (!a.length || !b.length) return false;
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i],
        q = poly[(i + 1) % poly.length],
        axis = { x: -(q.y - p.y), y: q.x - p.x };
      const norm = Math.hypot(axis.x, axis.y);
      if (!norm) continue;
      const project = (points: Point[]) =>
          points.map((v) => (v.x * axis.x + v.y * axis.y) / norm),
        x = project(a),
        y = project(b);
      if (
        Math.max(...x) <= Math.min(...y) + 0.05 ||
        Math.max(...y) <= Math.min(...x) + 0.05
      )
        return false;
    }
  return true;
}
export function composeSheet(
  project: Project,
  sheetId: string,
): PaperComposition {
  const sheet = project.sheets.find((s) => s.id === sheetId);
  if (!sheet) throw new Error('Folha inexistente.');
  validateSheetLayout(sheet);
  const size = sheetSize(sheet),
    useful = usefulArea(sheet),
    seal = sealArea(sheet),
    issues: PaperIssue[] = [];
  const decorations: PaperPrimitive[] = [
    { layer: 'MARGEM', points: rectPoints(useful), closed: true },
  ];
  if (seal) {
    if (!contained(rectPoints(seal), useful))
      issues.push({
        code: 'seal-overflow',
        message:
          'A reserva do selo ultrapassa a área útil. Reduza suas dimensões ou aumente o papel.',
      });
    decorations.push({ layer: 'SELO', points: rectPoints(seal), closed: true });
    const labels = [
      `OPENSTRUCT / ARMADURASTRUCT`,
      project.name,
      sheet.name,
      `Rev. ${sheet.properties.revision} | ${project.author || 'Autor não informado'}`,
      sheet.properties.notes,
    ].filter(Boolean);
    let y = seal.y + seal.height - 5;
    for (const label of labels)
      for (const text of wrapPaperText(
        label,
        2.5,
        Math.max(1, seal.width - 6),
      )) {
        decorations.push({
          layer: 'SELO',
          text,
          textHeight: 2.5,
          points: [{ x: seal.x + 3, y }],
        });
        y -= 3.8;
      }
    if (y < seal.y + 1)
      issues.push({
        code: 'seal-text-overflow',
        message:
          'Os textos do selo não cabem na reserva. Aumente o selo ou reduza as notas.',
      });
  }
  const views: PaperView[] = project.hierarchy.placements
    .filter((v) => v.sheetId === sheetId)
    .map((placement) => {
      let content: PaperPrimitive[] = [];
      try {
        content = localContent(project, placement);
      } catch (error) {
        issues.push({
          code: 'source-error',
          viewId: placement.id,
          message:
            error instanceof Error
              ? error.message
              : 'Não foi possível representar o desenho desta vista.',
        });
      }
      const titles = titleLines(project, placement);
      const titleHeight =
        Math.max(3, placement.textHeight + 0.5) * 1.4 * titles.length + 5;
      const contentRect = {
        x: 3,
        y: 3,
        width: placement.frame.width - 6,
        height: placement.frame.height - titleHeight - 3,
      };
      if (
        contentRect.width <= 0 ||
        contentRect.height <= 0 ||
        !contained(content.flatMap(paperPrimitiveBounds), contentRect)
      )
        issues.push({
          code: 'view-overflow',
          viewId: placement.id,
          message: `${viewTitle(project, placement)}: conteúdo excede o quadro da vista. Ajuste a escala, o quadro ou a origem no modelo.`,
        });
      const frame = rectPoints({ x: 0, y: 0, ...placement.frame }).map((p) =>
        localToPaper(p, placement),
      );
      const lines = [
          ...content,
          ...plotPrimitives(project, titles, 'paper', 'paper'),
        ].map((l) => transformLocal(l, placement)),
        ink = lines.flatMap(paperPrimitiveBounds);
      if (!contained([...frame, ...ink], useful))
        issues.push({
          code: 'paper-overflow',
          viewId: placement.id,
          message: `${viewTitle(project, placement)}: vista fora da área útil da folha.`,
        });
      if (
        seal &&
        (overlaps(frame, rectPoints(seal)) ||
          lines.some((l) =>
            overlaps(paperPrimitiveBounds(l), rectPoints(seal)),
          ))
      )
        issues.push({
          code: 'seal-overlap',
          viewId: placement.id,
          message: `${viewTitle(project, placement)}: vista sobre a reserva do selo.`,
        });
      return {
        placement,
        lines,
        content: content.map((l) => transformLocal(l, placement)),
        frame,
      };
    });
  if (
    [...decorations, ...views.flatMap((v) => v.lines)].some(
      (l) => l.text && /[^\x20-\xff]/.test(l.text),
    )
  )
    issues.push({
      code: 'text-encoding',
      message:
        'Há texto com caracteres fora do alfabeto latino suportado pelo PDF. Use caracteres latinos ou símbolos como Ø e °.',
    });
  return {
    sheet,
    size,
    useful,
    seal,
    decorations: plotPrimitives(project, decorations, 'paper', 'paper'),
    views,
    issues,
  };
}
export function assertPaperExportable(project: Project, ids: string[]) {
  if (!ids.length)
    throw new Error('Crie uma folha para exportar a composição.');
  const sheets = ids.map((id) => composeSheet(project, id));
  const invalid = sheets.filter((s) => s.issues.length);
  if (invalid.length)
    throw new Error(
      `PDF não exportado: ${invalid.map((s) => `${s.sheet.name}: ${s.issues.map((i) => i.message).join(' ')}`).join(' / ')}`,
    );
  return sheets;
}
