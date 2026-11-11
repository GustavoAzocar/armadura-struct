import { zipSync } from 'fflate';
import type { Project, ScheduleRow } from '../domain/types';
import { scheduleQuantityLabel } from '../domain/model';
import { detailTitle, quantitySourceLabel } from '../domain/detailQuantities';
import {
  buildScopedSchedule,
  percentLabel,
  resolveScopes,
  weightWithAllowance,
  type AllowancePolicy,
  type ScopeData,
  type ScopeSelection,
  type ScopeKind,
} from '../domain/scheduleScopes';
import { assertExportable } from './exports';
import { csvField } from './csv';
import { safeName } from './files';

export type LengthUnit = 'cm' | 'm';
export type CsvExportOptions = {
  detailed: boolean;
  summary: boolean;
  /** Vários escopos: um arquivo por escopo ou um arquivo com colunas de escopo. */
  layout: 'separate' | 'consolidated';
  /** Acrescenta o total físico pela união dos IDs (somente com 2+ escopos). */
  physicalTotal: boolean;
  detailedLength: LengthUnit;
  summaryLength: LengthUnit;
  /** `sheet`: mesmas casas do quadro visual (0,1); `extended`: mais casas. */
  precision: 'sheet' | 'extended';
  decimal: ',' | '.';
  allowance: AllowancePolicy;
};
export const defaultCsvExportOptions = (): CsvExportOptions => ({
  detailed: true,
  summary: true,
  layout: 'separate',
  physicalTotal: false,
  detailedLength: 'cm',
  summaryLength: 'm',
  precision: 'sheet',
  decimal: ',',
  allowance: { mode: 'scope', percent: 0 },
});
export type CsvFile = { name: string; content: string };
export type ScopePreview = {
  kind: ScopeKind;
  name: string;
  positions: number;
  pieces: number;
  weight: number;
  allowance: string;
};
export type CsvExportPlan = {
  /** Problemas que impedem a exportação; nenhum arquivo é produzido. */
  issues: string[];
  warnings: string[];
  scopes: ScopePreview[];
  files: CsvFile[];
};

const KIND_LABEL: Record<ScopeKind, string> = {
  project: 'Projeto',
  sheet: 'Prancha',
  detail: 'Elemento (detalhamento)',
  'physical-total': 'Total físico',
};
const KIND_SLUG: Record<ScopeKind, string> = {
  project: 'projeto',
  sheet: 'prancha',
  detail: 'elemento',
  'physical-total': 'total-fisico',
};

export function lengthDigits(
  unit: LengthUnit,
  precision: CsvExportOptions['precision'],
) {
  return precision === 'sheet' ? 1 : unit === 'cm' ? 2 : 3;
}
const weightDigits = (precision: CsvExportOptions['precision']) =>
  precision === 'sheet' ? 1 : 3;

/** Planeja a exportação sem efeitos: valida, monta os dados e serializa. */
export function planScopedCsv(
  p: Project,
  selection: ScopeSelection,
  options: CsvExportOptions,
  activeSheetId?: string,
): CsvExportPlan {
  const issues: string[] = [],
    warnings: string[] = [];
  const empty = (): CsvExportPlan => ({
    issues,
    warnings,
    scopes: [],
    files: [],
  });
  if (!options.detailed && !options.summary)
    issues.push('Escolha o quadro detalhado, o resumo do aço ou ambos.');
  try {
    // Mesmos bloqueios da exportação global: RA desatualizada e geometria inválida.
    assertExportable(p);
  } catch (e) {
    issues.push(e instanceof Error ? e.message : String(e));
  }
  const resolved = resolveScopes(p, selection, activeSheetId);
  issues.push(...resolved.issues);
  for (const s of resolved.scopes)
    if (!s.barIds.length)
      issues.push(
        `${KIND_LABEL[s.kind]} “${s.name}” não possui armaduras. Retire-o da seleção.`,
      );
  if (issues.length || !resolved.scopes.length) {
    if (!issues.length) issues.push('Nenhum escopo válido selecionado.');
    return empty();
  }
  let data;
  try {
    data = buildScopedSchedule(p, resolved.scopes, options.allowance, {
      physicalTotal: options.physicalTotal,
    });
  } catch (e) {
    issues.push(e instanceof Error ? e.message : String(e));
    return empty();
  }
  if (data.sharedBarIds.length)
    warnings.push(
      `${data.sharedBarIds.length} armadura(s) aparecem em mais de um escopo. Cada arquivo reflete o seu escopo; a soma dos arquivos não é o total físico${data.physicalTotal ? '. Use o total físico pela união dos IDs' : ''}.`,
    );
  if (
    data.scopes.some((s) =>
      s.rows.some((r) => r.contributions.some((c) => repeated(p, c.detailId))),
    )
  )
    warnings.push(
      'Detalhamentos repetidos são exportados como conjunto (quantidade × repetições), sem rateio por elemento representado.',
    );
  if (data.physicalTotal?.allowanceNote)
    warnings.push(data.physicalTotal.allowanceNote);
  const all = [
    ...data.scopes,
    ...(data.physicalTotal ? [data.physicalTotal] : []),
  ];
  const project = fileSlug(p.name || 'projeto');
  const files: CsvFile[] = [];
  const add = (name: string, content: string) => {
    let unique = name;
    for (let i = 2; files.some((f) => f.name === unique); i++)
      unique = name.replace(/\.csv$/, `-${i}.csv`);
    files.push({ name: unique, content });
  };
  const groups: { slug: string; data: ScopeData[] }[] =
    options.layout === 'consolidated' || all.length === 1
      ? [{ slug: selectionSlug(selection), data: all }]
      : all.map((d) => ({ slug: scopeSlug(d, all), data: [d] }));
  for (const g of groups) {
    if (options.detailed)
      add(`${project}_${g.slug}_quadro.csv`, detailedCsv(p, g.data, options));
    if (options.summary)
      add(`${project}_${g.slug}_resumo.csv`, summaryCsv(g.data, options));
  }
  return {
    issues,
    warnings,
    files,
    scopes: all.map((d) => ({
      kind: d.scope.kind,
      name: d.scope.name,
      positions: d.rows.length,
      pieces: d.rows.reduce((n, r) => n + r.quantity, 0),
      weight: d.rows.reduce((n, r) => n + r.weight, 0),
      allowance: d.allowance
        ? `${percentLabel(d.allowance.percent)}% · ${d.allowance.source}`
        : 'Reserva não consolidada',
    })),
  };
}
function selectionSlug(s: ScopeSelection) {
  return s.kind === 'project'
    ? 'projeto'
    : s.kind === 'sheets'
      ? 'pranchas'
      : 'elementos';
}
/** Nome de arquivo previsível: sem acentos, separadores ou caracteres inválidos. */
export const fileSlug = (s: string) =>
  safeName(s).replace(/-+/g, '-').replace(/^-|-$/g, '') || 'sem-nome';
function scopeSlug(d: ScopeData, all: ScopeData[]) {
  const plain = (o: ScopeData) =>
    fileSlug(o.scope.name.replace(/ \[[^\]]*\]$/, ''));
  const name = plain(d);
  // Nomes iguais (ex.: duas folhas homônimas) recebem o início do ID estável.
  const clash = all.some(
    (o) => o !== d && o.scope.kind === d.scope.kind && plain(o) === name,
  );
  return `${KIND_SLUG[d.scope.kind]}-${name}${clash ? `-${fileSlug(d.scope.id).slice(0, 8)}` : ''}`;
}
function repeated(p: Project, detailId: string) {
  return !!p.hierarchy.details.find((d) => d.id === detailId)?.repetition;
}

export function numberText(n: number, digits: number, decimal: ',' | '.') {
  return n.toLocaleString(decimal === ',' ? 'pt-BR' : 'en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  });
}
/** UTF-8 com BOM, `;` e CRLF; todo campo entre aspas e protegido contra fórmulas. */
export function serializeCsv(rows: unknown[][]) {
  return '﻿' + rows.map((r) => r.map(csvField).join(';')).join('\r\n') + '\r\n';
}
const scopeCells = (d: ScopeData) => [
  KIND_LABEL[d.scope.kind],
  d.scope.name,
  d.scope.context,
  d.scope.id,
];
const SCOPE_HEADERS = [
  'Tipo de escopo',
  'Escopo',
  'Contexto do escopo',
  'ID do escopo',
];

export function detailedCsv(
  p: Project,
  data: ScopeData[],
  o: CsvExportOptions,
) {
  const u = o.detailedLength,
    k = u === 'cm' ? 100 : 1,
    ld = lengthDigits(u, o.precision),
    n = (v: number, d: number) => numberText(v, d, o.decimal);
  const header = [
    ...SCOPE_HEADERS,
    'Posição',
    'ID da posição de fabricação',
    'Elemento',
    'Aço',
    'Bitola (mm)',
    'Quantidade base',
    'Multiplicador da armadura',
    'Quantidade por detalhe',
    'Repetições do detalhamento',
    'Quantidade efetiva',
    'Fórmula da quantidade',
    'Comprimento variável',
    `C. unitário (${u})`,
    `C. unit. mínimo (${u})`,
    `C. unit. máximo (${u})`,
    `Comprimento total (${u})`,
    'Peso teórico (kg)',
    'Origem da quantidade base',
    'Observação',
    'Por nervura',
    'Mostrar C/NERV',
    'Lance',
    'Repetição do detalhamento',
    'Detalhamentos de origem',
    'IDs dos detalhamentos',
    'IDs físicos das armaduras',
    'Contribuições por ocorrência (JSON)',
  ];
  const line = (d: ScopeData, r: ScheduleRow) => {
    const [min, max] = r.unitLengthRange,
      variable = Math.abs(max - min) > 0.00001,
      cs = r.contributions;
    return [
      ...scopeCells(d),
      r.mark,
      r.positionId,
      r.element,
      r.steel,
      n(r.diameter, 1),
      r.baseQuantity,
      r.multiplier ?? cs.map((c) => c.multiplier).join('/'),
      r.perDetailQuantity,
      r.repetitions ?? cs.map((c) => c.repetitions).join('/'),
      r.quantity,
      scheduleQuantityLabel(r),
      variable ? 'Sim' : 'Não',
      variable
        ? `${n(min * k, ld)}-${n(max * k, ld)}`
        : n(r.unitLength * k, ld),
      n(min * k, ld),
      n(max * k, ld),
      n(r.totalLength * k, ld),
      n(r.weight, weightDigits(o.precision)),
      cs.map((c) => quantitySourceLabel(c.quantitySource)).join(' / '),
      cs.map((c) => c.comment).join(' / '),
      cs.map((c) => (c.ribbed ? 'Sim' : 'Não')).join('/'),
      cs.map((c) => (c.showRibbed ? 'Sim' : 'Não')).join('/'),
      cs.map((c) => c.columnLevel).join(' / '),
      [
        ...new Set(
          cs
            .filter((c) => repeated(p, c.detailId))
            .map(
              (c) =>
                `${detailTitle(p, c.detailId)}: conjunto, sem rateio por elemento`,
            ),
        ),
      ].join(' | '),
      cs.map((c) => c.origin).join(' | '),
      [...new Set(cs.map((c) => c.detailId))].join(' | '),
      cs.map((c) => c.barId).join(' | '),
      JSON.stringify(cs),
    ];
  };
  return serializeCsv([
    header,
    ...data.flatMap((d) => d.rows.map((r) => line(d, r))),
  ]);
}

export function summaryCsv(data: ScopeData[], o: CsvExportOptions) {
  const u = o.summaryLength,
    k = u === 'cm' ? 100 : 1,
    ld = lengthDigits(u, o.precision),
    wd = weightDigits(o.precision),
    n = (v: number, d: number) => numberText(v, d, o.decimal);
  const header = [
    ...SCOPE_HEADERS,
    'Linha',
    'Aço',
    'Bitola (mm)',
    `Comprimento total (${u})`,
    'Peso teórico (kg)',
    'Acréscimo (%)',
    'Origem do acréscimo',
    'Peso com acréscimo (kg)',
  ];
  const rows: unknown[][] = [header];
  for (const d of data) {
    const reserve = (weight: number) =>
      d.allowance
        ? [
            percentLabel(d.allowance.percent, o.decimal),
            d.allowance.source,
            n(weightWithAllowance(weight, d.allowance.percent), wd),
          ]
        : ['', d.allowanceNote ?? 'Reserva não consolidada', ''];
    for (const s of d.summary)
      rows.push([
        ...scopeCells(d),
        'Bitola',
        s.steel,
        n(s.diameter, 1),
        n(s.totalLength * k, ld),
        n(s.weight, wd),
        ...reserve(s.weight),
      ]);
    const steels = [...new Set(d.summary.map((s) => s.steel))];
    for (const steel of steels) {
      const items = d.summary.filter((s) => s.steel === steel);
      const length = items.reduce((a, s) => a + s.totalLength, 0),
        weight = items.reduce((a, s) => a + s.weight, 0);
      rows.push([
        ...scopeCells(d),
        'Total do aço',
        steel,
        '',
        n(length * k, ld),
        n(weight, wd),
        ...reserve(weight),
      ]);
    }
  }
  return serializeCsv(rows);
}

/** Um arquivo vai direto; vários vão em um ZIP determinístico. */
export function packageCsvFiles(
  files: CsvFile[],
  projectName: string,
  selection: ScopeSelection,
): { name: string; data: string | Uint8Array; mime: string; ext: string } {
  if (!files.length) throw new Error('Nada para exportar.');
  if (files.length === 1)
    return {
      name: files[0].name,
      data: files[0].content,
      mime: 'text/csv',
      ext: 'csv',
    };
  const encoder = new TextEncoder();
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
  const mtime = new Date(2000, 0, 1);
  for (const f of files)
    entries[f.name] = [encoder.encode(f.content), { mtime }];
  return {
    name: `${fileSlug(projectName || 'projeto')}_relacao-aco_${selectionSlug(selection)}.zip`,
    data: zipSync(entries, { level: 6 }),
    mime: 'application/zip',
    ext: 'zip',
  };
}
