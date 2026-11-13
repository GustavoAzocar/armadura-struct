import { describe, expect, it } from 'vitest';
import { barDevelopment } from '../src/domain/barDevelopment';
import { defaultBeamClampCriteria } from '../src/domain/beamClampSchema';
import { beamClampBar } from '../src/domain/beamClamps';
import { geometry } from '../src/domain/geometry';
import { emptyProject, newBar, schedule } from '../src/domain/model';
import { defaultStirrupCriteria } from '../src/domain/stirrupSchema';
import { criteriaBar } from '../src/domain/stirrups';
import type { Bar, Point } from '../src/domain/types';

const pt = (x: number, y: number) => ({ x, y });
const free = (points: Point[]): Bar => ({
  ...newBar('N1'),
  diameter: 10,
  mandrel: 50,
  points,
});
const elbow = [pt(0, 0), pt(1000, 0), pt(1000, 500)];
const u = [pt(0, 600), pt(0, 0), pt(300, 0), pt(300, 600)];

function rectangle(hooks: boolean) {
  const c = defaultStirrupCriteria();
  Object.assign(c, { diameter: 10, mandrel: 50, width: 250, height: 500 });
  if (!hooks) c.profile.start.angle = c.profile.end.angle = 0;
  return criteriaBar(c, pt(0, 0), 'N1', 'stirrup');
}

function validDevelopment(bar: Bar) {
  const result = barDevelopment(bar);
  if (result.status !== 'available')
    throw new Error(result.diagnostics.join(' '));
  expect(result.cutLength).toBe(geometry(bar).length);
  expect(result.geometricLength).toBe(result.cutLength);
  expect(result.parcels.reduce((sum, p) => sum + p.length, 0)).toBeCloseTo(
    result.cutLength,
    8,
  );
  return result;
}

describe('memória do comprimento pelo eixo físico', () => {
  it.each([
    {
      bar: free(elbow.slice(0, 2)),
      straight: 1000,
      arc: 0,
      developed: 1000,
      theory: 1000,
      trim: 0,
    },
    {
      bar: free(elbow),
      straight: 1440,
      arc: 15 * Math.PI,
      developed: 1487.1238898,
      theory: 1500,
      trim: 60,
    },
    {
      bar: free(u),
      straight: 1380,
      arc: 30 * Math.PI,
      developed: 1474.2477796,
      theory: 1500,
      trim: 120,
    },
    {
      bar: rectangle(false),
      straight: 1260,
      arc: 60 * Math.PI,
      developed: 1448.4955592,
      theory: 1500,
      trim: 240,
    },
  ])(
    'reconcilia as parcelas analíticas com o comprimento de corte',
    ({ bar, straight, arc, developed, theory, trim }) => {
      const result = validDevelopment(bar);
      expect(result.geometricLength).toBeCloseTo(developed, 5);
      expect(
        result.parcels
          .filter((p) => p.kind === 'straight')
          .reduce((n, p) => n + p.length, 0),
      ).toBeCloseTo(straight, 8);
      const arcs = result.parcels.filter((p) => p.kind === 'arc');
      expect(arcs.reduce((n, p) => n + p.length, 0)).toBeCloseTo(arc, 8);
      for (const bend of arcs) {
        expect(bend.radius).toBe(30);
        expect(Math.abs(bend.angle)).toBeCloseTo(Math.PI / 2, 8);
      }
      expect(result.polyline?.theoreticalLength).toBeCloseTo(theory, 8);
      expect(result.polyline?.setbackLength).toBeCloseTo(trim, 8);
      expect(
        result.polyline!.theoreticalLength -
          result.polyline!.setbackLength +
          arc,
      ).toBeCloseTo(result.geometricLength, 8);
    },
  );

  it('identifica retas e arcos de ganchos legados e paramétricos uma única vez', () => {
    const legacy: Bar = {
      ...free([]),
      kind: 'stirrup',
      width: 250,
      height: 500,
      hook: 75,
    };
    const parametric = rectangle(true);
    for (const bar of [legacy, parametric]) {
      const result = validDevelopment(bar);
      for (const role of ['start-hook', 'end-hook']) {
        expect(
          result.parcels
            .filter((p) => p.role === role)
            .map((p) => p.kind)
            .sort(),
        ).toEqual(['arc', 'straight']);
      }
      expect(
        schedule({ ...emptyProject(), bars: [bar] })[0].unitLength,
      ).toBeCloseTo(result.cutLength / 1000, 10);
    }
    expect(
      barDevelopment({
        ...parametric,
        stirrupDisplay: { ...parametric.stirrupDisplay!, hooks: false },
      }),
    ).toEqual(barDevelopment(parametric));
  });

  it('mantém reta nula dentro da tolerância do motor, mesmo com tangências invertidas', () => {
    const result = validDevelopment(
      free([pt(0, 0), pt(29.9995, 0), pt(29.9995, 500)]),
    );
    expect(result.parcels[0]).toMatchObject({ kind: 'straight', length: 0 });
  });

  it('recusa memória para entradas inválidas sem modificar o mandril', () => {
    for (const bar of [
      free([pt(0, 0), pt(10, 0), pt(10, 50)]),
      free([pt(0, 0), pt(NaN, 0)]),
    ])
      expect(barDevelopment(bar)).toMatchObject({
        status: 'invalid',
        diagnostics: [expect.any(String)],
      });
  });

  it('usa o desenvolvimento analítico da hélice, sem retas da projeção', () => {
    const bar: Bar = {
      ...free([]),
      kind: 'helix',
      helix: {
        convention: 'axis-centerline',
        span: { source: 'gross', value: 1000 },
        diameter: { reference: 'axis', value: 400 },
        pitch: 100,
        startOffset: 0,
        endOffset: 0,
        hand: 'right',
        phase: 0,
        ends: 'none',
      },
    };
    const result = validDevelopment(bar);
    expect(result.polyline).toBeUndefined();
    expect(result.parcels).toHaveLength(1);
    expect(result.parcels[0]).toMatchObject({ kind: 'helix', turns: 10 });
    expect(result.parcels[0].length).toBeCloseTo(
      Math.hypot(4000 * Math.PI, 1000),
      8,
    );
  });

  it('mantém as parcelas do grampo U independentes da perspectiva', () => {
    const criteria = defaultBeamClampCriteria();
    const b = beamClampBar(criteria, pt(0, 0), 'N1', 'beam-clamp');
    const result = validDevelopment(b);
    expect(result.cutLength).toBeCloseTo(1474.2477796, 5);
    expect(result.polyline?.setbackLength).toBeCloseTo(120, 8);
    expect(
      barDevelopment({
        ...b,
        beamClampView: { ...criteria.view, transverseScale: 0.25 },
      }),
    ).toEqual(result);
  });
});
