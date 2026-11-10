import { cadBinding, cadDefaults } from './cadDefaults';
import { plotSettings } from './plotting';
import { maskPoint } from '../cad/import';
import {
  localMaskPoint,
  nativePrimitive,
  validateNativeMask,
} from './nativeMasks';
import {
  assertLocalMaskEdit,
  drawingLayerId,
  localDrawingLayer,
  maskDrawingState,
  type MaskDrawingContext,
} from './maskDrawing';
import {
  DEFAULT_TEXT_FONT,
  validateTextContent,
  validateTextFont,
} from './textStyle';
import {
  uid,
  type Mask,
  type Point,
  type Primitive,
  type Project,
  type TextFont,
} from './types';

/**
 * Editor values in model (world) terms. `height` is model mm for a model text
 * and paper mm for a sheet text, converted with `paperScale` (1:N).
 */
export type FreeTextDraft = {
  text: string;
  height: number;
  size: 'model' | 'paper';
  paperScale: number;
  rotation: number;
  align: 'left' | 'center' | 'right';
  font: TextFont;
};
const finite = (n: number) => Number.isFinite(n);
export const isFreeText = (q: Primitive | undefined): q is Primitive =>
  q?.native?.kind === 'text' && q.text !== undefined;
export function freeTextDefaults(p: Project): FreeTextDraft {
  const t = cadDefaults(p).texts;
  return {
    text: '',
    height: t.height,
    size: 'model',
    paperScale: plotSettings(p).referenceScale,
    rotation: 0,
    align: t.align ?? 'left',
    font: { ...DEFAULT_TEXT_FONT },
  };
}
export function freeTextModelHeight(d: FreeTextDraft) {
  return d.size === 'paper' ? d.height * d.paperScale : d.height;
}
export function validateFreeTextDraft(d: FreeTextDraft): FreeTextDraft {
  validateTextContent(d.text);
  const font = validateTextFont(d.font);
  if (!['model', 'paper'].includes(d.size))
    throw new Error('Escolha altura de modelo ou de folha.');
  if (!finite(d.paperScale) || d.paperScale < 1 || d.paperScale > 10000)
    throw new Error('Escala de papel: 1:1 a 1:10000.');
  const model = freeTextModelHeight(d);
  if (!finite(d.height) || d.height <= 0 || !finite(model) || model > 10000)
    throw new Error(
      'Altura do texto: positiva e até 10.000 mm no modelo (folha × escala).',
    );
  if (!finite(d.rotation) || Math.abs(d.rotation) > 360000)
    throw new Error('Rotação do texto inválida.');
  if (!['left', 'center', 'right'].includes(d.align))
    throw new Error('Alinhamento inválido.');
  return { ...d, font, rotation: ((d.rotation % 360) + 360) % 360 };
}
/** Local mask primitive; position and size are converted out of the mask transform once. */
function localText(
  mask: Mask,
  at: Point,
  input: FreeTextDraft,
  base: Primitive,
): Primitive {
  const d = validateFreeTextDraft(input);
  const local = localMaskPoint(at, mask);
  const rotation = (((d.rotation - mask.rotation) % 360) + 360) % 360;
  const q: Primitive = {
    ...base,
    ...nativePrimitive({ kind: 'text', at: local }, base.id, base.layer),
    text: d.text,
    textHeight: freeTextModelHeight(d) / mask.scale,
    textRotation: Math.abs(rotation) < 1e-12 ? 0 : rotation,
    textAlign: d.align,
    textFont: d.font,
  };
  if (d.size === 'paper') q.textPaperScale = d.paperScale;
  else delete q.textPaperScale;
  return q;
}
/** World primitive for the on-canvas preview; never part of the project. */
export function freeTextPreview(
  p: Project,
  mask: Mask,
  at: Point,
  d: FreeTextDraft,
): Primitive {
  const q = localText(mask, at, d, {
    id: 'free-text-preview',
    layer: localDrawingLayer(mask),
    layerId: drawingLayerId(p, mask),
    points: [],
  });
  return {
    ...q,
    points: [maskPoint(q.points[0], mask)],
    textHeight: q.textHeight! * mask.scale,
    textRotation: q.textRotation! + mask.rotation,
  };
}
/** Editor values of an existing native text, in model (world) terms. */
export function freeTextDraftOf(q: Primitive, mask: Mask): FreeTextDraft {
  if (!isFreeText(q)) throw new Error('A entidade não é um texto livre.');
  const model = (q.textHeight ?? 2.5) * mask.scale;
  return {
    text: q.text!,
    size: q.textPaperScale ? 'paper' : 'model',
    paperScale: q.textPaperScale ?? 50,
    height: q.textPaperScale ? model / q.textPaperScale : model,
    rotation: ((((q.textRotation ?? 0) + mask.rotation) % 360) + 360) % 360,
    align: q.textAlign ?? 'left',
    font: q.textFont ?? { ...DEFAULT_TEXT_FONT },
  };
}
export function freeTextWorldPoint(q: Primitive, mask: Mask): Point {
  if (q.native?.kind !== 'text') throw new Error('Texto livre inválido.');
  return maskPoint(q.native.at, mask);
}
function target(
  p: Project,
  maskId: string,
  context: MaskDrawingContext,
  expected: Mask,
) {
  const state = maskDrawingState(p, maskId, context),
    m = state.mask;
  if (!m || !state.editable) throw new Error(state.reason);
  if (m !== expected)
    throw new Error(
      'A máscara mudou. Reinicie o texto para conferir o destino.',
    );
  return m;
}
/** One atomic insertion into the active mask, with the CAD defaults of new mask entities. */
export function appendFreeText(
  p: Project,
  maskId: string,
  at: Point,
  draft: FreeTextDraft,
  context: MaskDrawingContext,
  expected: Mask,
  id: string = uid(),
) {
  const m = target(p, maskId, context, expected);
  if (m.primitives.length >= 100000)
    throw new Error('Limite de entidades da máscara atingido.');
  if (m.primitives.some((q) => q.id === id))
    throw new Error('Texto já inserido; nada foi duplicado.');
  const primitive = localText(m, at, draft, {
    id,
    layer: localDrawingLayer(m),
    layerId: drawingLayerId(p, m),
    ...(p.cadDefaults ? cadBinding(p, cadDefaults(p).masks.entity) : {}),
    points: [],
  });
  const next: Mask = {
    ...m,
    layers: { ...m.layers, [primitive.layer]: true },
    primitives: [...m.primitives, primitive],
  };
  validateNativeMask(next);
  return {
    project: { ...p, masks: p.masks.map((o) => (o.id === maskId ? next : o)) },
    id,
  };
}
/**
 * Edit content/typography (and optionally the insertion point) of a native
 * text, keeping its ID, layer binding, style overrides and list position.
 */
export function editFreeText(
  p: Project,
  maskId: string,
  entityId: string,
  draft: FreeTextDraft,
  context: MaskDrawingContext,
  expected: Mask,
  at?: Point,
) {
  const m = target(p, maskId, context, expected);
  const index = m.primitives.findIndex((q) => q.id === entityId);
  const before = m.primitives[index];
  if (!isFreeText(before))
    throw new Error('Texto livre inexistente nesta máscara.');
  const after = localText(
    m,
    at ?? freeTextWorldPoint(before, m),
    draft,
    before,
  );
  const next: Mask = {
    ...m,
    primitives: m.primitives.map((q, i) => (i === index ? after : q)),
  };
  assertLocalMaskEdit(p, m, next, context);
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  return {
    project: changed
      ? { ...p, masks: p.masks.map((o) => (o.id === maskId ? next : o)) }
      : p,
    changed,
  };
}
