import { barDevelopment } from './barDevelopment';
import { barDimensions } from './barDimensions';
import {
  seriesMembers,
  seriesTableSchema,
  validateBarSeries,
  withBarSeriesVersion,
  type BarSeries,
  type BarSeriesProvenance,
  type SeriesTable,
} from './barSeriesSchema';
import { quantityExpression } from './detailQuantities';
import { fabricationSignature } from './fabrication';
import { scheduleChanged } from './model';
import { scheduleForBarIds } from './sheetSchedule';
import {
  uid,
  type Bar,
  type Project,
  type ScheduleContribution,
} from './types';

export {
  BAR_SERIES_PROJECT_SCHEMA,
  seriesMembers,
  validateBarSeries,
  defaultSeriesTable,
  defaultSeriesTableColumns,
  withBarSeriesVersion,
  type BarSeries,
  type SeriesTable,
} from './barSeriesSchema';

/**
 * Séries variáveis e a consulta da tabela de comprimentos individuais.
 *
 * Fonte única: cada variante é uma armadura física (`Bar`) com ID próprio. A
 * consulta lê geometria, desenvolvimento e quantidades dessas armaduras e das
 * contribuições da RA (`scheduleForBarIds`), sem guardar uma segunda cópia de
 * comprimentos, sem interpolar e sem medir o desenho. Todas as funções são
 * puras e determinísticas.
 */

const DIMENSION_GRID = 0.01; // mm: comparação de cotas entre variantes

const withSchema = (p: Project): Project => withBarSeriesVersion(p);

/** Série que contém a armadura (como variante ou representante), se houver. */
export function seriesOfBar(p: Project, barId: string) {
  return (p.barSeries ?? []).find((s) => seriesMembers(s).includes(barId));
}
const ordered = (series: BarSeries) =>
  [...series.variants].sort(
    (a, b) => a.station - b.station || a.id.localeCompare(b.id),
  );

/**
 * Reconcilia vínculos depois de excluir armaduras: retira as variantes
 * ausentes, remove séries esvaziadas e as tabelas que as documentavam.
 * Uma série que perde variantes declara o total anterior e passa a
 * aparecer como incompleta, em vez de encolher silenciosamente.
 */
export function reconcileBarSeries(p: Project): Project {
  if (!p.barSeries?.length && !p.sheets.some((s) => s.seriesTables?.length))
    return p;
  const bars = new Set(p.bars.map((b) => b.id));
  let changed = false;
  const series = (p.barSeries ?? []).flatMap((s) => {
    const variants = s.variants.filter((v) => bars.has(v.barId));
    const representative =
      s.representativeBarId && bars.has(s.representativeBarId)
        ? s.representativeBarId
        : undefined;
    if (
      variants.length === s.variants.length &&
      representative === s.representativeBarId
    )
      return [s];
    changed = true;
    if (!variants.length && !representative) return [];
    const next: BarSeries = {
      ...s,
      variants,
      expectedVariants: Math.max(
        s.expectedVariants ?? s.variants.length,
        variants.length,
      ),
    };
    if (representative) next.representativeBarId = representative;
    else delete next.representativeBarId;
    return [next];
  });
  const live = new Set(series.map((s) => s.id));
  const sheets = p.sheets.map((sheet) => {
    if (!sheet.seriesTables?.some((t) => !live.has(t.seriesId))) return sheet;
    changed = true;
    return {
      ...sheet,
      seriesTables: sheet.seriesTables.filter((t) => live.has(t.seriesId)),
    };
  });
  return changed ? { ...p, barSeries: series, sheets } : p;
}

/** Isolamento: só altera séries cujas armaduras pertencem ao detalhamento. */
export function assertSeriesDetailEdit(
  before: Project,
  after: Project,
  detailId: string,
) {
  if (before.barSeries === after.barSeries) return;
  const owns = (p: Project, id: string) =>
    p.hierarchy.objectDetails[id] === detailId;
  const key = (s: BarSeries) => JSON.stringify(s);
  const old = new Map((before.barSeries ?? []).map((s) => [s.id, key(s)]));
  const next = new Map((after.barSeries ?? []).map((s) => [s.id, key(s)]));
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    if (old.get(id) === next.get(id)) continue;
    const touched = [
      ...(before.barSeries ?? []).filter((s) => s.id === id),
      ...(after.barSeries ?? []).filter((s) => s.id === id),
    ];
    if (
      touched.some((s) =>
        seriesMembers(s).some(
          (barId) => !owns(before, barId) && !owns(after, barId),
        ),
      )
    )
      throw new Error(
        'Conclua a edição isolada antes de alterar séries de outro detalhamento.',
      );
  }
}

export type CreateSeriesInput = {
  barIds: string[];
  name?: string;
  status?: BarSeries['status'];
  provenance?: BarSeriesProvenance;
  expectedVariants?: number;
  id?: string;
};
/**
 * Cria a série com armaduras já existentes, na ordem informada (estação 1…n).
 * Em série estimada, uma única armadura é o representante médio.
 */
export function createBarSeries(p: Project, input: CreateSeriesInput) {
  const ids = [...new Set(input.barIds)];
  if (!ids.length) throw new Error('Selecione as armaduras da série.');
  const bars = ids.map((id) => p.bars.find((b) => b.id === id));
  if (bars.some((b) => !b))
    throw new Error('Selecione apenas armaduras existentes.');
  for (const id of ids) {
    const owner = seriesOfBar(p, id);
    if (owner)
      throw new Error(
        `A armadura ${p.bars.find((b) => b.id === id)!.mark} já pertence à série ${owner.name}.`,
      );
  }
  const status = input.status ?? 'exact';
  if (status === 'estimated' && ids.length !== 1)
    throw new Error(
      'Uma série estimada usa uma única armadura como representante médio.',
    );
  const occupied = new Set([
    ...(p.barSeries ?? []).flatMap((s) => [
      s.id,
      ...s.variants.map((v) => v.id),
    ]),
  ]);
  const fresh = () => {
    let id = uid();
    while (occupied.has(id)) id = uid();
    occupied.add(id);
    return id;
  };
  const id = input.id ?? fresh();
  if (occupied.has(id) && input.id) throw new Error('ID de série repetido.');
  occupied.add(id);
  const series: BarSeries = {
    id,
    name: (input.name ?? bars[0]!.mark).trim().slice(0, 40) || bars[0]!.mark,
    status,
    provenance: input.provenance ?? { kind: 'manual' },
    variants:
      status === 'estimated'
        ? []
        : ids.map((barId, i) => ({ id: fresh(), barId, station: i + 1 })),
    ...(input.expectedVariants !== undefined
      ? { expectedVariants: input.expectedVariants }
      : {}),
    ...(status === 'estimated' ? { representativeBarId: ids[0] } : {}),
  };
  const next = withSchema({
    ...p,
    barSeries: [...(p.barSeries ?? []), series],
  });
  validateBarSeries(next);
  return { project: next, id: series.id };
}
export type SeriesPatch = Partial<
  Pick<BarSeries, 'name' | 'status' | 'expectedVariants' | 'provenance'>
> & { clearExpected?: boolean };
export function updateBarSeries(
  p: Project,
  seriesId: string,
  patch: SeriesPatch,
): Project {
  const old = (p.barSeries ?? []).find((s) => s.id === seriesId);
  if (!old) throw new Error('Série inexistente.');
  const next: BarSeries = { ...old };
  if (patch.name !== undefined) next.name = patch.name.trim();
  if (patch.provenance) next.provenance = patch.provenance;
  if (patch.expectedVariants !== undefined)
    next.expectedVariants = patch.expectedVariants;
  if (patch.clearExpected) delete next.expectedVariants;
  if (patch.status && patch.status !== old.status) {
    if (patch.status === 'exact' && old.representativeBarId) {
      // O representante passa a ser uma variante exata: a armadura continua
      // a mesma peça física, agora com corte individual próprio.
      next.variants = [
        ...old.variants,
        {
          id: uid(),
          barId: old.representativeBarId,
          station: Math.max(0, ...old.variants.map((v) => v.station)) + 1,
        },
      ];
      delete next.representativeBarId;
    }
    next.status = patch.status;
  }
  const project = withSchema({
    ...p,
    barSeries: (p.barSeries ?? []).map((s) => (s.id === seriesId ? next : s)),
  });
  validateBarSeries(project);
  return project;
}
/** Acrescenta armaduras existentes ao fim da série (próximas estações). */
export function addSeriesVariants(
  p: Project,
  seriesId: string,
  barIds: string[],
): Project {
  const old = (p.barSeries ?? []).find((s) => s.id === seriesId);
  if (!old) throw new Error('Série inexistente.');
  if (old.status === 'estimated')
    throw new Error(
      'Série estimada não recebe variantes; marque-a como exata antes.',
    );
  let station = Math.max(0, ...old.variants.map((v) => v.station));
  const variants = [...new Set(barIds)].map((barId) => ({
    id: uid(),
    barId,
    station: ++station,
  }));
  const project = withSchema({
    ...p,
    barSeries: (p.barSeries ?? []).map((s) =>
      s.id === seriesId ? { ...s, variants: [...s.variants, ...variants] } : s,
    ),
  });
  validateBarSeries(project);
  return project;
}
/** Retira a variante da série; a armadura física permanece no projeto. */
export function removeSeriesVariant(
  p: Project,
  seriesId: string,
  variantId: string,
): Project {
  const old = (p.barSeries ?? []).find((s) => s.id === seriesId);
  if (!old?.variants.some((v) => v.id === variantId))
    throw new Error('Variante inexistente.');
  if (old.variants.length === 1 && !old.representativeBarId)
    throw new Error(
      'A série precisa de ao menos uma variante. Exclua a série para desfazê-la.',
    );
  const variants = old.variants.filter((v) => v.id !== variantId);
  return withSchema({
    ...p,
    barSeries: (p.barSeries ?? []).map((s) =>
      s.id === seriesId
        ? {
            ...s,
            variants,
            ...(s.expectedVariants !== undefined
              ? {
                  expectedVariants: Math.max(
                    variants.length,
                    s.expectedVariants - 1,
                  ),
                }
              : {}),
          }
        : s,
    ),
  });
}
/** Move a variante uma posição na sequência física (troca as estações). */
export function moveSeriesVariant(
  p: Project,
  seriesId: string,
  variantId: string,
  step: -1 | 1,
): Project {
  const old = (p.barSeries ?? []).find((s) => s.id === seriesId);
  if (!old) throw new Error('Série inexistente.');
  const list = ordered(old),
    i = list.findIndex((v) => v.id === variantId),
    j = i + step;
  if (i < 0 || j < 0 || j >= list.length) return p;
  const a = list[i],
    b = list[j];
  return withSchema({
    ...p,
    barSeries: (p.barSeries ?? []).map((s) =>
      s.id === seriesId
        ? {
            ...s,
            variants: s.variants.map((v) =>
              v.id === a.id
                ? { ...v, station: b.station }
                : v.id === b.id
                  ? { ...v, station: a.station }
                  : v,
            ),
          }
        : s,
    ),
  });
}
/** Desfaz a série e retira suas tabelas; nenhuma armadura é excluída. */
export function deleteBarSeries(p: Project, seriesId: string): Project {
  if (!(p.barSeries ?? []).some((s) => s.id === seriesId))
    throw new Error('Série inexistente.');
  return {
    ...p,
    barSeries: (p.barSeries ?? []).filter((s) => s.id !== seriesId),
    sheets: p.sheets.map((sheet) =>
      sheet.seriesTables?.some((t) => t.seriesId === seriesId)
        ? {
            ...sheet,
            seriesTables: sheet.seriesTables.filter(
              (t) => t.seriesId !== seriesId,
            ),
          }
        : sheet,
    ),
  };
}
/**
 * Cópia física: séries cujas armaduras foram todas copiadas ganham uma cópia
 * com novos IDs (série e variantes) apontando para as novas armaduras. Cópia
 * parcial não cria série: as peças copiadas ficam independentes.
 */
export function copyBarSeries(
  source: Project,
  target: Project,
  idMap: Readonly<Record<string, string>>,
): Project {
  const copies = (source.barSeries ?? [])
    .filter((s) => seriesMembers(s).every((id) => idMap[id]))
    .map((s) => ({
      ...structuredClone(s),
      id: uid(),
      variants: s.variants.map((v) => ({
        ...v,
        id: uid(),
        barId: idMap[v.barId],
      })),
      ...(s.representativeBarId
        ? { representativeBarId: idMap[s.representativeBarId] }
        : {}),
    }));
  if (!copies.length) return target;
  return withSchema({
    ...target,
    barSeries: [...(target.barSeries ?? []), ...copies],
  });
}

// ---------------------------------------------------------------------------
// Consulta da tabela

export type SeriesDimension = {
  /** Letra de cota (a, b, c…), na ordem dos trechos da forma. */
  label: string;
  reference: 'eixo' | 'face externa' | 'por variante';
  variable: boolean;
  /** mm, quando a cota é igual em todas as variantes. */
  constant?: number;
};
export type SeriesSource = {
  variantId?: string;
  barId: string;
  sequence?: number;
  mark: string;
  baseQuantity: number;
  multiplier: number;
  repetitions: number;
  quantity: number;
};
export type SeriesTableRow = {
  /** Variante (ou grupo) estável, independente do índice visual. */
  key: string;
  representative: boolean;
  sequences: number[];
  subId: string;
  variantIds: string[];
  barIds: string[];
  marks: string[];
  positionIds: string[];
  steel: string;
  diameter: number;
  dimensionReference: 'eixo' | 'face externa';
  /** Cotas por letra, em mm; ausente quando a forma não oferece a cota. */
  dimensions: (number | undefined)[];
  baseQuantity: number;
  multiplier: number | null;
  repetitions: number | null;
  quantity: number;
  formula: string;
  /** mm: desenvolvimento geométrico da própria peça (NaN se inválida). */
  developedLength: number;
  /** mm: comprimento individual de corte (política explícita). */
  cutLength: number;
  cutPolicy: 'geometric';
  /** m: Σ contribuições da RA (quantidade efetiva × comprimento físico). */
  subtotalLength: number;
  /** kg teóricos (sem reserva). */
  weight: number;
  errors: string[];
  sources: SeriesSource[];
};
export type SeriesTableData = {
  series: BarSeries;
  name: string;
  status: {
    estimated: boolean;
    incomplete: boolean;
    review: boolean;
    partialScope: boolean;
    stale: boolean;
  };
  /** Avisos persistentes da interface, da tabela e das saídas documentais. */
  notes: string[];
  dimensions: SeriesDimension[];
  rows: SeriesTableRow[];
  steels: string[];
  totalVariants: number;
  inScopeVariants: number;
  expectedVariants?: number;
  totals: {
    variants: number;
    rows: number;
    pieces: number;
    length: number;
    weight: number;
  };
  grouping: SeriesTable['grouping'];
};
export const CUT_POLICY_LABEL =
  'Corte = desenvolvimento geométrico do eixo, sem acréscimos ou descontos';

function dimensionsOf(bar: Bar): {
  reference: SeriesTableRow['dimensionReference'];
  values: number[];
} {
  const d = barDimensions(bar);
  if (bar.dimensionConvention === 'external' && d.status === 'available')
    return {
      reference: 'face externa',
      values: d.external.map((x) => x.length),
    };
  return { reference: 'eixo', values: d.axis.map((x) => x.length) };
}
const letter = (i: number) =>
  i < 26 ? String.fromCharCode(97 + i) : `d${i + 1}`;
const sameValue = (a: number | undefined, b: number | undefined) =>
  a !== undefined &&
  b !== undefined &&
  Math.round(a / DIMENSION_GRID) === Math.round(b / DIMENSION_GRID);

function rangeLabel(name: string, sequences: number[]) {
  const s = [...sequences].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(
      j > i + 1 ? `${s[i]}-${s[j]}` : j > i ? `${s[i]},${s[j]}` : `${s[i]}`,
    );
    i = j;
  }
  return `${name}.${parts.join(',')}`;
}

/**
 * Consulta determinística da tabela de comprimentos da série.
 *
 * `scopeBarIds` restringe a tabela ao escopo físico documentado (folha ou
 * detalhamento); variantes fora do escopo não são acrescentadas e o aviso de
 * lista parcial acompanha a tabela. O agrupamento `fabrication` junta somente
 * variantes com a mesma assinatura de fabricação (forma, aço, bitola, mandril
 * e terminações), preservando IDs e quantidades de origem.
 */
export function seriesTableData(
  p: Project,
  seriesId: string,
  options: {
    scopeBarIds?: ReadonlySet<string>;
    grouping?: SeriesTable['grouping'];
  } = {},
): SeriesTableData {
  validateBarSeries(p);
  const series = (p.barSeries ?? []).find((s) => s.id === seriesId);
  if (!series) throw new Error('Série inexistente.');
  const grouping = options.grouping ?? 'variant';
  const bars = new Map(p.bars.map((b) => [b.id, b]));
  const variants = ordered(series);
  const sequence = new Map(variants.map((v, i) => [v.id, i + 1]));
  const inScope = (id: string) =>
    !options.scopeBarIds || options.scopeBarIds.has(id);
  const scopedVariants = variants.filter((v) => inScope(v.barId));
  const representative =
    series.representativeBarId && inScope(series.representativeBarId)
      ? series.representativeBarId
      : undefined;
  const ids = new Set([
    ...scopedVariants.map((v) => v.barId),
    ...(representative ? [representative] : []),
  ]);
  // Mesmo motor da RA, restrito aos IDs físicos da série no escopo.
  const { rows: raRows } = scheduleForBarIds(p, ids);
  const contribution = new Map<
    string,
    { c: ScheduleContribution; mark: string; positionId: string }
  >();
  for (const r of raRows)
    for (const c of r.contributions)
      contribution.set(c.barId, { c, mark: r.mark, positionId: r.positionId });

  type Item = {
    variantId?: string;
    sequence?: number;
    bar: Bar;
    dims: ReturnType<typeof dimensionsOf>;
  };
  const items: Item[] = [
    ...scopedVariants.map((v) => ({
      variantId: v.id,
      sequence: sequence.get(v.id),
      bar: bars.get(v.barId)!,
      dims: dimensionsOf(bars.get(v.barId)!),
    })),
    ...(representative
      ? [
          {
            bar: bars.get(representative)!,
            dims: dimensionsOf(bars.get(representative)!),
          },
        ]
      : []),
  ];
  const count = Math.max(0, ...items.map((i) => i.dims.values.length));
  const sameCount = items.every((i) => i.dims.values.length === count);
  const sameReference = items.every(
    (i) => i.dims.reference === items[0]?.dims.reference,
  );
  const dimensions: SeriesDimension[] = Array.from(
    { length: count },
    (_, k) => {
      const values = items.map((i) => i.dims.values[k]);
      const constant =
        sameCount &&
        sameReference &&
        values.every((v) => sameValue(v, values[0]))
          ? values[0]
          : undefined;
      return {
        label: letter(k),
        reference: sameReference
          ? (items[0]?.dims.reference ?? 'eixo')
          : 'por variante',
        variable: constant === undefined,
        ...(constant !== undefined ? { constant } : {}),
      };
    },
  );

  const rowOf = (group: Item[]): SeriesTableRow => {
    const first = group[0];
    const development = barDevelopment(first.bar);
    const errors = [
      ...new Set(
        group.flatMap((i) => {
          const d = barDevelopment(i.bar);
          return d.status === 'invalid' ? d.diagnostics : [];
        }),
      ),
    ];
    const sources: SeriesSource[] = group.map((i) => {
      const entry = contribution.get(i.bar.id);
      return {
        variantId: i.variantId,
        barId: i.bar.id,
        sequence: i.sequence,
        mark: entry?.mark ?? i.bar.mark,
        baseQuantity: entry?.c.baseQuantity ?? i.bar.quantity,
        multiplier: entry?.c.multiplier ?? i.bar.multiplier ?? 1,
        repetitions: entry?.c.repetitions ?? 1,
        quantity: entry?.c.quantity ?? 0,
      };
    });
    const contributions = group
      .map((i) => contribution.get(i.bar.id)?.c)
      .filter((c): c is ScheduleContribution => !!c);
    const same = <T>(values: T[]) =>
      values.every((v) => v === values[0]) ? values[0] : null;
    const sequences = group
      .map((i) => i.sequence)
      .filter((n): n is number => n !== undefined);
    const quantity = sources.reduce((n, s) => n + s.quantity, 0);
    return {
      key: first.variantId ?? `representante:${first.bar.id}`,
      representative: !first.variantId,
      sequences,
      subId: first.variantId
        ? rangeLabel(series.name, sequences)
        : `${series.name} (variável)`,
      variantIds: group
        .map((i) => i.variantId)
        .filter((id): id is string => !!id),
      barIds: group.map((i) => i.bar.id),
      marks: [...new Set(sources.map((s) => s.mark))],
      positionIds: [
        ...new Set(
          group
            .map((i) => contribution.get(i.bar.id)?.positionId)
            .filter((id): id is string => !!id),
        ),
      ],
      steel: first.bar.steel,
      diameter: first.bar.diameter,
      dimensionReference: first.dims.reference,
      dimensions: Array.from({ length: count }, (_, k) => first.dims.values[k]),
      baseQuantity: sources.reduce((n, s) => n + s.baseQuantity, 0),
      multiplier: same(sources.map((s) => s.multiplier)),
      repetitions: same(sources.map((s) => s.repetitions)),
      quantity,
      formula:
        sources.length > 1
          ? `${sources.map((s) => quantityExpression(s, false)).join(' + ')} = ${quantity}`
          : `${quantityExpression(sources[0], false)} = ${quantity}`,
      developedLength:
        development.status === 'available'
          ? development.geometricLength
          : Number.NaN,
      cutLength:
        development.status === 'available' ? development.cutLength : Number.NaN,
      cutPolicy: 'geometric',
      subtotalLength: contributions.reduce((n, c) => n + c.totalLength, 0),
      weight: contributions.reduce((n, c) => n + c.weight, 0),
      errors,
      sources,
    };
  };

  const variantItems = items.filter((i) => i.variantId);
  const groups: Item[][] = [];
  if (grouping === 'fabrication') {
    // Somente regras de fabricação: comprimento ou texto iguais não bastam.
    const bySignature = new Map<string, Item[]>();
    for (const item of variantItems) {
      const signature = fabricationSignature(item.bar);
      // A mesma peça pode ter cotagem gráfica distinta. Não misture medidas
      // de eixo e face externa numa única linha, ainda que o aço seja igual.
      const key = signature
        ? `${signature}:${item.dims.reference}`
        : `unique:${item.variantId}`;
      const list = bySignature.get(key);
      if (list) list.push(item);
      else {
        const created = [item];
        bySignature.set(key, created);
        groups.push(created);
      }
    }
  } else groups.push(...variantItems.map((i) => [i]));
  const representativeItem = items.find((i) => !i.variantId);
  if (representativeItem) groups.push([representativeItem]);
  const rows = groups.map(rowOf);

  const totalVariants = series.variants.length;
  const expected = series.expectedVariants;
  const status = {
    estimated: series.status === 'estimated',
    incomplete: expected !== undefined && expected > totalVariants,
    review: rows.some((r) => r.errors.length > 0),
    partialScope:
      scopedVariants.length < totalVariants ||
      (!!series.representativeBarId && !representative),
    stale: scheduleChanged(p),
  };
  const notes: string[] = [];
  if (status.estimated)
    notes.push(
      'ESTIMATIVA: comprimento médio do representante; não é lista de corte.',
    );
  if (status.incomplete)
    notes.push(
      `INCOMPLETA: ${totalVariants} de ${expected} variantes cadastradas.`,
    );
  if (status.review) notes.push('REVISAR: há variante com geometria inválida.');
  if (status.partialScope)
    notes.push(
      `Lista parcial neste escopo: ${scopedVariants.length} de ${totalVariants} variantes.`,
    );
  if (status.stale)
    notes.push('RA bloqueada e desatualizada: atualize ou desbloqueie a RA.');
  const steels = [...new Set(rows.map((r) => `${r.steel} Ø${r.diameter}`))];
  return {
    series,
    name: series.name,
    status,
    notes,
    dimensions,
    rows,
    steels,
    totalVariants,
    inScopeVariants: scopedVariants.length,
    ...(expected !== undefined ? { expectedVariants: expected } : {}),
    totals: {
      variants: scopedVariants.length,
      rows: rows.length,
      pieces: rows.reduce((n, r) => n + r.quantity, 0),
      length: rows.reduce((n, r) => n + r.subtotalLength, 0),
      weight: rows.reduce((n, r) => n + r.weight, 0),
    },
    grouping,
  };
}

export type SeriesTableBlock = {
  index: number;
  count: number;
  rows: SeriesTableRow[];
  subtotal: { pieces: number; length: number; weight: number };
};
/** Divide as linhas sem perder, repetir ou reordenar nenhuma delas. */
export function splitSeriesRows(
  rows: readonly SeriesTableRow[],
  rowsPerBlock?: number,
): SeriesTableBlock[] {
  const size =
    rowsPerBlock && rowsPerBlock > 0 ? Math.floor(rowsPerBlock) : rows.length;
  const chunks: SeriesTableRow[][] = [];
  for (let i = 0; i < rows.length; i += Math.max(1, size))
    chunks.push(rows.slice(i, i + Math.max(1, size)));
  if (!chunks.length) chunks.push([]);
  return chunks.map((chunk, index) => ({
    index,
    count: chunks.length,
    rows: chunk,
    subtotal: {
      pieces: chunk.reduce((n, r) => n + r.quantity, 0),
      length: chunk.reduce((n, r) => n + r.subtotalLength, 0),
      weight: chunk.reduce((n, r) => n + r.weight, 0),
    },
  }));
}

/** Registro de fabricação de uma peça exata (base para BVBS/romaneio). */
export type SeriesFabricationRecord = {
  seriesId: string;
  variantIds: string[];
  barIds: string[];
  subId: string;
  mark: string;
  steel: string;
  diameter: number;
  mandrel: number;
  quantity: number;
  /** mm, por peça. */
  cutLength: number;
};
/**
 * Dados exatos por variante para adaptadores industriais. Série estimada,
 * incompleta, com geometria inválida ou RA desatualizada é bloqueada com
 * diagnóstico; nunca converte a média em peça fabricável.
 */
export function seriesFabricationRecords(
  p: Project,
  seriesId: string,
  grouping: SeriesTable['grouping'] = 'variant',
): { records: SeriesFabricationRecord[]; diagnostics: string[] } {
  const data = seriesTableData(p, seriesId, { grouping });
  const diagnostics: string[] = [];
  if (data.status.estimated)
    diagnostics.push(
      `Série ${data.name}: estimativa por representante médio não gera peças de fabricação.`,
    );
  if (data.status.incomplete)
    diagnostics.push(
      `Série ${data.name}: faltam variantes (${data.totalVariants} de ${data.expectedVariants}).`,
    );
  if (data.status.review)
    diagnostics.push(`Série ${data.name}: corrija as geometrias inválidas.`);
  if (data.status.stale)
    diagnostics.push('RA bloqueada e desatualizada: atualize ou desbloqueie.');
  if (diagnostics.length) return { records: [], diagnostics };
  const bars = new Map(p.bars.map((b) => [b.id, b]));
  return {
    diagnostics,
    records: data.rows
      .filter((r) => !r.representative)
      .map((r) => ({
        seriesId,
        variantIds: r.variantIds,
        barIds: r.barIds,
        subId: r.subId,
        mark: r.marks.join('/'),
        steel: r.steel,
        diameter: r.diameter,
        mandrel: bars.get(r.barIds[0])!.mandrel,
        quantity: r.quantity,
        cutLength: r.cutLength,
      })),
  };
}

// ---------------------------------------------------------------------------
// Tabelas na prancha (apresentação)

export function setSeriesTable(
  p: Project,
  sheetId: string,
  tableId: string,
  input: SeriesTable | undefined,
): Project {
  const sheet = p.sheets.find((s) => s.id === sheetId);
  if (!sheet) throw new Error('Folha inexistente.');
  const value =
    input === undefined ? undefined : seriesTableSchema.parse(input);
  if (value && value.id !== tableId) throw new Error('Tabela inconsistente.');
  if (value && !(p.barSeries ?? []).some((s) => s.id === value.seriesId))
    throw new Error('A série da tabela não existe mais.');
  if (value?.blockOrigins && !value.blockOrigins.length)
    delete value.blockOrigins;
  const tables = sheet.seriesTables ?? [];
  const exists = tables.some((t) => t.id === tableId);
  if (!value && !exists) return p;
  const seriesTables = value
    ? exists
      ? tables.map((t) => (t.id === tableId ? value : t))
      : [...tables, value]
    : tables.filter((t) => t.id !== tableId);
  return withSchema({
    ...p,
    sheets: p.sheets.map((s) =>
      s.id === sheetId ? { ...s, seriesTables } : s,
    ),
  });
}
