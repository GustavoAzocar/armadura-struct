import { z } from 'zod';
import { add, mul, rotate } from './geometry';
import { drawingStyleSchema } from './layerSchema';
import { paperPrimitiveBounds, type PaperPrimitive } from './paperText';
import type { PaperRect } from './paper';
import { sheetSize } from './paperFormat';
import { validateTextContent } from './textStyle';
import { uid, type Mask, type Point, type Project, type Sheet } from './types';

// /38 combines legacy templates (/36), linked files/cotation (/35) and bands (/37).
export const SHEET_TEMPLATE_PROJECT_SCHEMA = 'armadurastruct/38' as const;
const catalogVersion = 'armadurastruct.sheet-template/1';
const num = z.number().finite();
const id = z.string().min(1).max(200);
const point = z.object({ x: num, y: num });
const rect = point.extend({ width: num.positive(), height: num.positive() });
const align = z.enum(['left', 'center', 'right']);
const font = z.enum(['helvetica', 'times', 'courier']);
const documentText = (text: string) => text.replace(/%%c/gi, 'Ø');
const geometrySchema = z.object({
  layer: z.string().min(1).max(200),
  points: z.array(point).min(1).max(100000),
  closed: z.boolean().optional(),
  text: z.string().max(500).optional(),
  textHeight: num.positive().max(5000).optional(),
  textRotation: num.optional(),
  textAlign: align.optional(),
  textFont: z
    .object({
      family: z.enum(['sans', 'serif', 'mono']),
      weight: z.enum(['normal', 'bold']),
      style: z.enum(['normal', 'italic']),
    })
    .optional(),
  resolvedStyle: drawingStyleSchema.optional(),
});
const fieldSchema = z.object({
  id,
  label: z.string().trim().min(1).max(150),
  box: rect,
  origin: point,
  text: z.string().max(500),
  font,
  height: num.positive().max(5000),
  align,
  rotation: num,
});
export type SheetTemplateField = z.infer<typeof fieldSchema>;
export const sheetTemplateSchema = z.object({
  id,
  name: z.string().trim().min(1).max(150),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  format: z.enum(['A0', 'A1', 'A2', 'A3', 'A4', 'custom']),
  orientation: z.enum(['portrait', 'landscape']),
  customSize: z.object({
    width: num.min(50).max(5000),
    height: num.min(50).max(5000),
  }),
  useful: rect,
  seal: rect.optional(),
  geometry: z.array(geometrySchema).max(100000),
  fields: z.array(fieldSchema).max(1000),
});
export type SheetTemplate = Omit<
  z.infer<typeof sheetTemplateSchema>,
  'geometry'
> & {
  geometry: PaperPrimitive[];
};

function paperContains(box: PaperRect, p: Point) {
  const tolerance = 1e-7;
  return (
    p.x >= box.x - tolerance &&
    p.y >= box.y - tolerance &&
    p.x <= box.x + box.width + tolerance &&
    p.y <= box.y + box.height + tolerance
  );
}

export const paperRectCorners = (box: PaperRect) => [
  { x: box.x, y: box.y },
  { x: box.x + box.width, y: box.y },
  { x: box.x + box.width, y: box.y + box.height },
  { x: box.x, y: box.y + box.height },
];

export function paperRectFromPoints(a: Point, b: Point): PaperRect {
  const first = point.parse(a);
  const second = point.parse(b);
  return rect.parse({
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(first.x - second.x),
    height: Math.abs(first.y - second.y),
  });
}

function fieldPrimitive(field: SheetTemplateField): PaperPrimitive {
  return {
    layer: 'SELO',
    points: [field.origin],
    text: documentText(field.text),
    textHeight: field.height,
    textAlign: field.align,
    textRotation: field.rotation,
    textFont: {
      family: { helvetica: 'sans', times: 'serif', courier: 'mono' }[
        field.font
      ],
      weight: 'normal',
      style: 'normal',
    },
  };
}

export function validateSheetTemplate(input: SheetTemplate): SheetTemplate {
  const parsed = sheetTemplateSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw Error(
      `Modelo de prancha inválido em ${issue.path.join('.') || 'modelo'}. ${issue.message}`,
    );
  }
  const value = parsed.data;
  const paper = { x: 0, y: 0, ...sheetSize(value) };
  if (!paperRectCorners(value.useful).every((p) => paperContains(paper, p)))
    throw Error('A área útil deve ficar dentro do papel.');
  if (
    value.seal &&
    !paperRectCorners(value.seal).every((p) => paperContains(paper, p))
  )
    throw Error('A reserva do selo deve ficar dentro do papel.');
  const ids = new Set<string>();
  for (const field of value.fields) {
    if (ids.has(field.id))
      throw Error(`Campo repetido. Confira ${field.label}.`);
    ids.add(field.id);
    if (!paperRectCorners(field.box).every((p) => paperContains(paper, p)))
      throw Error(
        `A caixa do campo “${field.label}” deve ficar dentro do papel.`,
      );
    if (!paperContains(field.box, field.origin))
      throw Error(
        `A origem do campo “${field.label}” deve ficar dentro da caixa.`,
      );
    if (!field.text) continue;
    try {
      validateTextContent(field.text);
    } catch (e) {
      throw Error(`Campo “${field.label}”. ${(e as Error).message}`);
    }
    if (
      !paperPrimitiveBounds(fieldPrimitive(field)).every((p) =>
        paperContains(field.box, p),
      )
    )
      throw Error(
        `O texto do campo “${field.label}” ultrapassa a caixa. Ajuste a caixa, o texto ou sua apresentação.`,
      );
  }
  for (const [i, item] of value.geometry.entries()) {
    if (item.text !== undefined) {
      validateTextContent(item.text);
      if (!item.textHeight || item.points.length !== 1)
        throw Error(`Texto importado ${i + 1} sem origem ou altura válida.`);
    } else if (item.points.length < (item.closed ? 3 : 2)) {
      throw Error(`Entidade ${i + 1} sem pontos suficientes.`);
    }
    if (
      !paperPrimitiveBounds(templatePrimitive(item)).every((p) =>
        paperContains(paper, p),
      )
    )
      throw Error(
        `A entidade ${i + 1} do modelo ultrapassa os limites do papel.`,
      );
  }
  return value;
}

export function templateFromSheet(sheet: Sheet): SheetTemplate {
  const name = `Modelo de ${sheet.name}`.slice(0, 150);
  if (sheet.paperTemplate)
    return duplicateSheetTemplate(sheet.paperTemplate, name);
  const { width, height } = sheetSize(sheet);
  const { margins, seal } = sheet;
  const useful = {
    x: margins.left,
    y: margins.bottom,
    width: width - margins.left - margins.right,
    height: height - margins.top - margins.bottom,
  };
  return {
    id: uid(),
    name,
    revision: 1,
    format: sheet.format,
    orientation: sheet.orientation,
    customSize: { ...sheet.customSize },
    useful,
    seal: seal.enabled
      ? {
          x: useful.x + useful.width - seal.width,
          y: useful.y,
          width: seal.width,
          height: seal.height,
        }
      : undefined,
    geometry: [],
    fields: [],
  };
}

export function sheetTemplateDecorations(
  template: SheetTemplate,
): PaperPrimitive[] {
  const { useful, seal, fields, geometry } = template;
  const borders: PaperPrimitive[] = geometry.length
    ? []
    : [
        { layer: 'MARGEM', points: paperRectCorners(useful), closed: true },
        ...(seal
          ? [{ layer: 'SELO', points: paperRectCorners(seal), closed: true }]
          : []),
      ];
  return [
    ...borders,
    ...geometry.map(templatePrimitive),
    ...fields.filter((f) => f.text.length > 0).map(fieldPrimitive),
  ];
}

function templatePrimitive(item: PaperPrimitive): PaperPrimitive {
  return item.text ? { ...item, text: documentText(item.text) } : item;
}

const nameKey = (name: string) => name.normalize('NFC').toLowerCase();

export function validateSheetTemplateCatalog(catalog: SheetTemplate[]) {
  const names = new Set<string>(),
    ids = new Set<string>();
  for (const template of catalog) {
    validateSheetTemplate(template);
    const name = nameKey(template.name);
    if (ids.has(template.id) || names.has(name))
      throw Error(`Modelo repetido. Confira “${template.name}”.`);
    names.add(name);
    ids.add(template.id);
  }
}

export function saveSheetTemplate(
  project: Project,
  draft: SheetTemplate,
): Project {
  const list = project.sheetTemplates ?? [];
  const existing = list.find((t) => t.id === draft.id);
  const next = validateSheetTemplate({
    ...draft,
    revision: existing?.revision ?? draft.revision,
  });
  if (
    list.some((t) => t.id !== next.id && nameKey(t.name) === nameKey(next.name))
  )
    throw Error(
      `Já existe um modelo com o nome “${next.name}”. Escolha outro nome.`,
    );
  if (
    existing &&
    JSON.stringify(validateSheetTemplate(existing)) === JSON.stringify(next)
  )
    return project;
  if (existing?.revision === Number.MAX_SAFE_INTEGER)
    throw Error('O modelo atingiu o limite de revisões.');
  if (!existing && list.length >= 1000)
    throw Error('O catálogo admite até 1.000 modelos.');
  return {
    ...project,
    schema: SHEET_TEMPLATE_PROJECT_SCHEMA,
    sheetTemplates: existing
      ? list.map((t) =>
          t.id === next.id ? { ...next, revision: t.revision + 1 } : t,
        )
      : [...list, next],
  };
}

export function duplicateSheetTemplate(
  template: SheetTemplate,
  name: string,
): SheetTemplate {
  return {
    ...structuredClone(template),
    id: uid(),
    name,
    revision: 1,
    fields: template.fields.map((field) => ({
      ...structuredClone(field),
      id: uid(),
    })),
  };
}

export function removeSheetTemplate(project: Project, id: string): Project {
  const templates = project.sheetTemplates ?? [];
  if (!templates.some((template) => template.id === id)) return project;
  return {
    ...project,
    sheetTemplates: templates.filter((template) => template.id !== id),
  };
}

export function applySheetTemplate(
  project: Project,
  id: string,
  sheetIds: string[],
): Project {
  const template = project.sheetTemplates?.find((t) => t.id === id);
  if (!template) throw Error('Modelo de prancha inexistente.');
  const selection = new Set(sheetIds);
  if (!selection.size) throw Error('Selecione pelo menos uma folha.');
  if (
    [...selection].some(
      (sheetId) => !project.sheets.some((s) => s.id === sheetId),
    )
  )
    throw Error('Uma das folhas selecionadas não existe mais.');
  const { useful, seal } = template;
  const { width, height } = sheetSize(template);
  let changed = false;
  const sheets = project.sheets.map((sheet) => {
    if (
      !selection.has(sheet.id) ||
      (sheet.paperTemplate?.id === id &&
        sheet.paperTemplate.revision === template.revision &&
        JSON.stringify(sheet.paperTemplate) === JSON.stringify(template))
    )
      return sheet;
    changed = true;
    return {
      ...sheet,
      format: template.format,
      orientation: template.orientation,
      customSize: { ...template.customSize },
      margins: {
        left: Math.max(0, useful.x),
        right: Math.max(0, width - useful.x - useful.width),
        bottom: Math.max(0, useful.y),
        top: Math.max(0, height - useful.y - useful.height),
      },
      seal: seal
        ? { enabled: true, width: seal.width, height: seal.height }
        : { ...sheet.seal, enabled: false },
      paperTemplate: structuredClone(template),
    };
  });
  return changed
    ? {
        ...project,
        schema: SHEET_TEMPLATE_PROJECT_SCHEMA,
        sheets,
      }
    : project;
}

export function encodeSheetTemplate(template: SheetTemplate) {
  return JSON.stringify(
    { schema: catalogVersion, template: validateSheetTemplate(template) },
    null,
    2,
  );
}

export function decodeSheetTemplate(raw: string): SheetTemplate {
  const data: unknown = JSON.parse(raw);
  const payload = z
    .object({
      schema: z.literal(catalogVersion),
      template: sheetTemplateSchema,
    })
    .parse(data);
  return validateSheetTemplate(payload.template);
}

/** Geometry and text heights enter in normalized millimeters from the existing importer. */
export function sheetTemplateGeometryFromMask(mask: Mask): PaperPrimitive[] {
  const layers = new Map(
    mask.layerDefinitions?.map((layer) => [layer.id, layer]),
  );
  return mask.primitives
    .filter(
      (item) =>
        mask.layers[item.layer] !== false &&
        item.text !== '' &&
        item.points.length > 0,
    )
    .map((item) => {
      const layer = item.layerId ? layers.get(item.layerId) : undefined;
      const source = layer
        ? { ...drawingStyleSchema.strip().parse(layer), ...item.style }
        : undefined;
      return {
        layer: item.layer,
        points: item.points.map((p) =>
          add(mask.origin, rotate(mul(p, mask.scale), mask.rotation)),
        ),
        closed: item.closed,
        text: item.text,
        textHeight: item.text
          ? (item.textHeight ?? 2.5) * mask.scale
          : undefined,
        textRotation: item.text
          ? (item.textRotation ?? 0) + mask.rotation
          : undefined,
        textAlign: item.textAlign,
        textFont:
          item.textFont &&
          ['sans', 'serif', 'mono'].includes(item.textFont.family)
            ? item.textFont
            : undefined,
        resolvedStyle: source,
      };
    });
}

export function detachSheetTemplate(project: Project, id: string): Project {
  const sheet = project.sheets.find((candidate) => candidate.id === id);
  if (!sheet?.paperTemplate) return project;
  return {
    ...project,
    sheets: project.sheets.map((candidate) =>
      candidate.id === id
        ? { ...candidate, paperTemplate: undefined }
        : candidate,
    ),
  };
}

export function calibrateSheetTemplateGeometry(
  geometry: PaperPrimitive[],
  a: Point,
  b: Point,
  distanceMm: number,
  paperOrigin: Point = { x: 0, y: 0 },
): PaperPrimitive[] {
  point.parse(a);
  point.parse(b);
  point.parse(paperOrigin);
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const factor = distanceMm / distance;
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(distanceMm))
    throw Error(
      'Informe dois pontos distintos e uma distância positiva em mm.',
    );
  const transform = (p: Point) =>
    point.parse({
      x: paperOrigin.x + (p.x - a.x) * factor,
      y: paperOrigin.y + (p.y - a.y) * factor,
    });
  return geometry.map((item) => ({
    ...item,
    points: item.points.map(transform),
    textHeight:
      item.textHeight === undefined
        ? undefined
        : num.positive().parse(item.textHeight * factor),
    resolvedStyle: item.resolvedStyle
      ? {
          ...item.resolvedStyle,
          lineType: {
            ...item.resolvedStyle.lineType,
            pattern: item.resolvedStyle.lineType.pattern.map((n) =>
              num.parse(n * factor),
            ),
          },
        }
      : undefined,
  }));
}
