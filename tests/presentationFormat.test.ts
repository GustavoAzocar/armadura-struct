import { describe, expect, it } from 'vitest';
import { format } from '../src/domain/geometry';

describe('formatação técnica reutilizável', () => {
  it('mantém arredondamento, separadores e precisão de cada chamada', () => {
    expect(format(1234.5678, 0)).toBe('1.235');
    expect(format(1234.5678, 2)).toBe('1.234,57');
    expect(format(1234.5678)).toBe('1.234,6');
    expect(format(-0.125, 2)).toBe('-0,13');
    expect(format(10, 3)).toBe('10,000');
    expect(format(10, 0)).toBe('10');
    expect(format(-0)).toBe('-0,0');
  });
  it('preserva os casos especiais e validações do formatador anterior', () => {
    for (const n of [NaN, Infinity, -Infinity, 1e20, Number.MIN_VALUE])
      for (const digits of [0, 1, 2, 4])
        expect(format(n, digits)).toBe(
          n.toLocaleString('pt-BR', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
          }),
        );
    expect(() => format(1, -1)).toThrow(RangeError);
    expect(() => format(1, 101)).toThrow(RangeError);
    expect(format(1.5, 1)).toBe('1,5');
  });
});
