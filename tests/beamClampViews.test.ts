import { describe, expect, it } from 'vitest';
import DxfParser from 'dxf-parser';
import { beamClampBar } from '../src/domain/beamClamps';
import { defaultBeamClampCriteria } from '../src/domain/beamClampSchema';
import { beamClampGeometry } from '../src/domain/beamClamp';
import {
  beamClampDimensionLabels,
  beamClampPrimitives,
  beamClampViewPoint,
  beamClampViewPoints,
} from '../src/domain/beamClampViews';
import { geometry } from '../src/domain/geometry';
import { emptyProject, schedule } from '../src/domain/model';
import { completeOwnership } from '../src/domain/hierarchy';
import {
  representationPoints,
  representationPrimitives,
} from '../src/domain/representations';
import { drawingPrimitives } from '../src/domain/drawingPrimitives';
import { primitiveBounds } from '../src/domain/drafting';
import { toCsv, toDxf, toPdf } from '../src/lib/exports';
import type { BeamClampView } from '../src/domain/beamClampSchema';
import type { BarRepresentation } from '../src/domain/types';

const bar = () => {
  const criteria = defaultBeamClampCriteria();
  criteria.quantity = 9;
  criteria.multiplier = 2;
  return beamClampBar(criteria, { x: 100, y: 200 }, 'N1', 'clamp');
};
const flat: BeamClampView = {
  mode: 'development',
  transverseScale: 0.5,
  transverseAngle: 45,
  closedSide: 'left',
};
const fixture = () => completeOwnership({ ...emptyProject(), bars: [bar()] });

describe('linked beam-clamp views and exports', () => {
  it('compresses only graphical transverse coordinates while labels retain real dimensions', () => {
    const b = bar(),
      before = geometry(b),
      view = { ...b.beamClampView!, transverseScale: 0.25 },
      original = beamClampViewPoints(b),
      compressed = beamClampViewPoints(b, view);
    expect(Math.max(...compressed.map((p) => p.y))).toBeCloseTo(
      Math.max(...original.map((p) => p.y)) / 2,
      10,
    );
    expect(beamClampDimensionLabels(b, view).map((p) => p.text)).toContain(
      'T = 30,00 cm (eixo)',
    );
    expect(beamClampDimensionLabels(b, view).map((p) => p.text)).toContain(
      'L = 60,00 cm (eixo)',
    );
    expect(geometry({ ...b, beamClampView: view })).toEqual(before);
    expect(before.length).toBeCloseTo(1474.2477796, 7);
  });

  it('uses projected chords within 0.05 mm after view scaling; only flat views carry circular ARC metadata', () => {
    const b = bar(),
      view = { ...b.beamClampView!, transverseScale: 2 },
      scale = 3,
      projection = (p: { x: number; y: number }) => ({
        x: p.x * scale,
        y: p.y * scale,
      }),
      primitives = beamClampPrimitives(b, view, projection, scale),
      segments = beamClampGeometry(b).segments;
    expect(primitives.every((p) => p.native === undefined)).toBe(true);
    for (let i = 0; i < segments.length; i++) {
      const arc = segments[i];
      if (arc.type !== 'arc') continue;
      const points = primitives[i].points,
        n = points.length - 1;
      for (let j = 0; j < n; j++) {
        const angle = arc.startAngle + (arc.angle * (j + 0.5)) / n,
          real = projection(
            beamClampViewPoint(
              {
                x: arc.center.x + arc.radius * Math.cos(angle),
                y: arc.center.y + arc.radius * Math.sin(angle),
              },
              view,
            ),
          ),
          chord = {
            x: (points[j].x + points[j + 1].x) / 2,
            y: (points[j].y + points[j + 1].y) / 2,
          };
        expect(
          Math.hypot(real.x - chord.x, real.y - chord.y),
        ).toBeLessThanOrEqual(0.05);
      }
    }
    const arcs = beamClampPrimitives(b, flat).filter(
      (p) => p.native?.kind === 'arc',
    );
    expect(arcs).toHaveLength(2);
    expect(
      arcs.every((p) => p.native?.kind === 'arc' && p.native.radius === 30),
    ).toBe(true);
    const reflected = beamClampPrimitives(b, { ...flat, closedSide: 'right' });
    expect(
      reflected
        .filter((p) => p.native?.kind === 'arc')
        .map((p) => (p.native?.kind === 'arc' ? p.native.sweepAngle : 0)),
    ).toEqual(
      arcs.map((p) => (p.native?.kind === 'arc' ? -p.native.sweepAngle : 0)),
    );
  });

  it('keeps T text outside the closed leg on both sides in primary and linked views', () => {
    for (const closedSide of ['left', 'right'] as const) {
      const p = fixture();
      const b = {
        ...p.bars[0],
        origin: { x: 0, y: 0 },
        beamClampView: { ...flat, closedSide },
      };
      const q = { ...p, bars: [b] };
      const primary = drawingPrimitives(q).find((item) =>
        item.text?.startsWith('T = '),
      )!;
      const linked = representationPrimitives(
        b,
        {
          id: 'linked',
          barId: b.id,
          origin: { x: 0, y: 0 },
          beamClampView: { ...flat, closedSide },
        },
        q,
      ).find((item) => item.text?.startsWith('T = '))!;
      for (const label of [primary, linked]) {
        expect(label.textAlign).toBe(closedSide === 'left' ? 'right' : 'left');
        const bounds = primitiveBounds(label);
        if (closedSide === 'left')
          expect(Math.max(...bounds.map((point) => point.x))).toBeLessThan(-70);
        else
          expect(Math.min(...bounds.map((point) => point.x))).toBeGreaterThan(
            70,
          );
      }
    }
  });

  it('keeps one physical position and propagates L/T edits to perspective and development', () => {
    const p = fixture(),
      b = p.bars[0],
      d: BarRepresentation = {
        id: 'flat',
        barId: b.id,
        origin: { x: 2000, y: 0 },
        scale: 2,
        rotation: 33,
        beamClampView: flat,
      },
      perspective: BarRepresentation = {
        ...d,
        id: 'perspective',
        origin: { x: 0, y: 2000 },
        beamClampView: {
          ...b.beamClampView!,
          transverseScale: 0.25,
          closedSide: 'right',
        },
      },
      q = completeOwnership({ ...p, details: [d, perspective] });
    expect(schedule(q)).toEqual(schedule(p));
    expect(schedule(q)[0].quantity).toBe(18);
    expect(schedule(q)[0].totalLength).toBeCloseTo(26.5364600328, 9);
    expect(
      representationPrimitives(b, d, q).filter((r) => r.native?.kind === 'arc'),
    ).toHaveLength(2);
    expect(
      representationPrimitives(b, perspective, q).every((r) => !r.native),
    ).toBe(true);
    const changed = {
      ...b,
      beamClamp: { ...b.beamClamp!, longitudinal: 700, transverse: 400 },
    };
    expect(geometry(changed).length - geometry(b).length).toBeCloseTo(300, 9);
    for (const view of [d, perspective])
      expect(representationPoints(changed, view)).not.toEqual(
        representationPoints(b, view),
      );
    expect(schedule({ ...q, bars: [changed] })[0].quantity).toBe(18);
  });

  it('moves identification independently and preserves quantity, length and mass in CSV/PDF/DXF', () => {
    const p = fixture(),
      b = p.bars[0],
      before = schedule(p);
    const q = {
      ...p,
      bars: [
        {
          ...b,
          beamClampView: { ...b.beamClampView!, label: { x: 1600, y: -400 } },
        },
      ],
    };
    const after = schedule(q)[0];
    for (const key of [
      'quantity',
      'unitLength',
      'totalLength',
      'weight',
    ] as const)
      expect(after[key]).toEqual(before[0][key]);
    expect(toCsv(q)).toEqual(toCsv(p));
    const caption = drawingPrimitives(q).find(
      (x) => x.role === 'IDENTIFICACAO',
    );
    expect(caption?.points[0]).toEqual({ x: 1700, y: -200 });
    const projected = new DxfParser().parseSync(toDxf(p))!;
    expect(projected.entities.filter((x) => x.type === 'ARC')).toHaveLength(0);
    expect(
      projected.entities.filter((x) => x.type === 'LWPOLYLINE').length,
    ).toBeGreaterThanOrEqual(5);
    const withFlat = completeOwnership({
      ...p,
      details: [
        {
          id: 'flat',
          barId: b.id,
          origin: { x: 2000, y: 0 },
          beamClampView: flat,
        },
      ],
    });
    const exported = new DxfParser().parseSync(toDxf(withFlat))!;
    expect(exported.entities.filter((x) => x.type === 'ARC')).toHaveLength(2);
    expect(toDxf(withFlat)).toContain('T = 30,00 cm (eixo)');
    expect(toDxf(withFlat)).toContain('L = 60,00 cm (eixo)');
    expect(toCsv(withFlat)).toEqual(toCsv(p));
    expect(toPdf(withFlat).byteLength).toBeGreaterThan(1000);
  });
});
