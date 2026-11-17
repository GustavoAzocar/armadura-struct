import { describe, expect, it } from 'vitest';
import {
  addSeriesVariants,
  createBarSeries,
  deleteBarSeries,
  moveSeriesVariant,
  reconcileBarSeries,
  removeSeriesVariant,
  seriesFabricationRecords,
  seriesTableData,
  setSeriesTable,
  splitSeriesRows,
  updateBarSeries,
} from '../src/domain/barSeries';
import {
  BAR_SERIES_PROJECT_SCHEMA,
  defaultSeriesTable,
} from '../src/domain/barSeriesSchema';
import {
  createScheduleLock,
  decodeProject,
  emptyProject,
  newBar,
  schedule,
} from '../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
  moveObjectsToDetail,
} from '../src/domain/hierarchy';
import { defaultCsvExportOptions, planScopedCsv } from '../src/lib/scopedCsv';
import { setDetailRepetition } from '../src/domain/detailRepetition';
import { previewRenumber, applyRenumber } from '../src/domain/numbering';
import { cloneArmatureGraph } from '../src/domain/editing';
import { createDetailPackage } from '../src/domain/detailPackage';
import { geometry } from '../src/domain/geometry';
import {
  duplicateSheet,
  placeDrawing,
  updatePlacement,
} from '../src/domain/sheets';
import {
  alignPlacement,
  composeSheet,
  seriesTableIssues,
  usefulArea,
} from '../src/domain/paper';
import { seriesTableGeometry } from '../src/domain/seriesTableGeometry';
import { sheetScheduleData } from '../src/domain/sheetSchedule';
import { criteriaBar } from '../src/domain/stirrups';
import { defaultStirrupCriteria } from '../src/domain/stirrupSchema';
import { assertDetailEdit } from '../src/domain/detailEditing';
import type { Bar, Project } from '../src/domain/types';

const straight = (id: string, mark: string, length: number, quantity = 1) =>
  ({
    ...newBar(mark),
    id,
    quantity,
    points: [
      { x: 0, y: 0 },
      { x: length, y: 0 },
    ],
  }) satisfies Bar;
const base = (bars: Bar[]) =>
  completeOwnership({ ...emptyProject(), name: 'Séries', bars });
const detailId = (p: Project) => p.hierarchy.details[0].id;
const withRepetition = (p: Project, factor: number) =>
  setDetailRepetition(p, detailId(p), { factor, elements: [] });
const multiply = (p: Project, multiplier: number): Project => ({
  ...p,
  bars: p.bars.map((b) => ({ ...b, multiplier })),
});

function threeBars(quantities = [1, 1, 1]) {
  const p = base([
    straight('b1', 'N1', 1000, quantities[0]),
    straight('b2', 'N2', 1250, quantities[1]),
    straight('b3', 'N3', 1500, quantities[2]),
  ]);
  return createBarSeries(p, { barIds: ['b1', 'b2', 'b3'], name: 'N5' });
}
const totalsMm = (p: Project, id: string) => {
  const t = seriesTableData(p, id).totals;
  return { pieces: t.pieces, length: Math.round(t.length * 1000 * 1e6) / 1e6 };
};

/** Folha com o desenho do detalhamento colocado e uma tabela da série. */
function onSheet(p: Project, seriesId: string, rowsPerBlock?: number) {
  const sheetId = p.sheets[0].id;
  const drawing = p.hierarchy.drawings.find((d) => d.detailId === detailId(p))!;
  const placed = placeDrawing(p, sheetId, drawing.id);
  p = updatePlacement(placed.project, placed.id, {
    origin: { x: 270, y: 150 },
    scale: 50,
    frame: { width: 130, height: 80 },
  });
  p = alignPlacement(p, placed.id);
  const area = usefulArea(p.sheets[0]);
  const table = {
    ...defaultSeriesTable('t1', seriesId, {
      x: area.x + 5,
      y: area.y + area.height - 5,
    }),
    ...(rowsPerBlock ? { rowsPerBlock } : {}),
  };
  return {
    project: setSeriesTable(p, sheetId, 't1', table),
    sheetId,
    table,
  };
}

describe('série variável: identidade e quantitativos', () => {
  it('3 barras de 1.000/1.250/1.500 mm totalizam 3.750 mm e aplicam fatores uma vez', () => {
    const { project, id } = threeBars();
    expect(project.schema).toBe(BAR_SERIES_PROJECT_SCHEMA);
    expect(totalsMm(project, id)).toEqual({ pieces: 3, length: 3750 });
    expect(totalsMm(withRepetition(project, 2), id)).toEqual({
      pieces: 6,
      length: 7500,
    });
    expect(totalsMm(withRepetition(multiply(project, 2), 3), id)).toEqual({
      pieces: 18,
      length: 22500,
    });
    const rows = seriesTableData(
      withRepetition(multiply(project, 2), 3),
      id,
    ).rows;
    expect(rows.map((r) => r.formula)).toEqual([
      '1×2×3 = 6',
      '1×2×3 = 6',
      '1×2×3 = 6',
    ]);
    expect(rows.map((r) => r.cutLength)).toEqual([1000, 1250, 1500]);
  });

  it('multiplicidades 1/2/3 dão 6 peças e 8.000 mm; o número de variantes não é fator', () => {
    const { project, id } = threeBars([1, 2, 3]);
    expect(totalsMm(project, id)).toEqual({ pieces: 6, length: 8000 });
    const factored = withRepetition(multiply(project, 2), 3);
    expect(totalsMm(factored, id)).toEqual({ pieces: 36, length: 48000 });
    // Soma independente das variantes = RA global = consulta da série.
    const independent = factored.bars.reduce(
      (n, b) => n + b.quantity * 2 * 3 * geometry(b).length,
      0,
    );
    const ra = schedule(factored).reduce((n, r) => n + r.totalLength, 0);
    expect(ra * 1000).toBeCloseTo(independent, 6);
    expect(seriesTableData(factored, id).totals.length).toBeCloseTo(ra, 9);
    expect(seriesTableData(factored, id).totals.weight).toBeCloseTo(
      schedule(factored).reduce((n, r) => n + r.weight, 0),
      9,
    );
  });

  it('editar só a segunda variante muda sua linha e os totais dependentes', () => {
    const { project, id } = threeBars();
    const before = seriesTableData(project, id);
    const edited: Project = {
      ...project,
      bars: project.bars.map((b) =>
        b.id === 'b2' ? straight('b2', 'N2', 1300) : b,
      ),
    };
    const after = seriesTableData(edited, id);
    expect(totalsMm(edited, id)).toEqual({ pieces: 3, length: 3800 });
    expect(totalsMm(withRepetition(edited, 2), id)).toEqual({
      pieces: 6,
      length: 7600,
    });
    expect(after.rows.map((r) => r.variantIds[0])).toEqual(
      before.rows.map((r) => r.variantIds[0]),
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(after.rows[2]).toEqual(before.rows[2]);
    expect(after.rows[1].cutLength).toBe(1300);
  });

  it('24 variantes distintas aparecem inteiras e três blocos de oito preservam IDs, ordem e totais', () => {
    const bars = Array.from({ length: 24 }, (_, i) =>
      straight(`v${i}`, `N${i + 1}`, 1000 + i * 50),
    );
    const created = createBarSeries(base(bars), {
      barIds: bars.map((b) => b.id),
      name: 'N30',
    });
    const data = seriesTableData(created.project, created.id);
    expect(data.rows).toHaveLength(24);
    const blocks = splitSeriesRows(data.rows, 8);
    expect(blocks.map((b) => b.rows.length)).toEqual([8, 8, 8]);
    expect(blocks.flatMap((b) => b.rows.map((r) => r.variantIds[0]))).toEqual(
      data.rows.map((r) => r.variantIds[0]),
    );
    expect(
      new Set(blocks.flatMap((b) => b.rows.map((r) => r.barIds[0]))).size,
    ).toBe(24);
    expect(blocks.reduce((n, b) => n + b.subtotal.length, 0)).toBeCloseTo(
      data.totals.length,
      12,
    );
    expect(blocks.reduce((n, b) => n + b.subtotal.pieces, 0)).toBe(24);
    // Geometria de papel: mesmas linhas, cabeçalho e unidades em cada bloco.
    const sheet = onSheet(created.project, created.id, 8);
    const g = seriesTableGeometry(sheet.project, sheet.sheetId, sheet.table);
    expect(g.blocks).toHaveLength(3);
    for (const block of g.blocks) {
      const texts = block.lines.map((l) => l.text).filter(Boolean);
      expect(texts).toContain('C.CORTE');
      expect(texts).toContain('(cm)');
      expect(texts.some((t) => t!.includes('SÉRIE N30'))).toBe(true);
    }
    expect(g.blocks.flatMap((b) => b.rows.map((r) => r.variantIds[0]))).toEqual(
      data.rows.map((r) => r.variantIds[0]),
    );
    // Subtotal por bloco e total somente no último, sem contar duas vezes.
    const texts = g.blocks.map((b) =>
      b.lines.map((l) => l.text ?? '').join('\n'),
    );
    expect(texts.filter((t) => t.includes('Total da série'))).toHaveLength(1);
    expect(texts[2]).toContain('Total da série');
    expect(texts.every((t) => t.includes('Subtotal do bloco'))).toBe(true);
    expect(texts[1]).toContain('Continuação 2/3');
    expect(composeSheet(sheet.project, sheet.sheetId).issues).toEqual([]);
  });

  it('ordem segue a estação física e mover uma variante não troca dimensões e cortes', () => {
    const { project, id } = threeBars([1, 2, 3]);
    const first = seriesTableData(project, id).rows;
    const moved = moveSeriesVariant(project, id, first[0].variantIds[0], 1);
    const rows = seriesTableData(moved, id).rows;
    expect(rows.map((r) => r.barIds[0])).toEqual(['b2', 'b1', 'b3']);
    const byVariant = (list: typeof rows) =>
      Object.fromEntries(
        list.map((r) => [r.variantIds[0], [r.cutLength, r.quantity]]),
      );
    expect(byVariant(rows)).toEqual(byVariant(first));
  });
});

describe('estribos e geometria analítica', () => {
  it('confere cada estribo com a fórmula analítica, incluindo ganchos', () => {
    const r = (40 + 8) / 2;
    const widths = [200, 250, 300, 350];
    const bars = widths.map((width, i) => ({
      ...newBar(`E${i + 1}`),
      id: `e${i}`,
      kind: 'stirrup' as const,
      width,
      height: 400,
      hook: 80,
      mandrel: 40,
      diameter: 8,
    }));
    const created = createBarSeries(base(bars), {
      barIds: bars.map((b) => b.id),
      name: 'E',
    });
    const data = seriesTableData(created.project, created.id);
    data.rows.forEach((row, i) => {
      const analytic =
        2 * widths[i] +
        2 * 400 +
        2 * 80 -
        2 * r * Math.tan((3 * Math.PI) / 8) -
        6 * r +
        3 * Math.PI * r;
      expect(row.cutLength).toBeCloseTo(analytic, 6);
      expect(row.developedLength).toBeCloseTo(analytic, 6);
    });
    // A largura varia e a altura é constante: cotas classificadas.
    expect(data.dimensions.some((d) => d.variable)).toBe(true);
    expect(data.dimensions.some((d) => !d.variable)).toBe(true);
  });

  it('ocultar ganchos na apresentação ou mudar a escala não altera os cortes', () => {
    const bars = [180, 220].map((width, i) => ({
      ...criteriaBar(
        { ...defaultStirrupCriteria(), width },
        { x: 0, y: 0 },
        `S${i + 1}`,
        `s${i}`,
      ),
    }));
    const created = createBarSeries(base(bars), {
      barIds: bars.map((b) => b.id),
      name: 'S',
    });
    const before = seriesTableData(created.project, created.id);
    const hidden: Project = {
      ...created.project,
      bars: created.project.bars.map((b) => ({
        ...b,
        stirrupDisplay: { ...b.stirrupDisplay!, hooks: false },
      })),
    };
    expect(
      seriesTableData(hidden, created.id).rows.map((r) => r.cutLength),
    ).toEqual(before.rows.map((r) => r.cutLength));
    const sheet = onSheet(created.project, created.id);
    const placement = sheet.project.hierarchy.placements[0];
    const rescaled = updatePlacement(sheet.project, placement.id, {
      scale: 20,
    });
    const a = seriesTableGeometry(sheet.project, sheet.sheetId, sheet.table);
    const b = seriesTableGeometry(rescaled, sheet.sheetId, {
      ...sheet.table,
      textHeight: 4,
    });
    expect(b.data.rows).toEqual(a.data.rows);
    expect(b.data.totals).toEqual(a.data.totals);
  });
});

describe('agrupamento por regras de fabricação', () => {
  it('não agrupa formas diferentes de mesmo comprimento; agrupa equivalentes mantendo origens', () => {
    const l = (id: string, mark: string, a: number, b: number) => ({
      ...newBar(mark),
      id,
      points: [
        { x: 0, y: 0 },
        { x: a, y: 0 },
        { x: a, y: b },
      ],
    });
    const p = base([
      l('x1', 'N1', 1000, 250),
      l('x2', 'N2', 800, 450),
      { ...l('x3', 'N3', 1000, 250), quantity: 2 },
    ]);
    expect(geometry(p.bars[0]).length).toBeCloseTo(
      geometry(p.bars[1]).length,
      9,
    );
    const { project, id } = createBarSeries(p, {
      barIds: ['x1', 'x2', 'x3'],
      name: 'L',
    });
    const grouped = seriesTableData(project, id, { grouping: 'fabrication' });
    expect(grouped.rows).toHaveLength(2);
    const equal = grouped.rows.find((r) => r.barIds.length === 2)!;
    expect(equal.barIds).toEqual(['x1', 'x3']);
    expect(equal.sources.map((s) => s.quantity)).toEqual([1, 2]);
    expect(equal.quantity).toBe(3);
    expect(equal.subId).toBe('L.1,3');
    const plain = seriesTableData(project, id).totals;
    expect(grouped.totals).toEqual({ ...plain, rows: 2 });
  });
});

describe('renumeração, cópia e reconciliação', () => {
  it('renumerar altera rótulos sem perder vínculos da linha', () => {
    const { project, id } = threeBars();
    const before = seriesTableData(project, id);
    const plan = previewRenumber(project, {
      policy: {
        prefix: 'P',
        start: 10,
        reserved: [],
        preservedPositionIds: [],
      },
    });
    const renumbered = applyRenumber(project, plan);
    const after = seriesTableData(renumbered, id);
    expect(after.rows.map((r) => r.variantIds)).toEqual(
      before.rows.map((r) => r.variantIds),
    );
    expect(after.rows.map((r) => r.barIds)).toEqual(
      before.rows.map((r) => r.barIds),
    );
    expect(after.rows.map((r) => r.subId)).toEqual(['N5.1', 'N5.2', 'N5.3']);
    expect(after.rows.map((r) => r.marks[0])).toEqual(
      renumbered.bars.map((b) => b.mark),
    );
  });

  it('cópia física cria nova série com novos IDs; cópia parcial não cria série', () => {
    const { project, id } = threeBars();
    const all = cloneArmatureGraph(project, {
      barIds: ['b1', 'b2', 'b3'],
      delta: { x: 0, y: 500 },
    } as never);
    expect(all.project.barSeries).toHaveLength(2);
    const copy = all.project.barSeries!.find((s) => s.id !== id)!;
    expect(copy.variants.map((v) => v.barId)).toEqual(
      ['b1', 'b2', 'b3'].map((b) => all.idMap[b]),
    );
    expect(
      copy.variants.some((v) =>
        project.barSeries![0].variants.some((o) => o.id === v.id),
      ),
    ).toBe(false);
    const partial = cloneArmatureGraph(project, {
      barIds: ['b1'],
      delta: { x: 0, y: 500 },
    } as never);
    expect(partial.project.barSeries).toHaveLength(1);
  });

  it('excluir uma variante reconcilia a série como incompleta, sem linha órfã', () => {
    const { project, id } = threeBars();
    const sheet = onSheet(project, id);
    const removed = reconcileBarSeries({
      ...sheet.project,
      bars: sheet.project.bars.filter((b) => b.id !== 'b2'),
    });
    const data = seriesTableData(removed, id);
    expect(data.rows.map((r) => r.barIds[0])).toEqual(['b1', 'b3']);
    expect(data.status.incomplete).toBe(true);
    expect(data.notes.join(' ')).toContain('INCOMPLETA: 2 de 3');
    const empty = reconcileBarSeries({ ...sheet.project, bars: [] });
    expect(empty.barSeries).toEqual([]);
    expect(empty.sheets[0].seriesTables).toEqual([]);
    expect(reconcileBarSeries(project)).toBe(project);
  });

  it('retirar, acrescentar e desfazer a série não exclui armaduras', () => {
    const { project, id } = threeBars();
    const variant = project.barSeries![0].variants[1].id;
    const less = removeSeriesVariant(project, id, variant);
    expect(less.bars).toHaveLength(3);
    expect(seriesTableData(less, id).rows).toHaveLength(2);
    const more = addSeriesVariants(less, id, ['b2']);
    expect(seriesTableData(more, id).rows.map((r) => r.barIds[0])).toEqual([
      'b1',
      'b3',
      'b2',
    ]);
    const sheet = onSheet(project, id);
    const gone = deleteBarSeries(sheet.project, id);
    expect(gone.bars).toHaveLength(3);
    expect(gone.sheets[0].seriesTables).toEqual([]);
    expect(() => createBarSeries(project, { barIds: ['b1'] })).toThrow(
      /já pertence/,
    );
  });

  it('edição isolada só altera séries do detalhamento isolado', () => {
    const { project, id } = threeBars();
    const renamed = updateBarSeries(project, id, { name: 'N9' });
    expect(() =>
      assertDetailEdit(project, renamed, detailId(project)),
    ).not.toThrow();
  });
});

describe('estimativa, bloqueio da RA e fabricação', () => {
  it('série estimada é identificada como variável/representativa e não gera fabricação', () => {
    const p = base([straight('m', 'N7', 1250, 24)]);
    const { project, id } = createBarSeries(p, {
      barIds: ['m'],
      status: 'estimated',
      expectedVariants: 24,
    });
    const data = seriesTableData(project, id);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].representative).toBe(true);
    expect(data.rows[0].subId).toBe('N7 (variável)');
    expect(data.notes[0]).toMatch(/ESTIMATIVA/);
    expect(data.totals.pieces).toBe(24);
    const fabrication = seriesFabricationRecords(project, id);
    expect(fabrication.records).toEqual([]);
    expect(fabrication.diagnostics.join(' ')).toMatch(/estimativa/);
    const sheet = onSheet(project, id);
    const text = seriesTableGeometry(sheet.project, sheet.sheetId, sheet.table)
      .lines.map((l) => l.text ?? '')
      .join('\n');
    expect(text).toContain('ESTIMATIVA');
    expect(text).toContain('méd.');
  });

  it('exportação exata gera um registro por variante com quantidade efetiva', () => {
    const { project, id } = threeBars([1, 2, 3]);
    const records = seriesFabricationRecords(withRepetition(project, 2), id);
    expect(records.diagnostics).toEqual([]);
    expect(records.records.map((r) => [r.cutLength, r.quantity])).toEqual([
      [1000, 2],
      [1250, 4],
      [1500, 6],
    ]);
  });

  it('com RA bloqueada, editar a variante acusa desatualização; atualizar reconcilia', () => {
    const { project, id } = threeBars();
    const sheet = onSheet(project, id);
    const locked = {
      ...sheet.project,
      scheduleLock: createScheduleLock(sheet.project, '2026-01-01'),
    };
    expect(seriesTableData(locked, id).status.stale).toBe(false);
    const edited = {
      ...locked,
      bars: locked.bars.map((b) =>
        b.id === 'b2' ? straight('b2', 'N2', 1300) : b,
      ),
    };
    expect(seriesTableData(edited, id).status.stale).toBe(true);
    const issues = composeSheet(edited, sheet.sheetId).issues.map(
      (i) => i.code,
    );
    expect(issues).toContain('series-table-stale');
    const refreshed = {
      ...edited,
      scheduleLock: createScheduleLock(edited, '2026-01-02'),
    };
    expect(seriesTableData(refreshed, id).status.stale).toBe(false);
    expect(seriesTableData(refreshed, id).rows[1].cutLength).toBe(1300);
    expect(composeSheet(refreshed, sheet.sheetId).issues).toEqual([]);
  });
});

describe('tabela na prancha: escopo e apresentação', () => {
  it('não atribui a cotas externas a referência do eixo, inclusive ao agrupar e exportar', () => {
    const a = {
      ...straight('a', 'N1', 1000),
      points: [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 500 },
      ],
      dimensionConvention: 'axis' as const,
    };
    const b = {
      ...a,
      id: 'b',
      mark: 'N2',
      dimensionConvention: 'external' as const,
    };
    const made = createBarSeries(base([a, b]), {
      barIds: ['a', 'b'],
      name: 'N5',
    });
    const data = seriesTableData(made.project, made.id, {
      grouping: 'fabrication',
    });
    expect(data.rows).toHaveLength(2);
    expect(data.rows.map((r) => r.dimensionReference)).toEqual([
      'eixo',
      'face externa',
    ]);
    expect(
      data.dimensions.every(
        (d) => d.reference === 'por variante' && d.variable,
      ),
    ).toBe(true);
    // Mesma geometria física, duas peças: cotagem externa não altera corte.
    expect(data.rows[0].cutLength).toBe(data.rows[1].cutLength);
    expect(data.totals.length * 1000).toBeCloseTo(
      2 * data.rows[0].cutLength,
      8,
    );
    const sheet = onSheet(made.project, made.id);
    const texts = seriesTableGeometry(
      sheet.project,
      sheet.sheetId,
      sheet.table,
    ).lines.map((l) => l.text);
    expect(texts).toContain('REF.');
    expect(texts).toContain('eixo');
    expect(texts).toContain('face externa');
    const csv = planScopedCsv(
      made.project,
      { kind: 'project' },
      { ...defaultCsvExportOptions(), variants: true },
    );
    expect(csv.files[0].content).toContain('"eixo"');
    expect(csv.files[0].content).toContain('"face externa"');
  });

  it('identifica aço e bitola por linha quando a seleção reúne materiais distintos', () => {
    const p = base([
      straight('a', 'N1', 1000),
      { ...straight('b', 'N2', 1250), steel: 'CA-60', diameter: 5 },
    ]);
    const made = createBarSeries(p, { barIds: ['a', 'b'] });
    const sheet = onSheet(made.project, made.id);
    const texts = seriesTableGeometry(
      sheet.project,
      sheet.sheetId,
      sheet.table,
    ).lines.map((l) => l.text);
    expect(texts).toContain('AÇO / Ø');
    expect(texts).toContain('CA-60 / 5,0');
    const expected = ((1.25 * Math.PI * (5 / 1000) ** 2) / 4) * 7850;
    expect(seriesTableData(made.project, made.id).rows[1].weight).toBeCloseTo(
      expected,
      10,
    );
  });

  it('duplicar, mover, retirar ou ocultar a tabela não altera aço; vistas repetidas contam uma vez', () => {
    const { project, id } = threeBars([1, 2, 3]);
    const sheet = onSheet(project, id);
    const ra = sheetScheduleData(sheet.project, sheet.sheetId);
    const twice = setSeriesTable(sheet.project, sheet.sheetId, 't2', {
      ...sheet.table,
      id: 't2',
      origin: { x: sheet.table.origin.x, y: sheet.table.origin.y - 60 },
    });
    const view = twice.hierarchy.placements[0];
    const again = placeDrawing(twice, sheet.sheetId, view.drawingId).project;
    const after = sheetScheduleData(again, sheet.sheetId);
    expect(after.rows.map((r) => r.totalLength)).toEqual(
      ra.rows.map((r) => r.totalLength),
    );
    const tables = composeSheet(again, sheet.sheetId).seriesTables;
    expect(tables).toHaveLength(2);
    expect(tables[0].data.totals).toEqual(tables[1].data.totals);
    expect(tables[0].data.totals.pieces).toBe(6);
    const hidden = setSeriesTable(sheet.project, sheet.sheetId, 't1', {
      ...sheet.table,
      visible: false,
    });
    expect(composeSheet(hidden, sheet.sheetId).seriesTables).toEqual([]);
    expect(schedule(hidden)).toEqual(schedule(sheet.project));
    expect(
      decodeProject(JSON.stringify(hidden)).sheets[0].seriesTables![0].visible,
    ).toBe(false);
    const shown = setSeriesTable(hidden, sheet.sheetId, 't1', {
      ...sheet.table,
      visible: true,
    });
    expect(
      composeSheet(shown, sheet.sheetId).seriesTables[0].data.totals.pieces,
    ).toBe(6);
    const removed = setSeriesTable(again, sheet.sheetId, 't2', undefined);
    expect(removed.bars).toEqual(again.bars);
    expect(schedule(removed)).toEqual(schedule(sheet.project));
    const copy = duplicateSheet(sheet.project, sheet.sheetId);
    const copied = copy.project.sheets.find((s) => s.id === copy.id)!;
    expect(copied.seriesTables![0].seriesId).toBe(id);
    expect(copied.seriesTables![0].id).not.toBe('t1');
    expect(schedule(copy.project)).toEqual(schedule(sheet.project));
  });

  it('tabela fora da área útil ou sem variantes na folha é recusada', () => {
    const { project, id } = threeBars();
    const sheet = onSheet(project, id);
    const outside = seriesTableGeometry(sheet.project, sheet.sheetId, {
      ...sheet.table,
      origin: { x: -50, y: 10 },
    });
    expect(
      seriesTableIssues(sheet.project.sheets[0], outside).map((i) => i.code),
    ).toContain('series-table-paper-overflow');
    const unplaced = setSeriesTable(project, project.sheets[0].id, 't1', {
      ...sheet.table,
    });
    expect(
      composeSheet(unplaced, unplaced.sheets[0].id).issues.map((i) => i.code),
    ).toContain('series-table-out-of-scope');
  });

  it('nomes longos quebram linha dentro da largura; alfabeto do PDF preservado', () => {
    const { project, id } = threeBars();
    const named = updateBarSeries(project, id, {
      name: 'N5-VARIAVEL-COM-NOME-LONGO-DE-TESTE',
    });
    const sheet = onSheet(named, id, 2);
    const g = seriesTableGeometry(sheet.project, sheet.sheetId, sheet.table);
    for (const block of g.blocks) {
      const right = Math.max(...block.frame.map((p) => p.x));
      for (const line of block.lines.filter(
        (l) => l.text && l.textAlign !== 'right' && l.textAlign !== 'center',
      ))
        expect(line.points[0].x).toBeLessThanOrEqual(right);
    }
    expect(composeSheet(sheet.project, sheet.sheetId).issues).toEqual([]);
  });
});

describe('persistência e compatibilidade', () => {
  it('salvar e reabrir preserva série, variantes, tabela e resultados', () => {
    const { project, id } = threeBars([1, 2, 3]);
    const sheet = onSheet(project, id, 2);
    const reopened = decodeProject(JSON.stringify(sheet.project));
    expect(reopened.schema).toBe(BAR_SERIES_PROJECT_SCHEMA);
    expect(reopened.barSeries).toEqual(sheet.project.barSeries);
    expect(reopened.sheets[0].seriesTables).toEqual(
      sheet.project.sheets[0].seriesTables,
    );
    expect(seriesTableData(reopened, id)).toEqual(
      seriesTableData(sheet.project, id),
    );
  });

  it('recusa séries em formato anterior e vínculos inconsistentes', () => {
    const { project } = threeBars();
    expect(() =>
      decodeProject(
        JSON.stringify({ ...project, schema: 'armadurastruct/39' }),
      ),
    ).toThrow(/formato 40/);
    const dangling = {
      ...project,
      barSeries: [
        {
          ...project.barSeries![0],
          variants: [
            ...project.barSeries![0].variants,
            { id: 'x', barId: 'inexistente', station: 9 },
          ],
        },
      ],
    };
    expect(() => decodeProject(JSON.stringify(dangling))).toThrow(/não existe/);
  });

  it('projeto legado sem séries mantém formato, RA e quadro', () => {
    const p = base([straight('a', 'N1', 1000)]);
    const reopened = decodeProject(JSON.stringify(p));
    expect(reopened.schema).toBe(p.schema);
    expect(reopened.barSeries).toBeUndefined();
    expect(schedule(reopened)).toEqual(schedule(p));
  });

  it('pacote de detalhamento recusa explicitamente a série em vez de descartá-la', () => {
    const { project } = threeBars();
    expect(() =>
      createDetailPackage(project, detailId(project), {
        producer: { app: 'teste', version: '1' },
      }),
    ).toThrow(/séries variáveis/);
  });
});

describe('CSV por variante integrado aos escopos', () => {
  const parse = (content: string) =>
    content
      .replace(/^﻿/, '')
      .trim()
      .split('\r\n')
      .map((line) =>
        line
          .slice(1, -1)
          .split('";"')
          .map((v) => v.replace(/""/g, '"')),
      );

  it('sem a opção, os arquivos legados continuam idênticos', () => {
    const { project } = threeBars([1, 2, 3]);
    const legacy = planScopedCsv(
      project,
      { kind: 'project' },
      defaultCsvExportOptions(),
    );
    expect(legacy.files.map((f) => f.name)).toEqual([
      'Series_projeto_quadro.csv',
      'Series_projeto_resumo.csv',
    ]);
    const withSeries = planScopedCsv(
      project,
      { kind: 'project' },
      { ...defaultCsvExportOptions(), variants: true },
    );
    expect(withSeries.files.map((f) => f.name)).toEqual([
      'Series_projeto_variantes.csv',
      'Series_projeto_quadro.csv',
      'Series_projeto_resumo.csv',
    ]);
    expect(withSeries.files.slice(1)).toEqual(legacy.files);
  });

  it('lista cada variante com IDs, quantidade efetiva, corte e subtotal coerentes com o resumo', () => {
    const { project, id } = threeBars([1, 2, 3]);
    const factored = withRepetition(multiply(project, 2), 3);
    const plan = planScopedCsv(
      factored,
      { kind: 'project' },
      { ...defaultCsvExportOptions(), variants: true, precision: 'extended' },
    );
    const [header, ...rows] = parse(plan.files[0].content);
    const col = (name: string) => header.indexOf(name);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r[col('ID da série')])).toEqual([id, id, id]);
    expect(rows.map((r) => r[col('Quantidade efetiva')])).toEqual([
      '6',
      '12',
      '18',
    ]);
    expect(rows.map((r) => r[col('C. de corte individual (cm)')])).toEqual([
      '100,00',
      '125,00',
      '150,00',
    ]);
    expect(rows.map((r) => r[col('Estado')])).toEqual([
      'Exato',
      'Exato',
      'Exato',
    ]);
    expect(rows.map((r) => r[col('IDs das variantes')])).toEqual(
      factored.barSeries![0].variants.map((v) => v.id),
    );
    const total = rows.reduce(
      (n, r) => n + Number(r[col('Subtotal (cm)')].replace(',', '.')),
      0,
    );
    expect(total).toBeCloseTo(4800, 6);
    const [, ...summary] = parse(plan.files[2].content);
    expect(summary.length).toBeGreaterThan(0);
    expect(plan.scopes[0].pieces).toBe(36);
  });

  it('protege nomes contra fórmulas e marca a série estimada', () => {
    const p = base([straight('m', 'N7', 1250, 24)]);
    const { project } = createBarSeries(p, {
      barIds: ['m'],
      status: 'estimated',
      name: '=SOMA(A1)',
    });
    const plan = planScopedCsv(
      project,
      { kind: 'project' },
      { ...defaultCsvExportOptions(), variants: true },
    );
    expect(plan.files[0].content).toContain(`"'=SOMA(A1)"`);
    expect(plan.files[0].content).toContain('Estimado');
    expect(plan.warnings.join(' ')).toMatch(/ESTIMATIVA/);
  });

  it('na prancha, somente variantes do escopo entram, com aviso de lista parcial', () => {
    const { project, id } = threeBars();
    const sheet = onSheet(project, id);
    // Retira b3 da folha: passa a outro detalhamento não colocado.
    const made = createHierarchyNode(
      sheet.project,
      'detail',
      'Outro',
      sheet.project.hierarchy.elements[0].id,
    );
    const moved = moveObjectsToDetail(made.project, ['b3'], made.id);
    const data = seriesTableData(moved, id, {
      scopeBarIds: sheetScheduleData(moved, sheet.sheetId).barIds.reduce(
        (s, b) => s.add(b),
        new Set<string>(),
      ),
    });
    expect(data.rows.map((r) => r.barIds[0])).toEqual(['b1', 'b2']);
    expect(data.status.partialScope).toBe(true);
    const plan = planScopedCsv(
      moved,
      { kind: 'sheets', mode: 'all', sheetIds: [] },
      { ...defaultCsvExportOptions(), variants: true },
    );
    const [, ...rows] = parse(plan.files[0].content);
    expect(rows).toHaveLength(2);
  });
});
