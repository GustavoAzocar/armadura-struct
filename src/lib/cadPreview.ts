import { dashArray } from '../domain/layers';
import type { Primitive } from '../domain/types';

export type PreviewItem =
  | { kind: 'text'; item: Primitive }
  | { kind: 'path'; item: Primitive; d: string };

/** Join only adjacent, identically styled strokes. Text/order/coordinates survive. */
export function prepareCadPreview(lines: Primitive[]): PreviewItem[] {
  const result: PreviewItem[] = [];
  let group: { kind: 'path'; item: Primitive; paths: string[] } | undefined;
  let previousKey: string | undefined;
  const flush = () => {
    if (group)
      result.push({ kind: 'path', item: group.item, d: group.paths.join(' ') });
    group = undefined;
    previousKey = undefined;
  };
  for (const item of lines) {
    if (item.text) {
      flush();
      result.push({ kind: 'text', item });
      continue;
    }
    const key = JSON.stringify([
      item.layerId,
      item.resolvedStyle?.lineWidth ?? 0.18,
      dashArray(item.resolvedStyle),
    ]);
    if (!group || key !== previousKey) {
      flush();
      group = { kind: 'path', item, paths: [] };
      previousKey = key;
    }
    group.paths.push(
      item.points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') +
        (item.closed ? ' Z' : ''),
    );
  }
  flush();
  return result;
}
