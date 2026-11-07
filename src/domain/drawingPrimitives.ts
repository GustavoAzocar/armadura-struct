import { format, geometry, sampled, world } from './geometry';
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
): Primitive[] {
  const lines = p.masks
    .flatMap(maskPrimitives)
    .map((l) => ({ ...l, layer: 'MASCARA' }));
  lines.push(
    ...p.polylines.map((l) => ({ ...l, layer: 'DESENHO' })),
    ...p.annotations.flatMap((a) => annotationPrimitives(a, references)),
  );
  const label = (text: string, at: Point, layer: string) => ({
    layer,
    points: [at],
    text,
    textHeight: 40,
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
        `${b.mark} - ${b.quantity} x %%c${b.diameter} - C=${format(geometry(b).length / 10)} cm`,
        { x: b.origin.x, y: b.origin.y - 100 },
        'IDENTIFICACAO',
      ),
    );
    if (b.kind === 'stirrup') {
      lines.push(
        label(
          format(b.width / 10),
          world({ x: b.width / 2, y: b.height + 45 }, b),
          'COTAS',
        ),
      );
      lines.push(
        label(
          format(b.height / 10),
          world({ x: -60, y: b.height / 2 }, b),
          'COTAS',
        ),
      );
    }
    lines.push(...distributionPrimitives(b));
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
        `${b.mark} - ${b.quantity} x %%c${b.diameter} - C=${format(geometry(b).length / 10)} cm`,
        { x: d.origin.x, y: d.origin.y - 110 },
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
            y: d.origin.y + (a.y + c.y) / 2 + 40,
          },
          'COTAS',
        ),
      );
    }
  }
  return lines;
}
