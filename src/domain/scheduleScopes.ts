import type { Project, ScheduleRow } from './types';
import {
  scheduleForBarIds,
  sheetScheduleData,
  steelSummary,
  type SteelSummaryRow,
} from './sheetSchedule';
import { detailTitle } from './detailQuantities';
import {
  weldedMeshSchedule,
  type WeldedMeshSchedule,
} from './weldedMeshSchedule';

/**
 * Escopos da exportação configurável da relação do aço.
 *
 * - Projeto: todos os IDs físicos de `Project.bars`.
 * - Prancha: a mesma fonte do quadro da folha (`sheetScheduleData`): barras dos
 *   detalhamentos colocados mais armaduras exibidas por inserções nesses
 *   detalhamentos, uma vez por ID físico.
 * - Elemento: um detalhamento (`hierarchy.details`), identificado por ID e pelo
 *   contexto pavimento › grupo. O vínculo é a propriedade física
 *   `hierarchy.objectDetails[bar.id] === detail.id`. Inserções de armaduras de
 *   outro detalhamento não entram: o aço pertence ao seu dono. O texto
 *   `Bar.element`, o grupo da árvore e os nomes da repetição não são usados como
 *   filtro.
 *
 * Telas soldadas seguem as mesmas regras de escopo (`meshIds`), em quadro à
 * parte. A perda das telas usa a mesma política de modos do acréscimo das
 * barras, com percentual próprio (padrão 0%).
 *
 * Nada aqui altera o projeto; todas as funções são puras.
 */
export type ScopeKind = 'project' | 'sheet' | 'detail' | 'physical-total';
export type ScopeSelection =
  | { kind: 'project' }
  | {
      kind: 'sheets';
      mode: 'active' | 'selected' | 'all';
      sheetIds: string[];
    }
  | { kind: 'details'; mode: 'selected' | 'all'; detailIds: string[] };
export type ExportScope = {
  kind: ScopeKind;
  id: string;
  name: string;
  /** Pavimento › grupo (detalhamento) ou detalhamentos colocados (prancha). */
  context: string;
  barIds: string[];
  /** Telas soldadas do escopo, pela mesma regra de propriedade das barras. */
  meshIds: string[];
};
export type DetailOption = {
  id: string;
  name: string;
  floor: string;
  group: string;
  /** Rótulo único mesmo quando nomes se repetem em outro pavimento/grupo. */
  label: string;
  repetition?: string;
  barCount: number;
};
export type SheetOption = {
  id: string;
  name: string;
  label: string;
  barCount: number;
};

export function detailOptions(p: Project): DetailOption[] {
  const owned = new Map<string, number>();
  for (const b of p.bars) {
    const d = p.hierarchy.objectDetails[b.id];
    if (d) owned.set(d, (owned.get(d) ?? 0) + 1);
  }
  const base = p.hierarchy.details.map((d) => {
    const g = p.hierarchy.elements.find((e) => e.id === d.elementId);
    const f = p.hierarchy.floors.find((f) => f.id === g?.floorId);
    return {
      id: d.id,
      name: d.name,
      floor: f?.name ?? '',
      group: g?.name ?? '',
      label: [f?.name, g?.name, d.name].filter(Boolean).join(' › '),
      repetition: d.repetition ? detailTitle(p, d.id) : undefined,
      barCount: owned.get(d.id) ?? 0,
    };
  });
  return disambiguate(base);
}
export function sheetOptions(p: Project): SheetOption[] {
  return disambiguate(
    p.sheets.map((s, i) => ({
      id: s.id,
      name: s.name,
      label: `${s.name} (folha ${i + 1})`,
      barCount: sheetScheduleData(p, s.id).barIds.length,
    })),
  );
}
function disambiguate<T extends { id: string; label: string }>(items: T[]) {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.label, (counts.get(i.label) ?? 0) + 1);
  return items.map((i) =>
    (counts.get(i.label) ?? 0) > 1
      ? { ...i, label: `${i.label} [${i.id.slice(0, 8)}]` }
      : i,
  );
}

/** Resolve a seleção contra o projeto atual. IDs ausentes nunca são trocados
 * por outro escopo: viram problemas explícitos. */
export function resolveScopes(
  p: Project,
  selection: ScopeSelection,
  activeSheetId?: string,
): { scopes: ExportScope[]; issues: string[] } {
  const issues: string[] = [];
  if (selection.kind === 'project')
    return {
      scopes: [
        {
          kind: 'project',
          id: p.id,
          name: p.name || 'Projeto',
          context: 'Projeto completo',
          barIds: p.bars.map((b) => b.id),
          meshIds: (p.weldedMeshes ?? []).map((l) => l.id),
        },
      ],
      issues,
    };
  if (selection.kind === 'sheets') {
    const ids =
      selection.mode === 'all'
        ? p.sheets.map((s) => s.id)
        : selection.mode === 'active'
          ? activeSheetId
            ? [activeSheetId]
            : []
          : selection.sheetIds;
    if (selection.mode === 'all' && !p.sheets.length)
      issues.push('O projeto não possui pranchas.');
    else if (selection.mode === 'active' && !activeSheetId)
      issues.push(
        'Não há prancha ativa. Abra uma prancha ou escolha pranchas selecionadas.',
      );
    else if (!ids.length) issues.push('Selecione ao menos uma prancha.');
    const labels = new Map(sheetOptions(p).map((s) => [s.id, s.label]));
    const scopes: ExportScope[] = [];
    for (const id of [...new Set(ids)]) {
      if (!p.sheets.some((s) => s.id === id)) {
        issues.push(`A prancha selecionada (${id}) não existe mais.`);
        continue;
      }
      const data = sheetScheduleData(p, id);
      scopes.push({
        kind: 'sheet',
        id,
        name: labels.get(id) ?? id,
        context: data.names.length
          ? `Detalhamentos: ${data.names.join('; ')}`
          : 'Sem detalhamentos colocados',
        barIds: data.barIds,
        meshIds: data.meshIds,
      });
    }
    return { scopes, issues };
  }
  const options = detailOptions(p);
  const ids =
    selection.mode === 'all' ? options.map((d) => d.id) : selection.detailIds;
  if (selection.mode === 'all' && !options.length)
    issues.push('O projeto não possui detalhamentos.');
  else if (!ids.length) issues.push('Selecione ao menos um elemento.');
  const scopes: ExportScope[] = [];
  for (const id of [...new Set(ids)]) {
    const d = options.find((d) => d.id === id);
    if (!d) {
      issues.push(`O elemento selecionado (${id}) não existe mais.`);
      continue;
    }
    scopes.push({
      kind: 'detail',
      id,
      name: d.label,
      context: [d.floor, d.group].filter(Boolean).join(' › '),
      barIds: p.bars
        .filter((b) => p.hierarchy.objectDetails[b.id] === id)
        .map((b) => b.id),
      meshIds: (p.weldedMeshes ?? [])
        .filter((l) => p.hierarchy.objectDetails[l.id] === id)
        .map((l) => l.id),
    });
  }
  return { scopes, issues };
}

export type AllowancePolicy =
  /** Prancha com quadro: percentual do quadro; demais escopos: `percent`. */
  | { mode: 'scope'; percent: number }
  /** Mesmo percentual para todos os escopos, somente nesta exportação. */
  | { mode: 'override'; percent: number }
  | { mode: 'none' };
export type ScopeAllowance = { percent: number; source: string };

export function scopeAllowance(
  p: Project,
  scope: ExportScope,
  policy: AllowancePolicy,
): ScopeAllowance {
  if (policy.mode === 'none') return { percent: 0, source: 'Sem acréscimo' };
  validPercent(policy.percent);
  if (policy.mode === 'override')
    return {
      percent: policy.percent,
      source: 'Definido nesta exportação',
    };
  if (scope.kind === 'sheet') {
    const configured = p.sheets.find((s) => s.id === scope.id)?.steelSchedule;
    if (configured)
      return {
        percent: configured.allowancePercent,
        source: 'Quadro inserido na prancha',
      };
    return {
      percent: policy.percent,
      source: 'Prancha sem quadro inserido; definido nesta exportação',
    };
  }
  return { percent: policy.percent, source: 'Definido nesta exportação' };
}
function validPercent(n: number) {
  if (!Number.isFinite(n) || n < 0 || n > 100)
    throw new Error('O acréscimo deve estar entre 0 e 100%.');
}
/**
 * Perda das telas por escopo, com os mesmos modos do acréscimo das barras:
 * prancha com quadro usa a perda do quadro (ausente = 0%); os demais escopos,
 * o percentual da exportação (padrão 0%).
 */
export function scopeMeshLoss(
  p: Project,
  scope: ExportScope,
  policy: AllowancePolicy,
): ScopeAllowance {
  if (policy.mode === 'none') return { percent: 0, source: 'Sem perda' };
  if (
    !Number.isFinite(policy.percent) ||
    policy.percent < 0 ||
    policy.percent > 100
  )
    throw new Error('A perda das telas deve estar entre 0 e 100%.');
  if (policy.mode === 'override')
    return { percent: policy.percent, source: 'Definida nesta exportação' };
  if (scope.kind === 'sheet') {
    const configured = p.sheets.find((s) => s.id === scope.id)?.steelSchedule;
    if (configured)
      return {
        percent: configured.meshLossPercent ?? 0,
        source: 'Quadro inserido na prancha',
      };
    return {
      percent: policy.percent,
      source: 'Prancha sem quadro inserido; definida nesta exportação',
    };
  }
  return { percent: policy.percent, source: 'Definida nesta exportação' };
}

export type ScopeData = {
  scope: ExportScope;
  rows: ScheduleRow[];
  summary: SteelSummaryRow[];
  /** `undefined` quando escopos consolidados têm reservas conflitantes. */
  allowance?: ScopeAllowance;
  allowanceNote?: string;
  /** Quadro de telas do escopo (vazio quando não há telas). */
  meshes: WeldedMeshSchedule;
  /** `undefined` quando escopos consolidados têm perdas conflitantes. */
  meshLoss?: ScopeAllowance;
  meshLossNote?: string;
};
export type ScopedSchedule = {
  scopes: ScopeData[];
  physicalTotal?: ScopeData;
  /** IDs físicos presentes em mais de um escopo selecionado. */
  sharedBarIds: string[];
  /** Telas presentes em mais de um escopo selecionado. */
  sharedMeshIds: string[];
};

/** Monta os dados com o motor atual da relação de aço. Sem cálculo paralelo. */
export function buildScopedSchedule(
  p: Project,
  scopes: ExportScope[],
  policy: AllowancePolicy,
  options: { physicalTotal?: boolean; meshLoss?: AllowancePolicy } = {},
): ScopedSchedule {
  const meshPolicy = options.meshLoss ?? { mode: 'scope', percent: 0 };
  const data = scopes.map((scope) => {
    const { rows } = scheduleForBarIds(p, new Set(scope.barIds));
    const meshLoss = scopeMeshLoss(p, scope, meshPolicy);
    return {
      scope,
      rows,
      summary: steelSummary(rows),
      allowance: scopeAllowance(p, scope, policy),
      meshes: weldedMeshSchedule(p, {
        ids: new Set(scope.meshIds),
        lossPercent: meshLoss.percent,
      }),
      meshLoss,
    };
  });
  const shared = (pick: (s: ExportScope) => string[]) => {
    const seen = new Map<string, number>();
    for (const s of scopes)
      for (const id of new Set(pick(s))) seen.set(id, (seen.get(id) ?? 0) + 1);
    return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  };
  const sharedBarIds = shared((s) => s.barIds),
    sharedMeshIds = shared((s) => s.meshIds);
  let physicalTotal: ScopeData | undefined;
  if (options.physicalTotal && scopes.length > 1) {
    // União dos IDs físicos antes de agregar: nunca a soma dos arquivos.
    const union = new Set(scopes.flatMap((s) => s.barIds));
    const meshUnion = new Set(scopes.flatMap((s) => s.meshIds));
    const scope: ExportScope = {
      kind: 'physical-total',
      id: 'uniao',
      name: 'Total físico (união dos IDs)',
      context: `União de ${scopes.length} escopos; armaduras repetidas contadas uma vez`,
      barIds: p.bars.filter((b) => union.has(b.id)).map((b) => b.id),
      meshIds: (p.weldedMeshes ?? [])
        .filter((l) => meshUnion.has(l.id))
        .map((l) => l.id),
    };
    const { rows } = scheduleForBarIds(p, union);
    const percents = [...new Set(data.map((d) => d.allowance.percent))];
    const losses = [...new Set(data.map((d) => d.meshLoss.percent))];
    physicalTotal = {
      scope,
      rows,
      summary: steelSummary(rows),
      meshes: weldedMeshSchedule(p, {
        ids: meshUnion,
        lossPercent: losses.length === 1 ? losses[0] : 0,
      }),
      ...(losses.length === 1
        ? {
            meshLoss: {
              percent: losses[0],
              source:
                meshPolicy.mode === 'none'
                  ? 'Sem perda'
                  : 'Mesma perda em todos os escopos',
            },
          }
        : {
            meshLossNote: `Perdas de telas diferentes entre escopos (${losses
              .map((n) => percentLabel(n))
              .join(', ')}%). Perda não aplicada ao total físico.`,
          }),
      ...(percents.length === 1
        ? {
            allowance: {
              percent: percents[0],
              source:
                policy.mode === 'none'
                  ? 'Sem acréscimo'
                  : 'Mesmo percentual em todos os escopos',
            },
          }
        : {
            allowanceNote: `Percentuais diferentes entre escopos (${percents
              .map((n) => percentLabel(n))
              .join(
                ', ',
              )}%). Reserva não aplicada ao total físico; defina um percentual único na exportação.`,
          }),
    };
  }
  return { scopes: data, physicalTotal, sharedBarIds, sharedMeshIds };
}
export const percentLabel = (n: number, decimal: ',' | '.' = ',') =>
  n.toLocaleString(decimal === ',' ? 'pt-BR' : 'en-US', {
    maximumFractionDigits: 10,
    useGrouping: false,
  });
/** Peso com reserva em precisão completa; quantidade e comprimento não mudam. */
export const weightWithAllowance = (weight: number, percent: number) =>
  weight * (1 + percent / 100);
