import { z } from 'zod';
import { primitiveSchema } from './primitiveSchema';
import { layerBindingShape } from './layerSchema';
import { symbolDefinitions, symbolInstances } from './symbolRender';
export * from './symbolRender';
import { nativePrimitive } from './nativeMasks';
import { maskManipSelection } from './maskManipulation';
import { maskEditTarget, type MaskEntityRef } from './maskCadEditing';
import { drawingLayerId, localDrawingLayer } from './maskDrawing';
import { layerState, objectState } from './layerProfiles';
import { objectHidden } from './visibility';
import { layerId } from './layers';
import type { MaskDrawingContext } from './maskDrawing';
import {
  uid,
  type Mask,
  type Point,
  type Primitive,
  type Project,
  type SymbolDefinition,
  type SymbolInstance,
} from './types';

export const SYMBOL_LIMITS = {
  definitions: 500,
  instances: 10000,
  primitives: 5000,
  nameLength: 100,
  categoryLength: 60,
};
export const SYMBOL_CATALOG_SCHEMA = 'armadurastruct.symbols/1';
const LIMIT = 1e9;
const finite = (n: number) => Number.isFinite(n) && Math.abs(n) <= LIMIT;
const validPoint = (p: Point) => finite(p.x) && finite(p.y);
const rad = (deg: number) => (deg * Math.PI) / 180;

export type SymbolTransform = {
  origin: Point;
  /** Degrees, counterclockwise, like Mask.rotation. */
  rotation: number;
  scale: number;
};
export const identityTransform: SymbolTransform = {
  origin: { x: 0, y: 0 },
  rotation: 0,
  scale: 1,
};
export const normalizeSymbolText = (s: string) => s.trim().replace(/\s+/g, ' ');
const nameKey = (s: string) =>
  normalizeSymbolText(s).toLocaleUpperCase('pt-BR');

function checkText(name: string, category: string) {
  const n = normalizeSymbolText(name),
    c = normalizeSymbolText(category);
  if (!n || n.length > SYMBOL_LIMITS.nameLength)
    throw new Error(
      `Nome do símbolo: 1 a ${SYMBOL_LIMITS.nameLength} caracteres.`,
    );
  if (c.length > SYMBOL_LIMITS.categoryLength)
    throw new Error(
      `Categoria do símbolo: até ${SYMBOL_LIMITS.categoryLength} caracteres.`,
    );
  return { name: n, category: c };
}
/** First free "Nome (2)", "Nome (3)"… ignoring case; the user always confirms it. */
export function uniqueSymbolName(
  p: Pick<Project, 'symbols'>,
  name: string,
  ignoreId?: string,
) {
  const taken = new Set(
    symbolDefinitions(p)
      .filter((d) => d.id !== ignoreId)
      .map((d) => nameKey(d.name)),
  );
  const base = normalizeSymbolText(name);
  if (!taken.has(nameKey(base))) return base;
  for (let i = 2; ; i++) {
    const suffix = ` (${i})`;
    const candidate =
      base.slice(0, SYMBOL_LIMITS.nameLength - suffix.length) + suffix;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
}
function assertFreeName(
  p: Pick<Project, 'symbols'>,
  name: string,
  ignoreId?: string,
) {
  if (nameKey(uniqueSymbolName(p, name, ignoreId)) !== nameKey(name))
    throw new Error(
      `Já existe um símbolo chamado "${normalizeSymbolText(name)}". Sugestão: "${uniqueSymbolName(p, name, ignoreId)}".`,
    );
}

/**
 * Similarity (rotation + uniform positive scale + translation) applied to one
 * CAD entity. Circles and arcs stay analytic; an oblique rectangle becomes its
 * four exact vertices. Nothing is discretized beyond the existing native model.
 */
export function transformSymbolPrimitive(
  q: Primitive,
  t: SymbolTransform,
): Primitive {
  if (!(t.scale > 0) || !finite(t.scale) || !finite(t.rotation))
    throw new Error(
      'Escala e rotação do símbolo devem ser finitas (escala > 0).',
    );
  const c = Math.cos(rad(t.rotation)),
    s = Math.sin(rad(t.rotation));
  const at = (v: Point): Point => ({
    x: t.origin.x + t.scale * (v.x * c - v.y * s),
    y: t.origin.y + t.scale * (v.x * s + v.y * c),
  });
  const out: Primitive = { ...q };
  if (q.native) {
    const n = q.native;
    if (n.kind === 'circle')
      out.native = { ...n, center: at(n.center), radius: n.radius * t.scale };
    else if (n.kind === 'arc')
      out.native = {
        ...n,
        center: at(n.center),
        radius: n.radius * t.scale,
        startAngle: n.startAngle + t.rotation,
      };
    else if (n.kind === 'rectangle') {
      const axisAligned =
        Math.abs(Math.sin(rad(t.rotation))) < 1e-12 &&
        Math.cos(rad(t.rotation)) > 0;
      out.native = axisAligned
        ? { ...n, points: n.points.map(at) }
        : {
            kind: 'polyline',
            closed: true,
            points: nativePrimitive(n).points.map(at),
          };
    } else out.native = { ...n, points: n.points.map(at) };
    const rendered = nativePrimitive(out.native, q.id ?? 'symbol', q.layer);
    out.points = rendered.points;
    out.closed = rendered.closed;
  } else out.points = q.points.map(at);
  if (q.text !== undefined) {
    out.textHeight = (q.textHeight ?? 2.5) * t.scale;
    out.textRotation =
      ((((q.textRotation ?? 0) + t.rotation) % 360) + 360) % 360;
    if (out.textRotation > 180) out.textRotation -= 360;
  }
  const coords = [
    ...out.points,
    ...(out.native && 'center' in out.native
      ? [
          {
            x: out.native.center.x - out.native.radius,
            y: out.native.center.y - out.native.radius,
          },
          {
            x: out.native.center.x + out.native.radius,
            y: out.native.center.y + out.native.radius,
          },
        ]
      : []),
  ];
  if (!coords.every(validPoint))
    throw new Error('Resultado fora dos limites de ±1.000.000.000 mm.');
  return out;
}
/** Definition space is pure geometry: no layer, steel, style or lineage of the source mask. */
const neutral = (q: Primitive, id: string): Primitive => ({
  id,
  ...(q.native ? { native: q.native } : {}),
  layer: 'DESENHO',
  points: q.points,
  ...(q.closed !== undefined ? { closed: q.closed } : {}),
  ...(q.text !== undefined
    ? {
        text: q.text,
        textHeight: q.textHeight,
        textRotation: q.textRotation,
        textAlign: q.textAlign,
      }
    : {}),
});
const compact = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** World primitives of a mask entity, relative to the symbol base point. */
export function bakeMaskPrimitives(
  mask: Mask,
  prims: Primitive[],
  base: Point,
): Primitive[] {
  if (!validPoint(base)) throw new Error('Ponto base fora dos limites.');
  const t: SymbolTransform = {
    origin: {
      x: mask.origin.x - base.x,
      y: mask.origin.y - base.y,
    },
    rotation: mask.rotation,
    scale: mask.scale,
  };
  return prims.map((q) =>
    compact(neutral(transformSymbolPrimitive(q, t), uid())),
  );
}

export function validateSymbolPrimitives(prims: Primitive[]) {
  if (!prims.length)
    throw new Error('O símbolo precisa de ao menos uma entidade.');
  if (prims.length > SYMBOL_LIMITS.primitives)
    throw new Error(
      `Um símbolo comporta até ${SYMBOL_LIMITS.primitives} entidades.`,
    );
  const ids = new Set<string>();
  for (const q of prims) {
    primitiveSchema.parse(q);
    if (q.layerId || q.style || q.plot || q.drafting)
      throw new Error('Definições de símbolo não carregam layer nem estilo.');
    if (!q.id || ids.has(q.id))
      throw new Error('Entidade do símbolo sem identidade única.');
    ids.add(q.id);
    if (!q.points.every(validPoint))
      throw new Error('Entidade do símbolo fora dos limites.');
    if (q.native) {
      const expected = nativePrimitive(q.native, q.id, q.layer);
      if (
        expected.points.length !== q.points.length ||
        expected.points.some(
          (v, i) =>
            Math.abs(v.x - q.points[i].x) > 1e-6 + Math.abs(v.x) * 1e-12 ||
            Math.abs(v.y - q.points[i].y) > 1e-6 + Math.abs(v.y) * 1e-12,
        )
      )
        throw new Error('Representação da entidade nativa inconsistente.');
    }
  }
}
export const validateTransform = (t: SymbolTransform) => {
  if (
    !validPoint(t.origin) ||
    !finite(t.rotation) ||
    !(t.scale > 0) ||
    t.scale > 10000
  )
    throw new Error(
      'Posição, rotação e escala devem ser finitas (escala entre 0 e 10000).',
    );
};

export const symbolDefinitionSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(SYMBOL_LIMITS.nameLength),
  category: z.string().max(SYMBOL_LIMITS.categoryLength),
  revision: z.number().int().min(1).max(1e9),
  primitives: z.array(primitiveSchema).min(1).max(SYMBOL_LIMITS.primitives),
});
export const symbolInstanceSchema = z.object({
  ...layerBindingShape,
  id: z.string().min(1).max(200),
  definitionId: z.string().min(1).max(200),
  layerId: z.string().min(1).max(200),
  origin: z.object({ x: z.number().finite(), y: z.number().finite() }),
  rotation: z.number().finite(),
  scale: z.number().finite().positive().max(10000),
});

/** Whole-project invariant: no duplicates, no orphan instance, no stray layer. */
export function validateSymbols(p: Project) {
  const defs = symbolDefinitions(p),
    insts = symbolInstances(p);
  if (defs.length > SYMBOL_LIMITS.definitions)
    throw new Error(
      `A biblioteca comporta até ${SYMBOL_LIMITS.definitions} símbolos.`,
    );
  if (insts.length > SYMBOL_LIMITS.instances)
    throw new Error(
      `O projeto comporta até ${SYMBOL_LIMITS.instances} instâncias.`,
    );
  const ids = new Set<string>(),
    names = new Set<string>();
  for (const d of defs) {
    symbolDefinitionSchema.parse(d);
    checkText(d.name, d.category);
    if (ids.has(d.id)) throw new Error('Definições de símbolo duplicadas.');
    ids.add(d.id);
    if (names.has(nameKey(d.name)))
      throw new Error(`Nome de símbolo duplicado: ${d.name}.`);
    names.add(nameKey(d.name));
    validateSymbolPrimitives(d.primitives);
  }
  const layers = new Set(p.layers.map((l) => l.id)),
    seen = new Set<string>();
  for (const i of insts) {
    symbolInstanceSchema.parse(i);
    if (seen.has(i.id)) throw new Error('Instâncias de símbolo duplicadas.');
    seen.add(i.id);
    if (!ids.has(i.definitionId))
      throw new Error('Instância de símbolo sem definição correspondente.');
    if (!layers.has(i.layerId))
      throw new Error('Instância de símbolo em layer inexistente.');
    validateTransform(i);
  }
}

export const instancesOf = (p: Pick<Project, 'symbolInstances'>, id: string) =>
  symbolInstances(p).filter((i) => i.definitionId === id);

/** Default layer for a new instance: same rule as local drawing, never a stray id. */
export function defaultInstanceLayer(p: Project) {
  return (
    p.cadDefaults?.masks.entity.layerId ??
    p.layers.find((l) => l.id === layerId('DESENHO'))?.id ??
    p.layers[0].id
  );
}

type Plan<K extends string> = {
  kind: K;
  project: Project;
  context: MaskDrawingContext;
};
function assertFresh(
  p: Project,
  plan: Plan<string>,
  context: MaskDrawingContext,
) {
  if (
    p !== plan.project ||
    context.key !== plan.context.key ||
    context.detailId !== plan.context.detailId ||
    context.scopeDetailId !== plan.context.scopeDetailId
  )
    throw new Error(
      'O projeto mudou. Reinicie a operação no contexto correto.',
    );
}
function assertDrawingContext(p: Project, context: MaskDrawingContext) {
  if (context.key.startsWith('sheet:'))
    throw new Error(
      'Abra o desenho/detalhamento; não se insere símbolo no papel.',
    );
  if (!p.hierarchy.details.some((d) => d.id === context.detailId))
    throw new Error('Detalhamento ativo inexistente.');
  if (context.scopeDetailId && context.scopeDetailId !== context.detailId)
    throw new Error('Isolamento ativo em outro detalhamento.');
}
const withSymbols = (
  p: Project,
  symbols: SymbolDefinition[],
  symbolInstances: SymbolInstance[],
): Project => ({
  ...p,
  symbols,
  symbolInstances,
});

// ───────────────────────── creation ─────────────────────────
export type SymbolCreationInput = {
  maskId: string;
  refs: MaskEntityRef[];
  name: string;
  category?: string;
  base: Point;
};
export type SymbolCreationPlan = Plan<'create'> & {
  definition: SymbolDefinition;
};
export function previewSymbolCreation(
  p: Project,
  input: SymbolCreationInput,
  context: MaskDrawingContext,
): SymbolCreationPlan {
  const { name, category } = checkText(input.name, input.category ?? '');
  assertFreeName(p, name);
  if (symbolDefinitions(p).length >= SYMBOL_LIMITS.definitions)
    throw new Error(
      `A biblioteca comporta até ${SYMBOL_LIMITS.definitions} símbolos.`,
    );
  const { mask, entities } = maskManipSelection(
    p,
    input.maskId,
    input.refs,
    context,
  );
  const primitives = bakeMaskPrimitives(
    mask,
    entities.map((e) => e.ref.primitive),
    input.base,
  );
  validateSymbolPrimitives(primitives);
  return {
    kind: 'create',
    project: p,
    context: { ...context },
    definition: { id: uid(), name, category, revision: 1, primitives },
  };
}
export function applySymbolCreation(
  p: Project,
  plan: SymbolCreationPlan,
  context: MaskDrawingContext,
): Project {
  assertFresh(p, plan, context);
  // Re-validate against the snapshot: a repeated confirmation hits the name check.
  assertFreeName(p, plan.definition.name);
  const next = withSymbols(
    p,
    [...symbolDefinitions(p), plan.definition],
    symbolInstances(p),
  );
  validateSymbols(next);
  return next;
}

// ───────────────────────── insertion ─────────────────────────
export type SymbolInsertMode = 'instance' | 'copy';
export type SymbolInsertionPlan = Plan<'insert'> & {
  definition: SymbolDefinition;
  mode: SymbolInsertMode;
  transform: SymbolTransform;
  layerId: string;
  maskId?: string;
  /** World-space entities for the preview; the project is not touched. */
  preview: Primitive[];
};
function copyPrimitives(
  p: Project,
  d: SymbolDefinition,
  mask: Mask,
  t: SymbolTransform,
): Primitive[] {
  // symbol → world → mask local, composed once.
  const k = 1 / mask.scale,
    c = Math.cos(rad(-mask.rotation)),
    s = Math.sin(rad(-mask.rotation));
  const dx = t.origin.x - mask.origin.x,
    dy = t.origin.y - mask.origin.y;
  const local: SymbolTransform = {
    origin: { x: k * (dx * c - dy * s), y: k * (dx * s + dy * c) },
    rotation: t.rotation - mask.rotation,
    scale: t.scale * k,
  };
  const layer = localDrawingLayer(mask),
    lid = drawingLayerId(p, mask);
  return d.primitives.map((q) => {
    const moved = transformSymbolPrimitive(q, local);
    if (mask.format === 'NATIVE' && !moved.native) {
      if (moved.text !== undefined || moved.points.length < 2)
        throw new Error(
          'O símbolo tem texto ou geometria importada; insira-o como instância.',
        );
      if (moved.points.length > 500)
        throw new Error(
          'Geometria longa demais para uma máscara nativa; insira como instância.',
        );
      return {
        ...nativePrimitive(
          { kind: 'polyline', points: moved.points, closed: !!moved.closed },
          uid(),
          layer,
        ),
        layerId: lid,
      };
    }
    return { ...moved, id: uid(), layer, layerId: lid };
  });
}
export function previewSymbolInsertion(
  p: Project,
  definitionId: string,
  transform: SymbolTransform,
  mode: SymbolInsertMode,
  context: MaskDrawingContext,
  options: { maskId?: string; layerId?: string } = {},
): SymbolInsertionPlan {
  const d = symbolDefinitions(p).find((d) => d.id === definitionId);
  if (!d) throw new Error('Símbolo inexistente na biblioteca.');
  assertDrawingContext(p, context);
  validateTransform(transform);
  const layer = options.layerId ?? defaultInstanceLayer(p);
  if (!p.layers.some((l) => l.id === layer))
    throw new Error('Layer de destino inexistente.');
  if (
    !layerState(p, context.key, layer).visible ||
    !layerState(p, context.key, layer).editable
  )
    throw new Error('Layer de destino oculto ou bloqueado; libere-o antes.');
  let maskId: string | undefined;
  if (mode === 'instance') {
    if (symbolInstances(p).length >= SYMBOL_LIMITS.instances)
      throw new Error(
        `O projeto comporta até ${SYMBOL_LIMITS.instances} instâncias.`,
      );
  } else {
    const mask = maskEditTarget(p, options.maskId, context);
    if (
      !mask.visible ||
      mask.opacity === 0 ||
      objectHidden(p, context.key, mask.id) ||
      !objectState(p, context.key, mask).editable
    )
      throw new Error('Máscara ativa oculta ou bloqueada nesta vista.');
    if (mask.primitives.length + d.primitives.length > 100000)
      throw new Error('Limite de 100 mil entidades da máscara atingido.');
    copyPrimitives(p, d, mask, transform);
    maskId = mask.id;
  }
  return {
    kind: 'insert',
    project: p,
    context: { ...context },
    definition: d,
    mode,
    transform: { ...transform, origin: { ...transform.origin } },
    layerId: layer,
    maskId,
    preview: d.primitives.map((q) => transformSymbolPrimitive(q, transform)),
  };
}
export function applySymbolInsertion(
  p: Project,
  plan: SymbolInsertionPlan,
  context: MaskDrawingContext,
  id: string = uid(),
): Project {
  assertFresh(p, plan, context);
  const fresh = previewSymbolInsertion(
    p,
    plan.definition.id,
    plan.transform,
    plan.mode,
    context,
    { maskId: plan.maskId, layerId: plan.layerId },
  );
  if (fresh.mode === 'instance') {
    const instance: SymbolInstance = {
      id,
      definitionId: fresh.definition.id,
      layerId: fresh.layerId,
      ...fresh.transform,
    };
    const next = withSymbols(p, symbolDefinitions(p), [
      ...symbolInstances(p),
      instance,
    ]);
    const owned = {
      ...next,
      hierarchy: {
        ...next.hierarchy,
        objectDetails: {
          ...next.hierarchy.objectDetails,
          [id]: context.detailId,
        },
      },
    };
    validateSymbols(owned);
    return owned;
  }
  const mask = p.masks.find((m) => m.id === fresh.maskId)!;
  const added = copyPrimitives(p, fresh.definition, mask, fresh.transform);
  return {
    ...p,
    masks: p.masks.map((m) =>
      m === mask ? { ...m, primitives: [...m.primitives, ...added] } : m,
    ),
  };
}

// ───────────────────── instance transformation ─────────────────────
/** Independent per-instance transform; the definition and the other instances stay put. */
export function transformSymbolInstance(
  p: Project,
  instanceId: string,
  patch: Partial<SymbolTransform> & { layerId?: string },
): Project {
  const i = symbolInstances(p).find((i) => i.id === instanceId);
  if (!i) throw new Error('Instância inexistente.');
  const next: SymbolInstance = {
    ...i,
    ...(patch.origin ? { origin: { ...patch.origin } } : {}),
    ...(patch.rotation !== undefined ? { rotation: patch.rotation } : {}),
    ...(patch.scale !== undefined ? { scale: patch.scale } : {}),
    ...(patch.layerId ? { layerId: patch.layerId } : {}),
  };
  validateTransform(next);
  if (!p.layers.some((l) => l.id === next.layerId))
    throw new Error('Layer de destino inexistente.');
  if (
    next.origin.x === i.origin.x &&
    next.origin.y === i.origin.y &&
    next.rotation === i.rotation &&
    next.scale === i.scale &&
    next.layerId === i.layerId
  )
    return p;
  return {
    ...p,
    symbolInstances: symbolInstances(p).map((x) => (x === i ? next : x)),
  };
}
/** Replaces the instance by independent copies in the active mask. */
export function detachSymbolInstance(
  p: Project,
  instanceId: string,
  maskId: string | undefined,
  context: MaskDrawingContext,
): Project {
  const i = symbolInstances(p).find((i) => i.id === instanceId);
  const d = i && symbolDefinitions(p).find((d) => d.id === i.definitionId);
  if (!i || !d) throw new Error('Instância inexistente.');
  if (p.hierarchy.objectDetails[i.id] !== context.detailId)
    throw new Error('A instância pertence a outro detalhamento.');
  const plan = previewSymbolInsertion(
    p,
    d.id,
    { origin: i.origin, rotation: i.rotation, scale: i.scale },
    'copy',
    context,
    { maskId, layerId: i.layerId },
  );
  return removeInstances(applySymbolInsertion(p, plan, context), [i.id]);
}
function removeInstances(p: Project, ids: string[]): Project {
  const gone = new Set(ids);
  const objectDetails = { ...p.hierarchy.objectDetails },
    objectOrigins = { ...p.hierarchy.objectOrigins };
  for (const id of gone) {
    delete objectDetails[id];
    delete objectOrigins[id];
  }
  return {
    ...p,
    symbolInstances: symbolInstances(p).filter((i) => !gone.has(i.id)),
    hierarchy: { ...p.hierarchy, objectDetails, objectOrigins },
  };
}
export function removeSymbolInstance(p: Project, instanceId: string): Project {
  if (!symbolInstances(p).some((i) => i.id === instanceId))
    throw new Error('Instância inexistente.');
  return removeInstances(p, [instanceId]);
}

// ───────────────────── definition edit and removal ─────────────────────
export type SymbolEditPatch = {
  name?: string;
  category?: string;
  /** Replaces the geometry with a fresh mask selection. */
  geometry?: { maskId: string; refs: MaskEntityRef[]; base: Point };
};
export type SymbolEditPlan = Plan<'edit'> & {
  definition: SymbolDefinition;
  next: SymbolDefinition;
  /** Instances whose appearance (geometry or label) changes with the edit. */
  affected: SymbolInstance[];
  geometryChanged: boolean;
};
export function previewSymbolEdit(
  p: Project,
  definitionId: string,
  patch: SymbolEditPatch,
  context: MaskDrawingContext,
): SymbolEditPlan {
  const d = symbolDefinitions(p).find((d) => d.id === definitionId);
  if (!d) throw new Error('Símbolo inexistente na biblioteca.');
  const { name, category } = checkText(
    patch.name ?? d.name,
    patch.category ?? d.category,
  );
  assertFreeName(p, name, d.id);
  let primitives = d.primitives;
  if (patch.geometry) {
    const { mask, entities } = maskManipSelection(
      p,
      patch.geometry.maskId,
      patch.geometry.refs,
      context,
    );
    primitives = bakeMaskPrimitives(
      mask,
      entities.map((e) => e.ref.primitive),
      patch.geometry.base,
    );
    validateSymbolPrimitives(primitives);
  }
  const geometryChanged = primitives !== d.primitives;
  const changed = geometryChanged || name !== d.name || category !== d.category;
  if (!changed) throw new Error('Nenhuma alteração a aplicar.');
  return {
    kind: 'edit',
    project: p,
    context: { ...context },
    definition: d,
    next: {
      ...d,
      name,
      category,
      primitives,
      revision: geometryChanged ? d.revision + 1 : d.revision,
    },
    affected: geometryChanged ? instancesOf(p, d.id) : [],
    geometryChanged,
  };
}
export function applySymbolEdit(
  p: Project,
  plan: SymbolEditPlan,
  context: MaskDrawingContext,
): Project {
  assertFresh(p, plan, context);
  const next = withSymbols(
    p,
    symbolDefinitions(p).map((d) => (d === plan.definition ? plan.next : d)),
    symbolInstances(p),
  );
  validateSymbols(next);
  return next;
}
export type SymbolRemovalPlan = Plan<'remove'> & {
  definition: SymbolDefinition;
  instances: SymbolInstance[];
};
export function previewSymbolRemoval(
  p: Project,
  definitionId: string,
  context: MaskDrawingContext,
): SymbolRemovalPlan {
  const d = symbolDefinitions(p).find((d) => d.id === definitionId);
  if (!d) throw new Error('Símbolo inexistente na biblioteca.');
  return {
    kind: 'remove',
    project: p,
    context: { ...context },
    definition: d,
    instances: instancesOf(p, d.id),
  };
}
/** A used definition goes only with its instances, atomically: no orphan survives. */
export function applySymbolRemoval(
  p: Project,
  plan: SymbolRemovalPlan,
  context: MaskDrawingContext,
  removeInstancesToo = false,
): Project {
  assertFresh(p, plan, context);
  if (plan.instances.length && !removeInstancesToo)
    throw new Error(
      `${plan.instances.length} instância(s) usam este símbolo; confirme a remoção delas.`,
    );
  const next = removeInstances(
    p,
    plan.instances.map((i) => i.id),
  );
  return {
    ...next,
    symbols: symbolDefinitions(next).filter((d) => d !== plan.definition),
  };
}

// ───────────────────── catalog interchange ─────────────────────
export const symbolCatalogSchema = z.object({
  schema: z.literal(SYMBOL_CATALOG_SCHEMA),
  producer: z.object({
    app: z.string().min(1).max(100),
    version: z.string().max(40),
  }),
  symbols: z
    .array(symbolDefinitionSchema.omit({ id: true, revision: true }))
    .min(1)
    .max(SYMBOL_LIMITS.definitions),
});
export type SymbolCatalog = z.infer<typeof symbolCatalogSchema>;
export function exportSymbolCatalog(
  p: Project,
  ids: string[] | undefined,
  producer: { app: string; version: string },
): string {
  const chosen = symbolDefinitions(p).filter((d) => !ids || ids.includes(d.id));
  if (!chosen.length) throw new Error('Nenhum símbolo para exportar.');
  const catalog: SymbolCatalog = {
    schema: SYMBOL_CATALOG_SCHEMA,
    producer,
    symbols: chosen.map(({ name, category, primitives }) => ({
      name,
      category,
      primitives,
    })),
  };
  return JSON.stringify(catalog, null, 2);
}
export function parseSymbolCatalog(raw: string): SymbolCatalog {
  if (raw.length > 64_000_000) throw new Error('Catálogo grande demais.');
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error('Catálogo de símbolos inválido: JSON malformado.');
  }
  if (
    typeof input === 'object' &&
    input &&
    (input as { schema?: unknown }).schema !== SYMBOL_CATALOG_SCHEMA
  )
    throw new Error(
      'Arquivo não é um catálogo de símbolos do ArmaduraStruct (formato symbols/1).',
    );
  const parsed = symbolCatalogSchema.parse(input);
  const names = new Set<string>();
  for (const s of parsed.symbols) {
    checkText(s.name, s.category);
    if (names.has(nameKey(s.name)))
      throw new Error(`Catálogo com nome repetido: ${s.name}.`);
    names.add(nameKey(s.name));
    validateSymbolPrimitives(s.primitives);
  }
  return parsed;
}
export type CatalogDuplicates = 'rename' | 'skip';
export type CatalogImportPlan = {
  project: Project;
  added: SymbolDefinition[];
  renamed: { from: string; to: string }[];
  skipped: string[];
};
export function previewCatalogImport(
  p: Project,
  catalog: SymbolCatalog,
  onDuplicate: CatalogDuplicates,
): CatalogImportPlan {
  const added: SymbolDefinition[] = [],
    renamed: { from: string; to: string }[] = [],
    skipped: string[] = [];
  let scratch: Pick<Project, 'symbols'> = {
    symbols: [...symbolDefinitions(p)],
  };
  for (const s of catalog.symbols) {
    const free = uniqueSymbolName(scratch, s.name);
    if (nameKey(free) !== nameKey(s.name)) {
      if (onDuplicate === 'skip') {
        skipped.push(s.name);
        continue;
      }
      renamed.push({ from: s.name, to: free });
    }
    // Fresh identities: a catalog never collides with, nor aliases, project ids.
    const definition: SymbolDefinition = {
      id: uid(),
      name: free,
      category: normalizeSymbolText(s.category),
      revision: 1,
      primitives: s.primitives.map((q) => ({
        ...structuredClone(q),
        id: uid(),
      })),
    };
    added.push(definition);
    scratch = { symbols: [...(scratch.symbols ?? []), definition] };
  }
  if (symbolDefinitions(p).length + added.length > SYMBOL_LIMITS.definitions)
    throw new Error(
      `A biblioteca comporta até ${SYMBOL_LIMITS.definitions} símbolos.`,
    );
  return { project: p, added, renamed, skipped };
}
export function applyCatalogImport(
  p: Project,
  plan: CatalogImportPlan,
): Project {
  if (p !== plan.project)
    throw new Error('O projeto mudou. Reinicie a importação do catálogo.');
  if (!plan.added.length) return p;
  const next = withSymbols(
    p,
    [...symbolDefinitions(p), ...plan.added],
    symbolInstances(p),
  );
  validateSymbols(next);
  return next;
}

export const searchSymbols = (p: Pick<Project, 'symbols'>, query: string) => {
  const q = normalizeSymbolText(query).toLocaleLowerCase('pt-BR');
  return symbolDefinitions(p).filter(
    (d) =>
      !q ||
      d.name.toLocaleLowerCase('pt-BR').includes(q) ||
      d.category.toLocaleLowerCase('pt-BR').includes(q),
  );
};
