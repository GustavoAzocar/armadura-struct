import { z } from 'zod';

export const dimensionUnitFactors = { mm: 1, cm: 10, m: 1000 };
export const dimensionRoundingModes = {
  nearest: 'Mais próximo',
  up: 'Para cima',
  down: 'Para baixo',
} as const;

const ticksPerMm = 1_000_000;
const maxMultipleTicks = 1_000_000_000_000_000;
const roundingSchema = z
  .object({
    // The multiple is always stored in millionths of a millimeter.
    multipleTicks: z.number().int().min(1).max(maxMultipleTicks),
    mode: z.enum(['nearest', 'up', 'down']),
  })
  .strict();

export const dimensionPresentationSchema = z
  .object({
    unit: z.enum(['mm', 'cm', 'm']),
    precision: z.number().int().min(0).max(6),
    rounding: roundingSchema.optional(),
  })
  .strict()
  .superRefine((options, ctx) => {
    const minimum = minimumDimensionPrecision(options);
    if (options.precision < minimum)
      ctx.addIssue({
        code: 'custom',
        path: ['precision'],
        message:
          minimum > 6
            ? 'O múltiplo precisa de mais de 6 casas nesta unidade. Escolha uma unidade menor ou outro múltiplo.'
            : `Use ao menos ${minimum} casa(s) decimais para representar o múltiplo.`,
      });
  });

export type DimensionPresentation = z.infer<typeof dimensionPresentationSchema>;
type Rounding = z.infer<typeof roundingSchema>;

export function minimumDimensionPrecision(options: DimensionPresentation) {
  if (!options.rounding) return 0;
  let unitTicks = ticksPerMm * dimensionUnitFactors[options.unit];
  let precision = 0;
  while (unitTicks > 1 && options.rounding.multipleTicks % unitTicks !== 0) {
    precision++;
    unitTicks /= 10;
  }
  return precision;
}

export function readDimensionMultiple(
  input: string,
  unit: DimensionPresentation['unit'],
) {
  const value = input.trim();
  if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value)) return undefined;
  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  const decimals = String(ticksPerMm * dimensionUnitFactors[unit]).length - 1;
  if (/[^0]/.test(fraction.slice(decimals))) return undefined;
  const ticks = Number(
    whole + fraction.slice(0, decimals).padEnd(decimals, '0'),
  );
  return ticks > 0 && ticks <= maxMultipleTicks ? ticks : undefined;
}

export function dimensionMultipleText(options: DimensionPresentation) {
  if (!options.rounding) return '';
  return fixedDimension(
    BigInt(options.rounding.multipleTicks),
    String(ticksPerMm * dimensionUnitFactors[options.unit]).length - 1,
  )
    .replace(/0+$/, '')
    .replace(/,$/, '');
}

function fixedDimension(value: bigint, decimals: number) {
  const sign = value < 0n ? '-' : '';
  const digits = (value < 0n ? -value : value)
    .toString()
    .padStart(decimals + 1, '0');
  return (
    sign +
    (decimals
      ? `${digits.slice(0, -decimals)},${digits.slice(-decimals)}`
      : digits)
  );
}

// Compare the decimal representation of the model value against exact multiples.
export function roundDimensionTicks(mm: number, rounding: Rounding) {
  const [mantissa, exponent = '0'] = mm.toString().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const shift = 6 + Number(exponent) - fraction.length;
  const ticks = BigInt(whole + fraction) * 10n ** BigInt(Math.max(0, shift));
  const denominator = 10n ** BigInt(Math.max(0, -shift));
  const multiple = BigInt(rounding.multipleTicks);
  const divisor = denominator * multiple;
  const quotient = ticks / divisor;
  const remainder = ticks % divisor;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  if (rounding.mode === 'up' && remainder > 0n)
    return (quotient + 1n) * multiple;
  if (rounding.mode === 'down' && remainder < 0n)
    return (quotient - 1n) * multiple;
  if (rounding.mode === 'nearest' && absoluteRemainder * 2n >= divisor)
    return (quotient + (remainder < 0n ? -1n : 1n)) * multiple;
  return quotient * multiple;
}

export function formatDimension(mm: number, options: DimensionPresentation) {
  const o = dimensionPresentationSchema.parse(options);
  return `${(mm / dimensionUnitFactors[o.unit]).toLocaleString('pt-BR', { minimumFractionDigits: o.precision, maximumFractionDigits: o.precision, useGrouping: false })} ${o.unit}`;
}

export function formatDimensionCaption(
  mm: number,
  options: DimensionPresentation,
) {
  options = dimensionPresentationSchema.parse(options);
  if (!options.rounding) return formatDimension(mm, options);
  const ticks = roundDimensionTicks(mm, options.rounding);
  const displayTick = BigInt(
    (ticksPerMm * dimensionUnitFactors[options.unit]) / 10 ** options.precision,
  );
  return `~ ${fixedDimension(ticks / displayTick, options.precision)} ${options.unit}`;
}
