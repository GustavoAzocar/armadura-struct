import { quantityLabel, detailTitle } from './detailQuantities';
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
  const lines = p.masks
    .flatMap(maskPrimitives)
    .map((l) => ({ ...l, layer: 'MASCARA' }));
  lines.push(
    ...p.polylines.map((l) => ({ ...l, layer: 'DESENHO' })),
    ...p.annotations.flatMap((a) =>
      annotationPrimitives(
        {
          ...a,
          textHeight: options.minTextHeight ?? a.textHeight,
        },
        references,
      ),
    ),
  );
  const label = (text: string, at: Point, layer: string) => ({
    layer,
    points: [at],
    text,
    textHeight: h,
  });
  for (const b of p.bars) {
    if (b.distribution?.render === 'bars') lines.push(...repeatedGeometry(b));
    else
      lines.push({
        layer: 'ARMADURAS',
        points: sampled(geometry(b).segments).map((v) => world(v, b)),
      });
    lines.push(
      label(
        `${b.mark} - ${quantityLabel(references, b)} x %%c${b.diameter} - C=${format(geometry(b).length / 10)} cm`,
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
  }
  for (const d of p.details) {
    const b = references.bars.find((b) => b.id === d.barId);
    if (!b) continue;
    lines.push({
      layer: 'REBATIMENTOS',
      points: sampled(geometry(b).segments).map((v) => ({
        x: v.x + d.origin.x,
        y: v.y + d.origin.y,
      })),
    });
    lines.push(
      label(
        `${b.mark} - ${quantityLabel(references, b)} x %%c${b.diameter} - C=${format(geometry(b).length / 10)} cm`,
        { x: d.origin.x, y: d.origin.y - offset(110, 1.8) },
        'IDENTIFICACAO',
      ),
    );
    const v = geometry(b).vertices;
    for (let i = 0; i < v.length - 1; i++) {
      if (b.kind === 'stirrup' && ![3, 4].includes(i)) continue;
      const a = v[i],
        c = v[i + 1];
      lines.push(
        label(
          format(Math.hypot(a.x - c.x, a.y - c.y) / 10),
          {
            x: d.origin.x + (a.x + c.x) / 2,
            y: d.origin.y + (a.y + c.y) / 2 + offset(40, 1.1),
          },
          'COTAS',
        ),
      );
    }
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
