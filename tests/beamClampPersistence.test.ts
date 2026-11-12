import { describe, expect, it } from 'vitest';
import { defaultBeamClampCriteria } from '../src/domain/beamClampSchema';
import { geometry } from '../src/domain/geometry';
import { completeOwnership } from '../src/domain/hierarchy';
import {
  emptyProject,
  newBar,
  decodeProject,
  schedule,
} from '../src/domain/model';
import {
  createDetailPackage,
  detailPackageProject,
  readDetailPackage,
} from '../src/domain/detailPackage';
import {
  applyRebarBatch,
  executeRebarBatch,
  rebarDefinition,
  REBAR_CAPABILITIES,
} from '../src/domain/rebarApi';
import { cloneArmatureGraph } from '../src/domain/editing';
import {
  previewDetailTransfer,
  applyDetailTransfer,
} from '../src/domain/detailTransfer';
import type { Bar, Project } from '../src/domain/types';

const analytic = 1474.247779607694;
function fixture(): Project {
  const defaults = defaultBeamClampCriteria();
  const bar: Bar = {
    ...newBar('G1'),
    id: 'clamp',
    kind: 'beam-clamp',
    diameter: 10,
    mandrel: 50,
    quantity: 9,
    multiplier: 2,
    origin: { x: 120, y: 35 },
    rotation: 37,
    beamClamp: defaults.profile,
    beamClampDisplay: defaults.display,
    beamClampView: { ...defaults.view, label: { x: 80, y: 350 } },
    manufacturing: { start: { kind: 'threaded', code: 'ROSCA X' } },
  };
  const p = completeOwnership({
    ...emptyProject(),
    beamClampDefaults: defaults,
    bars: [bar],
    details: [
      {
        id: 'perspective',
        barId: bar.id,
        origin: { x: 100, y: 500 },
        beamClampView: { ...defaults.view, label: { x: 150, y: 400 } },
      },
      {
        id: 'development',
        barId: bar.id,
        origin: { x: 100, y: 1000 },
        beamClampView: { ...defaults.view, mode: 'development' },
      },
    ],
  });
  p.hierarchy.details[0].repetition = { factor: 3, elements: [] };
  return p;
}
function run(p: Project, commands: Parameters<typeof executeRebarBatch>[1]) {
  return applyRebarBatch(p, executeRebarBatch(p, commands, { units: 'mm' }));
}
const packOptions = {
  producer: { app: 'Teste AS-67', version: '1' },
  exportedAt: '2026-11-11T00:00:00Z',
};

describe('AS-67: persistência, intercâmbio e quantitativos físicos', () => {
  it('salva critérios, peça e duas vistas, contando 54 grampos completos e 79,6093801 m', () => {
    const p = fixture(),
      q = decodeProject(JSON.stringify(p));
    expect(q.schema).toBe('armadurastruct/33');
    expect(q.beamClampDefaults).toEqual(p.beamClampDefaults);
    expect(q.bars[0].beamClamp).toEqual(p.bars[0].beamClamp);
    expect(q.details).toEqual(p.details);
    const [row] = schedule(q);
    expect(row.quantity).toBe(54);
    expect(row.unitLength).toBeCloseTo(analytic / 1000, 10);
    expect(row.totalLength).toBeCloseTo(79.60938009881548, 8);
    expect(row.weight).toBeCloseTo(
      ((79.60938009881548 * Math.PI * 0.01 ** 2) / 4) * 7850,
      10,
    );
    expect(geometry(q.bars[0]).length).toBeCloseTo(analytic, 8);
  });

  it.each(['mm', 'cm', 'm'] as const)(
    'converte L/T, ganchos absolutos, bitola, mandril e faixa uma vez em %s',
    (unit) => {
      const p = fixture();
      const b = p.bars[0];
      b.beamClamp!.start = { angle: 90, mode: 'mm', length: 80, turn: -1 };
      b.beamClamp!.end = { angle: 90, mode: 'diameters', length: 8, turn: 1 };
      b.distribution = {
        start: { x: 100, y: 200 },
        end: { x: 900, y: 500 },
        insets: { start: 50, end: 75 },
        annotationOffset: 40,
      };
      b.quantitySource = { kind: 'distribution', mode: 'quantity' };
      const pack = createDetailPackage(p, p.hierarchy.details[0].id, {
        ...packOptions,
        unit,
      });
      expect(pack.schema).toBe('openstruct.detail/22');
      const scale = unit === 'mm' ? 1 : unit === 'cm' ? 10 : 1000;
      expect(pack.objects.bars[0].beamClamp!.longitudinal).toBeCloseTo(
        600 / scale,
      );
      expect(pack.objects.bars[0].beamClamp!.start.length).toBeCloseTo(
        80 / scale,
      );
      expect(pack.objects.bars[0].beamClamp!.end.length).toBe(8);
      expect(pack.objects.bars[0].beamClampView).toMatchObject(
        defaultBeamClampCriteria().view,
      );
      expect(pack.objects.bars[0].beamClampView!.label!.x).toBeCloseTo(
        80 / scale,
        10,
      );
      expect(pack.objects.bars[0].beamClampView!.label!.y).toBeCloseTo(
        350 / scale,
        10,
      );
      expect(pack.objects.details[0].beamClampView!.label!.x).toBeCloseTo(
        150 / scale,
        10,
      );
      expect(pack.objects.details[0].beamClampView!.label!.y).toBeCloseTo(
        400 / scale,
        10,
      );
      const q = detailPackageProject(pack),
        actual = q.bars[0];
      expect(actual.beamClamp).toEqual(b.beamClamp);
      expect(actual.distribution).toEqual(b.distribution);
      expect(actual.diameter).toBeCloseTo(10, 10);
      expect(actual.mandrel).toBeCloseTo(50, 10);
      expect(actual.origin).toEqual(b.origin);
      expect(q.details).toEqual(p.details);
      expect(q.bars[0].beamClampView).toMatchObject(
        defaultBeamClampCriteria().view,
      );
      expect(q.bars[0].beamClampView!.label!.x).toBeCloseTo(80, 10);
      expect(q.bars[0].beamClampView!.label!.y).toBeCloseTo(350, 10);
      expect(schedule(q)[0].weight).toBeCloseTo(schedule(p)[0].weight, 10);
    },
  );

  it('recusa dados novos em versões antigas e nunca converte barras livres implicitamente', () => {
    const p = fixture();
    expect(() =>
      decodeProject(JSON.stringify({ ...p, schema: 'armadurastruct/28' })),
    ).toThrow(/30/);
    expect(() =>
      decodeProject(JSON.stringify({ ...p, schema: 'armadurastruct/29' })),
    ).toThrow(/30/);
    const pack = createDetailPackage(p, p.hierarchy.details[0].id, packOptions);
    expect(() =>
      readDetailPackage({ ...pack, schema: 'openstruct.detail/17' }),
    ).toThrow(/19/);
    // O v18 passou a existir (telas soldadas, #128) e é anterior aos grampos.
    expect(() =>
      readDetailPackage({ ...pack, schema: 'openstruct.detail/18' }),
    ).toThrow(/19/);
    const legacy = emptyProject();
    legacy.bars = [{ ...newBar('N1'), id: 'free' }];
    const q = decodeProject(
      JSON.stringify({
        ...completeOwnership(legacy),
        schema: 'armadurastruct/28',
      }),
    );
    expect(q.bars[0].kind).toBe('free');
    expect(q.bars[0].beamClamp).toBeUndefined();
    const bad = fixture();
    bad.bars[0].kind = 'free';
    expect(() => decodeProject(JSON.stringify(bad))).toThrow();
    const missing = fixture();
    delete missing.bars[0].beamClamp;
    expect(() => decodeProject(JSON.stringify(missing))).toThrow();
  });

  it('lê o formato nativo 30 e o pacote 19 sem perder grampos de viga existentes', () => {
    const p = fixture();
    const q = decodeProject(
      JSON.stringify({ ...p, schema: 'armadurastruct/30' }),
    );
    expect(q.bars).toEqual(p.bars);
    expect(q.details).toEqual(p.details);
    expect(q.beamClampDefaults).toEqual(p.beamClampDefaults);
    const pack = createDetailPackage(p, p.hierarchy.details[0].id, packOptions);
    const restored = readDetailPackage({
      ...pack,
      schema: 'openstruct.detail/19',
    }).project;
    expect(restored.bars).toEqual(p.bars);
    expect(restored.details).toEqual(p.details);
  });

  it('API cria/edita parâmetros reais e vistas separadas com validação atômica', () => {
    const original = fixture(),
      source = original.bars[0];
    let p = emptyProject();
    const detailId = p.hierarchy.details[0].id;
    expect(REBAR_CAPABILITIES.families).toContain('beam-clamp');
    p = run(p, [
      {
        type: 'bar.create',
        id: 'clamp',
        detailId,
        definition: rebarDefinition(source),
      },
    ]);
    expect(p.bars[0].manufacturing).toEqual(source.manufacturing);
    p = run(p, [
      {
        type: 'representation.create',
        id: 'view',
        barId: 'clamp',
        origin: { x: 0, y: 1000 },
        beamClampView: { ...source.beamClampView!, mode: 'development' },
      },
    ]);
    p = run(p, [
      {
        type: 'representation.update',
        id: 'view',
        beamClampView: {
          ...source.beamClampView!,
          transverseScale: 0.25,
          closedSide: 'right',
        },
      },
    ]);
    expect(geometry(p.bars[0]).length).toBeCloseTo(analytic, 8);
    p = run(p, [
      {
        type: 'bar.update',
        id: 'clamp',
        patch: {
          kind: 'beam-clamp',
          beamClamp: { ...source.beamClamp!, transverse: 400 },
        },
      },
    ]);
    expect(geometry(p.bars[0]).length).toBeCloseTo(analytic + 100, 8);
    expect(p.details[0].barId).toBe('clamp');
    const rejected = executeRebarBatch(
      p,
      [
        {
          type: 'bar.update',
          id: 'clamp',
          patch: {
            kind: 'beam-clamp',
            beamClamp: { ...source.beamClamp!, transverse: 50 },
          },
        },
      ],
      { units: 'mm' },
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.project).toBe(p);
  });

  it('cópia física remapeia vínculos e mantém parâmetros profundos; cópia gráfica não acrescenta aço', () => {
    const p = fixture();
    const copied = cloneArmatureGraph(p, {
      barIds: ['clamp'],
      delta: { x: 3000, y: 500 },
    });
    expect(copied.project.bars).toHaveLength(2);
    const clone = copied.project.bars[1];
    expect(clone.beamClamp).toEqual(p.bars[0].beamClamp);
    expect(clone.beamClamp).not.toBe(p.bars[0].beamClamp);
    expect(
      copied.project.details.filter((d) => d.barId === clone.id),
    ).toHaveLength(2);
    expect(
      schedule(copied.project).reduce((sum, row) => sum + row.quantity, 0),
    ).toBe(108);
    const graphic = run(p, [
      {
        type: 'representation.create',
        id: 'graphical-copy',
        barId: 'clamp',
        origin: { x: 4000, y: 0 },
        beamClampView: { ...p.bars[0].beamClampView!, mode: 'development' },
      },
    ]);
    expect(graphic.bars).toHaveLength(1);
    expect(schedule(graphic)[0].quantity).toBe(54);
    expect(schedule(graphic)[0].weight).toBeCloseTo(schedule(p)[0].weight, 10);
  });

  it('transferência para outro projeto remapeia a peça e suas vistas como um grafo físico', () => {
    const p = fixture();
    const pack = createDetailPackage(p, p.hierarchy.details[0].id, {
      ...packOptions,
      unit: 'm',
    });
    const incoming = detailPackageProject(pack),
      target = emptyProject();
    const plan = previewDetailTransfer(target, incoming, {
      sourceDetailId: incoming.hierarchy.details[0].id,
      mode: 'insert',
      targetElementId: target.hierarchy.elements[0].id,
    });
    expect(plan.issues).toEqual([]);
    const q = applyDetailTransfer(target, plan);
    expect(q.bars).toHaveLength(1);
    expect(q.bars[0].id).not.toBe('clamp');
    expect(q.bars[0].beamClamp).toEqual(p.bars[0].beamClamp);
    expect(q.details.every((d) => d.barId === q.bars[0].id)).toBe(true);
    expect(schedule(q)[0].quantity).toBe(54);
  });
});
