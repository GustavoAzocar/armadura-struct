import { stylePrimitive } from './layers';
import {
  representationPrimitives,
  showsPhysicalDescription,
} from './representations';
import { quantityLabel, detailTitle, assemblyLabel } from './detailQuantities';
import { format, geometry, sampled, world, bounds } from './geometry';
import { maskPrimitives } from '../cad/import';
import {
  annotationPrimitives,
  distributionPrimitives,
  repeatedGeometry,
} from './drafting';
import type { Point, Primitive, Project } from './types';

export function drawingPrimitives(
  p: Project,
  references: Project = p,
  options: { minTextHeight?: number } = {},
): Primitive[] {
  const h = options.minTextHeight ?? 40;
  const offset = (legacy: number, factor: number) =>
    options.minTextHeight === undefined ? legacy : h * factor;
  const lines = p.masks.flatMap((m) =>
    maskPrimitives(m).map((l) => stylePrimitive(references, m, l)),
  );
  lines.push(
    ...p.polylines.map((l) =>
      stylePrimitive(references, l, { ...l, layer: 'DESENHO' }),
    ),
    ...p.annotations.flatMap((a) =>
      annotationPrimitives(
        {
          ...a,
          textHeight: options.minTextHeight ?? a.textHeight,
        },
        references,
      ).map((item) => stylePrimitive(references, a, item)),
    ),
  );
  const label = (text: string, at: Point, layer: string) => ({
    layer,
    points: [at],
    text,
    textHeight: h,
  });
  for (const b of p.bars) {
    const start = lines.length;
    if (b.distribution?.render === 'bars') lines.push(...repeatedGeometry(b));
    else
      lines.push({
        layer: 'ARMADURAS',
        points: sampled(geometry(b).segments).map((v) => world(v, b)),
      });
    if (showsPhysicalDescription(references, b.id))
      lines.push(
        label(
          `${b.mark} - ${quantityLabel(references, b)} x %%c${b.diameter} - C=${format(geometry(b).length / 10)} cm${assemblyLabel(b) ? ` · ${assemblyLabel(b)}` : ''}`,
          { x: b.origin.x, y: b.origin.y - offset(100, 1.8) },
          'IDENTIFICACAO',
        ),
      );
    if (b.kind === 'stirrup') {
      lines.push(
        label(
          format(b.width / 10),
          world({ x: b.width / 2, y: b.height + offset(45, 1.1) }, b),
          'COTAS',
        ),
      );
      lines.push(
        label(
          format(b.height / 10),
          world({ x: -offset(60, 1.2), y: b.height / 2 }, b),
          'COTAS',
        ),
      );
    }
    lines.push(...distributionPrimitives(b, options.minTextHeight, references));
    for (let i = start; i < lines.length; i++)
      lines[i] = stylePrimitive(references, b, lines[i], 'ARMADURAS');
  }
  for (const d of p.details) {
    const b = references.bars.find((b) => b.id === d.barId);
    if (b)
      lines.push(
        ...representationPrimitives(b, d, references, h).map((item) =>
          stylePrimitive(references, d, item, 'REBATIMENTOS'),
        ),
      );
  }
  for (const d of p.hierarchy.details.filter((d) => d.repetition)) {
    const bars = p.bars.filter((b) => p.hierarchy.objectDetails[b.id] === d.id);
    if (!bars.length) continue;
    const box = bounds(
      bars.flatMap((b) => geometry(b).vertices.map((v) => world(v, b))),
    );
    lines.push(
      label(
        detailTitle(references, d.id),
        { x: box.x, y: box.y + box.height + h * 2 },
        'IDENTIFICACAO',
      ),
    );
  }
  return lines;
}

export function objectPrimitives(p: Project, ids: string[]): Primitive[] {
  const set = new Set(ids);
  return drawingPrimitives(
    {
      ...p,
      bars: p.bars.filter((o) => set.has(o.id)),
      details: p.details.filter((o) => set.has(o.id)),
      annotations: p.annotations.filter((o) => set.has(o.id)),
      polylines: p.polylines.filter((o) => set.has(o.id)),
      masks: p.masks.filter((o) => set.has(o.id)),
    },
    p,
  );
}
