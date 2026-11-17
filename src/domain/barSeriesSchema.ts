import { z } from 'zod';
import type { Point, Project } from './types';
import { withSeriesMaskVersion } from './projectSchema';

/**
 * Formato do projeto que acrescenta séries variáveis e tabelas de comprimentos.
 * Leitores anteriores (até 39) recusam o arquivo, em vez de perder os vínculos.
 */
export const BAR_SERIES_PROJECT_SCHEMA = 'armadurastruct/40' as const;

/** Uma variante é uma peça física real (`Bar`), com ID estável próprio. */
export type BarSeriesVariant = {
  /** Identidade da variante; não muda ao renumerar, ordenar ou agrupar. */
  id: string;
  /** Armadura física com a geometria e a quantidade desta variante. */
  barId: string;
  /** Estação/sequência física ao longo da série (ordem da tabela). */
  station: number;
};
export type BarSeriesProvenance =
  | { kind: 'manual' }
  | {
      kind: 'generator';
      /** Identificação do gerador ou da origem (ex.: plugin, importação). */
      source: string;
    };
/**
 * Série física de barras variáveis (contrato mínimo compartilhado).
 *
 * - `exact`: cada variante tem geometria própria; a lista é de corte.
 * - `estimated`: o aço vem de um representante médio (`representativeBarId`),
 *   que é a peça já contada na RA, nunca uma peça adicional. Não há corte
 *   individual exato.
 *
 * A série não guarda comprimentos nem quantidades: tudo é lido das armaduras.
 */
export type BarSeries = {
  id: string;
  /** Identificação principal da série/posição (ex.: N5). */
  name: string;
  status: 'exact' | 'estimated';
  provenance: BarSeriesProvenance;
  variants: BarSeriesVariant[];
  /** Total de variantes declarado; maior que a lista = série incompleta. */
  expectedVariants?: number;
  /** Somente em séries estimadas: armadura que representa a média. */
  representativeBarId?: string;
};
export type SeriesTableColumns = {
  dimensions: boolean;
  formula: boolean;
  developed: boolean;
  mass: boolean;
};
/** Tabela de papel vinculada a uma série; não guarda geometria nem totais. */
export type SeriesTable = {
  id: string;
  seriesId: string;
  /** Ausente = visível; ocultar só afeta a apresentação. */
  visible?: boolean;
  /** Canto superior esquerdo do primeiro bloco, em mm de papel. */
  origin: Point;
  textHeight: number;
  /** Linhas por bloco; ausente = um único bloco. */
  rowsPerBlock?: number;
  /** Origens explícitas das continuações (bloco 2 em diante). */
  blockOrigins?: Point[];
  grouping: 'variant' | 'fabrication';
  columns: SeriesTableColumns;
};

const identity = z.string().min(1).max(200);
const paperPoint = z
  .object({
    x: z.number().finite().min(-1e9).max(1e9),
    y: z.number().finite().min(-1e9).max(1e9),
  })
  .strict();

export const barSeriesVariantSchema = z
  .object({
    id: identity,
    barId: identity,
    station: z.number().finite().min(-1e12).max(1e12),
  })
  .strict();
export const barSeriesSchema = z
  .object({
    id: identity,
    name: z.string().trim().min(1).max(40),
    status: z.enum(['exact', 'estimated']),
    provenance: z.union([
      z.object({ kind: z.literal('manual') }).strict(),
      z
        .object({
          kind: z.literal('generator'),
          source: z.string().trim().min(1).max(200),
        })
        .strict(),
    ]),
    variants: z.array(barSeriesVariantSchema).max(10000),
    expectedVariants: z.number().int().min(1).max(10000).optional(),
    representativeBarId: identity.optional(),
  })
  .strict();
export const seriesTableColumnsSchema = z
  .object({
    dimensions: z.boolean(),
    formula: z.boolean(),
    developed: z.boolean(),
    mass: z.boolean(),
  })
  .strict();
export const seriesTableSchema = z
  .object({
    id: identity,
    seriesId: identity,
    visible: z.boolean().optional(),
    origin: paperPoint,
    textHeight: z.number().finite().min(1.8).max(5),
    rowsPerBlock: z.number().int().min(1).max(1000).optional(),
    blockOrigins: z.array(paperPoint).max(1000).optional(),
    grouping: z.enum(['variant', 'fabrication']),
    columns: seriesTableColumnsSchema,
  })
  .strict();
export const barSeriesListSchema = z.array(barSeriesSchema).max(2000);
export const seriesTablesSchema = z.array(seriesTableSchema).max(500);

export const defaultSeriesTableColumns = (): SeriesTableColumns => ({
  dimensions: true,
  formula: true,
  developed: false,
  mass: true,
});
export const defaultSeriesTable = (
  id: string,
  seriesId: string,
  origin: Point = { x: 20, y: 270 },
): SeriesTable => ({
  id,
  seriesId,
  origin,
  textHeight: 2.5,
  grouping: 'variant',
  columns: defaultSeriesTableColumns(),
});

/** Detecta dados do formato 40 em um JSON ainda não validado. */
export function hasBarSeriesData(input: unknown): boolean {
  const data = input as {
    barSeries?: unknown;
    sheets?: { seriesTables?: unknown }[];
  } | null;
  return (
    !!data &&
    typeof data === 'object' &&
    (data.barSeries !== undefined ||
      (Array.isArray(data.sheets) &&
        data.sheets.some(
          (s) => !!s && typeof s === 'object' && s.seriesTables !== undefined,
        )))
  );
}
export function withBarSeriesVersion<T extends { schema: string }>(
  project: T,
): T {
  return hasBarSeriesData(project)
    ? withSeriesMaskVersion(project, BAR_SERIES_PROJECT_SCHEMA)
    : project;
}

export function seriesMembers(series: BarSeries): string[] {
  return [
    ...series.variants.map((v) => v.barId),
    ...(series.representativeBarId ? [series.representativeBarId] : []),
  ];
}

/** Invariantes do contrato; lança erro em vez de descartar dados. */
export function validateBarSeries(p: Project) {
  const list: BarSeries[] = barSeriesListSchema.parse(p.barSeries ?? []);
  const bars = new Set(p.bars.map((b) => b.id));
  const seriesIds = new Set<string>(),
    variantIds = new Set<string>(),
    members = new Set<string>();
  for (const s of list) {
    if (seriesIds.has(s.id))
      throw new Error(`Série ${s.name}: identificação repetida.`);
    seriesIds.add(s.id);
    if (!s.variants.length && !s.representativeBarId)
      throw new Error(`Série ${s.name}: sem variantes nem representante.`);
    if (s.representativeBarId && s.status !== 'estimated')
      throw new Error(
        `Série ${s.name}: representante médio só é permitido em série estimada.`,
      );
    if (
      s.expectedVariants !== undefined &&
      s.expectedVariants < s.variants.length
    )
      throw new Error(
        `Série ${s.name}: total declarado menor que as variantes existentes.`,
      );
    const stations = new Set<number>();
    for (const v of s.variants) {
      if (variantIds.has(v.id))
        throw new Error(`Série ${s.name}: ID de variante repetido.`);
      variantIds.add(v.id);
      if (stations.has(v.station))
        throw new Error(`Série ${s.name}: estação repetida.`);
      stations.add(v.station);
    }
    for (const id of seriesMembers(s)) {
      if (!bars.has(id))
        throw new Error(
          `Série ${s.name}: a armadura vinculada (${id}) não existe.`,
        );
      if (members.has(id))
        throw new Error(
          `Série ${s.name}: a armadura ${id} já pertence a outra série ou variante.`,
        );
      members.add(id);
    }
  }
  for (const sheet of p.sheets) {
    const tables = new Set<string>();
    for (const t of sheet.seriesTables ?? []) {
      seriesTableSchema.parse(t);
      if (tables.has(t.id))
        throw new Error(`${sheet.name}: tabela de série repetida.`);
      tables.add(t.id);
      if (!seriesIds.has(t.seriesId))
        throw new Error(
          `${sheet.name}: tabela de comprimentos sem a série vinculada.`,
        );
    }
  }
}
