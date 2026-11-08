import { z } from 'zod';
import type { Bar, Point } from './types';
import { add, sub, mul, dot, distance, geometry, world } from './geometry';

const positive = z
  .number()
  .finite()
  .positive('Informe uma medida positiva.')
  .max(1e9);
export const dimensionalEditSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('segment'),
      segment: z.number().int().nonnegative(),
      length: positive,
      angle: z.number().finite().min(-36000).max(36000).optional(),
      fixed: z.enum(['start', 'end']),
      strategy: z.enum(['endpoint', 'chain']),
      convention: z.enum(['theoretical', 'straight']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('lengthen'),
      end: z.enum(['start', 'end']),
      amount: positive,
    })
    .strict(),
]);
export type DimensionalEdit = z.infer<typeof dimensionalEditSchema>;

export function barSegments(bar: Bar) {
  if (bar.kind !== 'free')
    throw new Error(
      'Selecione a armadura física de uma barra livre; estribos permanecem paramétricos.',
    );
  const lines = geometry(bar).segments.filter((s) => s.type === 'line');
  return bar.points.slice(1).map((end, i) => {
    const start = bar.points[i],
      theoretical = distance(start, end),
      line = lines[i];
    const trimStart = line ? distance(start, line.a) : 0;
    const trimEnd = line ? distance(end, line.b) : 0;
    return {
      index: i,
      theoretical,
      straight: Math.max(0, theoretical - trimStart - trimEnd),
      trimStart,
      trimEnd,
      angle: (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI,
    };
  });
}

/** Local model mm; the fixed vertex and unaffected vertices retain their exact values. */
export function dimensionalPoints(bar: Bar, input: DimensionalEdit): Point[] {
  const edit = dimensionalEditSchema.parse(input);
  const segments = barSegments(bar),
    count = bar.points.length;
  const index =
    edit.kind === 'lengthen'
      ? edit.end === 'start'
        ? 0
        : count - 2
      : edit.segment;
  const current = segments[index];
  if (!current) throw new Error('Segmento inexistente.');
  if (current.theoretical < 0.01)
    throw new Error(
      'O segmento é degenerado; corrija os vértices antes de editar sua dimensão.',
    );
  if (edit.kind === 'lengthen') {
    const i = edit.end === 'start' ? 0 : count - 1,
      neighbour = edit.end === 'start' ? 1 : count - 2;
    const direction = mul(
      sub(bar.points[i], bar.points[neighbour]),
      1 / current.theoretical,
    );
    return bar.points.map((v, j) =>
      j === i ? add(v, mul(direction, edit.amount)) : v,
    );
  }
  if (edit.convention === 'straight' && edit.strategy !== 'chain')
    throw new Error(
      'Para informar a reta física, escolha deslocar os vértices do lado móvel. A edição só da ponta usa a medida teórica.',
    );
  if (
    (edit.angle === undefined || edit.angle === current.angle) &&
    edit.length ===
      (edit.convention === 'straight' ? current.straight : current.theoretical)
  )
    return bar.points;
  const direction =
    edit.angle === undefined
      ? mul(
          sub(bar.points[index + 1], bar.points[index]),
          1 / current.theoretical,
        )
      : {
          x: Math.cos((edit.angle * Math.PI) / 180),
          y: Math.sin((edit.angle * Math.PI) / 180),
        };
  const build = (length: number) => {
    const movable = edit.fixed === 'start' ? index + 1 : index;
    const anchor = bar.points[edit.fixed === 'start' ? index : index + 1];
    const endpoint = add(
      anchor,
      mul(direction, edit.fixed === 'start' ? length : -length),
    );
    const delta = sub(endpoint, bar.points[movable]);
    return bar.points.map((v, i) =>
      i === movable
        ? endpoint
        : edit.strategy === 'chain' &&
            (edit.fixed === 'start' ? i > movable : i < movable)
          ? add(v, delta)
          : v,
    );
  };
  let length = edit.length;
  if (edit.convention === 'straight') {
    // Moving the whole side preserves neighbouring directions: bend tangencies
    // depend on the chosen angle/mandrel, not the new leg length. No iterative fit.
    const probe = barSegments({ ...bar, points: build(current.theoretical) })[
      index
    ];
    length += probe.trimStart + probe.trimEnd;
  }
  return build(length);
}

/** Project a world-space pick onto the outward terminal ray; never insert a bend. */
export function terminalExtensionAt(bar: Bar, end: 'start' | 'end', at: Point) {
  const segments = barSegments(bar),
    i = end === 'start' ? 0 : bar.points.length - 1;
  const neighbour = end === 'start' ? 1 : i - 1;
  const metric = segments[end === 'start' ? 0 : segments.length - 1];
  if (!metric || metric.theoretical < 0.01)
    throw new Error('O trecho terminal é degenerado.');
  if (![at.x, at.y].every(Number.isFinite))
    throw new Error('Informe um ponto finito.');
  const tip = world(bar.points[i], bar),
    adjacent = world(bar.points[neighbour], bar);
  const direction = mul(sub(tip, adjacent), 1 / metric.theoretical);
  const amount = dot(sub(at, tip), direction),
    point = add(tip, mul(direction, amount));
  if (amount <= 0)
    throw new Error(
      'Escolha um ponto além da ponta: Estender aceita somente acréscimo positivo.',
    );
  return {
    edit: { kind: 'lengthen' as const, end, amount },
    point,
    amount,
    finalLength: metric.theoretical + amount,
    offAxis: distance(at, point),
  };
}

/** The field/command declares mm; optional explicit suffixes are converted here. */
export function parseLength(value: string) {
  const m = value
    .trim()
    .match(/^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*(mm|cm|m)?$/i);
  if (!m)
    throw new Error(
      'Informe uma medida em mm (ou com sufixo mm, cm, m), não uma coordenada.',
    );
  const n =
    Number(m[1].replace(',', '.')) *
    { mm: 1, cm: 10, m: 1000 }[m[2]?.toLowerCase() ?? 'mm']!;
  if (!Number.isFinite(n) || n <= 0 || n > 1e9)
    throw new Error(
      'Informe uma medida positiva e finita, até 1.000.000.000 mm.',
    );
  return n;
}
