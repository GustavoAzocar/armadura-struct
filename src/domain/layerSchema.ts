import { z } from 'zod';
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const lineTypeSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(
        /^[^<>/\\":;?*|=\x00-\x1f]+$/,
        'Nome incompatível com tipo de linha DXF.',
      )
      .refine(
        (n) => !['BYLAYER', 'BYBLOCK'].includes(n.toUpperCase()),
        'Use herança para ByLayer/ByBlock.',
      ),
    pattern: z.array(z.number().finite().min(-1e6).max(1e6)).max(64),
  })
  .strict()
  .refine(
    (v) =>
      !v.pattern.length ||
      (v.pattern.length % 2 === 0 &&
        v.pattern.some((n) => n !== 0) &&
        v.pattern.every((n, i) => (i % 2 === 0 ? n >= 0 : n < 0))),
    'Padrão de linha sem extensão.',
  );
export const drawingStyleSchema = z
  .object({
    color,
    lineType: lineTypeSchema,
    lineScale: z.number().finite().positive().max(10000),
    lineWidth: z.number().finite().min(0).max(2.11),
    fill: z.enum(['none', 'solid']),
    fillColor: color,
  })
  .strict();
export const layerBindingShape = {
  layerId: z.string().min(1).max(200).optional(),
  style: drawingStyleSchema.partial().optional(),
};
export const drawingLayerSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^<>/\\":;?*|=\x00-\x1f]+$/, 'Nome incompatível com layer DXF.'),
    ...drawingStyleSchema.shape,
  })
  .strict();
