import type { Mask, Project, SymbolDefinition, SymbolInstance } from './types';

export const symbolDefinitions = (p: Pick<Project, 'symbols'>) =>
  p.symbols ?? [];
export const symbolInstances = (p: Pick<Project, 'symbolInstances'>) =>
  p.symbolInstances ?? [];

/** Mask-shaped view of an instance. Exists only to render; never stored. */
export function symbolInstanceMask(
  d: SymbolDefinition,
  i: SymbolInstance,
): Mask {
  return {
    layerId: i.layerId,
    style: i.style,
    plot: i.plot,
    id: i.id,
    name: d.name,
    format: 'NATIVE',
    primitives: d.primitives,
    layers: {},
    visible: true,
    opacity: 1,
    scale: i.scale,
    origin: i.origin,
    rotation: i.rotation,
    sourceUnit: 'mm',
    warnings: [],
  };
}
export function symbolRenderMasks(
  p: Pick<Project, 'symbols' | 'symbolInstances'>,
): Mask[] {
  const defs = new Map(symbolDefinitions(p).map((d) => [d.id, d]));
  return symbolInstances(p).flatMap((i) => {
    const d = defs.get(i.definitionId);
    return d ? [symbolInstanceMask(d, i)] : [];
  });
}
