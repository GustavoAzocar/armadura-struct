import type { Bar, Point } from './types';
import { add, sub, mul, unit, distance, dot } from './geometry';
import { quantityForSpacing } from './detailQuantities';
import { beamClampGeometry } from './beamClampGeometry';
import {
  defaultBeamClampCriteria,
  beamClampCriteriaSchema,
  type BeamClampCriteria,
} from './beamClampSchema';

export function beamClampBar(
  value: BeamClampCriteria,
  origin: Point,
  mark: string,
  id: string,
): Bar {
  const parsed = beamClampCriteriaSchema.safeParse(value);
  if (!parsed.success) {
    const names: Record<string, string> = {
      longitudinal: 'L longitudinal',
      transverse: 'T transversal',
      diameter: 'bitola',
      mandrel: 'mandril',
      quantity: 'quantidade inteira',
      multiplier: 'multiplicador inteiro',
      rotation: 'orientação',
      spacing: 'passo',
      startInset: 'afastamento inicial',
      endInset: 'afastamento final',
      length: 'trecho reto da terminação',
      transverseScale: 'compressão transversal',
      transverseAngle: 'ângulo da perspectiva',
    };
    const issue = parsed.error.issues[0],
      key = [...issue.path]
        .reverse()
        .map(String)
        .find((k) => names[k]);
    if (issue.code === 'custom') throw Error(issue.message);
    throw Error(
      `Revise ${key ? names[key] : 'os critérios do grampo de viga'}: informe um valor finito dentro dos limites, com medidas positivas e contagens inteiras.`,
    );
  }
  if (![origin.x, origin.y].every(Number.isFinite))
    throw Error('O ponto de inserção do grampo deve ser finito.');
  const c = parsed.data;
  const b: Bar = {
    id,
    mark,
    element: '',
    kind: 'beam-clamp',
    origin: { ...origin },
    rotation: c.rotation,
    beamClamp: structuredClone(c.profile),
    beamClampDisplay: { ...c.display },
    beamClampView: { ...c.view },
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    width: c.profile.longitudinal,
    height: c.profile.transverse,
    hook: 0,
    diameter: c.diameter,
    mandrel: c.mandrel,
    steel: c.steel,
    quantity: c.quantity,
    multiplier: c.multiplier,
    quantitySource: { kind: 'manual' },
    color: '#2563eb',
  };
  const errors = beamClampGeometry(b).errors;
  if (errors.length) throw Error(errors.join(' '));
  return b;
}

/** Distribution direction is explicit and independent of longitudinal/transverse dimensions. */
export function withBeamClampRange(
  b: Bar,
  c: BeamClampCriteria,
  a: Point,
  endFace: Point,
  label?: Point,
): Bar {
  if (
    [a, endFace, ...(label ? [label] : [])].some(
      (p) => !Number.isFinite(p.x) || !Number.isFinite(p.y),
    )
  )
    throw Error('Os pontos da faixa do grampo devem ser finitos.');
  const parsed = beamClampCriteriaSchema.safeParse(c);
  if (!parsed.success)
    throw Error(
      parsed.error.issues[0].code === 'custom'
        ? parsed.error.issues[0].message
        : 'Revise quantidade, passo e afastamentos da faixa do grampo.',
    );
  const u = unit(sub(endFace, a)),
    length = distance(a, endFace) - c.startInset - c.endInset;
  if (length < 0.01)
    throw Error(
      'Os pontos e os afastamentos não deixam uma faixa válida para os grampos.',
    );
  const start = add(a, mul(u, c.startInset)),
    end = sub(endFace, mul(u, c.endInset));
  let quantity = c.quantity;
  if (c.distributionMode === 'spacing') {
    try {
      quantity = quantityForSpacing(length, c.spacing, c.fit);
    } catch (error) {
      throw Error(
        (error as Error).message.replace('estribos', 'grampos de viga'),
      );
    }
  }
  if (quantity < 2)
    throw Error(
      'A distribuição exige ao menos dois grampos de viga. Use quantidade manual para uma peça localizada.',
    );
  if (quantity > 100000) throw Error('A faixa excede 100.000 grampos.');
  return {
    ...b,
    quantity,
    quantitySource:
      c.distributionMode === 'manual'
        ? { kind: 'manual' }
        : c.distributionMode === 'quantity'
          ? { kind: 'distribution', mode: 'quantity' }
          : {
              kind: 'distribution',
              mode: 'spacing',
              spacing: c.spacing,
              fit: c.fit,
            },
    distribution: {
      start,
      end,
      render: 'ticks',
      insets: { start: c.startInset, end: c.endInset },
      annotationOffset: label
        ? dot(sub(label, mul(add(start, end), 0.5)), { x: -u.y, y: u.x })
        : 0,
    },
  };
}

export function beamClampCriteriaFromBar(b: Bar): BeamClampCriteria {
  if (b.kind !== 'beam-clamp' || !b.beamClamp)
    throw Error('Selecione um grampo de viga.');
  const c = defaultBeamClampCriteria();
  return {
    ...c,
    profile: structuredClone(b.beamClamp),
    diameter: b.diameter,
    mandrel: b.mandrel,
    steel: b.steel,
    rotation: b.rotation,
    quantity: b.quantity,
    multiplier: b.multiplier,
    distribute: !!b.distribution,
    distributionMode:
      b.quantitySource.kind === 'distribution'
        ? b.quantitySource.mode
        : b.distribution
          ? 'manual'
          : c.distributionMode,
    display: b.beamClampDisplay ? { ...b.beamClampDisplay } : c.display,
    view: b.beamClampView ? { ...b.beamClampView } : c.view,
    ...(b.quantitySource.kind === 'distribution' &&
    b.quantitySource.mode === 'spacing'
      ? {
          spacing: b.quantitySource.spacing,
          fit: b.quantitySource.fit ?? 'maximum',
        }
      : {}),
    startInset: b.distribution?.insets?.start ?? 0,
    endInset: b.distribution?.insets?.end ?? 0,
  };
}
