import type { Bar, Point } from './types';
import { helixMetrics } from './helix';
import {
  defaultHelixCriteria,
  helixCriteriaSchema,
  type HelixCriteria,
} from './helixSchema';

const names: Record<string, string> = {
  value: 'diâmetro da hélice',
  cover: 'cobrimento',
  span: 'comprimento do trecho',
  startOffset: 'afastamento inicial',
  endOffset: 'afastamento final',
  pitch: 'passo',
  phase: 'ângulo inicial (fase)',
  diameter: 'bitola',
  quantity: 'quantidade de hélices (inteira)',
  multiplier: 'multiplicador inteiro',
};

/** Validates criteria and returns the parsed value, or a field-specific message. */
export function parseHelixCriteria(value: HelixCriteria): HelixCriteria {
  const parsed = helixCriteriaSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0],
    keys = issue.path.map(String),
    key = keys.includes('span')
      ? 'span'
      : [...keys].reverse().find((k) => names[k]);
  throw Error(
    `Revise ${key ? names[key] : 'os critérios do helicoidal'}: informe um valor finito dentro dos limites, com medidas positivas, afastamentos não negativos e contagens inteiras.`,
  );
}

/**
 * One continuous physical piece. A is the start center of the axis and
 * `rotation` the direction A→B. Legacy plane fields (points/width/height/
 * hook/mandrel) are inert for this family and never enter its length,
 * fabrication or quantities.
 */
export function helixBar(
  value: HelixCriteria,
  start: Point,
  rotation: number,
  mark: string,
  id: string,
): Bar {
  const c = parseHelixCriteria(value);
  if (![start.x, start.y, rotation].every(Number.isFinite))
    throw Error('O início e a direção do eixo da hélice devem ser finitos.');
  const b: Bar = {
    id,
    mark,
    element: '',
    kind: 'helix',
    origin: { ...start },
    rotation,
    helix: structuredClone(c.profile),
    helixDisplay: structuredClone(c.display),
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    width: 1,
    height: 1,
    hook: 0,
    diameter: c.diameter,
    mandrel: c.diameter,
    steel: c.steel,
    quantity: c.quantity,
    multiplier: c.multiplier,
    quantitySource: { kind: 'manual' },
    color: '#2563eb',
  };
  const errors = helixMetrics(b).errors;
  if (errors.length) throw Error(errors.join(' '));
  return b;
}

/** Two-point launch: A and B are the axis end centers, in true length. */
export function helixFromPoints(
  value: HelixCriteria,
  a: Point,
  b: Point,
  mark: string,
  id: string,
): Bar {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!Number.isFinite(length) || length < 0.01)
    throw Error('Indique um fim do eixo diferente do início.');
  return helixBar(
    {
      ...value,
      profile: {
        ...value.profile,
        span: { source: 'gross', value: length },
      },
    },
    a,
    (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    mark,
    id,
  );
}

export function helixCriteriaFromBar(b: Bar): HelixCriteria {
  if (b.kind !== 'helix' || !b.helix)
    throw Error('Selecione um estribo helicoidal.');
  const c = defaultHelixCriteria();
  return {
    ...c,
    profile: structuredClone(b.helix),
    diameter: b.diameter,
    steel: b.steel,
    quantity: b.quantity,
    multiplier: b.multiplier ?? 1,
    display: b.helixDisplay ? structuredClone(b.helixDisplay) : c.display,
  };
}

/** Local end point B, from the declared span source. */
export function helixEnd(b: Bar): Point {
  const m = helixMetrics(b);
  const r = (b.rotation * Math.PI) / 180;
  return {
    x: b.origin.x + Math.cos(r) * m.gross,
    y: b.origin.y + Math.sin(r) * m.gross,
  };
}
