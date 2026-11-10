import type { Point } from '../domain/types';
import { neutralRotation } from '../domain/maskManipulation';

export type RotationGuide = {
  /** Ponta do raio na direção inicial (+X ou Referência). */
  fromEnd: Point;
  /** Ponta do raio na direção girada. */
  toEnd: Point;
  /** Arco do ângulo, como polilinha (o SVG inverte o sweep-flag com Y para cima). */
  arc: Point[];
  /** Seta no fim do arco: [aba, ponta, aba]. Vazia quando a rotação é neutra. */
  arrow: Point[];
  /** Posição do rótulo do ângulo, no meio do arco, por fora dele. */
  label: Point;
};

const polar = (c: Point, r: number, a: number): Point => ({
  x: c.x + r * Math.cos(a),
  y: c.y + r * Math.sin(a),
});

/**
 * Geometria pura do guia visual do Rotacionar, em coordenadas do modelo
 * (anti-horário +). `rayLength` e `arcRadius` vêm da tela (já divididos pelo
 * zoom). Rotações acima de uma volta desenham no máximo uma volta.
 */
export function rotationGuide(
  base: Point,
  from: Point,
  angle: number,
  rayLength: number,
  arcRadius: number,
): RotationGuide | undefined {
  const n = Math.hypot(from.x, from.y);
  if (
    !Number.isFinite(angle) ||
    !(n > 0) ||
    !(rayLength > 0) ||
    !(arcRadius > 0)
  )
    return undefined;
  const a0 = Math.atan2(from.y, from.x);
  const a1 = a0 + (angle * Math.PI) / 180;
  const sweep = Math.sign(angle) * Math.min(Math.abs(angle), 360);
  const neutral = neutralRotation(angle);
  const segments = neutral
    ? 0
    : Math.max(2, Math.ceil((Math.abs(sweep) / 360) * 96));
  const arc = neutral
    ? []
    : Array.from({ length: segments + 1 }, (_, i) =>
        polar(base, arcRadius, a0 + ((sweep * Math.PI) / 180) * (i / segments)),
      );
  const arrow: Point[] = [];
  if (!neutral) {
    const end = a0 + (sweep * Math.PI) / 180;
    const tip = arc[arc.length - 1];
    const s = Math.sign(sweep);
    // Tangente no sentido do giro e normal radial na ponta do arco.
    const t = { x: -s * Math.sin(end), y: s * Math.cos(end) };
    const r = { x: Math.cos(end), y: Math.sin(end) };
    const h = arcRadius * 0.25,
      w = arcRadius * 0.12;
    arrow.push(
      { x: tip.x - t.x * h + r.x * w, y: tip.y - t.y * h + r.y * w },
      tip,
      { x: tip.x - t.x * h - r.x * w, y: tip.y - t.y * h - r.y * w },
    );
  }
  return {
    fromEnd: polar(base, rayLength, a0),
    toEnd: polar(base, rayLength, a1),
    arc,
    arrow,
    label: polar(base, arcRadius * 1.35, a0 + (sweep * Math.PI) / 360),
  };
}
