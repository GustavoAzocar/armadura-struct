import { z } from 'zod';
import { fabricationPositions, validateFabrication } from './fabrication';
import { defaultNumbering, nextFreeMark, numberingPolicySchema } from './marks';
import type { Project } from './types';
export const renumberOptionsSchema = z
  .object({
    policy: numberingPolicySchema.optional(),
    order: z
      .enum(['top-right', 'top-left', 'right-top', 'left-top'])
      .optional(),
    scope: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('project') }).strict(),
        z
          .object({
            kind: z.enum(['detail', 'element', 'floor']),
            id: z.string().min(1),
          })
          .strict(),
        z
          .object({
            kind: z.literal('positions'),
            positionIds: z.array(z.string().min(1)).max(10000),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();
export type RenumberOptions = z.infer<typeof renumberOptionsSchema>;
export function previewRenumber(p: Project, options: RenumberOptions = {}) {
  const input = renumberOptionsSchema.parse(options),
    policy = input.policy ?? p.numbering ?? defaultNumbering;
  const groups = fabricationPositions(p),
    bars = new Map(p.bars.map((b) => [b.id, b]));
  const scope = input.scope ?? { kind: 'project' as const };
  if (
    scope.kind === 'positions' &&
    scope.positionIds.some((id) => !groups.some((g) => g.id === id))
  )
    throw new Error('Posição do escopo inexistente.');
  if (
    'id' in scope &&
    !(
      scope.kind === 'detail'
        ? p.hierarchy.details
        : scope.kind === 'element'
          ? p.hierarchy.elements
          : p.hierarchy.floors
    ).some((n) => n.id === scope.id)
  )
    throw new Error('Escopo inexistente.');
  const belongs = (id: string) => {
    if (scope.kind === 'project') return true;
    if (scope.kind === 'positions') return true;
    const d = p.hierarchy.details.find(
      (d) => d.id === p.hierarchy.objectDetails[id],
    );
    const e = p.hierarchy.elements.find((e) => e.id === d?.elementId);
    return scope.kind === 'detail'
      ? d?.id === scope.id
      : scope.kind === 'element'
        ? e?.id === scope.id
        : e?.floorId === scope.id;
  };
  const preserved = new Set(policy.preservedPositionIds);
  const rows = groups.map((g) => {
    // The first member is the explicit AS-54 representative; never a sheet view/rebatimento.
    const b = bars.get(g.barIds[0])!;
    if (!b || !Number.isFinite(b.origin.x) || !Number.isFinite(b.origin.y))
      throw new Error('Inserção de referência inválida.');
    const inside =
      scope.kind === 'positions'
        ? scope.positionIds.includes(g.id)
        : g.barIds.every(belongs);
    return {
      positionId: g.id,
      barId: b.id,
      before: g.mark,
      after: g.mark,
      x: b.origin.x,
      y: b.origin.y,
      status: !inside
        ? 'outside'
        : preserved.has(g.id)
          ? 'preserved'
          : ('renumber' as string),
    };
  });
  const order = input.order ?? 'top-right';
  const targets = rows
    .filter((r) => r.status === 'renumber')
    .sort((a, b) => {
      const vertical = b.y - a.y,
        horizontal =
          order === 'top-left' || order === 'left-top' ? a.x - b.x : b.x - a.x;
      return (
        (order.startsWith('top')
          ? vertical || horizontal
          : horizontal || vertical) ||
        (a.positionId < b.positionId ? -1 : a.positionId > b.positionId ? 1 : 0)
      );
    });
  const used = new Set(
    rows.filter((r) => r.status !== 'renumber').map((r) => r.before),
  );
  for (const r of targets) {
    r.after = nextFreeMark(p, used, policy);
    used.add(r.after);
  }
  const marks = new Map(rows.map((r) => [r.positionId, r.after]));
  const positions = groups.map((g) => ({ ...g, mark: marks.get(g.id)! }));
  const byBar = new Map(
    positions.flatMap((g) => g.barIds.map((id) => [id, g.mark])),
  );
  const project: Project = {
    ...p,
    numbering: structuredClone(policy),
    fabricationPositions: positions,
    bars: p.bars.map((b) =>
      b.mark === byBar.get(b.id) ? b : { ...b, mark: byBar.get(b.id)! },
    ),
  };
  validateFabrication(project);
  return {
    base: p,
    project,
    rows: [...targets, ...rows.filter((r) => r.status !== 'renumber')],
    order,
  };
}
export function applyRenumber(
  current: Project,
  plan: ReturnType<typeof previewRenumber>,
) {
  if (current !== plan.base)
    throw new Error('O projeto mudou. Abra novamente a prévia.');
  return plan.project;
}
