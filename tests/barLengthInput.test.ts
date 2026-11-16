import { describe, expect, it } from 'vitest';
import {
  barPointAtLength,
  isBarLengthInput,
} from '../src/domain/barLengthInput';
import { geometry } from '../src/domain/geometry';
import { newBar } from '../src/domain/model';

const p = (x: number, y: number) => ({ x, y });

describe('Barra livre por comprimento na direção da prévia (#211)', () => {
  it.each([
    [p(10, 0), p(1200, 0)],
    [p(-10, 0), p(-1200, 0)],
    [p(0, 10), p(0, 1200)],
    [p(0, -10), p(0, -1200)],
  ])(
    'mantém 1.200 mm no sentido ortogonal indicado: %j',
    (preview, expected) => {
      expect(barPointAtLength(p(0, 0), preview, '1200')).toEqual(expected);
    },
  );

  it('usa a direção efetiva oblíqua 3:4 e a última origem, sem encaixar o destino', () => {
    const origin = Object.freeze(p(100, 200));
    const preview = Object.freeze(p(103, 204));
    expect(barPointAtLength(origin, preview, '1200')).toEqual(p(820, 1160));
    expect(barPointAtLength(origin, preview, '+12.5')).toEqual(p(107.5, 210));
    expect(barPointAtLength(p(100, 200), p(-200, -200), '1200')).toEqual(
      p(-620, -760),
    );
  });

  it.each([
    '0',
    '-1200',
    '0.01',
    '.005',
    'NaN',
    'Infinity',
    '1e309',
    '',
    '12 mm',
    '1,2',
    '@1200<90',
  ])('recusa %j sem produzir ponto', (value) => {
    expect(() => barPointAtLength(p(0, 0), p(3, 4), value)).toThrow();
  });

  it('recusa ausência de origem ou de direção, pontos não finitos e perda de precisão', () => {
    expect(() => barPointAtLength(undefined, p(1, 1), '1200')).toThrow(
      /ponto inicial/,
    );
    for (const preview of [undefined, p(0, 0), p(Infinity, 1), p(NaN, 1)])
      expect(() => barPointAtLength(p(0, 0), preview, '1200')).toThrow(
        /direção/,
      );
    expect(() =>
      barPointAtLength(p(1e18, 0), p(1e18, 100), '1200'),
    ).not.toThrow();
    expect(() => barPointAtLength(p(1e18, 0), p(1e18 + 1000, 0), '2')).toThrow(
      /precisão/,
    );
  });

  it('distingue o número simples das coordenadas, polares e aliases', () => {
    for (const value of ['1200', ' 1200 ', '+1200', '-5', '.5', '12.'])
      expect(isBarLengthInput(value)).toBe(true);
    for (const value of [
      '1200,0',
      '1200;0',
      '@1200,0',
      '@1200<90',
      'B',
      'F8',
      '',
    ])
      expect(isBarLengthInput(value)).toBe(false);
  });

  it('conserva as curvas e o comprimento físico do fluxo misto com referência analítica', () => {
    const start = p(0, 0);
    const first = barPointAtLength(start, p(500, 0), '1200');
    const clicked = p(1200, 800);
    const last = barPointAtLength(clicked, p(1500, 1200), '1000');
    const bar = {
      ...newBar('N1'),
      diameter: 10,
      mandrel: 50,
      points: [start, first, clicked, last],
    };
    // 3.000 mm de segmentos menos os recuos, mais os arcos de raio 30 mm.
    const angle = Math.atan(3 / 4);
    const expected = 3000 - 2 * 30 * (1 + 1 / 3) + 30 * (Math.PI / 2 + angle);
    expect(geometry(bar).errors).toEqual([]);
    expect(geometry(bar).length).toBeCloseTo(expected, 9);
    expect(last).toEqual(p(1800, 1600));
  });
});
