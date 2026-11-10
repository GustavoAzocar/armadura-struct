import { z } from 'zod';
import { layerBindingShape } from './layerSchema';

const number = z.number().finite();
const point = z.object({ x: number, y: number });
/** Wire contract of one CAD entity; shared by masks and symbol definitions. */
export const primitiveSchema = z.object({
  ...layerBindingShape,
  id: z.string().optional(),
  sourceEntityId: z.string().min(1).max(1000).optional(),
  native: z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('arc'),
        center: point,
        radius: number.positive(),
        startAngle: number.min(-360000).max(360000),
        sweepAngle: number.refine(
          (n) => Math.abs(n) > 1e-10 && Math.abs(n) < 360,
          'Abertura do arco inválida.',
        ),
      }),
      z.object({
        kind: z.literal('circle'),
        center: point,
        radius: number.positive(),
      }),
      ...(['line', 'rectangle', 'polyline'] as const).map((kind) =>
        z.object({
          kind: z.literal(kind),
          points: z.array(point).min(2).max(500),
          closed: z.boolean(),
        }),
      ),
    ])
    .optional(),
  layer: z.string(),
  points: z.array(point).max(100000),
  closed: z.boolean().optional(),
  text: z.string().optional(),
  textHeight: number.optional(),
  textRotation: number.optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
});
