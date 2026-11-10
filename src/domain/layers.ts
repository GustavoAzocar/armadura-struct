import type {
  DrawingLayer,
  DrawingStyle,
  LayerBinding,
  Primitive,
  PlotStyle,
  Project,
} from './types';
import { uid } from './types';
import {
  drawingLayerSchema,
  drawingStyleSchema,
  plotStyleSchema,
} from './layerSchema';
export const LINE_TYPES = [
  { name: 'CONTINUOUS', pattern: [] },
  { name: 'DASHED', pattern: [100, -50] },
  { name: 'DOTTED', pattern: [0, -40] },
  { name: 'DASHDOT', pattern: [100, -30, 0, -30] },
];
const defaults: [string, string, number][] = [
  ['ARMADURAS', '#4a88ff', 0.35],
  ['REBATIMENTOS', '#4cc9cd', 0.25],
  ['IDENTIFICACAO', '#8995b3', 0.18],
  ['COTAS', '#8995b3', 0.18],
  ['DISTRIBUICAO', '#76a9a7', 0.18],
  ['DESENHO', '#8995b3', 0.18],
  ['CORTES', '#c88be2', 0.18],
  ['CHAMADAS', '#8995b3', 0.18],
  ['MASCARA', '#8992a4', 0.18],
  ['QUADRO_ACO', '#263044', 0.18],
];
export const layerId = (name: string) => `layer:${name}`;
export function defaultLayers(): DrawingLayer[] {
  return defaults.map(([name, color, lineWidth]) => ({
    id: layerId(name),
    name,
    color,
    lineType: { name: 'CONTINUOUS', pattern: [] },
    lineScale: 1,
    lineWidth,
    fill: 'none',
    fillColor: color,
  }));
}
export const layerObjects = (
  p: Pick<
    Project,
    | 'bars'
    | 'details'
    | 'annotations'
    | 'polylines'
    | 'masks'
    | 'symbolInstances'
  >,
) => [
  ...p.bars,
  ...p.details,
  ...p.annotations,
  ...p.polylines,
  ...p.masks,
  ...(p.symbolInstances ?? []),
];
export function objectRole(
  p: Project,
  o: LayerBinding & { id: string },
): string {
  if (p.bars.some((b) => b.id === o.id)) return 'ARMADURAS';
  if (p.details.some((b) => b.id === o.id)) return 'REBATIMENTOS';
  const a = p.annotations.find((a) => a.id === o.id);
  if (a)
    return a.kind.startsWith('dimension')
      ? 'COTAS'
      : a.kind.startsWith('section')
        ? 'CORTES'
        : 'CHAMADAS';
  return p.masks.some((m) => m.id === o.id) ||
    (p.symbolInstances ?? []).some((i) => i.id === o.id)
    ? 'MASCARA'
    : 'DESENHO';
}
export function resolveStyle(
  p: Pick<Project, 'layers'>,
  object: LayerBinding & { color?: string },
  role: string,
): DrawingStyle {
  const layer =
    p.layers.find((l) => l.id === (object.layerId ?? layerId(role))) ??
    p.layers[0] ??
    defaultLayers()[0];
  return {
    ...layer,
    ...(!object.layerId && object.color ? { color: object.color } : {}),
    ...object.style,
  };
}
export function stylePrimitive(
  p: Pick<Project, 'layers'>,
  object: LayerBinding & { color?: string },
  item: Primitive,
  defaultRole?: string,
): Primitive {
  const role = item.role ?? item.layer;
  const binding = {
    layerId:
      object.layerId ??
      item.layerId ??
      (defaultRole ? layerId(defaultRole) : undefined),
    style: {
      ...item.style,
      ...(!object.layerId && object.color ? { color: object.color } : {}),
      ...object.style,
    },
  };
  const layer =
    p.layers.find((l) => l.id === (binding.layerId ?? layerId(role))) ??
    p.layers[0];
  return {
    ...item,
    role,
    layer: layer?.name ?? item.layer,
    layerId: layer?.id,
    style: binding.style,
    plot: mergePlotStyle(item.plot, object.plot),
    resolvedStyle: resolveStyle(p, binding, role),
  };
}
export function dashArray(
  style: DrawingStyle | undefined,
  scale = 1,
): number[] {
  if (!style) return [];
  // SVG/PDF need nonnegative dash-gap pairs, unlike signed DXF patterns.
  return style.lineType.pattern.map(
    (n) => (Math.abs(n) || 0.01) * style.lineScale * scale,
  );
}
export function validateLayers(p: Project) {
  if (!p.layers?.length || p.layers.length > 2000)
    throw new Error('O catálogo precisa conter de 1 a 2000 layers.');
  const ids = new Set<string>(),
    names = new Set<string>();
  for (const l of p.layers) {
    drawingLayerSchema.parse(l);
    const name = l.name.toLocaleUpperCase();
    if (ids.has(l.id) || names.has(name))
      throw new Error('IDs e nomes de layers devem ser únicos.');
    ids.add(l.id);
    names.add(name);
  }
  if (p.cadDefaults)
    for (const a of [
      p.cadDefaults.texts.appearance,
      p.cadDefaults.texts.identification,
      p.cadDefaults.armatures.bar,
      p.cadDefaults.armatures.representation,
      p.cadDefaults.dimensions.appearance,
      p.cadDefaults.masks.mask,
      p.cadDefaults.masks.entity,
    ])
      if (a.layerId && !ids.has(a.layerId))
        throw new Error(
          'Layer ainda usado nos padrões CAD. Reassocie-o em Configurações CAD antes de remover.',
        );
  for (const o of [
    ...layerObjects(p),
    ...p.masks.flatMap((m) => m.primitives),
  ]) {
    if (o.layerId && !ids.has(o.layerId))
      throw new Error(`Layer inexistente: ${o.layerId}.`);
    for (const binding of [o.drafting, o.drafting?.dimensions])
      if (binding?.layerId && !ids.has(binding.layerId))
        throw new Error('Layer de texto inexistente.');
    if (o.style) drawingStyleSchema.partial().parse(o.style);
    if (o.plot) plotStyleSchema.parse(o.plot);
  }
}
/** Imported styles never overwrite the styles of existing local objects. */
export function mergeLayers(target: Project, incoming: DrawingLayer[]) {
  const warnings: string[] = [];
  const layers = [...target.layers],
    map = new Map<string, string>();
  for (const raw of incoming) {
    const safeName =
      raw.name
        .trim()
        .replace(/[<>/\\":;?*|=\x00-\x1f]/g, '_')
        .slice(0, 200) || 'Referência';
    if (safeName !== raw.name)
      warnings.push(`Layer ${raw.name}: nome normalizado para ${safeName}.`);
    const l = drawingLayerSchema.parse({ ...raw, name: safeName });
    const equal = layers.find(
      (x) =>
        JSON.stringify({ ...x, id: '', name: '' }) ===
          JSON.stringify({ ...l, id: '', name: '' }) &&
        x.name.toUpperCase() === l.name.toUpperCase(),
    );
    if (equal) {
      map.set(l.id, equal.id);
      continue;
    }
    let id = l.id;
    while (layers.some((x) => x.id === id)) id = uid();
    let name = l.name,
      n = 2;
    while (layers.some((x) => x.name.toUpperCase() === name.toUpperCase()))
      name = `${l.name.slice(0, 185)} (${n++})`;
    if (name !== l.name)
      warnings.push(
        `Layer ${l.name}: nome local ${name} para preservar estilos existentes.`,
      );
    layers.push({ ...l, id, name });
    map.set(l.id, id);
  }
  return { project: { ...target, layers }, map, warnings };
}
export function remapLayer<T extends LayerBinding>(
  o: T,
  map: Map<string, string>,
): T {
  return {
    ...o,
    ...(o.layerId ? { layerId: map.get(o.layerId) ?? o.layerId } : {}),
    ...(o.drafting
      ? {
          drafting: {
            ...o.drafting,
            ...(o.drafting.layerId
              ? { layerId: map.get(o.drafting.layerId) ?? o.drafting.layerId }
              : {}),
            ...(o.drafting.dimensions
              ? {
                  dimensions: {
                    ...o.drafting.dimensions,
                    ...(o.drafting.dimensions.layerId
                      ? {
                          layerId:
                            map.get(o.drafting.dimensions.layerId) ??
                            o.drafting.dimensions.layerId,
                        }
                      : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}
export function completeLayers(p: Project): Project {
  let next = p;
  for (const m of p.masks) {
    if (m.layerDefinitions?.length) {
      const merged = mergeLayers(next, m.layerDefinitions);
      next = {
        ...merged.project,
        masks: next.masks.map((x) =>
          x.id === m.id
            ? {
                ...x,
                layerDefinitions: undefined,
                warnings: [...x.warnings, ...merged.warnings],
                primitives: x.primitives.map((q) => remapLayer(q, merged.map)),
              }
            : x,
        ),
      };
    }
  }
  // Legacy masks retain individual source layers, rather than collapsing to MASCARA.
  for (const m of next.masks.filter((m) => m.format !== 'NATIVE')) {
    const missing = [
      ...new Set(m.primitives.filter((q) => !q.layerId).map((q) => q.layer)),
    ];
    if (!missing.length) continue;
    const incoming = missing.map((name, i) => ({
      ...defaultLayers()[8],
      id: `${m.id}:layer:${i}`,
      name,
    }));
    const merged = mergeLayers(next, incoming);
    const mapping = new Map(
      missing.map((name, i) => [name, merged.map.get(incoming[i].id)!]),
    );
    next = {
      ...merged.project,
      masks: next.masks.map((x) =>
        x.id === m.id
          ? {
              ...x,
              warnings: [...x.warnings, ...merged.warnings],
              primitives: x.primitives.map((q) =>
                q.layerId ? q : { ...q, layerId: mapping.get(q.layer) },
              ),
            }
          : x,
      ),
    };
  }
  return next;
}
export function layerUsage(p: Project) {
  const usage = new Map(p.layers.map((l) => [l.id, new Set<string>()]));
  for (const o of layerObjects(p)) {
    usage
      .get(
        p.layers.find((l) => l.id === (o.layerId ?? layerId(objectRole(p, o))))
          ?.id ?? p.layers[0].id,
      )
      ?.add(o.id);
  }
  for (const m of p.masks)
    for (const q of m.primitives)
      usage.get(q.layerId ?? layerId('MASCARA'))?.add(m.id);
  return usage;
}
export function editLayers(
  p: Project,
  ids: string[],
  patch: Partial<DrawingLayer>,
): Project {
  if (!ids.length || ids.some((id) => !p.layers.some((l) => l.id === id)))
    throw new Error('Selecione layers existentes.');
  if (patch.id) throw new Error('O ID do layer é estável.');
  if (ids.length > 1 && patch.name)
    throw new Error('Renomeie um layer por vez.');
  const layers = p.layers.map((l) =>
    ids.includes(l.id) ? drawingLayerSchema.parse({ ...l, ...patch }) : l,
  );
  const next = { ...p, layers };
  validateLayers(next);
  return next;
}
export function createLayer(p: Project, name: string) {
  const layer = drawingLayerSchema.parse({
    ...defaultLayers()[5],
    id: uid(),
    name,
  });
  const next = { ...p, layers: [...p.layers, layer] };
  validateLayers(next);
  return { project: next, id: layer.id };
}
export function assignLayer(
  p: Project,
  ids: string[],
  id: string,
  style?: Partial<DrawingStyle>,
) {
  if (!p.layers.some((l) => l.id === id))
    throw new Error('Layer de destino inexistente.');
  const live = new Set(layerObjects(p).map((o) => o.id));
  if (ids.some((id) => !live.has(id))) throw new Error('Objeto inexistente.');
  const change = <T extends { id: string }>(o: T): T =>
    ids.includes(o.id) ? { ...o, layerId: id, ...(style ? { style } : {}) } : o;
  const next = {
    ...p,
    bars: p.bars.map(change),
    details: p.details.map(change),
    annotations: p.annotations.map(change),
    polylines: p.polylines.map(change),
    masks: p.masks.map(change),
  };
  validateLayers(next);
  return next;
}
export function removeLayer(p: Project, id: string, reassign?: string) {
  if (p.layers.length === 1) throw new Error('Mantenha ao menos um layer.');
  if (!p.layers.some((l) => l.id === id)) throw new Error('Layer inexistente.');
  if (reassign === id || (reassign && !p.layers.some((l) => l.id === reassign)))
    throw new Error('Escolha outro layer existente.');
  // Built-in IDs are implicit bindings too; deleting them requires explicit reassociation.
  const used = layerUsage(p).get(id)?.size ?? 0;
  if (used && !reassign)
    throw new Error('Layer em uso: escolha o destino da reassociação.');
  let next = p;
  const ids = layerObjects(p)
    .filter(
      (o) =>
        (p.layers.find((l) => l.id === (o.layerId ?? layerId(objectRole(p, o))))
          ?.id ?? p.layers[0].id) === id,
    )
    .map((o) => o.id);
  if (ids.length && reassign) next = assignLayer(next, ids, reassign);
  next = {
    ...next,
    layers: next.layers.filter((l) => l.id !== id),
    masks: next.masks.map((m) => ({
      ...m,
      primitives: m.primitives.map((q) =>
        q.layerId === id ? { ...q, layerId: reassign } : q,
      ),
    })),
  };
  validateLayers(next);
  return next;
}

/** A partial batch patch merges per layer; undefined restores individual inheritance. */
export function editLayerPlotStyles(
  p: Project,
  ids: string[],
  patch: import('./types').PlotStyle,
  reset = false,
): Project {
  plotStyleSchema.parse(patch);
  const next = {
    ...p,
    layers: p.layers.map((l) =>
      ids.includes(l.id)
        ? { ...l, plot: reset ? undefined : mergePlotStyle(l.plot, patch) }
        : l,
    ),
  };
  if (!ids.length || ids.some((id) => !p.layers.some((l) => l.id === id)))
    throw new Error('Selecione layers existentes.');
  validateLayers(next);
  return next;
}

export function mergePlotStyle(base?: PlotStyle, patch?: PlotStyle): PlotStyle {
  return Object.fromEntries(
    Object.entries({ ...base, ...patch }).filter(
      ([, value]) => value !== undefined,
    ),
  );
}
