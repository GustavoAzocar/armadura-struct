import { describe, expect, it } from 'vitest';
import { barDimensions } from '../src/domain/barDimensions';
import { rotate } from '../src/domain/geometry';
import { newBar } from '../src/domain/model';
import { criteriaBar } from '../src/domain/stirrups';
import { defaultStirrupCriteria } from '../src/domain/stirrupSchema';
import type { Bar } from '../src/domain/types';

const point = (x: number, y: number) => ({ x, y });
const free = (points: Bar['points']): Bar => ({
  ...newBar('N1'),
  points,
  diameter: 10,
  mandrel: 50,
});
const elbow = [point(0, 0), point(1000, 0), point(1000, 500)];
const u = [point(0, 600), point(0, 0), point(300, 0), point(300, 600)];

function rectangle(reference: 'axis' | 'concrete' = 'axis', hooks = false) {
  const c = defaultStirrupCriteria();
  Object.assign(c, {
    width: reference === 'axis' ? 250 : 310,
    height: reference === 'axis' ? 500 : 560,
    diameter: 10,
    mandrel: 50,
  });
  Object.assign(c.profile, { closed: true, reference, cover: 25 });
  if (!hooks) {
    c.profile.start.angle = 0;
    c.profile.end.angle = 0;
  }
  return criteriaBar(c, point(100, 200), 'N2', 'stirrup');
}

describe('referências das cotas de armadura', () => {
  it.each([
    ['reta', elbow.slice(0, 2), [1000], [1000], [1000]],
    ['L', elbow, [1000, 500], [970, 470], [1005, 505]],
    ['U', u, [600, 300, 600], [570, 240, 570], [605, 310, 605]],
  ])(
    'distingue eixo, tangências e faces da forma %s',
    (_, points, axis, straight, external) => {
      const result = barDimensions(free(points));
      expect(result.status).toBe('available');
      expect(result.axis.map((d) => d.length)).toEqual(axis);
      expect(result.straight.map((d) => d.length)).toEqual(straight);
      expect(result.external.map((d) => d.length)).toEqual(external);
    },
  );

  it('marca a ponta plana e a superfície da perna adjacente no L', () => {
    const [horizontal, vertical] = barDimensions(free(elbow)).external;
    expect(horizontal).toMatchObject({
      direction: point(1, 0),
      from: { point: point(0, 0), kind: 'cut-face' },
      to: { kind: 'outer-face' },
    });
    expect(horizontal.to.point.x).toBeCloseTo(1005, 6);
    expect(horizontal.to.point.y).toBeCloseTo(30, 6);
    expect(vertical.from.point.x).toBeCloseTo(970, 6);
    expect(vertical.from.point.y).toBeCloseTo(-5, 6);
    expect(vertical.to).toEqual({ point: point(1000, 500), kind: 'cut-face' });
  });

  it('atualiza as tangências e faces após mudança de bitola', () => {
    const result = barDimensions({ ...free(elbow), diameter: 20 });
    expect(result.axis.map((d) => d.length)).toEqual([1000, 500]);
    expect(result.straight.map((d) => d.length)).toEqual([965, 465]);
    expect(result.external.map((d) => d.length)).toEqual([1010, 510]);
  });

  it('mede um U inclinado, espelhado e com pontas de alturas diferentes', () => {
    const points = [...u.slice(0, 3), point(300, 450)].map((p) =>
      rotate(point(-p.x, p.y), 37),
    );
    const result = barDimensions({
      ...free(points),
      rotation: 21,
      origin: point(120, 70),
    });
    expect(result.status).toBe('available');
    [605, 310, 455].forEach((length, i) => {
      expect(result.external[i].length).toBeCloseTo(length, 6);
    });
  });

  it.each(['axis', 'concrete'] as const)(
    'mede o corpo retangular com referência %s',
    (reference) => {
      const result = barDimensions(rectangle(reference));
      expect(result.status).toBe('available');
      expect(result.axis.map((d) => d.length)).toEqual([250, 500]);
      expect(result.external.map((d) => d.length)).toEqual([260, 510]);
    },
  );

  it('mede o corpo sem incluir ganchos, inclusive espelhado', () => {
    const b = rectangle('axis', true);
    const result = barDimensions({
      ...b,
      stirrupMirrored: true,
      stirrupDisplay: { ...b.stirrupDisplay!, hooks: false },
    });
    expect(result.status).toBe('available');
    expect(result.external.map((d) => d.length)).toEqual([260, 510]);
    expect(result.external[1].direction).toEqual(point(0, -1));
  });

  it.each([
    free([point(0, 0), point(200, 0), point(300, 100)]),
    free([point(0, 0), point(200, 0), point(200, 200), point(400, 200)]),
  ])(
    'conserva as cotas pelo eixo em poligonais válidas fora da convenção',
    (b) => {
      const result = barDimensions(b);
      expect(result.status).toBe('unsupported');
      expect(result.axis).toHaveLength(b.points.length - 1);
      expect(result.external).toEqual([]);
      expect(result.diagnostic).toBeTruthy();
    },
  );

  it('conserva a referência do corpo aberto sem presumir uma face ausente', () => {
    const b = rectangle();
    b.stirrupProfile!.closed = false;
    const result = barDimensions(b);
    expect(result.status).toBe('unsupported');
    expect(result.axis.map((d) => d.length)).toEqual([250, 500]);
    expect(result.external).toEqual([]);
  });

  it('sinaliza a indisponibilidade para uma ponta com terminação especial', () => {
    const result = barDimensions({
      ...free(elbow),
      manufacturing: { start: { kind: 'headed', code: 'T1' } },
    });
    expect(result.status).toBe('unsupported');
    expect(result.axis.map((d) => d.length)).toEqual([1000, 500]);
  });

  it.each([
    free([point(0, 0), point(10, 0), point(10, 50)]),
    free([point(0, 0), point(NaN, 0)]),
    free([point(0, 0), point(0, 0)]),
  ])('sinaliza geometria inválida sem oferecer cota externa', (b) => {
    const result = barDimensions(b);
    expect(result.status).toBe('invalid');
    expect(result.external).toEqual([]);
    expect(result.diagnostic).toBeTruthy();
  });
});
