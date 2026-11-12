import { describe, expect, it } from 'vitest';
import { emptyProject } from '../src/domain/model';
import { defaultWeldedMeshCriteria } from '../src/domain/weldedMesh';
import { buildRegion, outlineFromPoints } from '../src/domain/weldedMeshRegion';
import {
  launchWeldedMesh,
  previewWeldedMeshUpdate,
  weldedMeshPlan,
  type WeldedMeshLaunch,
} from '../src/domain/weldedMeshLaunch';
import { weldedMeshSchedule } from '../src/domain/weldedMeshSchedule';
import { transformSelection } from '../src/domain/transforms';
import { executeRebarBatch } from '../src/domain/rebarApi';
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
/** Caso 2 da issue (Q92, 6.000 × 4.750, 150 mm na largura). */
const project = (): Project => {
  const p = emptyProject();
  return launchWeldedMesh(
    p,
    {
      criteria: { ...defaultWeldedMeshCriteria(), widthOverlap: 150 },
      region: region(rect(0, 0, 6000, 4750)),
      source: { mode: 'points' },
      exactness: 'exact',
      adjustments: [],
    },
    p.hierarchy.details[0].id,
    'tela-1',
  );
};
const plan = (l: WeldedMeshLaunch) => {
  const r = weldedMeshPlan(l);
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};
const mesh = (p: Project, id = 'tela-1') =>
  p.weldedMeshes!.find((l) => l.id === id)!;

describe('Mover, girar e espelhar a seleção', () => {
  it('mover leva a região e mantém os números', () => {
    const p = project();
    const next = transformSelection(p, ['tela-1'], {
      kind: 'translate',
      delta: P(1000, -500),
    });
    expect(mesh(next).region.outer).toContainEqual(P(1000, -500));
    expect(plan(mesh(next)).appliedArea).toBeCloseTo(
      plan(mesh(p)).appliedArea,
      6,
    );
    expect(plan(mesh(next)).basePanels).toBe(2);
  });

  it('girar 90° gira a região e soma à orientação, com os mesmos números', () => {
    const p = project();
    const next = transformSelection(p, ['tela-1'], {
      kind: 'rotate',
      base: P(0, 0),
      angle: 90,
    });
    expect(mesh(next).criteria.orientation).toBe(90);
    const xs = mesh(next).region.outer.map((q) => Math.round(q.x));
    expect(Math.min(...xs)).toBe(-4750);
    expect(plan(mesh(next)).appliedArea).toBeCloseTo(29.4e6, 3);
    expect(plan(mesh(next)).basePanels).toBe(2);
  });

  it('espelhar uma seleção com tela é recusado, sem mudar nada', () => {
    const p = project();
    expect(() =>
      transformSelection(p, ['tela-1'], {
        kind: 'mirror',
        base: P(0, 0),
        axisEnd: P(0, 1000),
      }),
    ).toThrow(/Espelhar tela soldada/);
    expect(mesh(p).region.outer).toContainEqual(P(0, 0));
  });
});

describe('Copiar (comando de cópia física)', () => {
  it('cria uma tela nova, deslocada, no detalhamento escolhido, e soma no quadro', () => {
    const p = project();
    const detailId = p.hierarchy.details[0].id;
    const r = executeRebarBatch(
      p,
      [
        {
          type: 'armature.clone',
          barIds: [],
          objectIds: ['tela-1'],
          delta: P(10000, 0),
          detailId,
        },
      ],
      { units: 'mm' },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const next = r.project;
    expect(next.weldedMeshes).toHaveLength(2);
    const [created] = r.receipt.createdIds;
    // O ID do recibo existe de fato no projeto (não é um ID fantasma).
    expect(mesh(next, created).region.outer).toContainEqual(P(10000, 0));
    expect(next.hierarchy.objectDetails[created]).toBe(detailId);
    expect(weldedMeshSchedule(next).total).toBeCloseTo(
      2 * weldedMeshSchedule(p).total,
      9,
    );
  });
});

describe('Redefinir a região de uma tela', () => {
  it('mantém o ID e os critérios; troca região, proveniência e números', () => {
    const p = project();
    const r = previewWeldedMeshUpdate(p, 'tela-1', {
      region: region(rect(0, 0, 6000, 2450)),
      source: { mode: 'contour', maskId: 'forma', entityIds: ['laje'] },
      exactness: 'exact',
      adjustments: [],
      anchor: undefined,
    });
    expect(r.before.basePanels).toBe(2);
    expect(r.after.basePanels).toBe(1);
    const l = mesh(r.project);
    expect(l.id).toBe('tela-1');
    expect(l.criteria).toEqual(mesh(p).criteria);
    expect(l.source).toEqual({
      mode: 'contour',
      maskId: 'forma',
      entityIds: ['laje'],
    });
    expect(r.project.weldedMeshDefaults).toEqual(p.weldedMeshDefaults);
  });
});
