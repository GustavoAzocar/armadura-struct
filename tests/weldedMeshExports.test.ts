import { describe, expect, it } from 'vitest';
import DxfParser from 'dxf-parser';
import { emptyProject } from '../src/domain/model';
import {
  defaultWeldedMeshCriteria,
  type WeldedMeshCriteria,
} from '../src/domain/weldedMesh';
import { buildRegion, outlineFromPoints } from '../src/domain/weldedMeshRegion';
import {
  launchWeldedMesh,
  previewWeldedMeshUpdate,
  weldedMeshLaunchIssues,
} from '../src/domain/weldedMeshLaunch';
import { weldedMeshPrimitives } from '../src/domain/weldedMeshDrawing';
import {
  drawingPrimitives,
  objectPrimitives,
} from '../src/domain/drawingPrimitives';
import { sheetScheduleGeometry } from '../src/domain/sheetSchedule';
import { createSheet, placeDrawing } from '../src/domain/sheets';
import {
  assignLayer,
  createLayer,
  layerId,
  layerUsage,
  removeLayer,
  validateLayers,
} from '../src/domain/layers';
import { setLayerState } from '../src/domain/layerProfiles';
import {
  hideObjects,
  visibilityProjection,
  visibilityReview,
} from '../src/domain/visibility';
import { toCsv, toDxf, toPdf } from '../src/lib/exports';
import { defaultCsvExportOptions, planScopedCsv } from '../src/lib/scopedCsv';
import type { Point, Project } from '../src/domain/types';

const P = (x: number, y: number): Point => ({ x, y });
const rect = (x: number, y: number, w: number, h: number): Point[] => [
  P(x, y),
  P(x + w, y),
  P(x + w, y + h),
  P(x, y + h),
];
const region = (outer: Point[]) => {
  const o = outlineFromPoints(outer);
  if (!o.ok) throw new Error(o.reason);
  const r = buildRegion(o.outline);
  if (!r.ok) throw new Error(r.reason);
  return r.region;
};
const criteria = (patch: Partial<WeldedMeshCriteria> = {}) => ({
  ...defaultWeldedMeshCriteria(),
  widthOverlap: 150,
  ...patch,
});
/** Caso 2 da issue (Q92, 6.000 × 4.750, 2 painéis), com o desenho colocado na prancha. */
const project = (patch: Partial<WeldedMeshCriteria> = {}) => {
  let p = emptyProject();
  p = launchWeldedMesh(
    p,
    {
      criteria: criteria(patch),
      region: region(rect(0, 0, 6000, 4750)),
      source: { mode: 'points' },
      exactness: 'exact',
      adjustments: [],
    },
    p.hierarchy.details[0].id,
    'tela-1',
  );
  return placeDrawing(p, p.sheets[0].id, p.hierarchy.drawings[0].id).project;
};
const texts = (items: { text?: string }[]) =>
  items.flatMap((i) => (i.text ? [i.text] : []));
const withLoss = (p: Project, meshLossPercent: number) => ({
  origin: P(10, 280),
  textHeight: 2.5,
  allowancePercent: 10,
  meshLossPercent,
});

describe('Desenho da tela no modelo', () => {
  it('peças com o contorno real, fios nominais e identificação', () => {
    const l = project().weldedMeshes![0];
    const items = weldedMeshPrimitives(l, 40);
    const pieces = items.filter((i) => i.closed);
    const wires = items.filter((i) => !i.closed && !i.text);
    expect(pieces).toHaveLength(2);
    expect(wires).toHaveLength(2 * (16 + 40));
    for (const i of [...pieces, ...wires]) expect(i.layer).toBe('ARMADURAS');
    const label = items.filter((i) => i.text);
    expect(label).toHaveLength(1);
    expect(label[0].text).toBe('TS1 · Q92 · 2 painéis');
    expect(label[0].layer).toBe('IDENTIFICACAO');
    expect(label[0].textHeight).toBe(40);
  });

  it('apresentação: fios, painéis e identificação podem ser desligados', () => {
    const base = defaultWeldedMeshCriteria().display;
    const count = (display: typeof base) =>
      weldedMeshPrimitives(project({ display }).weldedMeshes![0], 40).length;
    expect(count({ ...base, wires: false })).toBe(2 + 1);
    expect(count({ ...base, panels: false })).toBe(112 + 1);
    expect(count({ ...base, identification: false })).toBe(2 + 112);
  });

  it('entra no desenho do projeto e no da prancha, com camada resolvida', () => {
    const p = project();
    const own = weldedMeshPrimitives(p.weldedMeshes![0], 40).length;
    const all = drawingPrimitives(p);
    expect(all.filter((i) => i.layer === 'ARMADURAS')).toHaveLength(own - 1);
    expect(all.every((i) => i.resolvedStyle)).toBe(true);
    expect(objectPrimitives(p, ['tela-1'])).toHaveLength(own);
    expect(objectPrimitives(p, [])).toHaveLength(0);
    // Camada escolhida nos critérios vale para todo o lançamento.
    const q = project({ layerId: layerId('DESENHO') });
    expect(
      new Set(objectPrimitives(q, ['tela-1']).map((i) => i.layer)),
    ).toEqual(new Set(['DESENHO']));
  });
});

describe('Camadas', () => {
  it('a tela conta como uso da camada ARMADURAS por padrão', () => {
    const usage = layerUsage(project());
    expect([...(usage.get(layerId('ARMADURAS')) ?? [])]).toContain('tela-1');
  });

  it('camada dos critérios vira o vínculo do lançamento, visível no uso', () => {
    const p = project({ layerId: layerId('DESENHO') });
    expect(p.weldedMeshes![0].layerId).toBe(layerId('DESENHO'));
    // Uma só fonte: o lançamento não guarda a camada também nos critérios.
    expect('layerId' in p.weldedMeshes![0].criteria).toBe(false);
    expect(p.weldedMeshDefaults!.layerId).toBe(layerId('DESENHO'));
    expect([...(layerUsage(p).get(layerId('DESENHO')) ?? [])]).toContain(
      'tela-1',
    );
  });

  it('camada inexistente é recusada, e um lançamento não aceita camada nos critérios', () => {
    expect(() => project({ layerId: 'layer:NAO-EXISTE' })).toThrow(
      /Layer inexistente/,
    );
    const p = project(),
      l = p.weldedMeshes![0];
    expect(() =>
      previewWeldedMeshUpdate(p, 'tela-1', {
        criteria: criteria({ layerId: 'layer:NAO-EXISTE' }),
      }),
    ).toThrow(/Layer inexistente/);
    expect(
      weldedMeshLaunchIssues({
        ...l,
        criteria: { ...l.criteria, layerId: layerId('DESENHO') },
      } as never),
    ).toEqual(['Dados do lançamento inválidos.']);
  });

  it('editar com outra camada nos critérios move o vínculo; sem camada, mantém o atual', () => {
    const p = project({ layerId: layerId('DESENHO') });
    const moved = previewWeldedMeshUpdate(p, 'tela-1', {
      criteria: criteria({ layerId: layerId('ARMADURAS') }),
    }).project.weldedMeshes![0];
    expect(moved.layerId).toBe(layerId('ARMADURAS'));
    expect('layerId' in moved.criteria).toBe(false);
    const kept = previewWeldedMeshUpdate(p, 'tela-1', {
      criteria: criteria({ mark: 'TS2' }),
    }).project.weldedMeshes![0];
    expect(kept.layerId).toBe(layerId('DESENHO'));
    expect(kept.criteria.mark).toBe('TS2');
  });

  it('apagar a camada dos critérios padrão: os próximos lançamentos seguem a reassociação ou voltam ao papel', () => {
    const created = createLayer(emptyProject(), 'TELAS');
    const p = launchWeldedMesh(
      created.project,
      {
        criteria: criteria({ layerId: created.id }),
        region: region(rect(0, 0, 6000, 4750)),
        source: { mode: 'points' },
        exactness: 'exact',
        adjustments: [],
      },
      created.project.hierarchy.details[0].id,
      'tela-1',
    );
    expect(p.weldedMeshDefaults!.layerId).toBe(created.id);
    const reassigned = removeLayer(p, created.id, layerId('DESENHO'));
    expect(reassigned.weldedMeshes![0].layerId).toBe(layerId('DESENHO'));
    expect(reassigned.weldedMeshDefaults!.layerId).toBe(layerId('DESENHO'));
    // Camada usada só pelos critérios padrão (a tela foi para outra): sai sem destino.
    const onlyDefaults = assignLayer(p, ['tela-1'], layerId('ARMADURAS'));
    const removed = removeLayer(onlyDefaults, created.id);
    expect('layerId' in removed.weldedMeshDefaults!).toBe(false);
    expect(() =>
      validateLayers({
        ...p,
        weldedMeshDefaults: {
          ...p.weldedMeshDefaults!,
          layerId: 'layer:NAO-EXISTE',
        },
      }),
    ).toThrow(/critérios de telas/);
  });

  it('reassociar e apagar camada: a tela muda de camada e não fica órfã', () => {
    const created = createLayer(project(), 'TELAS');
    let p = assignLayer(created.project, ['tela-1'], created.id);
    expect(p.weldedMeshes![0].layerId).toBe(created.id);
    expect(
      new Set(objectPrimitives(p, ['tela-1']).map((i) => i.layer)),
    ).toEqual(new Set(['TELAS']));
    expect(() => removeLayer(p, created.id)).toThrow(/em uso/);
    p = removeLayer(p, created.id, layerId('ARMADURAS'));
    expect(p.weldedMeshes![0].layerId).toBe(layerId('ARMADURAS'));
  });
});

describe('Visibilidade', () => {
  const ids = (p: Project) => (p.weldedMeshes ?? []).map((l) => l.id);
  it('layer desligada e objeto oculto tiram a tela da vista e da impressão; o realce mostra só a oculta', () => {
    const p = project();
    expect(ids(visibilityProjection(p, 'model', 'visible'))).toEqual([
      'tela-1',
    ]);
    const off = setLayerState(p, 'model', layerId('ARMADURAS'), {
      visible: false,
    });
    expect(ids(visibilityProjection(off, 'model', 'visible'))).toEqual([]);
    expect(ids(visibilityProjection(off, 'model', 'print'))).toEqual([]);
    expect(ids(visibilityReview(off, 'model'))).toEqual(['tela-1']);
    const hidden = hideObjects(p, 'model', ['tela-1']);
    expect(ids(visibilityProjection(hidden, 'model', 'visible'))).toEqual([]);
    expect(ids(visibilityReview(hidden, 'model'))).toEqual(['tela-1']);
    // Visível e sem ocultação: nada a realçar.
    expect(ids(visibilityReview(p, 'model'))).toEqual([]);
    // Captura bloqueada: some da projeção de captura, continua visível.
    const locked = setLayerState(p, 'model', layerId('ARMADURAS'), {
      capture: false,
    });
    expect(ids(visibilityProjection(locked, 'model', 'capture'))).toEqual([]);
    expect(ids(visibilityProjection(locked, 'model', 'visible'))).toEqual([
      'tela-1',
    ]);
  });
});

describe('Quadro desenhado na prancha', () => {
  it('quadro de telas e resumo por tela, depois do quadro das barras', () => {
    const p = project();
    const g = sheetScheduleGeometry(p, p.sheets[0].id, withLoss(p, 0));
    const t = texts(g.lines);
    expect(t).toContain('QUADRO DE TELAS SOLDADAS');
    expect(t).toContain('RESUMO DAS TELAS');
    expect(t).toEqual(expect.arrayContaining(['TS1', 'Q92', '43,5', 'TOTAL']));
    expect(t).toContain('4,2 c/15');
    expect(t).toContain('2,45×6,00');
  });

  it('a perda do quadro entra no peso das telas', () => {
    const p = project();
    const t = texts(
      sheetScheduleGeometry(p, p.sheets[0].id, withLoss(p, 5)).lines,
    );
    expect(t).toContain('45,7');
    expect(t.join(' ')).toContain('perda de 5%');
  });

  it('prancha sem telas não ganha quadro de telas', () => {
    let p = emptyProject();
    p = placeDrawing(p, p.sheets[0].id, p.hierarchy.drawings[0].id).project;
    const t = texts(
      sheetScheduleGeometry(p, p.sheets[0].id, withLoss(p, 0)).lines,
    );
    expect(t.some((s) => s.includes('TELAS'))).toBe(false);
  });
});

describe('Exportações do projeto', () => {
  it('DXF: peças e fios na camada da armadura, e o quadro de telas em texto', () => {
    const p = project();
    const dxf = new DxfParser().parseSync(toDxf(p))!;
    const armadura = dxf.entities.filter((e) => e.layer === 'ARMADURAS');
    expect(armadura.length).toBeGreaterThanOrEqual(2 + 112);
    const all = dxf.entities.flatMap((e) =>
      'text' in e ? [String((e as { text: unknown }).text)] : [],
    );
    expect(all.some((s) => s.startsWith('QUADRO DE TELAS SOLDADAS'))).toBe(
      true,
    );
    expect(all.some((s) => s.startsWith('TS1') && s.includes('Q92'))).toBe(
      true,
    );
    expect(all.some((s) => s.startsWith('TOTAL TELAS'))).toBe(true);
  });

  it('PDF: página do quadro de telas com o resumo', () => {
    const pdf = new TextDecoder('latin1').decode(toPdf(project()));
    expect(pdf).toContain('Quadro de telas soldadas');
    expect(pdf).toContain('Q92');
    expect(pdf).toContain('Total das telas soldadas');
  });

  it('CSV simples: tabela de telas depois da de barras', () => {
    const csv = toCsv(project());
    expect(csv).toContain('"Telas soldadas"');
    expect(csv).toContain('"Q92"');
    expect(csv).toContain('"Total das telas soldadas"');
    expect(toCsv(emptyProject())).not.toContain('Telas soldadas');
  });
});

describe('CSV por escopo (projeto, prancha, elemento)', () => {
  const plan = (
    p: Project,
    selection: Parameters<typeof planScopedCsv>[1] = { kind: 'project' },
    patch: Partial<ReturnType<typeof defaultCsvExportOptions>> = {},
  ) => planScopedCsv(p, selection, { ...defaultCsvExportOptions(), ...patch });

  it('arquivo próprio das telas e linhas de tela no resumo; perda padrão 0', () => {
    const r = plan(project());
    expect(r.issues).toEqual([]);
    const names = r.files.map((f) => f.name);
    expect(names.some((n) => n.endsWith('_telas.csv'))).toBe(true);
    const telas = r.files.find((f) => f.name.endsWith('_telas.csv'))!.content;
    for (const h of [
      'Posição',
      'Tela',
      'Painéis-base',
      'Área útil (m²)',
      'Área aplicada (m²)',
      'Massa aplicada (kg)',
      'Perda (%)',
      'Peso (kg)',
      'Massa de fornecimento (kg)',
    ])
      expect(telas).toContain(`"${h}"`);
    expect(telas).toContain('"28,50"');
    expect(telas).toContain('"29,40"');
    const resumo = r.files.find((f) => f.name.endsWith('_resumo.csv'))!.content;
    expect(resumo).toContain('"Tela soldada · Q92"');
    expect(resumo).toContain('"Total das telas soldadas"');
    expect(resumo).toContain('"43,5"');
  });

  it('perda definida na exportação vale para as telas', () => {
    const r = plan(
      project(),
      { kind: 'project' },
      {
        meshLoss: { mode: 'override', percent: 5 },
      },
    );
    const resumo = r.files.find((f) => f.name.endsWith('_resumo.csv'))!.content;
    expect(resumo).toContain('"45,7"');
  });

  it('elemento só com telas é um escopo válido', () => {
    const p = project();
    const r = plan(p, {
      kind: 'details',
      mode: 'selected',
      detailIds: [p.hierarchy.details[0].id],
    });
    expect(r.issues).toEqual([]);
    expect(r.files.some((f) => f.name.endsWith('_telas.csv'))).toBe(true);
  });

  it('a mesma tela em duas pranchas: aviso e total físico pela união dos IDs', () => {
    let p = project();
    const other = createSheet(p, 'Prancha 2');
    p = placeDrawing(
      other.project,
      other.id,
      p.hierarchy.drawings[0].id,
    ).project;
    const r = plan(
      p,
      { kind: 'sheets', mode: 'all', sheetIds: [] },
      { physicalTotal: true },
    );
    expect(r.issues).toEqual([]);
    expect(r.warnings.join(' ')).toContain('tela(s)');
    const total = r.files.find(
      (f) => f.name.includes('total-fisico') && f.name.endsWith('_telas.csv'),
    )!.content;
    expect(total).toContain('"43,5"');
    expect(total).not.toContain('"87,0"');
  });

  it('projeto sem telas: nenhum arquivo nem linha de telas', () => {
    let p = emptyProject();
    p = { ...p, bars: [], name: 'Sem telas' };
    const r = plan(p);
    expect(r.files.some((f) => f.name.endsWith('_telas.csv'))).toBe(false);
  });
});
