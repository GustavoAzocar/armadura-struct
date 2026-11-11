import { z } from 'zod';
import type { Point, Project, ScheduleRow, SheetSteelSchedule } from './types';
import { schedule, scheduleChanged } from './model';
import { detailTitle } from './detailQuantities';
import { weldedMeshSchedule } from './weldedMeshSchedule';
import {
  paperTextWidth,
  wrapPaperText,
  type PaperPrimitive,
} from './paperText';
export const sheetSteelScheduleSchema = z
  .object({
    origin: z
      .object({
        x: z.number().finite().min(-1e9).max(1e9),
        y: z.number().finite().min(-1e9).max(1e9),
      })
      .strict(),
    textHeight: z.number().finite().min(1.8).max(5),
    allowancePercent: z.number().finite().min(0).max(100),
    /** Perda das telas soldadas (%), sobre a massa aplicada; ausente = 0. */
    meshLossPercent: z.number().finite().min(0).max(100).optional(),
  })
  .strict();
export const defaultSheetSchedule = (
  origin: Point = { x: 20, y: 270 },
): SheetSteelSchedule => ({ origin, textHeight: 2.5, allowancePercent: 10 });
/** Sheet scope is physical IDs in placed details or displayed through representations.
 * Visibility, plotting and repeated view instances never multiply or remove steel. */
export function sheetScheduleData(p: Project, sheetId: string) {
  if (!p.sheets.some((s) => s.id === sheetId))
    throw new Error('Folha inexistente.');
  const drawings = new Map(p.hierarchy.drawings.map((d) => [d.id, d.detailId]));
  const details = new Set(
    p.hierarchy.placements
      .filter((v) => v.sheetId === sheetId)
      .map((v) => drawings.get(v.drawingId))
      .filter((v): v is string => !!v),
  );
  const ids = new Set(
    p.bars
      .filter((b) => details.has(p.hierarchy.objectDetails[b.id]))
      .map((b) => b.id),
  );
  for (const r of p.details)
    if (details.has(p.hierarchy.objectDetails[r.id])) ids.add(r.barId);
  const { rows, barIds } = scheduleForBarIds(p, ids);
  // Telas dos detalhamentos da prancha: quadro à parte, com a perda configurada nele.
  const meshIds = (p.weldedMeshes ?? [])
    .filter((l) => details.has(p.hierarchy.objectDetails[l.id]))
    .map((l) => l.id);
  const meshes = weldedMeshSchedule(p, {
    ids: new Set(meshIds),
    lossPercent:
      p.sheets.find((s) => s.id === sheetId)?.steelSchedule?.meshLossPercent ??
      0,
  });
  return {
    rows,
    barIds,
    meshIds,
    meshes,
    detailIds: [...details],
    names: [...new Set([...details].map((id) => detailTitle(p, id)))],
    summary: steelSummary(rows),
    scheduleDirty: scheduleChanged(p),
  };
}
/** The existing schedule engine restricted to a set of physical IDs. Shared
 * fabrication positions keep their identity and only the scope's contributions. */
export function scheduleForBarIds(p: Project, ids: ReadonlySet<string>) {
  const bars = p.bars.filter((b) => ids.has(b.id));
  const rows = schedule({
    ...p,
    bars,
    scheduleLock: undefined,
    fabricationPositions: p.fabricationPositions
      ?.map((g) => ({ ...g, barIds: g.barIds.filter((id) => ids.has(id)) }))
      .filter((g) => g.barIds.length),
  }).sort(
    (a, b) =>
      b.steel.localeCompare(a.steel) ||
      a.mark.localeCompare(b.mark, 'pt-BR', { numeric: true }),
  );
  return { rows, barIds: bars.map((b) => b.id) };
}
export type SteelSummaryRow = {
  steel: string;
  diameter: number;
  totalLength: number;
  weight: number;
};
/** Steel class + diameter totals at full precision (m, kg). */
export function steelSummary(
  rows: readonly Pick<
    ScheduleRow,
    'steel' | 'diameter' | 'totalLength' | 'weight'
  >[],
): SteelSummaryRow[] {
  const summary = new Map<string, SteelSummaryRow>();
  for (const r of rows) {
    const key = `${r.steel}:${r.diameter}`,
      old = summary.get(key) ?? {
        steel: r.steel,
        diameter: r.diameter,
        totalLength: 0,
        weight: 0,
      };
    old.totalLength += r.totalLength;
    old.weight += r.weight;
    summary.set(key, old);
  }
  return [...summary.values()].sort(
    (a, b) => a.steel.localeCompare(b.steel) || a.diameter - b.diameter,
  );
}
export function setSheetSchedule(
  p: Project,
  sheetId: string,
  input: SheetSteelSchedule | undefined,
): Project {
  if (!p.sheets.some((s) => s.id === sheetId))
    throw new Error('Folha inexistente.');
  const value =
    input === undefined ? undefined : sheetSteelScheduleSchema.parse(input);
  // 0% é o padrão: não grava, para um quadro sem perda manter a forma de antes.
  if (value?.meshLossPercent === 0) delete value.meshLossPercent;
  return {
    ...p,
    sheets: p.sheets.map((s) =>
      s.id === sheetId ? { ...s, steelSchedule: value } : s,
    ),
  };
}
const number = (n: number, digits = 1) =>
  n.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  });
/** Vector table at its upper-left insertion point, already in real paper mm. */
export function sheetScheduleGeometry(
  p: Project,
  sheetId: string,
  input: SheetSteelSchedule,
) {
  const options = sheetSteelScheduleSchema.parse(input),
    data = sheetScheduleData(p, sheetId),
    h = options.textHeight,
    k = h / 2.5,
    rh = h * 1.75;
  const rows = data.rows.map((r) => [
    r.steel,
    r.mark,
    number(r.diameter),
    String(r.quantity),
    Math.abs(r.unitLengthRange[1] - r.unitLengthRange[0]) > 0.00001
      ? `${number(r.unitLengthRange[0] * 100)}-${number(r.unitLengthRange[1] * 100)}`
      : number(r.unitLength * 100),
    number(r.totalLength * 100),
  ]);
  const headings = ['AÇO', 'N', 'DIAM', 'QUANT', 'C.UNIT', 'C.TOTAL'],
    units = ['', '', '(mm)', '', '(cm)', '(cm)'];
  const widths = [13, 15, 15, 18, 20, 24].map((min, i) =>
    Math.max(
      min * k,
      ...rows.map((r) => paperTextWidth(r[i], h) + 3 * k),
      paperTextWidth(headings[i], h) + 3 * k,
    ),
  );
  const width = widths.reduce((a, b) => a + b, 0),
    lines: PaperPrimitive[] = [];
  const stroke = (points: Point[]) =>
    lines.push({
      layer: 'QUADRO_ACO',
      points,
      resolvedStyle: {
        color: '#8b96ad',
        fillColor: '#8b96ad',
        fill: 'none',
        lineWidth: 0.15,
        lineScale: 1,
        lineType: { name: 'CONTINUOUS', pattern: [] },
      },
    });
  const text = (
    value: string,
    x: number,
    y: number,
    align: 'left' | 'center' | 'right' = 'left',
  ) => {
    if (value)
      lines.push({
        layer: 'QUADRO_ACO',
        points: [{ x, y }],
        text: value,
        textHeight: h,
        textAlign: align,
        resolvedStyle: {
          color: '#8b96ad',
          fillColor: '#8b96ad',
          fill: 'none',
          lineWidth: 0.15,
          lineScale: 1,
          lineType: { name: 'CONTINUOUS', pattern: [] },
        },
      });
  };
  let y = -h;
  text('RELAÇÃO DO AÇO', width / 2, y, 'center');
  y -= h * 3;
  const nameColumns = 3,
    nameWidth = width / nameColumns;
  // Flow names column-by-column into equal-height columns without dropping/writing over wrapped names.
  const chunks = data.names.flatMap((n) =>
    wrapPaperText(n, h, nameWidth - 3 * k),
  );
  const namesPerColumn = Math.ceil(chunks.length / nameColumns);
  chunks.forEach((n, i) =>
    text(
      n,
      Math.floor(i / Math.max(1, namesPerColumn)) * nameWidth,
      y - (i % Math.max(1, namesPerColumn)) * rh,
    ),
  );
  y -= Math.max(1, namesPerColumn) * rh + h * 1.5;
  const grid = (
    cols: number[],
    title: string[],
    unit: string[],
    body: string[][],
    groupSteel: boolean,
  ) => {
    const w = cols.reduce((a, b) => a + b, 0),
      top = y,
      header = 3 * h,
      bodyCount = Math.max(1, body.length),
      bottom = top - header - bodyCount * rh;
    stroke([
      { x: 0, y: top },
      { x: w, y: top },
      { x: w, y: bottom },
      { x: 0, y: bottom },
      { x: 0, y: top },
    ]);
    stroke([
      { x: 0, y: top - header },
      { x: w, y: top - header },
    ]);
    let x = 0;
    cols.forEach((cw, i) => {
      if (i)
        stroke([
          { x, y: top },
          { x, y: bottom },
        ]);
      text(title[i], x + cw / 2, top - h * 1.25, 'center');
      text(unit[i], x + cw / 2, top - h * 2.5, 'center');
      x += cw;
    });
    body.forEach((row, ri) => {
      let x = 0;
      row.forEach((value, ci) => {
        if (!groupSteel || ci !== 0 || ri === 0 || body[ri - 1][0] !== value)
          text(
            value,
            ci === 0 ? x + cols[ci] / 2 : x + cols[ci] - 1.5 * k,
            top - header - rh * (ri + 0.7),
            ci === 0 ? 'center' : 'right',
          );
        x += cols[ci];
      });
      if (ri > 0 && body[ri - 1][0] !== row[0])
        stroke([
          { x: 0, y: top - header - rh * ri },
          { x: w, y: top - header - rh * ri },
        ]);
    });
    if (!body.length)
      text('Sem armaduras nesta folha', w / 2, bottom + rh * 0.3, 'center');
    y = bottom;
  };
  grid(widths, headings, units, rows, true);
  y -= h * 3.5;
  text('RESUMO DO AÇO', width / 2, y, 'center');
  y -= h * 2;
  const factor = 1 + options.allowancePercent / 100;
  const summary = data.summary.map((s) => [
    s.steel,
    number(s.diameter),
    number(s.totalLength),
    number(s.weight * factor),
  ]);
  const summaryWidths = [16, 19, 24, 31].map((n, i) =>
    Math.max(n * k, ...summary.map((r) => paperTextWidth(r[i], h) + 3 * k)),
  );
  grid(
    summaryWidths,
    [
      'AÇO',
      'DIAM',
      'C.TOTAL',
      `PESO + ${options.allowancePercent.toLocaleString('pt-BR', { maximumFractionDigits: 10, useGrouping: false })}%`,
    ],
    ['', '(mm)', '(m)', '(kg)'],
    summary,
    true,
  );
  const totals = new Map<string, number>();
  data.summary.forEach((s) =>
    totals.set(s.steel, (totals.get(s.steel) ?? 0) + s.weight * factor),
  );
  y -= h * 1.5;
  const totalRows = [...totals].map(([steel, weight]) => [
    steel,
    number(weight),
  ]);
  const totalWidths = [25, 25].map((n, i) =>
    Math.max(n * k, ...totalRows.map((r) => paperTextWidth(r[i], h) + 3 * k)),
  );
  grid(totalWidths, ['PESO TOTAL', ''], ['(kg)', ''], totalRows, false);
  y -= h * 1.5;
  text(
    `Acréscimo de ${options.allowancePercent.toLocaleString('pt-BR', { maximumFractionDigits: 10, useGrouping: false })}% apenas no peso.`,
    0,
    y,
  );
  y -= h;
  // Telas soldadas: quadro à parte, só quando a prancha tem telas.
  const meshes = weldedMeshSchedule(p, {
    ids: new Set(data.meshIds),
    lossPercent: options.meshLossPercent ?? 0,
  });
  let meshWidth = 0;
  if (meshes.rows.length) {
    const trim = (n: number) =>
      n.toLocaleString('pt-BR', {
        maximumFractionDigits: 1,
        useGrouping: false,
      });
    const meshRows = meshes.rows.map((r) => [
      r.mark,
      r.label,
      r.mesh.steel,
      `${number(r.mesh.longitudinal.diameter)} c/${trim(r.mesh.longitudinal.spacing / 10)}`,
      `${number(r.mesh.transverse.diameter)} c/${trim(r.mesh.transverse.spacing / 10)}`,
      `${number(r.mesh.width / 1000, 2)}×${number(r.mesh.length / 1000, 2)}`,
      String(r.basePanels),
      String(r.cutPieces),
      number(r.usefulArea / 1e6, 2),
      number(r.appliedArea / 1e6, 2),
      number(r.weight),
      number(r.supplyMass),
    ]);
    const meshHeadings = [
        'POS',
        'TELA',
        'AÇO',
        'LONG.',
        'TRANSV.',
        'PAINEL',
        'PAINÉIS',
        'RECORTES',
        'Á.ÚTIL',
        'Á.APLIC.',
        'PESO',
        'FORNEC.',
      ],
      meshUnits = [
        '',
        '',
        '',
        '(Ø mm c/cm)',
        '(Ø mm c/cm)',
        '(m)',
        '',
        '',
        '(m²)',
        '(m²)',
        '(kg)',
        '(kg)',
      ];
    const meshWidths = meshHeadings.map((title, i) =>
      Math.max(
        12 * k,
        ...meshRows.map((r) => paperTextWidth(r[i], h) + 3 * k),
        paperTextWidth(title, h) + 3 * k,
        paperTextWidth(meshUnits[i], h) + 3 * k,
      ),
    );
    meshWidth = meshWidths.reduce((a, b) => a + b, 0);
    y -= h * 3.5;
    text('QUADRO DE TELAS SOLDADAS', meshWidth / 2, y, 'center');
    y -= h * 2;
    grid(meshWidths, meshHeadings, meshUnits, meshRows, false);
    y -= h * 3.5;
    text('RESUMO DAS TELAS', meshWidth / 2, y, 'center');
    y -= h * 2;
    const resumeRows = [
      ...meshes.summary.map((s) => [s.label, number(s.weight)]),
      ['TOTAL', number(meshes.total)],
    ];
    const resumeWidths = [25, 25].map((n, i) =>
      Math.max(
        n * k,
        ...resumeRows.map((r) => paperTextWidth(r[i], h) + 3 * k),
      ),
    );
    grid(resumeWidths, ['TELA', 'PESO'], ['', '(kg)'], resumeRows, false);
    y -= h * 1.5;
    text(
      `Peso das telas: massa nominal aplicada com perda de ${trim(meshes.lossPercent)}%.`,
      0,
      y,
    );
    y -= h * 1.5;
    text('Fornecimento: painéis inteiros × kg/painel, sem perda.', 0, y);
    y -= h;
  }
  const height = -y,
    origin = options.origin,
    totalWidth = Math.max(
      width,
      summaryWidths.reduce((a, b) => a + b, 0),
      totalWidths.reduce((a, b) => a + b, 0),
      meshWidth,
    );
  return {
    data,
    width: totalWidth,
    height,
    lines: lines.map((l) => ({
      ...l,
      points: l.points.map((v) => ({ x: v.x + origin.x, y: v.y + origin.y })),
    })),
    frame: [
      { x: origin.x, y: origin.y },
      {
        x: origin.x + totalWidth,
        y: origin.y,
      },
      {
        x: origin.x + totalWidth,
        y: origin.y - height,
      },
      { x: origin.x, y: origin.y - height },
    ],
  };
}
