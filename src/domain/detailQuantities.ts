import type { Bar, DetailRepetition, Project } from './types';

export function repetitionNames(
  p: Project,
  repetition?: DetailRepetition,
): string[] {
  const elements = repetition?.elements ?? [];
  const names = elements.map((m) =>
    m.elementId
      ? (p.hierarchy.elements.find((e) => e.id === m.elementId)?.name ?? m.name)
      : m.name,
  );
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  const qualified = names.map((name, i) => {
    if ((counts.get(name) ?? 0) < 2 || !elements[i].elementId) return name;
    const e = p.hierarchy.elements.find((e) => e.id === elements[i].elementId);
    const floor = p.hierarchy.floors.find((f) => f.id === e?.floorId);
    return `${name} (${floor?.name ?? e?.floorId})`;
  });
  const qualifiedCounts = new Map<string, number>();
  for (const name of qualified)
    qualifiedCounts.set(name, (qualifiedCounts.get(name) ?? 0) + 1);
  return qualified.map((name, i) =>
    (qualifiedCounts.get(name) ?? 0) > 1 && elements[i].elementId
      ? `${name} [${elements[i].elementId}]`
      : name,
  );
}
export function detailTitle(p: Project, detailId: string): string {
  const d = p.hierarchy.details.find((d) => d.id === detailId);
  if (!d) return '';
  if (!d.repetition) return d.name;
  const names = repetitionNames(p, d.repetition);
  return `${names.length ? names.join(' = ') + ' · ' : ''}${d.name} · ${d.repetition.factor}×`;
}
export function quantityContext(p: Project, b: Bar) {
  const owner = p.hierarchy.objectDetails[b.id];
  const d = p.hierarchy.details.find((d) => d.id === owner);
  return {
    repetitions: d?.repetition?.factor ?? 1,
    detailTitle: d?.repetition ? detailTitle(p, owner) : '',
  };
}
export function barQuantities(p: Project, b: Bar) {
  const context = quantityContext(p, b);
  return {
    ...context,
    baseQuantity: b.quantity,
    quantity: b.quantity * context.repetitions,
  };
}
export function quantityLabel(p: Project, b: Bar): string {
  const q = barQuantities(p, b);
  return q.repetitions > 1
    ? `${q.baseQuantity} × ${q.repetitions} = ${q.quantity}`
    : String(q.baseQuantity);
}
