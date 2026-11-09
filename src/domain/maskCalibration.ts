import type { Mask, Point, Project } from './types';
import { distance } from './geometry';
import { maskPoint } from '../cad/import';
import { objectState, layerState } from './layerProfiles';
import { objectHidden } from './visibility';
import type { MaskDrawingContext } from './maskDrawing';

/** Same model-coordinate envelope as selection transforms; lengths are physical mm. */
export const CALIBRATION_TOLERANCE = 1e-6;
const COORDINATE_LIMIT = 1e9;
const validPoint = (p: Point) =>
  [p.x, p.y].every(
    (v) => Number.isFinite(v) && Math.abs(v) <= COORDINATE_LIMIT,
  );
export function calibrationDistance(p1: Point, p2: Point) {
  if (!validPoint(p1) || !validPoint(p2))
    throw new Error('Informe pontos finitos dentro de ±1.000.000.000 mm.');
  const current = distance(p1, p2);
  if (current < CALIBRATION_TOLERANCE)
    throw new Error(
      'P1 e P2 devem distar ao menos 0,000001 mm. Escolha outro P2.',
    );
  return current;
}
/** Identity and analytic local geometry remain untouched; only the model transform changes. */
export function calibratedMask(
  mask: Mask,
  p1: Point,
  p2: Point,
  desired: number,
) {
  const current = calibrationDistance(p1, p2);
  if (
    !Number.isFinite(desired) ||
    desired < CALIBRATION_TOLERANCE ||
    desired > COORDINATE_LIMIT
  )
    throw new Error(
      'Informe uma distância finita entre 0,000001 e 1.000.000.000 mm.',
    );
  const neutral =
    Math.abs(desired - current) <=
    Number.EPSILON * 8 * Math.max(desired, current);
  const factor = neutral ? 1 : desired / current,
    scale = mask.scale * factor;
  if (
    !Number.isFinite(mask.scale) ||
    mask.scale <= 0 ||
    !Number.isFinite(mask.rotation) ||
    !validPoint(mask.origin) ||
    !Number.isFinite(scale) ||
    scale <= 0 ||
    scale > 1e6
  )
    throw new Error(
      'A calibração excede os limites da transformação (escala positiva até 1.000.000).',
    );
  const transform = (p: Point): Point => ({
    x: p1.x + factor * (p.x - p1.x),
    y: p1.y + factor * (p.y - p1.y),
  });
  const origin = factor === 1 ? mask.origin : transform(mask.origin),
    endpoint = factor === 1 ? p2 : transform(p2);
  if (
    !validPoint(origin) ||
    !validPoint(endpoint) ||
    distance(p1, endpoint) === 0 ||
    Math.abs(distance(p1, endpoint) - desired) > desired * 1e-8
  )
    throw new Error(
      'A calibração excede os limites de coordenadas/precisão do modelo.',
    );
  const result = factor === 1 ? mask : { ...mask, scale, origin };
  for (const q of mask.primitives) {
    if (q.points.some((p) => !validPoint(maskPoint(p, result))))
      throw new Error(
        'A calibração levaria entidades para fora de ±1.000.000.000 mm.',
      );
    if (q.text && !Number.isFinite((q.textHeight ?? 2.5) * scale))
      throw new Error('Altura de texto fora dos limites numéricos.');
    if (q.native?.kind === 'circle' || q.native?.kind === 'arc') {
      const center = maskPoint(q.native.center, result),
        r = q.native.radius * scale;
      if (
        !Number.isFinite(r) ||
        r <= 0 ||
        ![
          { x: center.x - r, y: center.y - r },
          { x: center.x + r, y: center.y + r },
        ].every(validPoint)
      )
        throw new Error('O círculo calibrado excederia os limites do modelo.');
    }
  }
  return { mask: result, factor, current, desired, endpoint };
}
export function calibrationTarget(
  p: Project,
  id: string | undefined,
  context: MaskDrawingContext,
) {
  const mask = p.masks.find((m) => m.id === id);
  if (!mask)
    throw new Error(
      'Escolha e ative uma máscara, ou use Ajustar escala no controle da referência desejada.',
    );
  const owner = p.hierarchy.objectDetails[mask.id];
  if (
    context.key.startsWith('sheet:') ||
    owner !== context.detailId ||
    (context.scopeDetailId && owner !== context.scopeDetailId)
  )
    throw new Error(
      'Abra o desenho/detalhamento desta máscara antes de ajustar sua escala; a prancha não é o espaço do modelo.',
    );
  if (
    !mask.visible ||
    mask.opacity === 0 ||
    objectHidden(p, context.key, mask.id)
  )
    throw new Error(
      'Máscara oculta. Reexiba o alvo explicitamente antes de calibrar.',
    );
  if (!objectState(p, context.key, mask).editable)
    throw new Error('Layer da máscara desligado, sem captura ou bloqueado.');
  if (!mask.primitives.length)
    throw new Error(
      'A máscara está vazia. Desenhe ou importe uma referência antes de calibrar.',
    );
  for (const q of mask.primitives) {
    if (
      mask.layers[q.layer] === false ||
      (q.layerId && !layerState(p, context.key, q.layerId).editable)
    )
      throw new Error(
        'A máscara contém camada oculta ou layer protegido. Libere-os explicitamente para transformar a máscara inteira.',
      );
  }
  return mask;
}
export function applyMaskCalibration(
  p: Project,
  expected: Mask,
  p1: Point,
  p2: Point,
  desired: number,
  context: MaskDrawingContext,
) {
  const mask = calibrationTarget(p, expected.id, context);
  if (mask !== expected)
    throw new Error(
      'A máscara mudou durante a calibração. Reinicie o comando.',
    );
  const result = calibratedMask(mask, p1, p2, desired);
  return {
    ...result,
    project:
      result.mask === mask
        ? p
        : {
            ...p,
            masks: p.masks.map((m) => (m.id === mask.id ? result.mask : m)),
          },
  };
}
