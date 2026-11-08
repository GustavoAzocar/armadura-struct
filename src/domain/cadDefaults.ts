import { z } from 'zod';
import { drawingStyleSchema, lineTypeSchema } from './layerSchema';
import { LINE_TYPES, stylePrimitive } from './layers';
import type {
  Bar,
  BarRepresentation,
  LayerBinding,
  Primitive,
  Project,
  Annotation,
} from './types';
const positive = z.number().finite().positive();
const height = positive.max(10000);
const appearance = z
  .object({
    layerId: z.string().min(1).max(200).optional(),
    style: drawingStyleSchema.partial().optional(),
    commonLine: z.boolean(),
  })
  .strict();
const align = z.enum(['left', 'center', 'right']).optional();
export const cadDefaultsSchema = z
  .object({
    texts: z
      .object({
        height,
        identificationHeight: height,
        align,
        appearance,
        identification: appearance,
      })
      .strict(),
    armatures: z
      .object({
        diameter: positive.max(100),
        steel: z.enum(['CA-50', 'CA-60']),
        quantity: z.number().int().min(1).max(100000),
        spacing: positive,
        cover: z.number().finite().min(0).max(10000),
        bar: appearance,
        representation: appearance,
      })
      .strict(),
    dimensions: z.object({ height, autoHeight: height, appearance }).strict(),
    masks: z
      .object({
        opacity: z.number().finite().min(0).max(1),
        mask: appearance,
        entity: appearance,
      })
      .strict(),
    lines: z
      .object({
        lineType: lineTypeSchema,
        lineScale: drawingStyleSchema.shape.lineScale,
        lineWidth: drawingStyleSchema.shape.lineWidth,
      })
      .strict(),
  })
  .strict();
export type CadDefaults = z.infer<typeof cadDefaultsSchema>;
export type CadCategory = keyof CadDefaults;
export function factoryCadDefaults(): CadDefaults {
  const a = () => ({ commonLine: false });
  return {
    texts: {
      height: 50,
      identificationHeight: 40,
      appearance: a(),
      identification: a(),
    },
    armatures: {
      diameter: 8,
      steel: 'CA-50',
      quantity: 1,
      spacing: 150,
      cover: 30,
      bar: a(),
      representation: a(),
    },
    dimensions: { height: 50, autoHeight: 40, appearance: a() },
    masks: { opacity: 1, mask: a(), entity: a() },
    lines: {
      lineType: structuredClone(LINE_TYPES[0]),
      lineScale: 1,
      lineWidth: 0.18,
    },
  };
}
export const cadDefaults = (p: Pick<Project, 'cadDefaults'>) =>
  p.cadDefaults ?? factoryCadDefaults();
export function cadBinding(
  p: Pick<Project, 'cadDefaults'>,
  a: z.infer<typeof appearance>,
): LayerBinding {
  const c = cadDefaults(p);
  return structuredClone({
    ...(a.layerId ? { layerId: a.layerId } : {}),
    ...(a.commonLine || a.style
      ? {
          style: Object.fromEntries(
            Object.entries({
              ...(a.commonLine ? c.lines : {}),
              ...a.style,
            }).filter(([, v]) => v !== undefined),
          ),
        }
      : {}),
  });
}
export function validateCadDefaults(p: Project, c: unknown): CadDefaults {
  const next = cadDefaultsSchema.parse(c);
  for (const a of [
    next.texts.appearance,
    next.texts.identification,
    next.armatures.bar,
    next.armatures.representation,
    next.dimensions.appearance,
    next.masks.mask,
    next.masks.entity,
  ])
    if (a.layerId && !p.layers.some((l) => l.id === a.layerId))
      throw new Error(
        'Layer de padrão inexistente. Escolha um layer do projeto.',
      );
  const weights = [
    0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106,
    120, 140, 158, 200, 211,
  ];
  for (const path of [
    'lines.lineWidth',
    'texts.appearance.style.lineWidth',
    'texts.identification.style.lineWidth',
    'armatures.bar.style.lineWidth',
    'armatures.representation.style.lineWidth',
    'dimensions.appearance.style.lineWidth',
    'masks.mask.style.lineWidth',
    'masks.entity.style.lineWidth',
  ]) {
    const width = path
      .split('.')
      .reduce((value: any, key) => value?.[key], next);
    if (
      width !== undefined &&
      !weights.some((w) => Math.abs(width * 100 - w) < 1e-7)
    )
      throw new z.ZodError([
        {
          code: 'custom',
          path: path.split('.'),
          message:
            'Pena não suportada no DXF. Use 0,18 / 0,25 / 0,35 / 0,50 / 0,70 mm ou outra pena CAD suportada.',
        },
      ]);
  }
  return JSON.parse(JSON.stringify(next)) as CadDefaults;
}
export function setCadDefaults(p: Project, value: unknown): Project {
  return { ...p, cadDefaults: validateCadDefaults(p, value) };
}
export function barCadDefaults(p: Project, b: Bar, physical = false): Bar {
  if (!p.cadDefaults) return b;
  const c = cadDefaults(p),
    binding = cadBinding(p, c.armatures.bar);
  return {
    ...b,
    ...(physical ? { steel: c.armatures.steel } : {}),
    ...binding,
    style: { ...binding.style, ...b.style },
    ...(!physical && b.layerId ? { layerId: b.layerId } : {}),
    drafting: b.drafting ?? {
      height: c.texts.identificationHeight,
      distributionHeight: c.texts.height,
      dimensionHeight: c.dimensions.autoHeight,
      dimensions: cadBinding(p, c.dimensions.appearance),
      align: c.texts.align,
      ...cadBinding(p, c.texts.identification),
    },
  };
}
export function representationCadDefaults(
  p: Project,
  d: BarRepresentation,
): BarRepresentation {
  if (!p.cadDefaults) return d;
  const c = cadDefaults(p),
    binding = cadBinding(p, c.armatures.representation);
  return {
    ...d,
    ...binding,
    ...(d.layerId ? { layerId: d.layerId } : {}),
    style: { ...binding.style, ...d.style },
    drafting: d.drafting ?? {
      height: c.texts.identificationHeight,
      distributionHeight: c.texts.height,
      dimensionHeight: c.dimensions.autoHeight,
      dimensions: cadBinding(p, c.dimensions.appearance),
      align: c.texts.align,
      ...cadBinding(p, c.texts.identification),
    },
  };
}
export function annotationCadDefaults(p: Project, a: Annotation): Annotation {
  if (!p.cadDefaults) return a;
  const c = cadDefaults(p),
    dimension = a.kind.startsWith('dimension'),
    binding = cadBinding(
      p,
      dimension ? c.dimensions.appearance : c.texts.appearance,
    );
  return {
    ...a,
    ...binding,
    textHeight: dimension ? c.dimensions.height : c.texts.height,
    drafting: {
      height: dimension ? c.dimensions.height : c.texts.height,
      dimensionHeight: c.dimensions.height,
      align: c.texts.align,
    },
  };
}
export function styledDrafting(
  p: Project,
  o: LayerBinding,
  item: Primitive,
  role?: string,
): Primitive {
  const binding =
    item.text && o.drafting
      ? (item.role ?? item.layer) === 'COTAS'
        ? (o.drafting.dimensions ?? o.drafting)
        : o.drafting
      : o;
  return stylePrimitive(
    p,
    binding.layerId || (binding.style && Object.keys(binding.style).length)
      ? binding
      : o,
    item,
    role,
  );
}
