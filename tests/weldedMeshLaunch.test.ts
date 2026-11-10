import { describe, expect, it } from 'vitest';
import { decodeProject, emptyProject } from '../src/domain/model';
import {
  catalogWeldedMesh,
  defaultWeldedMeshCriteria,
  type WeldedMeshCriteria,
} from '../src/domain/weldedMesh';
import {
  buildRegion,
  outlineFromPoints,
  type WeldedMeshRegion,
} from '../src/domain/weldedMeshRegion';
import {
  copyWeldedMesh,
  deleteWeldedMesh,
  launchWeldedMesh,
  previewWeldedMeshUpdate,
  transformWeldedMesh,
  weldedMeshPlan,
  type WeldedMeshLaunch,
} from '../src/domain/weldedMeshLaunch';
import type { Point, Project } from '../src/domain/types';

const P = (x: number, y: number): Point => ({ x, y });
const rect = (x: number, y: number, w: number, h: number): Point[] => [
  P(x, y),
  P(x + w, y),
  P(x + w, y + h),
  P(x, y + h),
];
const region = (outer: Point[]): WeldedMeshRegion => {
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
const input = (
  outer = rect(0, 0, 6000, 2450),
  c: WeldedMeshCriteria = criteria(),
): Omit<WeldedMeshLaunch, 'id'> => ({
  criteria: c,
  region: region(outer),
  source: { mode: 'points' },
  exactness: 'exact',
  adjustments: [],
});
const plan = (l: WeldedMeshLaunch) => {
  const r = weldedMeshPlan(l);
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
};
const launched = (outer?: Point[], c?: WeldedMeshCriteria) => {
  const p = emptyProject();
  const detailId = p.hierarchy.details[0].id;
  return {
    p: launchWeldedMesh(p, input(outer, c), detailId, 'tela-1'),
    detailId,
    before: p,
  };
};
const roundTrip = (p: Project) => decodeProject(JSON.stringify(p));

describe('Lançamento de tela soldada no projeto', () => {
  it('lança uma operação: nova entidade, dono, critérios padrão; o projeto anterior fica intacto', () => {
    const { p, detailId, before } = launched();
    expect(before.weldedMeshes ?? []).toEqual([]);
    expect(p.weldedMeshes).toHaveLength(1);
    const l = p.weldedMeshes![0];
    expect(l.id).toBe('tela-1');
    expect(p.hierarchy.objectDetails['tela-1']).toBe(detailId);
    expect(p.weldedMeshDefaults).toEqual(l.criteria);
    const layout = plan(l);
    expect(layout.basePanels).toBe(1);
    expect(layout.appliedMass).toBeCloseTo(21.756, 9);
  });

  it('salvar e reabrir mantém IDs, dono, critérios e os mesmos quantitativos', () => {
    const { p } = launched(
      rect(0, 0, 6000, 4750),
      criteria({ widthOverlap: 150 }),
    );
    const q = roundTrip(p);
    expect(q.schema).toBe('armadurastruct/29');
    expect(q.weldedMeshes).toEqual(p.weldedMeshes);
    expect(q.weldedMeshDefaults).toEqual(p.weldedMeshDefaults);
    expect(q.hierarchy.objectDetails['tela-1']).toBe(
      p.hierarchy.objectDetails['tela-1'],
    );
    const a = plan(p.weldedMeshes![0]),
      b = plan(q.weldedMeshes![0]);
    expect(b.basePanels).toBe(2);
    expect(b.appliedArea).toBe(a.appliedArea);
    expect(b.overlapArea).toBeCloseTo(0.9e6, 6);
  });

  it('a cópia guardada não muda quando o catálogo ou os critérios padrão mudam depois', () => {
    const { p } = launched();
    const stored = structuredClone(p.weldedMeshes![0].criteria);
    const q = {
      ...p,
      weldedMeshDefaults: criteria({ mesh: catalogWeldedMesh('Q138')! }),
    };
    expect(q.weldedMeshes![0].criteria).toEqual(stored);
    expect(plan(q.weldedMeshes![0]).appliedMass).toBeCloseTo(21.756, 9);
  });

  it('recusa sem lançar: detalhamento inexistente, critérios inválidos, afastamento que elimina a região', () => {
    const p = emptyProject();
    const detailId = p.hierarchy.details[0].id;
    expect(() => launchWeldedMesh(p, input(), 'nao-existe')).toThrow(
      /Detalhamento/,
    );
    expect(() =>
      launchWeldedMesh(
        p,
        input(undefined, criteria({ lengthOverlap: 6000 })),
        detailId,
      ),
    ).toThrow(/Sobreposição/);
    expect(() =>
      launchWeldedMesh(
        p,
        input(undefined, criteria({ edgeOffset: 1300 })),
        detailId,
      ),
    ).toThrow(/eliminam/);
    expect(p.weldedMeshes ?? []).toEqual([]);
  });
});

describe('Formato do arquivo (29)', () => {
  it('projeto novo já nasce no formato 29', () => {
    expect(emptyProject().schema).toBe('armadurastruct/29');
  });

  it('arquivo 28 sem telas abre normalmente e é salvo como 29', () => {
    const old = { ...emptyProject(), schema: 'armadurastruct/28' };
    const q = decodeProject(JSON.stringify(old));
    expect(q.schema).toBe('armadurastruct/29');
    expect(q.weldedMeshes ?? []).toEqual([]);
  });

  it('arquivo 28 com telas é recusado: o recurso exige o formato 29', () => {
    const { p } = launched();
    expect(() =>
      decodeProject(JSON.stringify({ ...p, schema: 'armadurastruct/28' })),
    ).toThrow(/formato 29/);
  });

  it('tela inválida ou ID repetido no arquivo são recusados ao abrir', () => {
    const { p } = launched();
    const broken = structuredClone(p);
    broken.weldedMeshes![0].criteria.lengthOverlap = 6000;
    expect(() => roundTrip(broken)).toThrow(/Tela soldada/);
    const duplicated = structuredClone(p);
    duplicated.weldedMeshes!.push({ ...duplicated.weldedMeshes![0] });
    expect(() => roundTrip(duplicated)).toThrow(/duplicados/);
  });
});

describe('Edição do lançamento', () => {
  it('mover desloca região e âncora; girar soma à orientação sem mudar os quantitativos', () => {
    const { p } = launched(
      rect(0, 0, 6000, 4750),
      criteria({ widthOverlap: 150 }),
    );
    const l = p.weldedMeshes![0];
    const moved = transformWeldedMesh(l, {
      kind: 'translate',
      delta: P(1000, -500),
    });
    expect(moved.region.outer[0]).toEqual(P(1000, -500));
    expect(plan(moved).appliedArea).toBeCloseTo(plan(l).appliedArea, 6);
    const turned = transformWeldedMesh(l, {
      kind: 'rotate',
      base: P(0, 0),
      angle: 90,
    });
    expect(turned.criteria.orientation).toBe(90);
    const a = plan(l),
      b = plan(turned);
    expect(b.basePanels).toBe(a.basePanels);
    expect(Math.abs(b.appliedArea - a.appliedArea)).toBeLessThan(10);
    expect(l.criteria.orientation).toBe(0);
  });

  it('espelhar é recusado: inverteria a posição dos fios', () => {
    const { p } = launched();
    expect(() =>
      transformWeldedMesh(p.weldedMeshes![0], {
        kind: 'mirror',
        base: P(0, 0),
        axisEnd: P(0, 1000),
      }),
    ).toThrow(/Espelhar/);
  });

  it('copiar cria outra contribuição física com novo ID e o mesmo dono', () => {
    const { p, detailId } = launched();
    const q = copyWeldedMesh(
      p,
      'tela-1',
      { kind: 'translate', delta: P(0, 3000) },
      'tela-2',
    );
    expect(q.weldedMeshes!.map((l) => l.id)).toEqual(['tela-1', 'tela-2']);
    expect(q.hierarchy.objectDetails['tela-2']).toBe(detailId);
    expect(q.weldedMeshes![1].region.outer[0]).toEqual(P(0, 3000));
    expect(p.weldedMeshes).toHaveLength(1);
  });

  it('apagar remove a entidade e o vínculo com o detalhamento', () => {
    const { p } = launched();
    const q = deleteWeldedMesh(p, 'tela-1');
    expect(q.weldedMeshes).toEqual([]);
    expect(q.hierarchy.objectDetails['tela-1']).toBeUndefined();
    expect(() => deleteWeldedMesh(p, 'outra')).toThrow(/inexistente/);
  });

  it('editar exige prévia do impacto: Q92 → Q138 mostra antes e depois', () => {
    const { p } = launched();
    const r = previewWeldedMeshUpdate(p, 'tela-1', {
      criteria: criteria({ mesh: catalogWeldedMesh('Q138')! }),
    });
    expect(r.before.appliedMass).toBeCloseTo(14.7 * 1.48, 9);
    expect(r.after.appliedMass).toBeCloseTo(14.7 * 2.2, 9);
    expect(r.project.weldedMeshes![0].criteria.mesh.designation).toBe('Q138');
    expect(p.weldedMeshes![0].criteria.mesh.designation).toBe('Q92');
    expect(() =>
      previewWeldedMeshUpdate(p, 'tela-1', {
        criteria: criteria({ widthOverlap: 2450 }),
      }),
    ).toThrow(/Sobreposição/);
  });
});
