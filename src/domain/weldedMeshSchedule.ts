import { quantityContext } from './detailQuantities';
import { weldedMeshLabel, type WeldedMeshDefinition } from './weldedMesh';
import { weldedMeshPlan, type WeldedMeshLaunch } from './weldedMeshLaunch';
import type { Project } from './types';

/**
 * Quadro de telas soldadas, à parte do quadro de barras.
 *
 * Uma linha por posição (marca) e definição de tela: a mesma marca com telas
 * diferentes vira linhas separadas, com aviso. A repetição do detalhamento dono
 * é aplicada uma única vez por lançamento.
 *
 * Perda: percentual informado pelo usuário (padrão 0%), aplicado sobre a massa
 * nominal aplicada e mostrado à parte (`lossMass`); `weight` = aplicada + perda.
 * A massa de fornecimento (painéis-base × kg/painel) já inclui os retalhos e
 * nunca recebe perda nem se soma à aplicada.
 *
 * Quadro global (sem `ids`): com a RA bloqueada, usa a fotografia do bloqueio.
 * Escopo por IDs (prancha, detalhamento): dado vivo, como o quadro de barras da
 * prancha; a desatualização é apontada por `scheduleChanged`.
 */
export type WeldedMeshContribution = {
  launchId: string;
  detailId: string;
  detailTitle: string;
  repetitions: number;
  basePanels: number;
  cutPieces: number;
  /** mm² (já multiplicada pela repetição), como as demais áreas. */
  usefulArea: number;
  appliedArea: number;
  overlapArea: number;
  /** kg */
  appliedMass: number;
  supplyMass: number;
};
type Totals = Omit<
  WeldedMeshContribution,
  'launchId' | 'detailId' | 'detailTitle' | 'repetitions'
>;
export type WeldedMeshScheduleRow = Totals & {
  mark: string;
  mesh: WeldedMeshDefinition;
  label: string;
  contributions: WeldedMeshContribution[];
  /** kg: perda sobre a massa aplicada. */
  lossMass: number;
  /** kg: massa aplicada + perda (vai para o resumo). */
  weight: number;
  warnings: string[];
  errors: string[];
};
export type WeldedMeshSummaryRow = {
  label: string;
  mesh: WeldedMeshDefinition;
  marks: string[];
  /** kg: massa nominal aplicada, sem perda. */
  appliedMass: number;
  /** kg: massa aplicada + perda. */
  weight: number;
};
export type WeldedMeshSchedule = {
  rows: WeldedMeshScheduleRow[];
  /** Peso de cada tela, à parte das bitolas das barras. */
  summary: WeldedMeshSummaryRow[];
  /** kg */
  total: number;
  lossPercent: number;
};

const ZERO: Totals = {
  basePanels: 0,
  cutPieces: 0,
  usefulArea: 0,
  appliedArea: 0,
  overlapArea: 0,
  appliedMass: 0,
  supplyMass: 0,
};
const KEYS = Object.keys(ZERO) as (keyof Totals)[];
const byText = (a: string, b: string) =>
  a.localeCompare(b, 'pt-BR', { numeric: true });

export function validLossPercent(n: number) {
  if (!Number.isFinite(n) || n < 0 || n > 100)
    throw new Error('A perda das telas deve estar entre 0 e 100%.');
  return n;
}

export function weldedMeshSchedule(
  p: Project,
  options: { lossPercent?: number; ids?: ReadonlySet<string> } = {},
): WeldedMeshSchedule {
  const lossPercent = validLossPercent(options.lossPercent ?? 0);
  const lock = options.ids ? undefined : p.scheduleLock;
  const launches: WeldedMeshLaunch[] = lock
    ? (lock.weldedMeshes ?? [])
    : (p.weldedMeshes ?? []).filter(
        (l) => !options.ids || options.ids.has(l.id),
      );
  const groups = new Map<string, WeldedMeshScheduleRow>();
  for (const l of launches) {
    const context = lock
      ? (lock.quantities?.[l.id] ?? { repetitions: 1, detailTitle: '' })
      : quantityContext(p, l);
    const detailId =
      (lock ? lock.detailIds?.[l.id] : p.hierarchy.objectDetails[l.id]) ?? '';
    const mesh = l.criteria.mesh,
      key = `${l.criteria.mark}\u0000${JSON.stringify(mesh)}`;
    let row = groups.get(key);
    if (!row) {
      row = {
        ...ZERO,
        mark: l.criteria.mark,
        mesh: structuredClone(mesh),
        label: weldedMeshLabel(mesh),
        contributions: [],
        lossMass: 0,
        weight: 0,
        warnings: [],
        errors: [],
      };
      groups.set(key, row);
    }
    const plan = weldedMeshPlan(l);
    if (!plan.ok) {
      row.errors.push(`${l.id}: ${plan.reason}`);
      continue;
    }
    const k = context.repetitions,
      layout = plan.layout;
    const contribution: WeldedMeshContribution = {
      launchId: l.id,
      detailId,
      detailTitle: context.detailTitle,
      repetitions: k,
      basePanels: layout.basePanels * k,
      cutPieces: layout.cutPieces * k,
      usefulArea: layout.usefulArea * k,
      appliedArea: layout.appliedArea * k,
      overlapArea: layout.overlapArea * k,
      appliedMass: layout.appliedMass * k,
      supplyMass: layout.supplyMass * k,
    };
    row.contributions.push(contribution);
    for (const field of KEYS) row[field] += contribution[field];
  }
  const rows = [...groups.values()].sort(
    (a, b) => byText(a.mark, b.mark) || byText(a.label, b.label),
  );
  const marks = new Map<string, Set<string>>();
  for (const r of rows) {
    r.lossMass = (r.appliedMass * lossPercent) / 100;
    r.weight = r.appliedMass + r.lossMass;
    marks.set(r.mark, (marks.get(r.mark) ?? new Set()).add(r.label));
  }
  for (const r of rows)
    if (marks.get(r.mark)!.size > 1)
      r.warnings.push(
        `Posição ${r.mark} com telas diferentes: confira a identificação.`,
      );
  const summary = new Map<string, WeldedMeshSummaryRow>();
  for (const r of rows) {
    const key = JSON.stringify(r.mesh);
    const s = summary.get(key) ?? {
      label: r.label,
      mesh: structuredClone(r.mesh),
      marks: [],
      appliedMass: 0,
      weight: 0,
    };
    s.appliedMass += r.appliedMass;
    s.weight += r.weight;
    if (!s.marks.includes(r.mark)) s.marks.push(r.mark);
    summary.set(key, s);
  }
  const list = [...summary.values()].sort((a, b) => byText(a.label, b.label));
  return {
    rows,
    summary: list,
    total: list.reduce((s, r) => s + r.weight, 0),
    lossPercent,
  };
}
