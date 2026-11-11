import { describe, expect, it } from 'vitest';
import {
  createScheduleLock,
  decodeProject,
  emptyProject,
  scheduleChanged,
} from '../src/domain/model';
import {
  catalogWeldedMesh,
  defaultWeldedMeshCriteria,
  type WeldedMeshCriteria,
} from '../src/domain/weldedMesh';
import { buildRegion, outlineFromPoints } from '../src/domain/weldedMeshRegion';
import {
  deleteWeldedMesh,
  launchWeldedMesh,
  previewWeldedMeshUpdate,
} from '../src/domain/weldedMeshLaunch';
import { weldedMeshSchedule } from '../src/domain/weldedMeshSchedule';
import {
  defaultSheetSchedule,
  setSheetSchedule,
  sheetScheduleData,
} from '../src/domain/sheetSchedule';
import { setDetailRepetition } from '../src/domain/detailRepetition';
import {
  createSheet,
  duplicatePlacement,
  placeDrawing,
} from '../src/domain/sheets';
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
  ...patch,
});
const launch = (
  p: Project,
  id: string,
  outer: Point[],
  c: WeldedMeshCriteria,
  detailId = p.hierarchy.details[0].id,
) =>
  launchWeldedMesh(
    p,
    {
      criteria: c,
      region: region(outer),
      source: { mode: 'points' },
      exactness: 'exact',
      adjustments: [],
    },
    detailId,
    id,
  );
/** Caso 2 da issue: Q92, 6.000 × 4.750 mm, sobreposição de 150 mm na largura. */
const caso2 = () =>
  launch(
    emptyProject(),
    'tela-1',
    rect(0, 0, 6000, 4750),
    criteria({ widthOverlap: 150 }),
  );

describe('Quadro de telas soldadas', () => {
  it('uma linha por posição e tela, com os números do plano', () => {
    const s = weldedMeshSchedule(caso2());
    expect(s.rows).toHaveLength(1);
    const r = s.rows[0];
    expect(r.mark).toBe('TS1');
    expect(r.label).toBe('Q92');
    expect(r.mesh.longitudinal).toEqual({
      diameter: 4.2,
      spacing: 150,
      steelArea: 92,
    });
    expect(r.basePanels).toBe(2);
    expect(r.cutPieces).toBe(0);
    expect(r.usefulArea).toBeCloseTo(28.5e6, 6);
    expect(r.appliedArea).toBeCloseTo(29.4e6, 6);
    expect(r.appliedMass).toBeCloseTo(29.4 * 1.48, 9);
    expect(r.supplyMass).toBeCloseTo(2 * 21.8, 9);
    expect(r.contributions).toEqual([
      expect.objectContaining({ launchId: 'tela-1', repetitions: 1 }),
    ]);
  });

  it('perda: padrão 0%; quando informada, incide sobre a massa aplicada e aparece à parte', () => {
    const p = caso2();
    const zero = weldedMeshSchedule(p);
    expect(zero.lossPercent).toBe(0);
    expect(zero.rows[0].lossMass).toBe(0);
    expect(zero.rows[0].weight).toBeCloseTo(43.512, 9);
    const five = weldedMeshSchedule(p, { lossPercent: 5 });
    expect(five.rows[0].appliedMass).toBeCloseTo(43.512, 9);
    expect(five.rows[0].lossMass).toBeCloseTo(43.512 * 0.05, 9);
    expect(five.rows[0].weight).toBeCloseTo(43.512 * 1.05, 9);
    // Fornecimento (painéis inteiros) já inclui os retalhos: sem perda.
    expect(five.rows[0].supplyMass).toBeCloseTo(43.6, 9);
    for (const lossPercent of [-1, 101, NaN])
      expect(() => weldedMeshSchedule(p, { lossPercent })).toThrow(/perda/i);
  });

  it('resumo à parte das barras: peso de cada tela e o total', () => {
    let p = caso2();
    p = launch(
      p,
      'tela-2',
      rect(0, 10000, 6000, 2450),
      criteria({
        mark: 'TS2',
        mesh: catalogWeldedMesh('Q138')!,
      }),
    );
    const s = weldedMeshSchedule(p);
    expect(s.summary.map((r) => r.label)).toEqual(['Q92', 'Q138']);
    expect(s.summary[0].weight).toBeCloseTo(43.512, 9);
    expect(s.summary[1].weight).toBeCloseTo(14.7 * 2.2, 9);
    expect(s.total).toBeCloseTo(43.512 + 14.7 * 2.2, 9);
  });

  it('mesma posição com telas diferentes: linhas separadas, com aviso', () => {
    let p = caso2();
    p = launch(
      p,
      'tela-2',
      rect(0, 10000, 6000, 2450),
      criteria({
        mesh: catalogWeldedMesh('Q138')!,
      }),
    );
    const s = weldedMeshSchedule(p);
    expect(s.rows.map((r) => `${r.mark} ${r.label}`)).toEqual([
      'TS1 Q92',
      'TS1 Q138',
    ]);
    for (const r of s.rows)
      expect(r.warnings.join(' ')).toContain('diferentes');
  });

  it('repetição do detalhamento é aplicada uma única vez', () => {
    const p = caso2();
    const detailId = p.hierarchy.details[0].id;
    const q = setDetailRepetition(p, detailId, {
      factor: 3,
      elements: ['L1', 'L2', 'L3'].map((name) => ({ name })),
    });
    const r = weldedMeshSchedule(q).rows[0];
    expect(r.contributions[0].repetitions).toBe(3);
    expect(r.basePanels).toBe(6);
    expect(r.appliedArea).toBeCloseTo(3 * 29.4e6, 6);
    expect(r.appliedMass).toBeCloseTo(3 * 43.512, 9);
    expect(r.supplyMass).toBeCloseTo(3 * 43.6, 9);
  });
});

describe('Pranchas, união de IDs e relação de aço', () => {
  it('duas vistas na mesma prancha e outra prancha: cada quadro conta a tela uma vez, e o total não soma os quadros', () => {
    let p = caso2();
    const drawingId = p.hierarchy.drawings[0].id;
    p = placeDrawing(p, p.sheets[0].id, drawingId).project;
    p = duplicatePlacement(p, p.hierarchy.placements[0].id).project;
    const other = createSheet(p, 'Prancha 2');
    p = placeDrawing(other.project, other.id, drawingId).project;
    const a = sheetScheduleData(p, p.sheets[0].id),
      b = sheetScheduleData(p, other.id);
    expect(a.meshIds).toEqual(['tela-1']);
    expect(a.meshes.total).toBeCloseTo(43.512, 9);
    expect(b.meshes.total).toBeCloseTo(43.512, 9);
    // O total físico é o quadro global (IDs únicos), não a soma das pranchas.
    expect(weldedMeshSchedule(p).total).toBeCloseTo(43.512, 9);
  });

  it('perda 0% no quadro da prancha não é gravada; outro valor é', () => {
    const p = caso2(),
      id = p.sheets[0].id;
    const zero = setSheetSchedule(p, id, {
      ...defaultSheetSchedule(),
      meshLossPercent: 0,
    });
    expect(zero.sheets[0].steelSchedule).not.toHaveProperty('meshLossPercent');
    const five = setSheetSchedule(zero, id, {
      ...zero.sheets[0].steelSchedule!,
      meshLossPercent: 5,
    });
    expect(five.sheets[0].steelSchedule!.meshLossPercent).toBe(5);
    expect(sheetScheduleData(five, id).meshes.lossPercent).toBe(5);
  });

  it('perda configurada no quadro da prancha, guardada no arquivo', () => {
    let p = caso2();
    p = placeDrawing(p, p.sheets[0].id, p.hierarchy.drawings[0].id).project;
    p = {
      ...p,
      sheets: p.sheets.map((s, i) =>
        i
          ? s
          : {
              ...s,
              steelSchedule: {
                origin: P(10, 280),
                textHeight: 2.5,
                allowancePercent: 10,
                meshLossPercent: 5,
              },
            },
      ),
    };
    const q = decodeProject(JSON.stringify(p));
    expect(q.sheets[0].steelSchedule?.meshLossPercent).toBe(5);
    expect(sheetScheduleData(q, q.sheets[0].id).meshes.total).toBeCloseTo(
      43.512 * 1.05,
      9,
    );
    expect(() =>
      decodeProject(
        JSON.stringify({
          ...emptyProject(),
          schema: 'armadurastruct/28',
          sheets: p.sheets,
        }),
      ),
    ).toThrow(/formato 29/);
  });

  it('RA bloqueada: o quadro global usa a fotografia e acusa desatualização', () => {
    const p = caso2();
    const locked = { ...p, scheduleLock: createScheduleLock(p) };
    expect(scheduleChanged(locked)).toBe(false);
    const edited = previewWeldedMeshUpdate(locked, 'tela-1', {
      criteria: criteria({
        widthOverlap: 150,
        mesh: catalogWeldedMesh('Q138')!,
      }),
    }).project;
    expect(scheduleChanged(edited)).toBe(true);
    expect(weldedMeshSchedule(edited).rows[0].label).toBe('Q92');
    const refreshed = { ...edited, scheduleLock: createScheduleLock(edited) };
    expect(scheduleChanged(refreshed)).toBe(false);
    expect(weldedMeshSchedule(refreshed).rows[0].label).toBe('Q138');
    expect(scheduleChanged(deleteWeldedMesh(locked, 'tela-1'))).toBe(true);
    const reopened = decodeProject(JSON.stringify(locked));
    expect(scheduleChanged(reopened)).toBe(false);
    expect(weldedMeshSchedule(reopened).total).toBeCloseTo(43.512, 9);
  });

  it('projeto sem telas: a fotografia da RA não muda de forma', () => {
    expect('weldedMeshes' in createScheduleLock(emptyProject())).toBe(false);
  });
});
