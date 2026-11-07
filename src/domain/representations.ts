import { geometry, sampled, rotate, format } from './geometry';
import { quantityLabel, assemblyLabel } from './detailQuantities';
import type { Bar, Detail, Point, Primitive, Project } from './types';
export function representationPoint(d: Detail, p: Point): Point {
  const v = rotate(
    { x: p.x * (d.scale ?? 1), y: p.y * (d.scale ?? 1) },
    d.rotation ?? 0,
  );
  return { x: v.x + d.origin.x, y: v.y + d.origin.y };
}
export function representationPoints(b: Bar, d: Detail) {
  return sampled(geometry(b).segments).map((p) => representationPoint(d, p));
}
export function showsPhysicalDescription(p: Project, id: string) {
  return !p.details.some(
    (d) => d.barId === id && d.identification === 'primary',
  );
}
export function representationPrimitives(
  b: Bar,
  d: Detail,
  p: Project,
  h = 40,
): Primitive[] {
  const text = (text: string, at: Point, layer: string): Primitive => ({
    layer,
    text,
    points: [representationPoint(d, at)],
    textHeight: h * (d.scale ?? 1),
    textRotation: d.rotation ?? 0,
  });
  const out: Primitive[] = [
    { layer: 'REBATIMENTOS', points: representationPoints(b, d) },
  ];
  const mode = d.identification ?? 'legacy';
  if (mode !== 'none')
    out.push(
      text(
        mode === 'mark'
          ? b.mark
          : `${b.mark} - ${quantityLabel(p, b)} x %%c${b.diameter} - C=${format(geometry(b).length / 10)} cm${assemblyLabel(b) ? ` · ${assemblyLabel(b)}` : ''}`,
        { x: 0, y: -110 },
        'IDENTIFICACAO',
      ),
    );
  const v = geometry(b).vertices;
  for (let i = 0; i < v.length - 1; i++) {
    if (b.kind === 'stirrup' && ![3, 4].includes(i)) continue;
    const a = v[i],
      c = v[i + 1];
    out.push(
      text(
        format(Math.hypot(a.x - c.x, a.y - c.y) / 10),
        { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 + 40 },
        'COTAS',
      ),
    );
  }
  return out;
}
