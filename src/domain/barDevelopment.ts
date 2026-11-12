import { distance, dot, geometry, sub, unit } from './geometry';
import { helixMetrics } from './helix';
import type { Bar, Geometry, Point, Segment } from './types';

type ParcelRole = 'body' | 'start-hook' | 'end-hook';
type Straight = Extract<Segment, { type: 'line' }>;
type PlanarParcel =
  | (Omit<Straight, 'type'> & {
      kind: 'straight';
      length: number;
      role: ParcelRole;
    })
  | (Omit<Extract<Segment, { type: 'arc' }>, 'type'> & {
      kind: 'arc';
      length: number;
      role: ParcelRole;
    });
type HelixParcel = {
  kind: 'helix';
  role: 'body';
  length: number;
  axisRadius: number;
  height: number;
  pitch: number;
  turns: number;
};
type PolylineLeg = {
  from: Point;
  to: Point;
  theoreticalLength: number;
  startSetback: number;
  endSetback: number;
};
type PolylineDevelopment = {
  legs: PolylineLeg[];
  theoreticalLength: number;
  setbackLength: number;
  /** True when the hooks are explicit additions to the theoretical body. */
  hooksOutsidePolyline: boolean;
};
export type BarDevelopment =
  | { status: 'invalid'; diagnostics: string[] }
  | {
      status: 'available';
      diameter: number;
      mandrel: number;
      parcels: (PlanarParcel | HelixParcel)[];
      polyline?: PolylineDevelopment;
      geometricLength: number;
      cutLength: number;
      policy: 'geometric';
    };

const invalid = (...diagnostics: string[]): BarDevelopment => ({
  status: 'invalid',
  diagnostics,
});

function polylineLeg(from: Point, to: Point, line: Straight): PolylineLeg {
  const direction = unit(sub(to, from));
  return {
    from,
    to,
    theoreticalLength: distance(from, to),
    startSetback: Math.max(0, dot(sub(line.a, from), direction)),
    endSetback: Math.max(0, dot(sub(to, line.b), direction)),
  };
}

function planarDevelopment(physical: Geometry, clippedLines: boolean) {
  const { segments, theoreticalVertices: vertices, hookSegments } = physical;
  const start = hookSegments?.start ?? 0;
  const end = segments.length - (hookSegments?.end ?? 0);
  const legs: PolylineLeg[] = [];
  let hasOverlap = false;
  const parcels = segments.map((segment, i): PlanarParcel => {
    const role = i < start ? 'start-hook' : i >= end ? 'end-hook' : 'body';
    if (segment.type === 'arc') {
      const { a, b, center, radius, angle, startAngle } = segment;
      return {
        kind: 'arc',
        a,
        b,
        center,
        radius,
        angle,
        startAngle,
        role,
        length: radius * Math.abs(angle),
      };
    }

    const { a, b } = segment;
    let length = distance(a, b);
    if (vertices && (clippedLines || role === 'body')) {
      const leg = polylineLeg(
        vertices[legs.length],
        vertices[legs.length + 1],
        segment,
      );
      const projected =
        leg.theoreticalLength - leg.startSetback - leg.endSetback;
      legs.push(leg);
      if (clippedLines) length = Math.max(0, projected);
      // The existing motor can tolerate a small inversion at tangencies.
      // In that case only the actual parcel total applies.
      if (projected < -1e-9) hasOverlap = true;
    }
    return { kind: 'straight', a, b, role, length };
  });
  const polyline =
    legs.length && !hasOverlap
      ? {
          legs,
          theoreticalLength: legs.reduce(
            (n, leg) => n + leg.theoreticalLength,
            0,
          ),
          setbackLength: legs.reduce(
            (n, leg) => n + leg.startSetback + leg.endSetback,
            0,
          ),
          hooksOutsidePolyline:
            !clippedLines && (start > 0 || end < segments.length),
        }
      : undefined;
  return { parcels, polyline };
}

/** Reads the full physical bar, independent of drawing and hook visibility. */
export function barDevelopment(bar: Bar): BarDevelopment {
  const { diameter, mandrel } = bar;
  const base = {
    status: 'available',
    policy: 'geometric',
    diameter,
    mandrel,
  } as const;
  if (bar.kind === 'helix') {
    const m = helixMetrics(bar);
    if (m.errors.length) return invalid(...m.errors);
    return {
      ...base,
      geometricLength: m.bodyLength,
      cutLength: m.cutLength,
      parcels: [
        {
          kind: 'helix',
          role: 'body',
          length: m.bodyLength,
          axisRadius: m.R,
          height: m.H,
          pitch: m.pitch,
          turns: m.turns,
        },
      ],
    };
  }
  if (!Number.isFinite(mandrel + diameter) || diameter <= 0 || mandrel < 0) {
    return invalid('Bitola ou mandril inválido.');
  }
  const physical = geometry(bar);
  if (physical.errors.length) return invalid(...physical.errors);
  if (!Number.isFinite(physical.length) || physical.length <= 0) {
    return invalid('Comprimento geométrico inválido.');
  }
  const clippedLines =
    !bar.stirrupProfile && (bar.kind === 'free' || bar.kind === 'stirrup');
  return {
    ...base,
    ...planarDevelopment(physical, clippedLines),
    geometricLength: physical.length,
    cutLength: physical.length,
  };
}
