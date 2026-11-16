import type { Point } from './types';

const scalar = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export const BAR_LENGTH_PROMPT =
  'Clique no próximo ponto ou aponte e digite o comprimento (mm). Enter sem valor conclui.';

/** Coordenadas e entradas polares continuam no roteamento existente. */
export const isBarLengthInput = (value: string) => scalar.test(value.trim());

/** Distância entre vértices do eixo; a direção já recebeu as restrições do CAD. */
export function barPointAtLength(
  origin: Point | undefined,
  preview: Point | undefined,
  value: string,
): Point {
  const length = Number(value);
  if (!isBarLengthInput(value) || !Number.isFinite(length))
    throw new Error('Informe um comprimento válido em mm. Use ponto decimal.');
  // A sessão de pontos existente só admite trechos maiores que 0,01 mm.
  if (length <= 0.01)
    throw new Error('Informe um comprimento maior que 0,01 mm.');
  const finite = (point: Point | undefined): point is Point =>
    !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
  if (!finite(origin))
    throw new Error(
      'Indique o ponto inicial da Barra livre antes do comprimento.',
    );
  if (!finite(preview))
    throw new Error(
      'Mova o cursor no desenho para indicar a direção do trecho.',
    );
  const dx = preview.x - origin.x,
    dy = preview.y - origin.y,
    distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance <= 1e-9)
    throw new Error(
      'Mova o cursor no desenho para indicar uma direção válida.',
    );
  const point = {
    x: origin.x + (dx / distance) * length,
    y: origin.y + (dy / distance) * length,
  };
  if (
    !finite(point) ||
    Math.abs(Math.hypot(point.x - origin.x, point.y - origin.y) - length) >
      Math.max(0.01, length * 1e-12)
  )
    throw new Error(
      'Comprimento fora da precisão admitida pelas coordenadas do modelo.',
    );
  return point;
}
