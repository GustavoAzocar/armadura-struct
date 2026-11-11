import type { Bar, DetailRepetition, Project } from './types';
import { decodeProject, repetitionSchema, schedule } from './model';
import { completeOwnership, contentObjects, detailPath } from './hierarchy';
import { detailOrigin, sameDetailOrigin } from './detailTransfer';
import { repetitionNames } from './detailQuantities';
import { add, sub, geometry, world, vertices } from './geometry';
import { weldedMeshSchedule } from './weldedMeshSchedule';
import type { WeldedMeshLaunch } from './weldedMeshLaunch';
import { fabricationSignature } from './fabrication';

export function setDetailRepetition(
  p: Project,
  detailId: string,
  repetition?: DetailRepetition,
): Project {
  if (!p.hierarchy.details.some((d) => d.id === detailId))
    throw new Error('Detalhamento inexistente.');
  const value = repetition ? repetitionSchema.parse(repetition) : undefined;
  const old = p.hierarchy.details.find((d) => d.id === detailId)!.repetition;
  if (JSON.stringify(old) === JSON.stringify(value)) return p;
  const next: Project = {
    ...p,
    scheduleLock: undefined,
    hierarchy: {
      ...p.hierarchy,
      details: p.hierarchy.details.map((d) =>
        d.id === detailId
          ? { ...d, repetition: value, ...(value ? { grouped: true } : {}) }
          : d,
      ),
    },
  };
  decodeProject(JSON.stringify(next));
  return next;
}
/** Marks, descriptions, colors and graphic placement do not define the steel cut shape. */
function barKey(b: Bar) {
  const clampSignature =
    b.kind === 'beam-clamp' ? fabricationSignature(b) : undefined;
  if (b.kind === 'beam-clamp' && !clampSignature) return undefined;
  const first = b.points[0];
  return JSON.stringify({
    kind: b.kind,
    diameter: b.diameter,
    mandrel: b.mandrel,
    steel: b.steel,
    manufacturing: b.manufacturing,
    quantity: b.quantity,
    multiplier: b.multiplier ?? 1,
    quantitySource: b.quantitySource ?? { kind: 'manual' },
    comment: b.comment ?? '',
    ribbed: b.ribbed ?? false,
    showRibbed: b.showRibbed ?? false,
    columnLevel: b.columnLevel ?? '',
    quantityDisplay: b.quantityDisplay ?? 'factored',
    ...(b.kind === 'beam-clamp'
      ? { beamClamp: clampSignature }
      : b.kind === 'free'
        ? { points: b.points.map((p) => sub(p, first)) }
        : { width: b.width, height: b.height, hook: b.hook }),
    ...(b.distribution
      ? {
          distribution: {
            start: sub(b.distribution.start ?? b.origin, b.origin),
            end: sub(b.distribution.end, b.origin),
          },
        }
      : {}),
  });
}
const barsOf = (p: Project, id: string) =>
  p.bars.filter((b) => p.hierarchy.objectDetails[b.id] === id);
const meshesOf = (p: Project, id: string) =>
  (p.weldedMeshes ?? []).filter((l) => p.hierarchy.objectDetails[l.id] === id);
/** Tela independente da posição: critérios e região relativos ao 1º vértice. */
function meshKey(l: WeldedMeshLaunch) {
  const o = l.region.outer[0];
  const rel = (q: { x: number; y: number }) => ({
    x: Math.round((q.x - o.x) * 1e6) / 1e6,
    y: Math.round((q.y - o.y) * 1e6) / 1e6,
  });
  return JSON.stringify({
    criteria: l.criteria,
    outer: l.region.outer.map(rel),
    openings: l.region.openings.map((h) => h.map(rel)),
    anchor: l.anchor ? rel(l.anchor) : null,
  });
}
/** Detalhamentos só são repetição quando barras e telas coincidem. */
function signature(p: Project, id: string) {
  const bars = barsOf(p, id);
  const keys = bars.map(barKey);
  return bars.length &&
    bars.every((b) => !geometry(b).errors.length) &&
    keys.every(Boolean)
    ? JSON.stringify({
        bars: keys.sort(),
        meshes: meshesOf(p, id).map(meshKey).sort(),
      })
    : undefined;
}
export function repetitionCandidates(p: Project, representativeId: string) {
  const key = signature(p, representativeId);
  return p.hierarchy.details
    .filter(
      (d) => d.id !== representativeId && !!key && signature(p, d.id) === key,
    )
    .map((d) => ({
      id: d.id,
      path: detailPath(p, d.id),
      factor: d.repetition?.factor ?? 1,
      positions: barsOf(p, d.id).length,
    }));
}
export function mergeElements(
  p: Project,
  ids: string[],
): DetailRepetition['elements'] {
  const names = ids.map(
    (id) => p.hierarchy.details.find((d) => d.id === id)?.name,
  );
  return ids.flatMap((id) => {
    const d = p.hierarchy.details.find((d) => d.id === id)!;
    if (d.repetition?.elements.length) return d.repetition.elements;
    return [
      // A parent is a group (Vigas), not a physical occurrence. Keep existing
      // explicit legacy links, but new merges snapshot each detail's identity.
      {
        name:
          names.filter((name) => name === d.name).length > 1
            ? detailPath(p, d.id)
            : d.name,
      },
      ...Array.from({ length: (d.repetition?.factor ?? 1) - 1 }, () => ({
        name: '',
      })),
    ];
  });
}
export type MergeRepetitionPlan = {
  base: Project;
  project?: Project;
  representativeId: string;
  issues: string[];
  warnings: string[];
  removedDetailIds: string[];
  mapping: Record<string, string>;
  beforePieces: number;
  afterPieces: number;
  beforeWeight: number;
  afterWeight: number;
  factor: number;
  names: string[];
};
const totals = (p: Project) => ({
  ...schedule({ ...p, scheduleLock: undefined }).reduce(
    (sum, r) => ({
      pieces: sum.pieces + r.quantity,
      weight: sum.weight + r.weight,
    }),
    { pieces: 0, weight: 0 },
  ),
  /** kg: massa das telas (com repetição); a reunião não pode alterá-la. */
  meshes: weldedMeshSchedule({ ...p, scheduleLock: undefined }).total,
});
export function previewMergeRepetitions(
  p: Project,
  representativeId: string,
  detailIds: string[],
  names?: string[],
): MergeRepetitionPlan {
  const before = totals(p);
  const plan: MergeRepetitionPlan = {
    base: p,
    representativeId,
    issues: [],
    warnings: [],
    removedDetailIds: [],
    mapping: {},
    beforePieces: before.pieces,
    afterPieces: before.pieces,
    beforeWeight: before.weight,
    afterWeight: before.weight,
    factor: 1,
    names: [],
  };
  try {
    const ids = [...new Set([representativeId, ...detailIds])];
    if (ids.length < 2)
      throw new Error('Escolha pelo menos dois detalhamentos para reunir.');
    const allowed = new Set([
      representativeId,
      ...repetitionCandidates(p, representativeId).map((d) => d.id),
    ]);
    if (ids.some((id) => !allowed.has(id)))
      throw new Error(
        'Os detalhamentos precisam ter posições físicas idênticas, incluindo quantidades base e distribuições.',
      );
    const rep = p.hierarchy.details.find((d) => d.id === representativeId);
    if (!rep) throw new Error('Escolha o representante.');
    const selected = p.hierarchy.details.filter((d) => ids.includes(d.id));
    const members = mergeElements(p, ids);
    plan.factor = selected.reduce((n, d) => n + (d.repetition?.factor ?? 1), 0);
    const defaults = repetitionNames(p, {
      factor: plan.factor,
      elements: members,
    });
    plan.names = names ?? defaults;
    if (plan.names.length !== plan.factor || plan.names.some((n) => !n.trim()))
      throw new Error(
        `Informe os ${plan.factor} nomes dos elementos representados antes de reunir.`,
      );
    const elements = plan.names.map((name, i) =>
      defaults[i] === name && members[i]?.elementId
        ? members[i]
        : { name: name.trim() },
    );
    const repOrigin = detailOrigin(p, representativeId);
    const origins = selected
      .flatMap((d) => [
        detailOrigin(p, d.id),
        ...(d.repetition?.absorbedOrigins ?? []),
      ])
      .filter(
        (o, i, all) =>
          !sameDetailOrigin(o, repOrigin) &&
          all.findIndex((other) => sameDetailOrigin(o, other)) === i,
      );
    const repetition = repetitionSchema.parse({
      factor: plan.factor,
      elements,
      absorbedOrigins: origins,
    });
    const removed = new Set(ids.filter((id) => id !== representativeId));
    plan.removedDetailIds = [...removed];
    const keptBars = barsOf(p, representativeId);
    const translations = new Map<string, { x: number; y: number }>();
    for (const id of removed) {
      const available = new Map<string, Bar[]>();
      for (const b of keptBars) {
        const key = barKey(b);
        if (!key) throw Error('Peça sem assinatura de fabricação válida.');
        available.set(key, [...(available.get(key) ?? []), b]);
      }
      const deltas: { x: number; y: number }[] = [];
      for (const b of barsOf(p, id)) {
        const key = barKey(b);
        if (!key) throw Error('Peça sem assinatura de fabricação válida.');
        const target = available.get(key)!.shift()!;
        plan.mapping[b.id] = target.id;
        if (target.rotation !== b.rotation) deltas.push({ x: NaN, y: NaN });
        else
          deltas.push(
            sub(world(vertices(target)[0], target), world(vertices(b)[0], b)),
          );
      }
      if (
        deltas.every(
          (d) =>
            Math.abs(d.x - deltas[0].x) < 1e-6 &&
            Math.abs(d.y - deltas[0].y) < 1e-6,
        )
      )
        translations.set(id, deltas[0]);
      else
        plan.warnings.push(
          `${detailPath(p, id)}: layout diferente; confira o enquadramento das vistas após reunir.`,
        );
    }
    const removedIds = new Set(
      contentObjects(p)
        .filter((o) => removed.has(p.hierarchy.objectDetails[o.id]))
        .map((o) => o.id),
    );
    const drawingOwners = new Map(
      p.hierarchy.drawings.map((d) => [d.id, d.detailId]),
    );
    const mapRef = <
      T extends { id: string; barId?: string; barIds?: string[] },
    >(
      o: T,
    ): T =>
      o.barId && Object.hasOwn(plan.mapping, o.barId)
        ? {
            ...o,
            barId: plan.mapping[o.barId],
            ...(o.barIds
              ? {
                  barIds: [
                    ...new Set(o.barIds.map((id) => plan.mapping[id] ?? id)),
                  ],
                }
              : {}),
          }
        : o.barIds
          ? {
              ...o,
              barIds: [
                ...new Set(o.barIds.map((id) => plan.mapping[id] ?? id)),
              ],
            }
          : o;
    let next: Project = {
      ...p,
      scheduleLock: undefined,
      bars: p.bars.filter((o) => !removedIds.has(o.id)),
      details: p.details
        .filter((o) => !removedIds.has(o.id))
        .map((o) => {
          const mapped = mapRef(o);
          if (mapped.barId === o.barId) return o;
          const old = p.bars.find((b) => b.id === o.barId)!,
            kept = p.bars.find((b) => b.id === mapped.barId)!;
          return {
            ...mapped,
            origin: add(o.origin, sub(vertices(old)[0], vertices(kept)[0])),
          };
        }),
      annotations: p.annotations
        .filter((o) => !removedIds.has(o.id))
        .map(mapRef),
      polylines: p.polylines.filter((o) => !removedIds.has(o.id)).map(mapRef),
      masks: p.masks.filter((o) => !removedIds.has(o.id)),
      symbolInstances: (p.symbolInstances ?? []).filter(
        (o) => !removedIds.has(o.id),
      ),
      ...(p.weldedMeshes
        ? {
            weldedMeshes: p.weldedMeshes.filter((o) => !removedIds.has(o.id)),
          }
        : {}),
      hierarchy: {
        ...p.hierarchy,
        details: p.hierarchy.details
          .filter((d) => !removed.has(d.id))
          .map((d) =>
            d.id === representativeId ? { ...d, repetition, grouped: true } : d,
          ),
        drawings: p.hierarchy.drawings.map((d) =>
          removed.has(d.detailId) ? { ...d, detailId: representativeId } : d,
        ),
        placements: p.hierarchy.placements.map((v) => {
          const delta = translations.get(drawingOwners.get(v.drawingId)!);
          return delta ? { ...v, modelOrigin: add(v.modelOrigin, delta) } : v;
        }),
      },
    };
    next = completeOwnership(next, representativeId);
    decodeProject(JSON.stringify(next));
    const after = totals(next);
    plan.afterPieces = after.pieces;
    plan.afterWeight = after.weight;
    if (
      after.pieces !== before.pieces ||
      Math.abs(after.weight - before.weight) >
        1e-8 * Math.max(1, before.weight) ||
      Math.abs(after.meshes - before.meshes) > 1e-8 * Math.max(1, before.meshes)
    )
      throw new Error(
        'A reunião alteraria o quantitativo físico. Nenhuma alteração foi aplicada.',
      );
    plan.warnings.push(
      'Somente os gráficos do representante serão conservados; notas, máscaras, símbolos e rebatimentos internos dos demais detalhes serão removidos. Vistas são redirecionadas e vínculos externos são reassociados.',
    );
    plan.project = next;
  } catch (e) {
    plan.issues.push(
      e instanceof Error
        ? e.message
        : 'Não foi possível reunir os detalhamentos.',
    );
  }
  return plan;
}
export function applyMergeRepetitions(
  current: Project,
  plan: MergeRepetitionPlan,
) {
  if (current !== plan.base)
    throw new Error('O projeto mudou. Abra novamente a comparação.');
  if (!plan.project || plan.issues.length)
    throw new Error(plan.issues.join(' '));
  return plan.project;
}
