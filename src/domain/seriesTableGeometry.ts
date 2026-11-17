import {
  seriesTableData,
  splitSeriesRows,
  type SeriesTableData,
  type SeriesTableRow,
} from './barSeries';
import { seriesTableSchema, type SeriesTable } from './barSeriesSchema';
import {
  paperTextWidth,
  wrapPaperText,
  type PaperPrimitive,
} from './paperText';
import { formatSheetScheduleNumber, sheetScheduleData } from './sheetSchedule';
import type { Point, Project } from './types';

/** Espaço entre blocos posicionados automaticamente, em mm de papel. */
export const SERIES_BLOCK_GAP = 6;
const INK = '#8b96ad';
const style = {
  color: INK,
  fillColor: INK,
  fill: 'none' as const,
  lineWidth: 0.15,
  lineScale: 1,
  lineType: { name: 'CONTINUOUS', pattern: [] },
};

export type SeriesTableBlockGeometry = {
  index: number;
  count: number;
  origin: Point;
  width: number;
  height: number;
  frame: Point[];
  lines: PaperPrimitive[];
  rows: SeriesTableRow[];
};
export type SeriesTableGeometry = {
  table: SeriesTable;
  data: SeriesTableData;
  blocks: SeriesTableBlockGeometry[];
  lines: PaperPrimitive[];
};

const n1 = (v: number) => formatSheetScheduleNumber(v, 1);
const n2 = (v: number) => formatSheetScheduleNumber(v, 2);
const cm = (mm: number) => (Number.isFinite(mm) ? n1(mm / 10) : 'REVISAR');

/** Escopo físico documentado pela folha: o mesmo do quadro de aço. */
export function sheetSeriesScope(p: Project, sheetId: string) {
  return new Set(sheetScheduleData(p, sheetId).barIds);
}

/** Colunas visíveis; identificação, quantidade e corte nunca são ocultados. */
export function seriesTableColumns(
  data: SeriesTableData,
  table: Pick<SeriesTable, 'columns'>,
) {
  const dims = table.columns.dimensions
    ? data.dimensions.filter((d) => d.variable)
    : [];
  const columns: {
    title: string;
    unit: string;
    min: number;
    value: (r: SeriesTableRow) => string;
    align: 'left' | 'right';
  }[] = [
    {
      title: 'VAR.',
      unit: '',
      min: 12,
      value: (r) => r.subId,
      align: 'left',
    },
    {
      title: 'POS.',
      unit: '',
      min: 10,
      value: (r) => r.marks.join('/'),
      align: 'left',
    },
    ...(data.steels.length > 1
      ? [
          {
            title: 'AÇO / Ø',
            unit: '(mm)',
            min: 20,
            value: (r: SeriesTableRow) => `${r.steel} / ${n1(r.diameter)}`,
            align: 'left' as const,
          },
        ]
      : []),
    ...(dims.some((d) => d.reference === 'por variante')
      ? [
          {
            title: 'REF.',
            unit: '',
            min: 18,
            value: (r: SeriesTableRow) => r.dimensionReference,
            align: 'left' as const,
          },
        ]
      : []),
    ...dims.map((d) => ({
      title: d.label,
      unit: '(cm)',
      min: 11,
      value: (r: SeriesTableRow) => {
        const k = data.dimensions.indexOf(d),
          v = r.dimensions[k];
        return v === undefined ? '-' : cm(v);
      },
      align: 'right' as const,
    })),
    {
      title: 'QUANT',
      unit: '',
      min: 12,
      value: (r) => String(r.quantity),
      align: 'right',
    },
    ...(table.columns.formula
      ? [
          {
            title: 'BASE×M×R',
            unit: '',
            min: 18,
            value: (r: SeriesTableRow) => r.formula.replace(/ = \d+$/, ''),
            align: 'right' as const,
          },
        ]
      : []),
    ...(table.columns.developed
      ? [
          {
            title: 'C.DESENV',
            unit: '(cm)',
            min: 17,
            value: (r: SeriesTableRow) => cm(r.developedLength),
            align: 'right' as const,
          },
        ]
      : []),
    {
      title: 'C.CORTE',
      unit: '(cm)',
      min: 17,
      value: (r) =>
        r.representative ? `méd. ${cm(r.cutLength)}` : cm(r.cutLength),
      align: 'right',
    },
    {
      title: 'C.TOTAL',
      unit: '(m)',
      min: 17,
      value: (r) => n2(r.subtotalLength),
      align: 'right',
    },
    ...(table.columns.mass
      ? [
          {
            title: 'PESO',
            unit: '(kg)',
            min: 15,
            value: (r: SeriesTableRow) => n2(r.weight),
            align: 'right' as const,
          },
        ]
      : []),
  ];
  return columns;
}

/**
 * Tabela vetorial em mm reais de papel, dividida em blocos/continuações.
 * Cada bloco repete cabeçalho, série, unidades e avisos; o subtotal do bloco e
 * o total da série são distintos, e o total aparece somente no último bloco.
 */
export function seriesTableGeometry(
  p: Project,
  sheetId: string,
  input: SeriesTable,
): SeriesTableGeometry {
  const table = seriesTableSchema.parse(input);
  const data = seriesTableData(p, table.seriesId, {
    scopeBarIds: sheetSeriesScope(p, sheetId),
    grouping: table.grouping,
  });
  const h = table.textHeight,
    k = h / 2.5,
    rh = h * 1.75,
    pad = 1.5 * k;
  const columns = seriesTableColumns(data, table);
  const chunks = splitSeriesRows(data.rows, table.rowsPerBlock);
  // Larguras comuns a todos os blocos, para continuações alinhadas.
  const widths = columns.map((c) =>
    Math.max(
      c.min * k,
      paperTextWidth(c.title, h) + 2 * pad,
      paperTextWidth(c.unit, h) + 2 * pad,
      ...data.rows.map((r) => paperTextWidth(c.value(r), h) + 2 * pad),
    ),
  );
  const gridWidth = widths.reduce((a, b) => a + b, 0);
  const title = `TABELA DE COMPRIMENTOS - SÉRIE ${data.name}`;
  const width = Math.max(gridWidth, 60 * k);
  const constants = data.dimensions.filter(
    (d) => !d.variable || !table.columns.dimensions,
  );
  const summary = `${data.steels.join(' / ') || 'Sem armaduras'} · ${data.totals.variants} variante(s) · ${data.totals.pieces} peça(s)`;
  const blocks: SeriesTableBlockGeometry[] = [];
  let next: Point = table.origin;
  for (const chunk of chunks) {
    const origin =
      chunk.index === 0
        ? table.origin
        : (table.blockOrigins?.[chunk.index - 1] ?? next);
    const lines: PaperPrimitive[] = [];
    const stroke = (points: Point[]) =>
      lines.push({ layer: 'TABELA_SERIE', points, resolvedStyle: style });
    const text = (
      value: string,
      x: number,
      y: number,
      align: 'left' | 'center' | 'right' = 'left',
    ) => {
      if (value)
        lines.push({
          layer: 'TABELA_SERIE',
          points: [{ x, y }],
          text: value,
          textHeight: h,
          textAlign: align,
          resolvedStyle: style,
        });
    };
    const paragraph = (value: string) => {
      for (const line of wrapPaperText(value, h, width)) {
        text(line, 0, y);
        y -= rh;
      }
    };
    let y = -h;
    for (const line of wrapPaperText(title, h, width)) {
      text(line, width / 2, y, 'center');
      y -= rh;
    }
    paragraph(summary);
    if (table.columns.dimensions && data.dimensions.length)
      paragraph(`Referência das cotas: ${data.dimensions[0].reference}.`);
    if (constants.length)
      paragraph(
        `Cotas constantes (${constants[0].reference}): ${constants
          .map((d) =>
            d.constant === undefined
              ? `${d.label} variável`
              : `${d.label} = ${cm(d.constant)} cm`,
          )
          .join('; ')}`,
      );
    for (const note of data.notes) paragraph(note);
    if (chunk.count > 1)
      paragraph(
        chunk.index === 0
          ? `Bloco 1/${chunk.count} - continua`
          : `Continuação ${chunk.index + 1}/${chunk.count}`,
      );
    y -= h * 0.5;
    // Grade: cabeçalho com unidades em todos os blocos.
    const top = y,
      header = 3 * h,
      body = Math.max(1, chunk.rows.length),
      bottom = top - header - body * rh;
    stroke([
      { x: 0, y: top },
      { x: gridWidth, y: top },
      { x: gridWidth, y: bottom },
      { x: 0, y: bottom },
      { x: 0, y: top },
    ]);
    stroke([
      { x: 0, y: top - header },
      { x: gridWidth, y: top - header },
    ]);
    let x = 0;
    columns.forEach((c, i) => {
      if (i)
        stroke([
          { x, y: top },
          { x, y: bottom },
        ]);
      text(c.title, x + widths[i] / 2, top - h * 1.25, 'center');
      text(c.unit, x + widths[i] / 2, top - h * 2.5, 'center');
      x += widths[i];
    });
    chunk.rows.forEach((r, ri) => {
      let x = 0;
      columns.forEach((c, ci) => {
        text(
          c.value(r),
          c.align === 'left' ? x + pad : x + widths[ci] - pad,
          top - header - rh * (ri + 0.7),
          c.align,
        );
        x += widths[ci];
      });
    });
    if (!chunk.rows.length)
      text(
        'Sem variantes desta série nesta folha',
        gridWidth / 2,
        bottom + rh * 0.3,
        'center',
      );
    y = bottom - h * 1.5;
    if (chunk.count > 1)
      paragraph(
        `Subtotal do bloco: ${chunk.subtotal.pieces} peça(s) · ${n2(chunk.subtotal.length)} m${table.columns.mass ? ` · ${n2(chunk.subtotal.weight)} kg` : ''}`,
      );
    if (chunk.index === chunk.count - 1) {
      paragraph(
        `Total da série: ${data.totals.pieces} peça(s) · ${n2(data.totals.length)} m${table.columns.mass ? ` · ${n2(data.totals.weight)} kg` : ''}`,
      );
      paragraph(
        'Corte = desenvolvimento geométrico do eixo, sem ajustes. Valores arredondados apenas na apresentação; peso teórico sem reserva.',
      );
    }
    const height = -y - h * 0.5;
    const local = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: -height },
      { x: 0, y: -height },
    ];
    const move = (v: Point) => ({ x: v.x + origin.x, y: v.y + origin.y });
    blocks.push({
      index: chunk.index,
      count: chunk.count,
      origin,
      width,
      height,
      frame: local.map(move),
      rows: chunk.rows,
      lines: lines.map((l) => ({ ...l, points: l.points.map(move) })),
    });
    next = { x: origin.x + width + SERIES_BLOCK_GAP, y: origin.y };
  }
  return { table, data, blocks, lines: blocks.flatMap((b) => b.lines) };
}
