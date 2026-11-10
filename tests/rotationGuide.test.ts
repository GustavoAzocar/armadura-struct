import { describe, expect, it } from 'vitest';
import { rotationGuide } from '../src/cad/rotationGuide';

const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe('Guia visual do Rotacionar (base, raios, arco e seta)', () => {
  const base = { x: 10, y: 10 };

  it('+90° a partir de +X: raio inicial em +X, final em +Y, arco anti-horário', () => {
    const g = rotationGuide(base, { x: 1, y: 0 }, 90, 100, 40)!;
    near(g.fromEnd, { x: 110, y: 10 });
    near(g.toEnd, { x: 10, y: 110 });
    near(g.arc[0], { x: 50, y: 10 });
    near(g.arc.at(-1)!, { x: 10, y: 50 });
    // Ponto do meio do arco a 45°: prova que o arco passa pelo lado anti-horário.
    const mid = g.arc[Math.floor(g.arc.length / 2)];
    expect(mid.x).toBeGreaterThan(base.x);
    expect(mid.y).toBeGreaterThan(base.y);
    near(g.label, {
      x: base.x + 40 * 1.35 * Math.SQRT1_2,
      y: base.y + 40 * 1.35 * Math.SQRT1_2,
    });
  });

  it('−90° percorre o lado horário e a seta aponta no sentido do giro', () => {
    const g = rotationGuide(base, { x: 1, y: 0 }, -90, 100, 40)!;
    near(g.toEnd, { x: 10, y: -90 });
    const mid = g.arc[Math.floor(g.arc.length / 2)];
    expect(mid.y).toBeLessThan(base.y);
    // A ponta da seta é o fim do arco; as abas ficam "atrás" dela (lado anti-horário).
    near(g.arrow[1], g.arc.at(-1)!);
    expect(g.arrow[0].y).toBeLessThan(0 + base.y);
    expect(g.arrow[0].x).toBeGreaterThan(g.arc.at(-1)!.x);
  });

  it('direção de referência arbitrária: o arco começa nela, não em +X', () => {
    const g = rotationGuide(base, { x: 0, y: 5 }, 90, 20, 10)!;
    near(g.fromEnd, { x: 10, y: 30 });
    near(g.toEnd, { x: -10, y: 10 });
    near(g.arc[0], { x: 10, y: 20 });
  });

  it('ângulos acima de uma volta desenham no máximo uma volta, sem explodir pontos', () => {
    const g = rotationGuide(base, { x: 1, y: 0 }, 360000, 100, 40)!;
    expect(g.arc.length).toBeLessThanOrEqual(97);
    near(g.toEnd, g.fromEnd);
  });

  it('ângulo neutro ou dados inválidos não geram arco', () => {
    expect(rotationGuide(base, { x: 1, y: 0 }, 0, 100, 40)!.arc).toEqual([]);
    expect(rotationGuide(base, { x: 0, y: 0 }, 90, 100, 40)).toBeUndefined();
    expect(rotationGuide(base, { x: 1, y: 0 }, NaN, 100, 40)).toBeUndefined();
    expect(rotationGuide(base, { x: 1, y: 0 }, 90, 0, 40)).toBeUndefined();
  });
});
