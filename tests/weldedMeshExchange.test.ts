import { describe, expect, it } from 'vitest';
import { createScheduleLock, emptyProject, newBar } from '../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
} from '../src/domain/hierarchy';
import { createLayer } from '../src/domain/layers';
import {
  catalogWeldedMesh,
  defaultWeldedMeshCriteria,
  type WeldedMeshCriteria,
} from '../src/domain/weldedMesh';
import { buildRegion, outlineFromPoints } from '../src/domain/weldedMeshRegion';
import {
  launchWeldedMesh,
  weldedMeshPlan,
} from '../src/domain/weldedMeshLaunch';
import { weldedMeshSchedule } from '../src/domain/weldedMeshSchedule';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import { previewDetailTransfer } from '../src/domain/detailTransfer';
import {
  previewMergeRepetitions,
  repetitionCandidates,
} from '../src/domain/detailRepetition';
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
  detailId: string,
  outer: Point[],
  c: WeldedMeshCriteria = criteria(),
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
/** Caso 2 da issue: Q92, 6.000 × 4.750, sobreposição de 150 mm na largura. */
const source = () => {
  const p = emptyProject();
  return launch(
    p,
    'tela-1',
    p.hierarchy.details[0].id,
    rect(0, 0, 6000, 4750),
    criteria({ widthOverlap: 150 }),
  );
};
const producer = { app: 'teste', version: '1' };
const plan = (p: Project) => {
  const r = weldedMeshPlan(p.weldedMeshes![0]);
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};

describe('Pacote de detalhamento (telas desde o openstruct.detail/18)', () => {
  it('em mm: leva a tela e volta idêntica, com os mesmos números', () => {
    const p = source();
    const pack = createDetailPackage(p, p.hierarchy.details[0].id, {
      producer,
    });
    expect(pack.schema).toBe('openstruct.detail/20');
    // O v18 (reservado à #128) e o v19 também levam telas.
    for (const v of ['18', '19'])
      expect(
        readDetailPackage(
          JSON.stringify({ ...pack, schema: `openstruct.detail/${v}` }),
        ).project.weldedMeshes,
      ).toHaveLength(1);
    expect(pack.objects.weldedMeshes).toHaveLength(1);
    const back = readDetailPackage(JSON.stringify(pack)).project;
    expect(back.weldedMeshes).toEqual(p.weldedMeshes);
    expect(back.hierarchy.objectDetails['tela-1']).toBe(pack.context.detail.id);
    expect(plan(back).appliedArea).toBe(plan(p).appliedArea);
  });

  it('em m: geometria e comprimentos dos critérios na unidade do pacote; a definição da tela não muda', () => {
    const p = source();
    const pack = createDetailPackage(p, p.hierarchy.details[0].id, {
      producer,
      unit: 'm',
    });
    const l = pack.objects.weldedMeshes![0];
    expect(
      l.region.outer.some(
        (q) => Math.abs(q.x - 6) < 1e-9 && Math.abs(q.y) < 1e-9,
      ),
    ).toBe(true);
    expect(l.criteria.widthOverlap).toBeCloseTo(0.15, 12);
    // Registro de catálogo: unidades próprias, sem conversão (evita deriva numérica).
    expect(l.criteria.mesh).toEqual(catalogWeldedMesh('Q92'));
    const back = readDetailPackage(JSON.stringify(pack)).project;
    const b = back.weldedMeshes![0];
    expect(b.criteria.mesh).toEqual(catalogWeldedMesh('Q92'));
    expect(b.criteria.widthOverlap).toBeCloseTo(150, 9);
    expect(plan(back).basePanels).toBe(2);
    expect(plan(back).appliedArea).toBeCloseTo(29.4e6, 3);
  });

  it('pacote sem telas mantém a mesma forma', () => {
    const p = emptyProject();
    const pack = createDetailPackage(p, p.hierarchy.details[0].id, {
      producer,
    });
    expect('weldedMeshes' in pack.objects).toBe(false);
  });

  it('pacote anterior com telas é recusado: o recurso exige o pacote v18', () => {
    const p = source();
    const pack = createDetailPackage(p, p.hierarchy.details[0].id, {
      producer,
    });
    expect(() =>
      readDetailPackage(
        JSON.stringify({ ...pack, schema: 'openstruct.detail/17' }),
      ),
    ).toThrow(/pacote v18/);
  });
});

describe('Transferência de detalhamento', () => {
  it('inserir leva a tela com novo dono, conta na prévia e no quadro do destino', () => {
    const src = source(),
      target = emptyProject();
    const r = previewDetailTransfer(target, src, {
      mode: 'insert',
      sourceDetailId: src.hierarchy.details[0].id,
      targetElementId: target.hierarchy.elements[0].id,
    });
    expect(r.issues).toEqual([]);
    const next = r.project!;
    expect(next.weldedMeshes).toHaveLength(1);
    const id = next.weldedMeshes![0].id;
    expect(next.hierarchy.objectDetails[id]).toBe(r.targetDetailId);
    expect(r.counts.after.weldedMeshes).toBe(1);
    expect(r.physicalChanged).toBe(true);
    expect(weldedMeshSchedule(next).total).toBeCloseTo(43.512, 9);
  });

  it('reimportar o mesmo detalhamento substitui sem duplicar e mantém o ID da tela', () => {
    const src = source(),
      target = emptyProject();
    const sourceDetailId = src.hierarchy.details[0].id;
    const first = previewDetailTransfer(target, src, {
      mode: 'insert',
      sourceDetailId,
      targetElementId: target.hierarchy.elements[0].id,
    });
    const inserted = first.project!;
    const again = previewDetailTransfer(inserted, src, {
      mode: 'replace',
      sourceDetailId,
      targetDetailId: first.targetDetailId,
    });
    expect(again.issues).toEqual([]);
    expect(again.project!.weldedMeshes).toHaveLength(1);
    expect(again.project!.weldedMeshes![0].id).toBe(
      inserted.weldedMeshes![0].id,
    );
    expect(again.physicalChanged).toBe(false);
  });

  it('a camada da tela segue o catálogo do destino: layer igual é reaproveitado', () => {
    const a = createLayer(emptyProject(), 'TELAS');
    const src = launch(
      a.project,
      'tela-1',
      a.project.hierarchy.details[0].id,
      rect(0, 0, 6000, 4750),
      criteria({ widthOverlap: 150, layerId: a.id }),
    );
    const b = createLayer(emptyProject(), 'TELAS');
    expect(b.id).not.toBe(a.id);
    const r = previewDetailTransfer(b.project, src, {
      mode: 'insert',
      sourceDetailId: src.hierarchy.details[0].id,
      targetElementId: b.project.hierarchy.elements[0].id,
    });
    expect(r.issues).toEqual([]);
    expect(r.project!.weldedMeshes![0].layerId).toBe(b.id);
    expect(r.project!.layers.filter((x) => x.name === 'TELAS')).toHaveLength(1);
  });

  it('com a RA bloqueada no destino, importar uma tela invalida a relação', () => {
    const src = source();
    let target = emptyProject();
    target = { ...target, scheduleLock: createScheduleLock(target) };
    const r = previewDetailTransfer(target, src, {
      mode: 'insert',
      sourceDetailId: src.hierarchy.details[0].id,
      targetElementId: target.hierarchy.elements[0].id,
    });
    expect(r.raInvalidated).toBe(true);
    expect(r.project!.scheduleLock).toBeUndefined();
  });
});

describe('Reunir repetições', () => {
  /** Dois detalhamentos com a mesma barra; telas iguais (deslocadas) ou diferentes. */
  const twins = (secondMesh: WeldedMeshCriteria) => {
    let p = emptyProject();
    const d1 = p.hierarchy.details[0].id;
    p = completeOwnership({
      ...p,
      bars: [{ ...newBar('N1'), id: 'b1', diameter: 10, quantity: 4 }],
    });
    const e = createHierarchyNode(p, 'element', 'V2', p.hierarchy.floors[0].id);
    const d = createHierarchyNode(e.project, 'detail', 'Armação V2', e.id);
    p = completeOwnership(
      {
        ...d.project,
        bars: [
          ...p.bars,
          {
            ...newBar('N2'),
            id: 'b2',
            diameter: 10,
            quantity: 4,
            origin: P(20000, 0),
          },
        ],
      },
      d.id,
    );
    p = launch(p, 'tela-1', d1, rect(0, 0, 6000, 2450));
    p = launch(p, 'tela-2', d.id, rect(20000, 0, 6000, 2450), secondMesh);
    return { p, d1, d2: d.id };
  };

  it('telas iguais: reúne, mantém só a tela do representante e não muda o aço', () => {
    const { p, d1, d2 } = twins(criteria());
    expect(repetitionCandidates(p, d1).map((c) => c.id)).toEqual([d2]);
    const before = weldedMeshSchedule(p).total;
    const merged = previewMergeRepetitions(p, d1, [d1, d2]);
    expect(merged.issues).toEqual([]);
    const next = merged.project!;
    expect(next.weldedMeshes!.map((l) => l.id)).toEqual(['tela-1']);
    expect(weldedMeshSchedule(next).rows[0].contributions[0].repetitions).toBe(
      2,
    );
    expect(weldedMeshSchedule(next).total).toBeCloseTo(before, 9);
  });

  it('telas diferentes: não são repetição, e forçar a reunião é recusado', () => {
    const { p, d1, d2 } = twins(criteria({ mesh: catalogWeldedMesh('Q138')! }));
    expect(repetitionCandidates(p, d1)).toEqual([]);
    const merged = previewMergeRepetitions(p, d1, [d1, d2]);
    expect(merged.issues.length).toBeGreaterThan(0);
    expect(merged.project).toBeUndefined();
  });
});
