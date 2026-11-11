import { describe, expect, it } from 'vitest';
import {
  dimensionMultipleText,
  dimensionPresentationSchema,
  formatDimension,
  formatDimensionCaption,
  readDimensionMultiple,
  roundDimensionTicks,
  type DimensionPresentation,
} from '../src/domain/dimensionPresentation';

describe('Arredondamento de apresentação das cotas', () => {
  it.each([
    ['mm', 0, '5', '~ 1235 mm', '~ 1230 mm'],
    ['cm', 1, '0,5', '~ 123,5 cm', '~ 123,0 cm'],
    ['m', 3, '0,005', '~ 1,235 m', '~ 1,230 m'],
    ['mm', 0, '5', '~ 1235 mm', '~ 1230 mm'],
  ] as const)(
    'conserva o múltiplo físico em %s',
    (unit, precision, input, upper, lower) => {
      const multipleTicks = readDimensionMultiple(input, unit)!;
      expect(multipleTicks).toBe(5_000_000);
      const options = (
        mode: 'nearest' | 'up' | 'down',
      ): DimensionPresentation => ({
        unit,
        precision,
        rounding: { multipleTicks, mode },
      });
      expect(dimensionMultipleText(options('nearest'))).toBe(input);
      expect(formatDimensionCaption(1234, options('nearest'))).toBe(upper);
      expect(formatDimensionCaption(1234, options('up'))).toBe(upper);
      expect(formatDimensionCaption(1234, options('down'))).toBe(lower);
      expect(formatDimension(1234, options('nearest'))).toBe(
        formatDimension(1234, { unit, precision }),
      );
    },
  );

  it.each([
    [1232.4999999999998, 'nearest', 1230n],
    [1232.5, 'nearest', 1235n],
    [1232.5000000000002, 'nearest', 1235n],
    [1235, 'up', 1235n],
    [1235, 'down', 1235n],
    [-1232.5, 'nearest', -1235n],
    [-1232.5, 'up', -1230n],
    [-1232.5, 'down', -1235n],
    [-0.01, 'up', 0n],
  ] as const)('arredonda %s no modo %s', (value, mode, expected) => {
    expect(roundDimensionTicks(value, { multipleTicks: 5_000_000, mode })).toBe(
      expected * 1_000_000n,
    );
  });

  it('usa múltiplos decimais exatos, inclusive em medidas negativas', () => {
    expect(
      roundDimensionTicks(0.15, { multipleTicks: 100_000, mode: 'nearest' }),
    ).toBe(200_000n);
    expect(
      roundDimensionTicks(-0.75, { multipleTicks: 500_000, mode: 'nearest' }),
    ).toBe(-1_000_000n);
    expect(
      roundDimensionTicks(1.2, { multipleTicks: 100_000, mode: 'up' }),
    ).toBe(1_200_000n);
  });

  it('rejeita precisão incompatível e múltiplos inválidos', () => {
    for (const input of [
      '',
      '0',
      '-5',
      'Infinity',
      'NaN',
      '0,0000001',
      '1000000001',
    ])
      expect(readDimensionMultiple(input, 'mm')).toBeUndefined();
    expect(readDimensionMultiple(',5', 'mm')).toBe(500_000);
    for (const [precision, multipleTicks] of [
      [0, 500_000],
      [7, 5_000_000],
      [6, -1],
      [6, Infinity],
    ])
      expect(
        dimensionPresentationSchema.safeParse({
          unit: 'mm',
          precision,
          rounding: { multipleTicks, mode: 'up' },
        }).success,
      ).toBe(false);
    expect(
      dimensionPresentationSchema.safeParse({ unit: 'mm', precision: 0 })
        .success,
    ).toBe(true);
  });
});
