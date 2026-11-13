import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import packageSchema from '../docs/openstruct-detail-v23.schema.json';
import {
  helixMetrics,
  helixPoint,
  helixSampledLength,
  helixAxisDiameter,
  helixMemory,
  helixDevelopedLength,
} from '../src/domain/helix';
import {
  helixBar,
  helixFromPoints,
  helixCriteriaFromBar,
  helixEnd,
} from '../src/domain/helixBars';
import {
  HELIX_LIMITS,
  defaultHelixCriteria,
  mirrorHelixProfile,
  type HelixCriteria,
} from '../src/domain/helixSchema';
import {
  helixProjection,
  helixPrimitives,
  helixCaption,
  helixViewPoints,
} from '../src/domain/helixViews';
import { geometry, world, distance } from '../src/domain/geometry';
import {
  fabricationSignature,
  groupFabrication,
} from '../src/domain/fabrication';
import { nominalWeight } from '../src/domain/steel';
import { completeOwnership } from '../src/domain/hierarchy';
import {
  emptyProject,
  decodeProject,
  schedule,
  scheduleChanged,
  createScheduleLock,
} from '../src/domain/model';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import {
  applyRebarBatch,
  executeRebarBatch,
  rebarDefinition,
  REBAR_CAPABILITIES,
} from '../src/domain/rebarApi';
import { transformBar, cloneArmatureGraph } from '../src/domain/editing';
import { transformSelection } from '../src/domain/transforms';
import { drawingPrimitives } from '../src/domain/drawingPrimitives';
import { representationPrimitives } from '../src/domain/representations';
import { barCaption } from '../src/domain/drafting';
import { toCsv, toDxf, toPdf, helixScheduleNotes } from '../src/lib/exports';
import type { Bar, Point, Project } from '../src/domain/types';

/** Explicit numeric tolerance for the analytic fixtures (mm). */
const TOL_MM = 1e-6;
const close = (actual: number, expected: number, tol = TOL_MM) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

function criteria(
  patch: Partial<HelixCriteria['profile']> = {},
  rest: Partial<HelixCriteria> = {},
): HelixCriteria {
  const c = defaultHelixCriteria();
  return { ...c, ...rest, profile: { ...c.profile, ...patch } };
}
const A: Point = { x: 1000, y: 2000 };
const helix = (
  patch: Partial<HelixCriteria['profile']> = {},
  rest: Partial<HelixCriteria> = {},
  rotation = 0,
  id = 'h1',
  mark = 'N1',
) => helixBar(criteria(patch, rest), A, rotation, mark, id);

function project(bars: Bar[], repetition?: number): Project {
  const p = completeOwnership({ ...emptyProject(), bars });
  if (repetition)
    p.hierarchy.details[0].repetition = { factor: repetition, elements: [] };
  return p;
}
const run = (p: Project, commands: Parameters<typeof executeRebarBatch>[1]) =>
  applyRebarBatch(p, executeRebarBatch(p, commands, { units: 'mm' }));

describe('Estribo helicoidal · fixtures matemáticas da seção 8', () => {
  it('hélice regular: N = 20, L = 25.311,157256627 mm e massa nominal φ8', () => {
    const b = helix({ diameter: { reference: 'axis', value: 400 } });
    const m = helixMetrics(b);
    expect(m.errors).toEqual([]);
    expect(m.D).toBe(400);
    expect(m.H).toBe(3000);
    close(m.turns, 20, 1e-12);
    close(m.bodyLength, 25311.157256627);
    close(geometry(b).length, 25311.157256627);
    close(m.bodyLength, 20 * Math.hypot(Math.PI * 400, 150));
    close(nominalWeight(1, 8), 0.394584037291, 1e-12);
    close(nominalWeight(m.cutLength / 1000, 8), 9.987378618824, 1e-9);
  });

  it('volta fracionária: N = 20 + 1/3, sem arredondar N nem ajustar p', () => {
    const b = helix({ span: { source: 'gross', value: 3050 } });
    const m = helixMetrics(b);
    close(m.turns, 20 + 1 / 3, 1e-12);
    expect(m.pitch).toBe(150);
    close(m.bodyLength, 25733.009877571);
    // Final phase adds 120° (mod 360) for the positive hand.
    const delta =
      (((((m.endAngle - m.startAngle) * 180) / Math.PI) % 360) + 360) % 360;
    close(delta, 120, 1e-9);
    // The real end stays exactly at z = H.
    close(helixPoint(m, 1).x - m.start, 3050, 1e-9);
  });

  it('menos de uma volta: N = 0,5 é uma única peça', () => {
    const b = helix({ span: { source: 'gross', value: 75 } });
    const m = helixMetrics(b);
    expect(m.errors).toEqual([]);
    close(m.turns, 0.5, 1e-12);
    close(m.bodyLength, 632.778931416);
    expect(b.quantity).toBe(1);
  });

  it('referência externa: Dext = 408, φ = 8 → D = 400 e mesmo L', () => {
    const b = helix({ diameter: { reference: 'external', value: 408 } });
    const m = helixMetrics(b);
    expect(m.D).toBe(400);
    close(m.bodyLength, 25311.157256627);
  });

  it('concreto/cobrimento: Dconc = 500, c = 25, φ = 10 → D = 440', () => {
    const b = helix(
      { diameter: { reference: 'concrete', value: 500, cover: 25 } },
      { diameter: 10 },
    );
    const m = helixMetrics(b);
    expect(m.D).toBe(440);
    close(m.bodyLength, 27808.311074576);
  });

  it('afastamentos: Hbruto = 3.200, a = b = 100 → H = 3.000 sem descontar duas vezes', () => {
    const b = helix({
      span: { source: 'gross', value: 3200 },
      startOffset: 100,
      endOffset: 100,
    });
    const m = helixMetrics(b);
    expect(m.H).toBe(3000);
    expect(m.gross).toBe(3200);
    close(m.turns, 20, 1e-12);
    close(m.bodyLength, 25311.157256627);
    expect(m.start).toBe(100);
    expect(m.end).toBe(3100);
    // Useful source declares H; the gross span is derived, not contradicted.
    const u = helix({
      span: { source: 'useful', value: 3000 },
      startOffset: 100,
      endOffset: 100,
    });
    expect(helixMetrics(u).gross).toBe(3200);
    close(helixMetrics(u).bodyLength, 25311.157256627);
  });

  it('confere o comprimento analítico por amostragem independente da curva espacial', () => {
    for (const patch of [
      {},
      { span: { source: 'gross' as const, value: 3050 } },
      { span: { source: 'gross' as const, value: 75 } },
      { hand: 'left' as const, phase: 37 },
    ]) {
      const m = helixMetrics(helix(patch));
      const sampled = helixSampledLength(m, 1_000_000);
      expect(Math.abs(sampled - m.bodyLength) / m.bodyLength).toBeLessThan(
        1e-8,
      );
    }
  });

  it('quantidade 2 × multiplicador 3 × repetição 4 = 24 hélices, sem fator de 20 voltas', () => {
    const b = helix({}, { quantity: 2, multiplier: 3 });
    const p = project([b], 4);
    const [row] = schedule(p);
    expect(row.quantity).toBe(24);
    close(row.totalLength, 607.467774159, 1e-8);
    close(row.weight, 239.697086852, 1e-8);
    close(row.unitLength, 25.311157256627, 1e-11);
    expect(scheduleChanged(p)).toBe(false);
  });
});

describe('Estribo helicoidal · diâmetro, bitola e validações', () => {
  it('φ no modo eixo mantém L; nos modos externo/concreto recalcula D e L', () => {
    const axis8 = helix({}, { diameter: 8 }),
      axis10 = helix({}, { diameter: 10 });
    close(geometry(axis8).length, geometry(axis10).length, 1e-9);
    expect(schedule(project([axis10]))[0].weight).toBeGreaterThan(
      schedule(project([axis8]))[0].weight,
    );
    const ext8 = helix({ diameter: { reference: 'external', value: 408 } }),
      ext10 = helix(
        { diameter: { reference: 'external', value: 408 } },
        { diameter: 10 },
      );
    expect(helixMetrics(ext10).D).toBe(398);
    expect(geometry(ext10).length).toBeLessThan(geometry(ext8).length);
    expect(
      helixAxisDiameter({ reference: 'concrete', value: 500, cover: 25 }, 12.5),
    ).toBe(437.5);
  });

  it.each([
    [{ pitch: Number.NaN }, /passo/],
    [{ pitch: 0 }, /passo/],
    [{ pitch: -1 }, /passo/],
    [{ pitch: Number.POSITIVE_INFINITY }, /passo/],
    [{ span: { source: 'gross' as const, value: Number.NaN } }, /trecho/],
    [{ startOffset: -1 }, /afastamento inicial/],
    [{ endOffset: -1 }, /afastamento final/],
    [{ diameter: { reference: 'axis' as const, value: 0 } }, /diâmetro/],
    [
      {
        diameter: { reference: 'concrete' as const, value: 500, cover: -1 },
      },
      /cobrimento/,
    ],
  ])('recusa entrada inválida %j', (patch, message) => {
    expect(() => helix(patch as never)).toThrow(message);
  });

  it('recusa trecho útil nulo após afastamentos, D ≤ φ, voltas sobrepostas e excesso de voltas', () => {
    expect(() =>
      helix({
        span: { source: 'gross', value: 200 },
        startOffset: 100,
        endOffset: 100,
      }),
    ).toThrow(/trecho útil/);
    expect(() =>
      helix({ diameter: { reference: 'concrete', value: 50, cover: 25 } }),
    ).toThrow(/não é positivo/);
    expect(() => helix({ diameter: { reference: 'axis', value: 8 } })).toThrow(
      /maior que a bitola/,
    );
    expect(() => helix({ pitch: 7.9 })).toThrow(/sobrepõem/);
    expect(() =>
      helix({ span: { source: 'gross', value: 750000 }, pitch: 100 }),
    ).toThrow(/Limite do software/);
    expect(() => helix({}, { quantity: 1.5 })).toThrow(/quantidade/);
    expect(() => helix({}, { quantity: 0 })).toThrow(/quantidade/);
  });

  it('limita o traçado antes de alocar e não deixa a geometria gráfica alterar L/N', () => {
    const b = helix({ span: { source: 'gross', value: 500000 }, pitch: 100 });
    const m = helixMetrics(b);
    expect(m.turns).toBe(HELIX_LIMITS.maxTurns);
    for (const scale of [0.01, 1, 50]) {
      const { front, back } = helixProjection(m, scale);
      const count = [...front, ...back].reduce((n, l) => n + l.length, 0);
      expect(count).toBeLessThanOrEqual(HELIX_LIMITS.maxProjectionPoints * 1.3);
      expect(geometry(b).length).toBe(m.cutLength);
    }
    const small = helixMetrics(helix());
    const { front, back } = helixProjection(small);
    // 20 turns: one front half and one back half per turn, split exactly at w = 0.
    expect(front).toHaveLength(20);
    expect(back).toHaveLength(20);
    for (const line of front) {
      const mid = line[Math.floor(line.length / 2)];
      expect(Math.abs(mid.y)).toBeLessThan(small.R);
    }
    const lengthOf = (lines: Point[][]) =>
      lines.reduce(
        (n, l) => n + l.slice(1).reduce((s, p, i) => s + distance(p, l[i]), 0),
        0,
      );
    close(lengthOf(front), lengthOf(back), 1e-6 * lengthOf(back));
    const all = [...front, ...back].flat();
    // Exact end points and phase are preserved by the representation.
    const start = helixPoint(small, 0),
      end = helixPoint(small, 1);
    expect(all.some((p) => distance(p, start) < 1e-9)).toBe(true);
    expect(all.some((p) => distance(p, end) < 1e-9)).toBe(true);
  });
});

describe('Estribo helicoidal · eixo, sentido, fase e espelhamentos', () => {
  it.each([
    ['horizontal', { x: 4000, y: 2000 }],
    ['vertical', { x: 1000, y: 5000 }],
    ['inclinado', { x: 1000 + 1800, y: 2000 + 2400 }],
  ])(
    'dois pontos em eixo %s preservam a verdadeira grandeza e os afastamentos',
    (_, B) => {
      const b = helixFromPoints(
        criteria({ startOffset: 50, endOffset: 25 }),
        A,
        B,
        'N1',
        'h',
      );
      const m = helixMetrics(b);
      close(m.gross, 3000, 1e-9);
      close(m.H, 2925, 1e-9);
      close(distance(helixEnd(b), B), 0, 1e-9);
      const useful = world({ x: m.start, y: 0 }, b);
      close(distance(useful, A), 50, 1e-9);
    },
  );

  it('inverter A/B mantém sentido, comprimento e assinatura de fabricação', () => {
    const B = { x: 3400, y: 3800 };
    const ab = helixFromPoints(criteria(), A, B, 'N1', 'ab'),
      ba = helixFromPoints(criteria(), B, A, 'N2', 'ba');
    expect(ab.helix!.hand).toBe(ba.helix!.hand);
    close(geometry(ab).length, geometry(ba).length, 1e-9);
    expect(fabricationSignature(ab)).toBe(fabricationSignature(ba));
  });

  it('fase posiciona o ponto inicial; o sentido define o giro visto de B para A', () => {
    const m0 = helixMetrics(helix({ phase: 0 }));
    const p0 = helixPoint(m0, 0);
    close(p0.y, 200, 1e-9);
    close(p0.w, 0, 1e-9);
    const m90 = helixMetrics(helix({ phase: 90 }));
    close(helixPoint(m90, 0).w, 200, 1e-9);
    const turn = (hand: 'right' | 'left') => {
      const m = helixMetrics(helix({ hand }));
      const a = helixPoint(m, 0),
        b = helixPoint(m, 0.001);
      // In the (x̂ = y, ŷ = w) plane, positive cross = counterclockwise.
      return Math.sign(a.y * b.w - a.w * b.y);
    };
    expect(turn('right')).toBe(1);
    expect(turn('left')).toBe(-1);
    close(
      geometry(helix({ hand: 'left', phase: 45 })).length,
      geometry(helix()).length,
      1e-9,
    );
  });

  it('espelhamento físico reflete a curva, inverte o sentido e conserva o desenvolvimento', () => {
    const b = helix({ phase: 30 }, {}, 25);
    const mirrored = transformBar(b, 'mirror');
    expect(mirrored.helix!.hand).toBe('left');
    close(geometry(mirrored).length, geometry(b).length, 1e-9);
    const m = helixMetrics(b),
      n = helixMetrics(mirrored);
    for (const t of [0, 0.13, 0.5, 0.77, 1]) {
      const p = helixPoint(m, t),
        q = helixPoint(n, t);
      const expected = world({ x: -p.x, y: p.y }, b);
      const actual = world({ x: q.x, y: q.y }, mirrored);
      close(distance(expected, actual), 0, 1e-6);
      close(q.w, p.w, 1e-6);
    }
    expect(fabricationSignature(mirrored)).not.toBe(fabricationSignature(b));
    expect(mirrorHelixProfile(mirrorHelixProfile(b.helix!)).hand).toBe('right');
  });

  it('espelho da seleção inverte o sentido; translação e giro preservam quantitativos', () => {
    const b = helix({}, { quantity: 2 });
    const p = project([b]);
    const before = schedule(p)[0];
    const mirrored = transformSelection(p, [b.id], {
      kind: 'mirror',
      base: { x: 0, y: 0 },
      axisEnd: { x: 1000, y: 700 },
    });
    expect(mirrored.bars[0].helix!.hand).toBe('left');
    const rotated = transformSelection(p, [b.id], {
      kind: 'rotate',
      base: { x: 0, y: 0 },
      angle: 33,
    });
    const moved = run(p, [
      { type: 'bar.move', id: b.id, delta: { x: 500, y: -300 } },
    ]);
    for (const q of [mirrored, rotated, moved]) {
      const row = schedule(q)[0];
      expect(row.quantity).toBe(before.quantity);
      close(row.totalLength, before.totalLength, 1e-12);
      close(row.weight, before.weight, 1e-12);
    }
    expect(fabricationSignature(rotated.bars[0])).toBe(fabricationSignature(b));
  });
});

describe('Estribo helicoidal · fabricação, vistas e quantitativos', () => {
  it('assinatura distingue hélices de mesmo comprimento arredondado e ignora fase/posição', () => {
    const base = helix();
    const left = helix({ hand: 'left' });
    expect(Math.round(geometry(left).length)).toBe(
      Math.round(geometry(base).length),
    );
    expect(fabricationSignature(left)).not.toBe(fabricationSignature(base));
    // Same rounded length, different D/p combination.
    const D2 = 400.002;
    const other = helix({ diameter: { reference: 'axis', value: D2 } });
    expect(Math.round(geometry(other).length)).toBe(
      Math.round(geometry(base).length),
    );
    expect(fabricationSignature(other)).not.toBe(fabricationSignature(base));
    const phased = helix({ phase: 123 }, {}, 47, 'h2', 'N1');
    expect(fabricationSignature(phased)).toBe(fabricationSignature(base));
    // Same D on the axis from another reference is the same physical piece.
    const ext = helix({ diameter: { reference: 'external', value: 408 } });
    expect(fabricationSignature(ext)).toBe(fabricationSignature(base));
    const p = project([
      base,
      { ...phased, id: 'h2', mark: 'N2' },
      { ...left, id: 'h3', mark: 'N3' },
    ]);
    expect(() => groupFabrication(p, ['h1', 'h3'], 'h1')).toThrow(
      /equivalentes/,
    );
    const grouped = groupFabrication(p, ['h1', 'h2'], 'h1');
    expect(schedule(grouped).find((r) => r.mark === 'N1')!.quantity).toBe(2);
  });

  it('vistas, seção e rebatimentos não duplicam aço; legenda separa hélice e voltas', () => {
    const b = helix({}, { quantity: 1 });
    const p = project([b]);
    p.details = [
      { id: 'v1', barId: b.id, origin: { x: 0, y: -2000 } },
      { id: 'v2', barId: b.id, origin: { x: 0, y: -4000 }, scale: 0.5 },
    ];
    const q = completeOwnership(p);
    expect(schedule(q)[0].quantity).toBe(1);
    expect(helixCaption(b, q)).toBe(
      'N1 - 1 hélice x %%c8 - 20 voltas - p=15,0 cm - C=25,311 m',
    );
    expect(barCaption(b, q)).toContain('HÉLICE 20 voltas p=15,0');
    const texts = drawingPrimitives(q)
      .filter((x) => x.text)
      .map((x) => x.text!);
    expect(texts).toContain('p = 15,0 cm (volta completa)');
    expect(texts).toContain('D = 40,0 cm (eixo)');
    expect(texts).toContain('H = 300,0 cm (útil)');
    expect(texts.some((t) => /20 estribos/.test(t))).toBe(false);
    const rep = representationPrimitives(b, q.details[1], q);
    expect(rep.some((x) => x.layer === 'REBATIMENTOS')).toBe(true);
    // Display options never change the material.
    const hidden = {
      ...b,
      helixDisplay: {
        dimensions: false,
        identification: false,
        section: false,
      },
    };
    expect(fabricationSignature(hidden)).toBe(fabricationSignature(b));
    close(geometry(hidden).length, geometry(b).length, 0);
    expect(helixViewPoints(hidden).length).toBeLessThan(
      helixViewPoints(b).length,
    );
    expect(
      helixPrimitives(b).every((x) =>
        x.points.every((v) => Number.isFinite(v.x)),
      ),
    ).toBe(true);
  });

  it('memória mostra referência, D, φ, H, p, N, Lcorpo, parcelas e quantidade', () => {
    const b = helix(
      { diameter: { reference: 'external', value: 408 } },
      { quantity: 2, multiplier: 3 },
    );
    const rows = helixMemory(b, {
      quantity: 24,
      multiplier: 3,
      repetitions: 4,
    });
    const text = rows.map((r) => `${r.label}: ${r.value}`).join('\n');
    expect(text).toMatch(/diâmetro externo/);
    expect(text).toMatch(/Dext = 408,0 mm/);
    expect(text).toMatch(/D no eixo da barra: 400,000 mm/);
    expect(text).toMatch(
      /Número de voltas N = H \/ p: 20 \(20 completas \+ 0,000\)/,
    );
    expect(text).toMatch(/25\.311,157 mm/);
    expect(text).toMatch(/nenhuma: sem ganchos/);
    expect(text).toMatch(/= 24 · 607,468 m · 239,697 kg/);
  });
});

describe('Estribo helicoidal · persistência, RA, intercâmbio e API', () => {
  const packOptions = {
    producer: { app: 'Teste helicoidal', version: '1' },
    exportedAt: '2026-11-11T00:00:00Z',
  };

  it('salva e reabre critérios, peça, fase, sentido e referência original', () => {
    const b = helix(
      {
        diameter: { reference: 'concrete', value: 500, cover: 25 },
        hand: 'left',
        phase: -45,
        startOffset: 10,
      },
      { diameter: 10, quantity: 3 },
      17,
    );
    const p = { ...project([b]), helixDefaults: helixCriteriaFromBar(b) };
    const q = decodeProject(JSON.stringify(p));
    expect(q.schema).toBe('armadurastruct/35');
    expect(q.bars[0]).toEqual(b);
    expect(q.helixDefaults).toEqual(p.helixDefaults);
    close(geometry(q.bars[0]).length, geometry(b).length, 0);
  });

  it('formatos anteriores não aceitam hélice; arquivos antigos abrem sem conversão', () => {
    const p = project([helix()]);
    const old = JSON.parse(JSON.stringify(p));
    old.schema = 'armadurastruct/32';
    expect(() => decodeProject(JSON.stringify(old))).toThrow(/formato 33/);
    const defaultsOnly = JSON.parse(
      JSON.stringify({ ...emptyProject(), helixDefaults: criteria() }),
    );
    defaultsOnly.schema = 'armadurastruct/31';
    expect(() => decodeProject(JSON.stringify(defaultsOnly))).toThrow(
      /formato 33/,
    );
    const legacy = JSON.parse(JSON.stringify(emptyProject()));
    legacy.schema = 'armadurastruct/31';
    expect(decodeProject(JSON.stringify(legacy)).bars).toEqual([]);
  });

  it('dados corrompidos ou incoerentes são recusados com diagnóstico', () => {
    const p = JSON.parse(JSON.stringify(project([helix()])));
    p.bars[0].helix.pitch = -5;
    expect(() => decodeProject(JSON.stringify(p))).toThrow();
    const q = JSON.parse(JSON.stringify(project([helix()])));
    q.bars[0].kind = 'free';
    expect(() => decodeProject(JSON.stringify(q))).toThrow(/helicoidais/);
    const r = JSON.parse(JSON.stringify(project([helix()])));
    r.bars[0].helix.pitch = 7;
    expect(() => decodeProject(JSON.stringify(r))).toThrow(/sobrepõem/);
    const s = JSON.parse(JSON.stringify(project([helix()])));
    s.bars[0].distribution = { end: { x: 10, y: 0 } };
    s.bars[0].quantity = 2;
    expect(() => decodeProject(JSON.stringify(s))).toThrow(/helicoidais/);
  });

  it('RA bloqueada mantém a fotografia, detecta mudança física e ignora mudança de vista', () => {
    const b = helix();
    let p = project([b]);
    p = { ...p, scheduleLock: createScheduleLock(p, '2026-11-11T00:00:00Z') };
    const locked = schedule(p)[0].totalLength;
    const view = {
      ...p,
      bars: [{ ...b, helixDisplay: { ...b.helixDisplay!, section: false } }],
    };
    expect(scheduleChanged(view)).toBe(false);
    const pitch = {
      ...p,
      bars: [{ ...b, helix: { ...b.helix!, pitch: 200 } }],
    };
    expect(scheduleChanged(pitch)).toBe(true);
    expect(schedule(pitch)[0].totalLength).toBe(locked);
    const refreshed = {
      ...pitch,
      scheduleLock: createScheduleLock(pitch, '2026-11-12T00:00:00Z'),
    };
    expect(schedule(refreshed)[0].totalLength).toBeLessThan(locked);
    expect(() => toCsv(pitch)).toThrow(/desatualizada/);
  });

  it.each(['mm', 'cm', 'm'] as const)(
    'pacote atual em %s converte comprimentos uma vez e não escala ângulos ou voltas',
    (unit) => {
      const b = helix(
        {
          diameter: { reference: 'concrete', value: 500, cover: 25 },
          phase: 30,
          startOffset: 40,
          endOffset: 60,
        },
        { diameter: 10, quantity: 2 },
      );
      b.helixDisplay = { ...b.helixDisplay!, label: { x: 100, y: -500 } };
      const p = project([b]);
      const pack = createDetailPackage(p, p.hierarchy.details[0].id, {
        ...packOptions,
        unit,
      });
      expect(pack.schema).toBe('openstruct.detail/23');
      const k = unit === 'mm' ? 1 : unit === 'cm' ? 10 : 1000;
      const out = pack.objects.bars[0].helix!;
      expect(out.phase).toBe(30);
      expect(out.hand).toBe('right');
      close(out.pitch, 150 / k, 1e-12);
      close(out.span.value, 3000 / k, 1e-12);
      expect(out.diameter.reference).toBe('concrete');
      expect(pack.objects.bars[0].quantity).toBe(2);
      const ajv = new Ajv2020({ strict: false, allErrors: true });
      const validate = ajv.compile(packageSchema);
      expect(validate(pack), JSON.stringify(validate.errors)).toBe(true);
      const back = readDetailPackage(JSON.stringify(pack)).project.bars[0];
      close(geometry(back).length, geometry(b).length, 1e-6);
      close(helixMetrics(back).turns, helixMetrics(b).turns, 1e-9);
      expect(back.helix!.phase).toBe(30);
    },
  );

  it('pacote rotulado com versão anterior não transporta hélice', () => {
    const p = project([helix()]);
    const pack = createDetailPackage(p, p.hierarchy.details[0].id, packOptions);
    expect(() =>
      readDetailPackage(
        JSON.stringify({ ...pack, schema: 'openstruct.detail/21' }),
      ),
    ).toThrow(/openstruct\.detail\/22/);
  });

  it('API: cria, edita mantendo ID, recusa faixa e família incompatível', () => {
    expect(REBAR_CAPABILITIES.families).toContain('helix');
    expect(REBAR_CAPABILITIES.helix.distribution).toBe(false);
    const p0 = project([]);
    const detailId = p0.hierarchy.details[0].id;
    const b = helix();
    const created = run(p0, [
      {
        type: 'bar.create',
        id: 'api',
        detailId,
        definition: rebarDefinition(b),
      },
    ]);
    const bar = created.bars.find((x) => x.id === 'api')!;
    expect(bar.kind).toBe('helix');
    close(geometry(bar).length, 25311.157256627);
    const edited = run(created, [
      {
        type: 'bar.update',
        id: 'api',
        patch: { kind: 'helix', helix: { ...b.helix!, pitch: 200 } },
      },
    ]);
    const after = edited.bars.find((x) => x.id === 'api')!;
    expect(after.id).toBe('api');
    close(helixMetrics(after).turns, 15, 1e-12);
    const mismatch = executeRebarBatch(
      created,
      [{ type: 'bar.update', id: 'api', patch: { kind: 'free', points: [] } }],
      { units: 'mm' },
    );
    expect(mismatch.ok).toBe(false);
    const range = executeRebarBatch(
      created,
      [
        {
          type: 'distribution.set',
          barId: 'api',
          distribution: { end: { x: 5000, y: 0 } },
          count: { mode: 'quantity', quantity: 3 },
        },
      ],
      { units: 'mm' },
    );
    expect(range.ok).toBe(false);
    expect(JSON.stringify(range.issues)).toMatch(/helicoidais/);
    const invalid = executeRebarBatch(
      created,
      [
        {
          type: 'bar.update',
          id: 'api',
          patch: { kind: 'helix', helix: { ...b.helix!, pitch: 5 } },
        },
      ],
      { units: 'mm' },
    );
    expect(invalid.ok).toBe(false);
    expect(invalid.project).toBe(created);
  });

  it('cópia física cria nova peça; cópia de vista não cria aço', () => {
    const b = helix();
    const p = project([b]);
    const copy = cloneArmatureGraph(p, {
      barIds: [b.id],
      delta: { x: 0, y: 3000 },
    });
    expect(copy.project.bars).toHaveLength(2);
    expect(schedule(copy.project).reduce((n, r) => n + r.quantity, 0)).toBe(2);
    const view = run(p, [
      {
        type: 'representation.create',
        barId: b.id,
        origin: { x: 0, y: -1500 },
      },
    ]);
    expect(schedule(view).reduce((n, r) => n + r.quantity, 0)).toBe(1);
  });

  it('CSV, PDF e DXF trazem quantidade, comprimentos e massa coerentes; DXF não declara hélice nativa', () => {
    const b = helix({}, { quantity: 2, multiplier: 3 });
    const p = project([b], 4);
    const csv = toCsv(p);
    expect(csv).toMatch(/"N1";.*;"24";"25,311";"607,468";"239,70"/);
    const notes = helixScheduleNotes(p);
    expect(notes[0]).toMatch(
      /D = 400,0 mm \(eixo\) · H = 3\.000,0 mm · p = 150,0 mm · N = 20 voltas/,
    );
    const pdf = toPdf(p);
    expect(pdf.byteLength).toBeGreaterThan(1000);
    const dxf = toDxf(p);
    expect(dxf).toContain('N = 20 voltas');
    expect(dxf).not.toMatch(/HELIX\r?\n/);
  });
});
