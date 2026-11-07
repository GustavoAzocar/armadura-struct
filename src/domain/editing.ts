export { quantityForSpacing } from './detailQuantities';
import { fabricationPositions } from './fabrication';
import {
  add,
  distance,
  geometry,
  local,
  mul,
  rotate,
  sub,
  vertices,
  world,
} from './geometry';
import { nextMark } from './model';
import { completeOwnership } from './hierarchy';
import { uid, type Bar, type Point, type Project } from './types';

/** Split a physical centerline on a straight leg. Bends remain exact in both pieces. */
export function splitBar(
  project: Project,
  id: string,
  station: number,
  lap: number,
): Project {
  const bar = project.bars.find((b) => b.id === id);
  if (!bar || bar.kind !== 'free')
    throw new Error('Selecione uma barra livre para dividir.');
  if (bar.distribution)
    throw new Error('Remova a distribuição antes de dividir a barra.');
  const g = geometry(bar);
  if (g.errors.length) throw new Error(g.errors.join(' '));
  if (
    !Number.isFinite(station) ||
    !Number.isFinite(lap) ||
    lap < 0 ||
    station <= 0 ||
    station >= g.length
  )
    throw new Error(
      'Informe um corte dentro da barra e um traspasse não negativo.',
    );
  let accumulated = 0,
    leg = 0;
  for (const segment of g.segments) {
    const length =
      segment.type === 'line'
        ? distance(segment.a, segment.b)
        : segment.radius * Math.abs(segment.angle);
    if (station > accumulated && station < accumulated + length) {
      if (
        segment.type !== 'line' ||
        station - lap / 2 <= accumulated + 0.01 ||
        station + lap / 2 >= accumulated + length - 0.01
      )
        throw new Error(
          'O corte e todo o traspasse precisam caber em um trecho reto, fora das dobras.',
        );
      const at = (d: number) =>
        add(segment.a, mul(sub(segment.b, segment.a), d / length));
      const end = at(station - accumulated + lap / 2);
      const start = at(station - accumulated - lap / 2);
      const first: Bar = {
        ...bar,
        points: [...bar.points.slice(0, leg + 1), end],
        ...(bar.manufacturing
          ? {
              manufacturing: {
                ...bar.manufacturing,
                end: { kind: 'plain', code: '' },
              },
            }
          : {}),
      };
      const second: Bar = {
        ...bar,
        id: uid(),
        mark: nextMark(project),
        origin: world(start, bar),
        ...(bar.manufacturing
          ? {
              manufacturing: {
                ...bar.manufacturing,
                start: { kind: 'plain', code: '' },
              },
            }
          : {}),
        points: [start, ...bar.points.slice(leg + 1)].map((p) => sub(p, start)),
      };
      const errors = [...geometry(first).errors, ...geometry(second).errors];
      if (errors.length) throw new Error(errors.join(' '));
      return completeOwnership(
        {
          ...project,
          bars: project.bars.flatMap((b) =>
            b.id === id ? [first, second] : [b],
          ),
        },
        project.hierarchy.objectDetails[id] || project.hierarchy.details[0].id,
      );
    }
    accumulated += length;
    if (segment.type === 'line') leg++;
  }
  throw new Error(
    'Posicione o corte no interior de um trecho reto, fora das dobras.',
  );
}

/** Merge touching polylines into one physical bar; never silently weld a gap or overlap. */
export function joinBars(project: Project, ids: string[]): Project {
  const bars = project.bars.filter((b) => ids.includes(b.id));
  if (bars.length !== 2 || ids.length !== 2)
    throw new Error(
      'Selecione exatamente duas barras com Shift para emendar as poligonais.',
    );
  const [a, b] = bars;
  if (
    bars.some(
      (b) =>
        b.manufacturing?.variant ||
        [b.manufacturing?.start, b.manufacturing?.end].some(
          (t) => t && t.kind !== 'plain',
        ),
    )
  )
    throw new Error(
      'A união de peças com terminações/luvas ou variantes exige revisão explícita das especificações.',
    );
  const ownerA = project.hierarchy.objectDetails[a.id],
    ownerB = project.hierarchy.objectDetails[b.id];
  if (ownerA && ownerB && ownerA !== ownerB)
    throw new Error('Mova as barras para o mesmo detalhamento antes de unir.');
  if (
    bars.some(
      (b) => b.kind !== 'free' || b.distribution || geometry(b).errors.length,
    )
  )
    throw new Error('Use duas barras livres válidas, sem distribuição.');
  if (
    a.diameter !== b.diameter ||
    a.steel !== b.steel ||
    a.quantity !== b.quantity ||
    (a.multiplier ?? 1) !== (b.multiplier ?? 1) ||
    (a.comment ?? '') !== (b.comment ?? '') ||
    (a.ribbed ?? false) !== (b.ribbed ?? false) ||
    (a.showRibbed ?? false) !== (b.showRibbed ?? false) ||
    (a.columnLevel ?? '') !== (b.columnLevel ?? '') ||
    a.mandrel !== b.mandrel
  )
    throw new Error(
      'As barras precisam ter a mesma bitola, aço, quantidade base, multiplicador, dados de montagem e mandril.',
    );
  let best:
    | { first: typeof a.points; second: typeof b.points; gap: number }
    | undefined;
  for (const reverseA of [false, true])
    for (const reverseB of [false, true]) {
      const first = a.points.map((p) => world(p, a)),
        second = b.points.map((p) => world(p, b));
      if (reverseA) first.reverse();
      if (reverseB) second.reverse();
      const gap = distance(first.at(-1)!, second[0]);
      if (!best || gap < best.gap) best = { first, second, gap };
    }
  if (!best || best.gap > 0.01)
    throw new Error(
      'As extremidades devem coincidir. Use Mover para ajustar as pontas antes de unir.',
    );
  const origin = best.first[0];
  const joined = {
    ...a,
    origin,
    rotation: 0,
    points: [...best.first, ...best.second.slice(1)].map((p) => sub(p, origin)),
  };
  const errors = geometry(joined).errors;
  if (errors.length) throw new Error(errors.join(' '));
  return completeOwnership(
    {
      ...project,
      bars: project.bars
        .filter((x) => x.id !== b.id)
        .map((x) => (x.id === a.id ? joined : x)),
      details: project.details.map((d) =>
        d.barId === b.id ? { ...d, barId: a.id } : d,
      ),
      annotations: project.annotations.map((n) =>
        n.barId === b.id ? { ...n, barId: a.id } : n,
      ),
    },
    ownerA || project.hierarchy.details[0].id,
  );
}

/** A translation moves the physical occurrence and its linked range together. */
export function translateBar(bar: Bar, delta: Point): Bar {
  return {
    ...bar,
    origin: add(bar.origin, delta),
    distribution: bar.distribution
      ? {
          ...bar.distribution,
          start: bar.distribution.start
            ? add(bar.distribution.start, delta)
            : undefined,
          end: add(bar.distribution.end, delta),
        }
      : undefined,
  };
}

export function renumber(project: Project): Project {
  const positions = fabricationPositions(project).map((g, i) => ({
    ...g,
    mark: `N${i + 1}`,
  }));
  const names = new Map(
    positions.flatMap((g) => g.barIds.map((id) => [id, g.mark])),
  );
  return {
    ...project,
    fabricationPositions: positions,
    bars: project.bars.map((b) => ({ ...b, mark: names.get(b.id)! })),
  };
}

/** Transform geometry and its distribution together about the bar origin. */
export function transformBar(bar: Bar, operation: 'rotate' | 'mirror'): Bar {
  const transformPoint = (point: Point) => {
    if (operation === 'rotate')
      return add(bar.origin, rotate(sub(point, bar.origin), 90));
    const pointLocal = local(point, bar);
    return world({ x: -pointLocal.x, y: pointLocal.y }, bar);
  };
  return {
    ...bar,
    ...(operation === 'rotate'
      ? { rotation: (bar.rotation + 90) % 360 }
      : {
          kind: 'free' as const,
          points: vertices(bar).map((p) => ({ x: -p.x, y: p.y })),
        }),
    distribution: bar.distribution
      ? {
          ...bar.distribution,
          start: bar.distribution.start
            ? transformPoint(bar.distribution.start)
            : undefined,
          end: transformPoint(bar.distribution.end),
        }
      : undefined,
  };
}
