import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
const strFromU8 = (b: Uint8Array) =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(b);
import {
  emptyProject,
  newBar,
  schedule,
  createScheduleLock,
} from '../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
  moveObjectsToDetail,
} from '../src/domain/hierarchy';
import {
  createSheet,
  placeDrawing,
  duplicatePlacement,
} from '../src/domain/sheets';
import {
  defaultSheetSchedule,
  setSheetSchedule,
  sheetScheduleData,
  sheetScheduleGeometry,
} from '../src/domain/sheetSchedule';
import {
  buildScopedSchedule,
  detailOptions,
  resolveScopes,
  weightWithAllowance,
} from '../src/domain/scheduleScopes';
import {
  defaultCsvExportOptions,
  packageCsvFiles,
  planScopedCsv,
  type CsvExportOptions,
} from '../src/lib/scopedCsv';
import { toCsv } from '../src/lib/exports';
import { groupFabrication } from '../src/domain/fabrication';
import { setDetailRepetition } from '../src/domain/detailRepetition';
import { hideObjects } from '../src/domain/visibility';
import type { Project } from '../src/domain/types';

/** Térreo › Vigas › V1 (barra a) e Superior › Vigas › V1 (barra b): mesmos nomes,
 * IDs distintos. Prancha A mostra o primeiro, prancha B o segundo. */
function fixture() {
  let p = completeOwnership({
    ...emptyProject(),
    name: 'Edifício Ação',
    bars: [
      { ...newBar('N1'), id: 'a', quantity: 4, multiplier: 2, diameter: 10 },
      { ...newBar('N2'), id: 'b', quantity: 3, diameter: 5, steel: 'CA-60' },
    ],
  });
  const ids: Record<string, string> = {};
  for (const floor of ['Térreo', 'Superior']) {
    const f = createHierarchyNode(p, 'floor', floor);
    const g = createHierarchyNode(f.project, 'element', 'Vigas', f.id);
    const d = createHierarchyNode(g.project, 'detail', 'V1', g.id);
    p = d.project;
    ids[floor] = d.id;
  }
  p = moveObjectsToDetail(p, ['a'], ids['Térreo']);
  p = moveObjectsToDetail(p, ['b'], ids['Superior']);
  const drawing = (detail: string) =>
    p.hierarchy.drawings.find((d) => d.detailId === detail)!.id;
  p = { ...p, sheets: [{ ...p.sheets[0], name: 'Prancha A' }] };
  p = placeDrawing(p, p.sheets[0].id, drawing(ids['Térreo'])).project;
  const second = createSheet(p, 'Prancha B');
  p = placeDrawing(second.project, second.id, drawing(ids['Superior'])).project;
  return { p, terreo: ids['Térreo'], superior: ids['Superior'] };
}
const options = (o: Partial<CsvExportOptions> = {}): CsvExportOptions => ({
  ...defaultCsvExportOptions(),
  ...o,
});
/** Lê o CSV de volta: BOM, `;`, CRLF e aspas. */
function parse(csv: string) {
  expect(csv.startsWith('﻿')).toBe(true);
  expect(csv.endsWith('\r\n')).toBe(true);
  const text = csv.slice(1);
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ';') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

describe('exportação CSV configurável por escopo', () => {
  it('prancha A não inclui aço exclusivo da B e vistas repetidas não multiplicam', () => {
    let { p } = fixture();
    p = duplicatePlacement(p, p.hierarchy.placements[0].id).project;
    p = hideObjects(p, `view:${p.hierarchy.placements[0].id}`, ['a']);
    const plan = planScopedCsv(
      p,
      { kind: 'sheets', mode: 'selected', sheetIds: [p.sheets[0].id] },
      options({ summary: false }),
    );
    expect(plan.issues).toEqual([]);
    expect(plan.files.map((f) => f.name)).toEqual([
      'Edificio-Acao_pranchas_quadro.csv',
    ]);
    const rows = parse(plan.files[0].content);
    expect(rows.map((r) => r['Posição'])).toEqual(['N1']);
    expect(rows[0]['IDs físicos das armaduras']).toBe('a');
    expect(rows[0]['Quantidade efetiva']).toBe('8');
    expect(rows[0]['Escopo']).toBe('Prancha A (folha 1)');
  });

  it('elementos com o mesmo nome em pavimentos diferentes permanecem distintos', () => {
    const { p, terreo, superior } = fixture();
    const labels = detailOptions(p).filter((d) => d.name === 'V1');
    expect(labels.map((d) => d.label).sort()).toEqual([
      'Superior › Vigas › V1',
      'Térreo › Vigas › V1',
    ]);
    const plan = planScopedCsv(
      p,
      { kind: 'details', mode: 'selected', detailIds: [terreo, superior] },
      options({ layout: 'separate' }),
    );
    expect(plan.issues).toEqual([]);
    expect(plan.files.map((f) => f.name)).toEqual([
      'Edificio-Acao_elemento-Terreo-Vigas-V1_quadro.csv',
      'Edificio-Acao_elemento-Terreo-Vigas-V1_resumo.csv',
      'Edificio-Acao_elemento-Superior-Vigas-V1_quadro.csv',
      'Edificio-Acao_elemento-Superior-Vigas-V1_resumo.csv',
    ]);
    const t = parse(plan.files[0].content),
      s = parse(plan.files[2].content);
    expect(t.map((r) => r['IDs físicos das armaduras'])).toEqual(['a']);
    expect(s.map((r) => r['IDs físicos das armaduras'])).toEqual(['b']);
    expect(t[0]['ID do escopo']).toBe(terreo);
    expect(t[0]['Contexto do escopo']).toBe('Térreo › Vigas');
  });

  it('posição compartilhada exporta só as contribuições do escopo e aplica fatores uma vez', () => {
    let { p, terreo, superior } = fixture();
    p.bars[1] = {
      ...p.bars[0],
      id: 'b',
      mark: 'N2',
      quantity: 2,
      multiplier: 1,
      origin: { x: 1500, y: 0 },
    };
    p = groupFabrication(p, ['a', 'b'], 'a');
    p = setDetailRepetition(p, terreo, {
      factor: 3,
      elements: [{ name: 'V1' }, { name: 'V3' }, { name: 'V5' }],
    });
    const global = schedule(p)[0];
    // 4 × 2 × 3 + 2 = 26 no projeto; a posição N1 é a mesma nos dois escopos.
    expect(global.quantity).toBe(26);
    const plan = planScopedCsv(
      p,
      { kind: 'details', mode: 'selected', detailIds: [terreo, superior] },
      options({ layout: 'consolidated', physicalTotal: true }),
    );
    expect(plan.issues).toEqual([]);
    const rows = parse(plan.files[0].content);
    const [t, s, total] = rows;
    expect(t['ID da posição de fabricação']).toBe(global.positionId);
    expect(s['ID da posição de fabricação']).toBe(global.positionId);
    expect(t['Posição']).toBe('N1');
    expect(s['Posição']).toBe('N1');
    expect([t['Quantidade base'], t['Multiplicador da armadura']]).toEqual([
      '4',
      '2',
    ]);
    expect(t['Quantidade por detalhe']).toBe('8');
    expect(t['Repetições do detalhamento']).toBe('3');
    expect(t['Quantidade efetiva']).toBe('24');
    expect(t['Fórmula da quantidade']).toBe('4 × 2 × 3 = 24');
    expect(t['Repetição do detalhamento']).toContain('sem rateio por elemento');
    expect(s['Quantidade efetiva']).toBe('2');
    expect(s['IDs físicos das armaduras']).toBe('b');
    expect(total['Tipo de escopo']).toBe('Total físico');
    expect(total['Quantidade efetiva']).toBe('26');
    expect(total['IDs físicos das armaduras']).toBe('a | b');
    expect(plan.warnings.join(' ')).toContain('sem rateio');
    // Quadro e resumo conciliam pelo mesmo valor completo.
    const summary = parse(plan.files[1].content).filter(
      (r) => r['Linha'] === 'Bitola' && r['Tipo de escopo'] === 'Total físico',
    );
    expect(summary[0]['Peso teórico (kg)']).toBe(total['Peso teórico (kg)']);
  });

  it('100 kg com 10% resulta em 110 kg sem alterar comprimentos ou quantidades', () => {
    expect(weightWithAllowance(100, 10)).toBeCloseTo(110, 12);
    // 100 kg de Ø25: 100 / (π·0,025²/4·7850) m.
    const length = 100 / ((Math.PI * 0.025 ** 2) / 4 / 1) / 7850;
    let { p } = fixture();
    p.bars[0] = {
      ...p.bars[0],
      diameter: 25,
      quantity: 1,
      multiplier: 1,
      points: [
        { x: 0, y: 0 },
        { x: length * 1000, y: 0 },
      ],
    };
    p = setSheetSchedule(p, p.sheets[0].id, defaultSheetSchedule());
    const before = JSON.stringify(p);
    const plan = planScopedCsv(
      p,
      { kind: 'sheets', mode: 'active', sheetIds: [] },
      options({ detailed: false, precision: 'extended' }),
      p.sheets[0].id,
    );
    const [row] = parse(plan.files[0].content);
    expect(row['Peso teórico (kg)']).toBe('100,000');
    expect(row['Acréscimo (%)']).toBe('10');
    expect(row['Origem do acréscimo']).toBe('Quadro inserido na prancha');
    expect(row['Peso com acréscimo (kg)']).toBe('110,000');
    expect(row['Comprimento total (m)']).toBe(
      length.toLocaleString('pt-BR', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
        useGrouping: false,
      }),
    );
    expect(JSON.stringify(p)).toBe(before);
  });

  it('percentual: quadro da folha, explícito sem quadro, sobrescrita só na exportação e conflito no total', () => {
    let { p } = fixture();
    p = setSheetSchedule(p, p.sheets[0].id, {
      ...defaultSheetSchedule(),
      allowancePercent: 7.5,
    });
    const before = JSON.stringify(p);
    const sel = { kind: 'sheets' as const, mode: 'all' as const, sheetIds: [] };
    const scoped = planScopedCsv(
      p,
      sel,
      options({
        detailed: false,
        layout: 'consolidated',
        physicalTotal: true,
        allowance: { mode: 'scope', percent: 0 },
      }),
    );
    const rows = parse(scoped.files[0].content).filter(
      (r) => r['Linha'] === 'Bitola',
    );
    expect(rows.map((r) => [r['Escopo'], r['Acréscimo (%)']])).toEqual([
      ['Prancha A (folha 1)', '7,5'],
      ['Prancha B (folha 2)', '0'],
      ['Total físico (união dos IDs)', ''],
      ['Total físico (união dos IDs)', ''],
    ]);
    expect(rows[1]['Origem do acréscimo']).toBe(
      'Prancha sem quadro inserido; definido nesta exportação',
    );
    expect(rows[2]['Origem do acréscimo']).toContain('Percentuais diferentes');
    expect(rows[2]['Peso com acréscimo (kg)']).toBe('');
    const override = planScopedCsv(
      p,
      sel,
      options({
        detailed: false,
        layout: 'consolidated',
        physicalTotal: true,
        allowance: { mode: 'override', percent: 5 },
      }),
    );
    expect(
      parse(override.files[0].content).every((r) => r['Acréscimo (%)'] === '5'),
    ).toBe(true);
    const none = planScopedCsv(
      p,
      sel,
      options({ detailed: false, allowance: { mode: 'none' } }),
    );
    expect(
      none.files
        .flatMap((f) => parse(f.content))
        .map((r) => r['Acréscimo (%)']),
    ).toEqual(['0', '0', '0', '0']);
    expect(JSON.stringify(p)).toBe(before);
    expect(p.sheets[0].steelSchedule!.allowancePercent).toBe(7.5);
  });

  it('pranchas sobrepostas: arquivos por folha e total físico pela união dos IDs', () => {
    let { p, superior } = fixture();
    p = completeOwnership({
      ...p,
      details: [{ id: 'r', barId: 'a', origin: { x: 0, y: 0 } }],
    });
    p = moveObjectsToDetail(p, ['r'], superior);
    const resolved = resolveScopes(p, {
      kind: 'sheets',
      mode: 'all',
      sheetIds: [],
    });
    const data = buildScopedSchedule(
      p,
      resolved.scopes,
      { mode: 'none' },
      { physicalTotal: true },
    );
    expect(data.scopes.map((s) => s.scope.barIds.sort())).toEqual([
      ['a'],
      ['a', 'b'],
    ]);
    expect(data.sharedBarIds).toEqual(['a']);
    const sum = data.scopes
      .flatMap((s) => s.rows)
      .reduce((n, r) => n + r.weight, 0);
    const physical = schedule(p).reduce((n, r) => n + r.weight, 0);
    expect(sum).toBeGreaterThan(physical);
    expect(
      data.physicalTotal!.rows.reduce((n, r) => n + r.weight, 0),
    ).toBeCloseTo(physical, 12);
    const plan = planScopedCsv(
      p,
      { kind: 'sheets', mode: 'all', sheetIds: [] },
      options({ physicalTotal: true }),
    );
    expect(plan.warnings[0]).toContain('não é o total físico');
    expect(plan.files.map((f) => f.name)).toEqual([
      'Edificio-Acao_prancha-Prancha-A-folha-1_quadro.csv',
      'Edificio-Acao_prancha-Prancha-A-folha-1_resumo.csv',
      'Edificio-Acao_prancha-Prancha-B-folha-2_quadro.csv',
      'Edificio-Acao_prancha-Prancha-B-folha-2_resumo.csv',
      'Edificio-Acao_total-fisico-Total-fisico-uniao-dos-IDs_quadro.csv',
      'Edificio-Acao_total-fisico-Total-fisico-uniao-dos-IDs_resumo.csv',
    ]);
  });

  it('unidades e arredondamento conferem com o quadro visual configurado igualmente', () => {
    let { p } = fixture();
    p.bars[0] = {
      ...p.bars[0],
      points: [
        { x: 0, y: 0 },
        { x: 1234.56, y: 0 },
      ],
    };
    const visual = sheetScheduleGeometry(p, p.sheets[0].id, {
      ...defaultSheetSchedule(),
      allowancePercent: 10,
    });
    const labels = visual.lines.map((l) => l.text).filter(Boolean);
    p = setSheetSchedule(p, p.sheets[0].id, defaultSheetSchedule());
    const plan = planScopedCsv(
      p,
      { kind: 'sheets', mode: 'active', sheetIds: [] },
      options(),
      p.sheets[0].id,
    );
    const [d] = parse(plan.files[0].content),
      [s] = parse(plan.files[1].content);
    expect(d['C. unitário (cm)']).toBe('123,5');
    expect(d['Comprimento total (cm)']).toBe('987,6');
    for (const v of [
      d['Bitola (mm)'],
      d['C. unitário (cm)'],
      d['Comprimento total (cm)'],
      s['Comprimento total (m)'],
      s['Peso com acréscimo (kg)'],
    ])
      expect(labels).toContain(v);
    const m = planScopedCsv(
      p,
      { kind: 'sheets', mode: 'active', sheetIds: [] },
      options({
        detailedLength: 'm',
        summaryLength: 'cm',
        precision: 'extended',
        decimal: '.',
      }),
      p.sheets[0].id,
    );
    const [dm] = parse(m.files[0].content),
      [sm] = parse(m.files[1].content);
    expect(dm['C. unitário (m)']).toBe('1.235');
    expect(dm['Comprimento total (m)']).toBe('9.876');
    expect(sm['Comprimento total (cm)']).toBe('987.65');
    expect(dm['Bitola (mm)']).toBe('10.0');
  });

  it('acentos, aspas, ponto e vírgula, quebras de linha e fórmulas não corrompem o arquivo', () => {
    const { p } = fixture();
    p.bars[0] = {
      ...p.bars[0],
      element: '=HYPERLINK("http://x";"ç")',
      comment: 'Observação; "aspas"\r\nlinha 2',
      columnLevel: '+1',
    };
    const plan = planScopedCsv(
      p,
      { kind: 'project' },
      options({ summary: false }),
    );
    const r = parse(plan.files[0].content).find((r) => r['Posição'] === 'N1')!;
    expect(r['Elemento']).toBe('\'=HYPERLINK("http://x";"ç")');
    expect(r['Observação']).toBe('Observação; "aspas"\r\nlinha 2');
    expect(r['Lance']).toBe("'+1");
    expect(plan.files[0].content).not.toMatch(/;"=|;"\+|;"@|;"-/);
    expect(plan.files[0].name).toBe('Edificio-Acao_projeto_quadro.csv');
  });

  it('seleções vazias, removidas, RA desatualizada e geometria inválida são explícitas', () => {
    const { p, terreo } = fixture();
    const all = options();
    expect(
      planScopedCsv(
        p,
        { kind: 'details', mode: 'selected', detailIds: [] },
        all,
      ).issues,
    ).toEqual(['Selecione ao menos um elemento.']);
    const removed = planScopedCsv(
      p,
      { kind: 'details', mode: 'selected', detailIds: [terreo, 'apagado'] },
      all,
    );
    expect(removed.issues).toEqual([
      'O elemento selecionado (apagado) não existe mais.',
    ]);
    expect(removed.files).toEqual([]);
    expect(
      planScopedCsv(p, { kind: 'sheets', mode: 'active', sheetIds: [] }, all)
        .issues[0],
    ).toContain('Não há prancha ativa');
    const emptyDetail = p.hierarchy.details.find(
      (d) => !p.bars.some((b) => p.hierarchy.objectDetails[b.id] === d.id),
    )!;
    expect(
      planScopedCsv(
        p,
        { kind: 'details', mode: 'selected', detailIds: [emptyDetail.id] },
        all,
      ).issues[0],
    ).toContain('não possui armaduras');
    expect(
      planScopedCsv(
        p,
        { kind: 'project' },
        { ...all, detailed: false, summary: false },
      ).issues,
    ).toEqual(['Escolha o quadro detalhado, o resumo do aço ou ambos.']);
    const locked: Project = {
      ...p,
      scheduleLock: createScheduleLock(p),
      bars: p.bars.map((b) => (b.id === 'a' ? { ...b, quantity: 9 } : b)),
    };
    expect(planScopedCsv(locked, { kind: 'project' }, all).issues[0]).toContain(
      'relação de aço está bloqueada e desatualizada',
    );
    const invalid: Project = {
      ...p,
      bars: p.bars.map((b) =>
        b.id === 'a' ? { ...b, points: [{ x: 0, y: 0 }] } : b,
      ),
    };
    const blocked = planScopedCsv(invalid, { kind: 'project' }, all);
    expect(blocked.issues[0]).toContain('Corrija a geometria de N1');
    expect(blocked.files).toEqual([]);
  });

  it('ZIP contém os CSVs íntegros; exportar não altera o projeto e o CSV global é preservado', () => {
    const { p } = fixture();
    const before = JSON.stringify(p),
      global = toCsv(p);
    const sel = { kind: 'sheets' as const, mode: 'all' as const, sheetIds: [] };
    const plan = planScopedCsv(p, sel, options());
    const pack = packageCsvFiles(plan.files, p.name, sel);
    expect(pack.name).toBe('Edificio-Acao_relacao-aco_pranchas.zip');
    expect(pack.mime).toBe('application/zip');
    const unzipped = unzipSync(pack.data as Uint8Array);
    expect(Object.keys(unzipped)).toEqual(plan.files.map((f) => f.name));
    for (const f of plan.files) {
      expect([...unzipped[f.name].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(strFromU8(unzipped[f.name])).toBe(f.content);
    }
    expect(parse(strFromU8(unzipped[plan.files[0].name]))[0]['Posição']).toBe(
      'N1',
    );
    const single = packageCsvFiles(plan.files.slice(0, 1), p.name, sel);
    expect(single).toMatchObject({ ext: 'csv', data: plan.files[0].content });
    expect(JSON.stringify(p)).toBe(before);
    expect(toCsv(p)).toBe(global);
    expect(global.split('\r\n')[0]).toBe(
      '﻿"Posição";"Elemento";"Aço";"Bitola (mm)";"Quantidade base";"Repetições";"Quantidade efetiva";"Comprimento unitário (m)";"Comprimento total (m)";"Peso teórico (kg)";"ID da posição de fabricação";"Contribuições por ocorrência (JSON)";"Fórmula da quantidade";"C. unit. mínimo (m)";"C. unit. máximo (m)";"Multiplicador da armadura";"Quantidade por detalhe";"Origem da quantidade base";"Observação";"Por nervura";"Mostrar C/NERV";"Lance"',
    );
    expect(sheetScheduleData(p, p.sheets[0].id).barIds).toEqual(['a']);
  });
});
