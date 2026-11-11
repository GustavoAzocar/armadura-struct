import { describe, expect, it } from 'vitest';
import {
  defaultBeamClampCriteria,
  scaleBeamClampProfile,
  scaleBeamClampView,
} from '../src/domain/beamClampSchema';
import {
  beamClampBar,
  beamClampCriteriaFromBar,
  withBeamClampRange,
} from '../src/domain/beamClamps';
import { beamClampCutLength, beamClampGeometry } from '../src/domain/beamClamp';
import { distance, dot, geometry, sub, world } from '../src/domain/geometry';
import { fabricationSignature } from '../src/domain/fabrication';
import { distributionOrigins, distributionStep } from '../src/domain/drafting';
import {
  completeOwnership,
  createHierarchyNode,
} from '../src/domain/hierarchy';
import { repetitionCandidates } from '../src/domain/detailRepetition';
import { emptyProject, schedule } from '../src/domain/model';
import { transformBar } from '../src/domain/editing';
import { transformSelection } from '../src/domain/transforms';
import { beamClampViewPoint } from '../src/domain/beamClampViews';

const pt = (x: number, y: number) => ({ x, y });
const bar = (c = defaultBeamClampCriteria()) =>
  beamClampBar(c, pt(100, 200), 'N1', 'beam-clamp');

describe('Grampo U de viga: eixo físico e fabricação', () => {
  it('reproduz o caso analítico com duas dobras exatas e tangências contínuas', () => {
    const b = bar(),
      g = geometry(b);
    expect(g.errors).toEqual([]);
    expect(g.length).toBeCloseTo(1474.2477796, 7);
    expect(beamClampCutLength(b)).toBe(g.length);
    expect(
      g.segments
        .filter((s) => s.type === 'line')
        .map((s) => distance(s.a, s.b)),
    ).toEqual([570, 240, 570]);
    const arcs = g.segments.filter((s) => s.type === 'arc');
    expect(arcs).toHaveLength(2);
    for (const arc of arcs) {
      expect(arc.radius).toBe(30);
      expect(Math.abs(arc.angle)).toBeCloseTo(Math.PI / 2, 12);
      const i = g.segments.indexOf(arc),
        before = g.segments[i - 1],
        after = g.segments[i + 1];
      expect(distance(before.b, arc.a)).toBeLessThan(1e-10);
      expect(distance(after.a, arc.b)).toBeLessThan(1e-10);
      expect(dot(sub(before.b, before.a), sub(arc.a, arc.center))).toBeCloseTo(
        0,
        8,
      );
      expect(dot(sub(after.b, after.a), sub(arc.b, arc.center))).toBeCloseTo(
        0,
        8,
      );
    }
  });

  it('altera L/T físicos sem inferir medidas da perspectiva ou duplicar pernas', () => {
    const c = defaultBeamClampCriteria(),
      b = bar(c),
      initial = geometry(b).length;
    c.profile.transverse = 400;
    expect(geometry(bar(c)).length - initial).toBeCloseTo(100, 10);
    c.profile.transverse = 300;
    c.profile.longitudinal = 700;
    expect(geometry(bar(c)).length - initial).toBeCloseTo(200, 10);
    const reflectedView = {
      ...b,
      beamClampView: {
        ...c.view,
        transverseScale: 0.25,
        closedSide: 'right' as const,
        label: pt(900, 300),
      },
    };
    expect(geometry(reflectedView)).toEqual(geometry(b));
    expect(fabricationSignature(reflectedView)).toBe(fabricationSignature(b));
    expect(
      fabricationSignature({ ...b, origin: pt(-500, 700), rotation: 64 }),
    ).toBe(fabricationSignature(b));
  });

  it.each([0, -1, NaN, Infinity])(
    'recusa números inválidos %s sem produzir barra',
    (value) => {
      const c = defaultBeamClampCriteria();
      expect(() =>
        bar({ ...c, profile: { ...c.profile, longitudinal: value } }),
      ).toThrow();
      expect(() =>
        bar({ ...c, profile: { ...c.profile, transverse: value } }),
      ).toThrow();
      expect(() => bar({ ...c, diameter: value })).toThrow();
      expect(() => bar({ ...c, mandrel: value })).toThrow();
    },
  );

  it('recusa dobras incompatíveis, contagens fracionárias e origem não finita', () => {
    const c = defaultBeamClampCriteria();
    expect(() =>
      bar({ ...c, profile: { ...c.profile, transverse: 50 } }),
    ).toThrow(/T insuficiente/);
    expect(() =>
      bar({ ...c, profile: { ...c.profile, longitudinal: 20 } }),
    ).toThrow(/L insuficiente/);
    expect(() => bar({ ...c, quantity: 1.5 })).toThrow(/quantidade/);
    expect(() => bar({ ...c, multiplier: 1.5 })).toThrow(/multiplicador/);
    expect(() => beamClampBar(c, pt(NaN, 0), 'N1', 'bad')).toThrow(/inserção/);
  });

  it('ganchos independentes reutilizam arcos e trechos mm/bitola; especificação não acrescenta geometria', () => {
    const c = defaultBeamClampCriteria();
    c.profile.start = { angle: 90, mode: 'diameters', length: 10, turn: -1 };
    c.profile.end = { angle: 180, mode: 'mm', length: 80, turn: 1 };
    const b = bar(c),
      g = geometry(b),
      body = beamClampGeometry(b, true);
    expect(g.length - body.length).toBeCloseTo(
      30 * Math.PI * 1.5 + 100 + 80,
      9,
    );
    expect(
      geometry({
        ...b,
        beamClampDisplay: {
          dimensions: false,
          identification: false,
          hooks: false,
        },
      }),
    ).toEqual(g);
    expect(
      geometry({
        ...b,
        manufacturing: { start: { kind: 'threaded', code: 'M10' } },
      }),
    ).toEqual(g);
    expect(beamClampCriteriaFromBar(b)).toEqual(c);
    c.profile.start = { angle: 90, mode: 'mm', length: 400, turn: 1 };
    expect(() => bar(c)).toThrow(/cruzam|sobrepõem/);
  });

  it('quantidade 9 × 2 × 3 representa 54 grampos completos e 79,6093801 m', () => {
    const c = defaultBeamClampCriteria();
    c.quantity = 9;
    c.multiplier = 2;
    const p = completeOwnership({ ...emptyProject(), bars: [bar(c)] });
    p.hierarchy.details[0].repetition = { factor: 3, elements: [] };
    const row = schedule(p)[0];
    expect(row.quantity).toBe(54);
    expect(row.totalLength).toBeCloseTo(79.6093801, 7);
    expect(row.weight).toBeCloseTo(
      ((row.totalLength * Math.PI * 0.01 ** 2) / 4) * 7850,
      10,
    );
    const views = {
      ...p,
      details: [
        {
          id: 'view-flat',
          barId: p.bars[0].id,
          origin: pt(1000, 0),
          beamClampView: { ...c.view, mode: 'development' as const },
        },
        {
          id: 'view-perspective',
          barId: p.bars[0].id,
          origin: pt(2000, 0),
          beamClampView: { ...c.view },
        },
      ],
    };
    expect(schedule(views)).toEqual(schedule(p));
  });

  it('faixa opcional usa direção independente, afastamentos e política existente de passo', () => {
    const c = defaultBeamClampCriteria();
    Object.assign(c, { startInset: 50, endInset: 75, spacing: 200 });
    const b = bar(c),
      max = withBeamClampRange(b, c, pt(0, 0), pt(0, 1100), pt(300, 400));
    expect(max.quantity).toBe(6);
    expect(distributionStep(max)).toBe(195);
    expect(distributionOrigins(max)).toEqual(
      [50, 245, 440, 635, 830, 1025].map((y) => pt(0, y)),
    );
    const fixed = withBeamClampRange(
      b,
      { ...c, fit: 'fixed' },
      pt(0, 0),
      pt(0, 1100),
    );
    expect(fixed.quantity).toBe(5);
    expect(distributionStep(fixed)).toBe(200);
    const quantity = withBeamClampRange(
      b,
      { ...c, distributionMode: 'quantity', quantity: 11 },
      pt(0, 0),
      pt(1100, 0),
    );
    expect(quantity.quantity).toBe(11);
    expect(quantity.quantitySource).toEqual({
      kind: 'distribution',
      mode: 'quantity',
    });
    const manual = {
      ...quantity,
      quantity: 7,
      quantitySource: { kind: 'manual' as const },
    };
    const editCriteria = beamClampCriteriaFromBar(manual);
    expect(editCriteria.distributionMode).toBe('manual');
    editCriteria.profile.longitudinal = 700;
    const edited = withBeamClampRange(
      beamClampBar(editCriteria, manual.origin, manual.mark, manual.id),
      editCriteria,
      pt(0, 0),
      pt(1100, 0),
    );
    expect(edited.quantity).toBe(7);
    expect(edited.quantitySource).toEqual({ kind: 'manual' });
    expect(() =>
      bar({ ...c, distribute: true, distributionMode: 'manual', quantity: 1 }),
    ).toThrow(/dois grampos/);
    expect(() => withBeamClampRange(b, c, pt(0, 0), pt(0, 0))).toThrow(
      /faixa válida/,
    );
    expect(() => withBeamClampRange(b, c, pt(0, 0), pt(Infinity, 0))).toThrow(
      /finitos/,
    );
    expect(() =>
      withBeamClampRange(
        b,
        { ...c, distributionMode: 'quantity', quantity: 1 },
        pt(0, 0),
        pt(1100, 0),
      ),
    ).toThrow(/dois grampos/);
    expect(geometry(max).length).toBe(geometry(b).length);
  });

  it('mesmo corte com outras dimensões não cria equivalência falsa; aço e terminações distinguem fabricação', () => {
    const c = defaultBeamClampCriteria(),
      a = bar(c);
    const b = bar({
      ...c,
      profile: { ...c.profile, longitudinal: 550, transverse: 400 },
    });
    expect(geometry(a).length).toBeCloseTo(geometry(b).length, 9);
    expect(fabricationSignature(a)).not.toBe(fabricationSignature(b));
    expect(fabricationSignature({ ...a, steel: 'CA-60' })).not.toBe(
      fabricationSignature(a),
    );
    expect(
      fabricationSignature({
        ...a,
        manufacturing: { end: { kind: 'coupler', code: 'L10' } },
      }),
    ).not.toBe(fabricationSignature(a));
  });

  it('rotação e espelho físicos preservam família paramétrica, geometria e critérios', () => {
    const c = defaultBeamClampCriteria();
    c.profile.start = { angle: 90, mode: 'mm', length: 60, turn: -1 };
    const b = bar(c),
      rotated = transformBar(b, 'rotate'),
      mirrored = transformBar(b, 'mirror');
    expect(rotated.kind).toBe('beam-clamp');
    expect(mirrored.kind).toBe('beam-clamp');
    expect(mirrored.beamClamp?.mirrored).toBe(true);
    expect(geometry(rotated).length).toBeCloseTo(geometry(b).length, 10);
    expect(geometry(mirrored).length).toBeCloseTo(geometry(b).length, 10);
    const p = completeOwnership({ ...emptyProject(), bars: [b] });
    const q = transformSelection(p, [b.id], {
      kind: 'mirror',
      base: pt(0, 0),
      axisEnd: pt(1, 0),
    });
    expect(q.bars[0].kind).toBe('beam-clamp');
    expect(q.bars[0].beamClamp?.mirrored).toBe(true);
    expect(
      geometry(q.bars[0]).segments.map((s) => world(s.a, q.bars[0])),
    ).toEqual(
      geometry(b).segments.map((s) => {
        const p = world(s.a, b);
        return pt(p.x, -p.y);
      }),
    );
    expect(q.bars[0].beamClampView?.transverseAngle).toBe(135);
    for (let i = 0; i < geometry(b).segments.length; i++) {
      const oldPoint = world(
        beamClampViewPoint(geometry(b).segments[i].a, b.beamClampView),
        b,
      );
      const newPoint = world(
        beamClampViewPoint(
          geometry(q.bars[0]).segments[i].a,
          q.bars[0].beamClampView,
        ),
        q.bars[0],
      );
      expect(newPoint.x).toBeCloseTo(oldPoint.x, 9);
      expect(newPoint.y).toBeCloseTo(-oldPoint.y, 9);
    }
  });

  it('consolidação de detalhamentos distingue terminações e ignora apenas ajustes gráficos', () => {
    const c = defaultBeamClampCriteria(),
      a = bar(c);
    let p = completeOwnership({ ...emptyProject(), bars: [a] });
    const id = p.hierarchy.details[0].id;
    const added = createHierarchyNode(
      p,
      'detail',
      'Outro grampo',
      p.hierarchy.elements[0].id,
    );
    const b = {
      ...a,
      id: 'other-clamp',
      mark: 'N2',
      beamClampView: { ...c.view, closedSide: 'right' as const },
    };
    p = completeOwnership({ ...added.project, bars: [a, b] }, added.id);
    expect(
      repetitionCandidates(p, id).map((candidate) => candidate.id),
    ).toContain(added.id);
    p.bars[1] = {
      ...b,
      beamClamp: {
        ...b.beamClamp!,
        end: { angle: 90, mode: 'mm', length: 50, turn: 1 },
      },
    };
    expect(repetitionCandidates(p, id)).toEqual([]);
  });

  it('escala apenas medidas físicas e textos; fatores, ângulos e compressão permanecem adimensionais', () => {
    const c = defaultBeamClampCriteria();
    c.profile.start = { angle: 90, mode: 'mm', length: 100, turn: -1 };
    c.profile.end = { angle: 135, mode: 'diameters', length: 10, turn: 1 };
    const profile = scaleBeamClampProfile(c.profile, 0.1);
    expect(profile.longitudinal).toBe(60);
    expect(profile.transverse).toBe(30);
    expect(profile.start.length).toBe(10);
    expect(profile.end.length).toBe(10);
    const view = { ...c.view, label: pt(120, 240) };
    expect(scaleBeamClampView(view, 0.1)).toEqual({
      ...view,
      label: pt(12, 24),
    });
  });
});
