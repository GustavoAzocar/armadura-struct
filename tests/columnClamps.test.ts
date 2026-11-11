import { describe, expect, it } from 'vitest';
import {
  defaultStirrupCriteria,
  scaleStirrupProfile,
} from '../src/domain/stirrupSchema';
import { criteriaBar, withStirrupRange } from '../src/domain/stirrups';
import { geometry, distance, rotate, sub, dot } from '../src/domain/geometry';
import {
  segmentPointDistance,
  displayedBarGeometry,
} from '../src/domain/stirrupGeometry';
import { fabricationSignature } from '../src/domain/fabrication';
import {
  emptyProject,
  decodeProject,
  schedule,
  scheduleChanged,
  createScheduleLock,
} from '../src/domain/model';
import { completeOwnership } from '../src/domain/hierarchy';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import { toCsv, toDxf, toPdf } from '../src/lib/exports';
import {
  executeRebarBatch,
  applyRebarBatch,
  rebarDefinition,
} from '../src/domain/rebarApi';
const pt = (x: number, y: number) => ({ x, y });
function criteria(
  shape: 'clamp-s' | 'clamp-c' = 'clamp-s',
  orientation: 1 | -1 = 1,
) {
  const c = defaultStirrupCriteria();
  c.diameter = 8;
  c.mandrel = 32;
  c.quantity = 22;
  c.distribute = false;
  c.profile = {
    ...c.profile,
    shape,
    reference: 'axis',
    closed: false,
    points: [pt(0, 0), pt(200, 0)],
    clamp: {
      diameters: [16, 20],
      clearance: 2,
      orientation,
      capture: 'static',
    },
    start: { angle: 135, length: 30, mode: 'mm', turn: orientation },
    end: {
      angle: 135,
      length: 30,
      mode: 'mm',
      turn: shape === 'clamp-c' ? (orientation === 1 ? -1 : 1) : orientation,
    },
  };
  return c;
}
const bar = (c = criteria()) => criteriaBar(c, pt(100, 200), 'N1', 'clamp');
const project = () => completeOwnership({ ...emptyProject(), bars: [bar()] });

describe('AS-65 grampos por centros longitudinais', () => {
  it.each(['clamp-s', 'clamp-c'] as const)(
    '%s: tangências, envolvimento e comprimento analítico independente',
    (shape) => {
      const c = criteria(shape),
        b = bar(c),
        g = geometry(b),
        r = 20;
      // Internal vs external common tangent of two equal bend circles.
      const straight =
        shape === 'clamp-s' ? Math.sqrt(200 ** 2 - 40 ** 2) : 200;
      expect(g.errors).toEqual([]);
      expect(g.length).toBeCloseTo(
        straight + (2 * r * 3 * Math.PI) / 4 + 60,
        9,
      );
      expect(g.segments).toHaveLength(5);
      for (let i = 0; i < g.segments.length - 1; i++)
        expect(distance(g.segments[i].b, g.segments[i + 1].a)).toBeLessThan(
          1e-8,
        );
      for (let i = 0; i < 2; i++) {
        const center = c.profile.points[i];
        for (const s of g.segments)
          expect(segmentPointDistance(s, center)).toBeGreaterThanOrEqual(
            (c.profile.clamp!.diameters[i] + 8) / 2 + 2 - 1e-8,
          );
      }
      const body = g.segments[2],
        u = sub(body.b, body.a);
      for (const s of [g.segments[1], g.segments[3]]) {
        expect(s.type).toBe('arc');
        if (s.type === 'arc') {
          const tangentPoint = s === g.segments[1] ? s.b : s.a;
          expect(dot(sub(tangentPoint, s.center), u)).toBeCloseTo(0, 7);
        }
      }
      const ends = [g.segments[0].a, g.segments.at(-1)!.b];
      const signed = ends.map((p, i) => {
        const v = sub(p, c.profile.points[i]);
        return u.x * v.y - u.y * v.x;
      });
      expect(Math.sign(signed[0] * signed[1])).toBe(
        shape === 'clamp-s' ? -1 : 1,
      );
    },
  );
  it('orientação reflete todos os pontos; rotação, inclinação e inversão ordenada conservam comprimento', () => {
    for (const shape of ['clamp-s', 'clamp-c'] as const) {
      const c = criteria(shape),
        g = geometry(bar(c)),
        reflected = geometry(bar(criteria(shape, -1)));
      g.segments.forEach((s, i) => {
        expect(reflected.segments[i].a.x).toBeCloseTo(s.a.x, 8);
        expect(reflected.segments[i].a.y).toBeCloseTo(-s.a.y, 8);
      });
      for (const angle of [0, 37, 90, 180]) {
        const copy = structuredClone(c);
        copy.profile.points = copy.profile.points.map((p) => rotate(p, angle));
        expect(geometry(bar(copy)).length).toBeCloseTo(g.length, 8);
      }
      const copy = structuredClone(c);
      copy.profile.points.reverse();
      copy.profile.clamp!.diameters.reverse();
      [copy.profile.start, copy.profile.end] = [
        copy.profile.end,
        copy.profile.start,
      ];
      copy.profile.clamp!.orientation = copy.profile.start.turn;
      expect(geometry(bar(copy)).length).toBeCloseTo(g.length, 8);
      expect(
        geometry({ ...bar(c), origin: pt(-1000, 30), rotation: 73 }).length,
      ).toBeCloseTo(g.length, 8);
    }
  });
  it('bitolas independentes, folga e mandril não sofrem ajustes silenciosos', () => {
    const c = criteria();
    const before = bar(c);
    c.profile.clamp!.diameters[1] = 40;
    expect(() => bar(c)).toThrow(/Mandril/);
    expect(c.diameter).toBe(8);
    c.mandrel = 50;
    expect(geometry(bar(c)).length).not.toBe(geometry(before).length);
    for (const invalid of [0, -1, NaN, Infinity]) {
      const x = criteria();
      x.profile.clamp!.diameters[0] = invalid;
      expect(() => bar(x)).toThrow();
    }
    const negative = criteria();
    negative.profile.clamp!.clearance = -1;
    expect(() => bar(negative)).toThrow();
    const overlap = criteria();
    overlap.profile.points[1] = pt(5, 0);
    expect(() => bar(overlap)).toThrow(/sobrepostas/);
    const short = criteria();
    short.profile.points[1] = pt(35, 0);
    expect(() => bar(short)).toThrow(/tangente/);
    for (const p of [pt(0, 0), pt(0.001, 0), pt(NaN, 0), pt(Infinity, 0)]) {
      const x = criteria();
      x.profile.points[1] = p;
      expect(() => bar(x)).toThrow();
    }
    const collision = criteria('clamp-c');
    collision.profile.start.length = 1000;
    collision.profile.end.length = 1000;
    expect(() => bar(collision)).toThrow(/cruz|atravessa/);
    const zero = criteria();
    zero.profile.start.angle = 0;
    expect(() => bar(zero)).toThrow(/gancho/);
  });
  it('fabricação distingue S/C e preserva equivalência sem metadados de captura', () => {
    const s = bar(),
      c = bar(criteria('clamp-c'));
    expect(fabricationSignature(s)).not.toBe(fabricationSignature(c));
    const copy = {
      ...s,
      rotation: 90,
      origin: pt(999, 999),
      stirrupDisplay: {
        hooks: false,
        dimensions: false,
        identification: false,
      },
    };
    expect(fabricationSignature(copy)).toBe(fabricationSignature(s));
    expect(geometry(copy).length).toBe(geometry(s).length);
    expect(displayedBarGeometry(copy)!.length).toBeLessThan(geometry(s).length);
  });
  it('11 estações × 2 grampos × multiplicador 2 × repetição 3 = 132 peças físicas', () => {
    const c = criteria();
    c.spacing = 100;
    c.distribute = true;
    const one = withStirrupRange(bar(c), c, pt(0, 0), pt(1000, 0));
    const two = { ...one, id: 'second', origin: pt(500, 0) };
    let p = completeOwnership({
      ...emptyProject(),
      bars: [
        { ...one, multiplier: 2 },
        { ...two, multiplier: 2 },
      ],
    });
    p = {
      ...p,
      hierarchy: {
        ...p.hierarchy,
        details: p.hierarchy.details.map((d) => ({
          ...d,
          repetition: { factor: 3, elements: [] },
        })),
      },
    };
    expect(one.quantity).toBe(11);
    expect(schedule(p).reduce((sum, r) => sum + r.quantity, 0)).toBe(132);
  });
  it('arquivo, API, lock, pacote mm/cm/m e saídas preservam parâmetros e eixos analíticos', () => {
    const p = project(),
      b = p.bars[0];
    expect(decodeProject(JSON.stringify(p)).bars).toEqual(p.bars);
    expect(() =>
      decodeProject(JSON.stringify({ ...p, schema: 'armadurastruct/28' })),
    ).toThrow(/31/);
    const locked = createScheduleLock(p);
    const changed = {
      ...p,
      scheduleLock: locked,
      bars: [bar(criteria('clamp-c'))],
    };
    expect(scheduleChanged(changed)).toBe(true);
    for (const unit of ['mm', 'cm', 'm'] as const) {
      const pack = createDetailPackage(p, p.hierarchy.details[0].id, {
        unit,
        producer: { app: 'ArmaduraStruct', version: '0.6.0' },
      });
      const restored = readDetailPackage(pack).project.bars[0];
      expect(restored.stirrupProfile!.clamp!.diameters[1]).toBeCloseTo(20, 8);
      expect(geometry(restored).length).toBeCloseTo(geometry(b).length, 8);
      expect(() =>
        readDetailPackage({ ...pack, schema: 'openstruct.detail/17' }),
      ).toThrow(/20/);
    }
    const result = executeRebarBatch(
      p,
      [
        {
          type: 'bar.create',
          id: 'copy',
          detailId: p.hierarchy.details[0].id,
          definition: rebarDefinition({ ...b, mark: 'N2' }),
        },
      ],
      { units: 'mm' },
    );
    expect(result.ok).toBe(true);
    expect(applyRebarBatch(p, result).bars[1].stirrupProfile).toEqual(
      b.stirrupProfile,
    );
    expect(
      toDxf(p)
        .replace(/\r/g, '')
        .match(/\nARC\n/g),
    ).toHaveLength(2);
    expect(toPdf(p).byteLength).toBeGreaterThan(1000);
    expect(toCsv(p)).toContain('N1');
    expect(
      scaleStirrupProfile(b.stirrupProfile!, 0.1).clamp!.diameters,
    ).toEqual([1.6, 2]);
  });
});

it('cópia física, gráfica, renumeração, reflexão e transferência mantêm identidades distintas', async () => {
  const { cloneArmatureGraph, renumber } = await import(
    '../src/domain/editing'
  );
  const { transformSelection } = await import('../src/domain/transforms');
  const { previewDetailTransfer, applyDetailTransfer } = await import(
    '../src/domain/detailTransfer'
  );
  const { representationPrimitives } = await import(
    '../src/domain/representations'
  );
  const source = project(),
    b = source.bars[0];
  const graphical = completeOwnership({
    ...source,
    details: [
      { id: 'r1', barId: b.id, origin: pt(500, 500) },
      { id: 'r2', barId: b.id, origin: pt(1000, 0) },
    ],
  });
  expect(schedule(graphical).reduce((n, r) => n + r.quantity, 0)).toBe(22);
  expect(
    representationPrimitives(b, graphical.details[0], graphical).length,
  ).toBeGreaterThan(0);
  const { project: copied, idMap } = cloneArmatureGraph(graphical, {
    barIds: [b.id],
    delta: pt(900, 0),
  });
  expect(idMap[b.id]).not.toBe(b.id);
  expect(copied.bars[1].stirrupProfile).toEqual(b.stirrupProfile);
  expect(copied.bars[1].stirrupProfile).not.toBe(b.stirrupProfile);
  expect(schedule(copied).reduce((n, r) => n + r.quantity, 0)).toBe(44);
  const numbered = renumber(copied);
  expect(numbered.bars.map((b) => b.id)).toEqual(copied.bars.map((b) => b.id));
  const mirror = {
    kind: 'mirror' as const,
    base: pt(0, 0),
    axisEnd: pt(100, 100),
  };
  const reflected = transformSelection(source, [b.id], mirror);
  expect(geometry(reflected.bars[0]).length).toBeCloseTo(geometry(b).length, 8);
  expect(
    geometry(transformSelection(reflected, [b.id], mirror).bars[0]).segments,
  ).toEqual(geometry(b).segments);
  const target = emptyProject(),
    plan = previewDetailTransfer(target, graphical, {
      mode: 'insert',
      sourceDetailId: source.hierarchy.details[0].id,
      targetElementId: target.hierarchy.elements[0].id,
      sheetId: target.sheets[0].id,
    });
  expect(plan.issues).toEqual([]);
  const transferred = applyDetailTransfer(target, plan);
  expect(transferred.bars[0].id).not.toBe(b.id);
  expect(transferred.bars[0].stirrupProfile).toEqual(b.stirrupProfile);
  expect(
    transferred.details.every((r) => r.barId === transferred.bars[0].id),
  ).toBe(true);
  expect(schedule(transferred).reduce((n, r) => n + r.quantity, 0)).toBe(22);
});
