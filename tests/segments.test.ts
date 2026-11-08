import { describe, expect, it } from 'vitest';
import {
  barSegments,
  terminalExtensionAt,
  parseLength,
} from '../src/domain/segments';
import { editVertices, type VertexEdit } from '../src/domain/vertices';
import {
  schedule,
  decodeProject,
  createScheduleLock,
} from '../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
  moveObjectsToDetail,
} from '../src/domain/hierarchy';
import { geometry, world, add, rotate } from '../src/domain/geometry';
import { executeRebarBatch } from '../src/domain/rebarApi';
import { setDetailRepetition } from '../src/domain/detailRepetition';
import { groupFabrication } from '../src/domain/fabrication';
import { setLayerState } from '../src/domain/layerProfiles';
import { hideObjects } from '../src/domain/visibility';
import { representationPoints } from '../src/domain/representations';
import { segmentFixture } from './segmentFixture';

const segment: VertexEdit = {
  kind: 'segment',
  segment: 0,
  length: 1200,
  fixed: 'start',
  strategy: 'chain',
  convention: 'theoretical',
};
function apply(p: ReturnType<typeof segmentFixture>, edit: VertexEdit) {
  const r = executeRebarBatch(p, [{ type: 'vertices.edit', id: 'a', edit }], {
    units: 'mm',
    schedule: 'invalidate-lock',
  });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r;
}
describe('AS-26 · extensão terminal e segmentos físicos', () => {
  it('1000 + 300 = 1300 mm, com 2 × 3 × 4 = 24 peças e três vistas sem aço adicional', () => {
    let p = segmentFixture();
    p = setDetailRepetition(p, p.hierarchy.objectDetails.a, {
      factor: 4,
      elements: [],
    });
    const before = JSON.stringify(p),
      r = apply(p, { kind: 'lengthen', end: 'end', amount: 300 });
    expect(geometry(r.project.bars[0]).length).toBe(1300);
    expect(schedule(r.project)[0].quantity).toBe(24);
    expect(schedule(r.project)[0].weight).toBeCloseTo(
      schedule(p)[0].weight * 1.3,
      12,
    );
    expect(r.project.bars[0].points).toHaveLength(2);
    expect(r.project.details).toEqual(p.details);
    expect(r.receipt.createdIds).toEqual([]);
    expect(r.receipt.operations[0].topology).toEqual({
      vertexMap: [0, 1],
      segmentMap: [[0]],
      warnings: [],
    });
    expect(JSON.stringify(p)).toBe(before);
    expect(
      representationPoints(r.project.bars[0], r.project.details[0]),
    ).not.toEqual(representationPoints(p.bars[0], p.details[0]));
  });
  it.each(['start', 'end'] as const)(
    'estende a ponta %s de barra girada e inclinada mantendo a outra ponta exata',
    (end) => {
      const p = segmentFixture();
      p.bars[0] = {
        ...p.bars[0],
        rotation: 37,
        origin: { x: 221, y: -530 },
        points: [
          { x: 20, y: 50 },
          { x: 620, y: 850 },
        ],
      };
      const q = apply(p, { kind: 'lengthen', end, amount: 300 }).project
        .bars[0];
      expect(geometry(q).length).toBeCloseTo(1300, 10);
      const fixed = end === 'start' ? 1 : 0;
      expect(q.points[fixed]).toEqual(p.bars[0].points[fixed]);
      expect(world(q.points[fixed], q)).toEqual(
        world(p.bars[0].points[fixed], p.bars[0]),
      );
      expect(q.rotation).toBe(37);
      expect(q.points[end === 'start' ? 0 : 1]).toEqual(
        end === 'start' ? { x: -160, y: -190 } : { x: 800, y: 1090 },
      );
    },
  );
  it.each(['start', 'end'] as const)(
    'o clique projetado na ponta %s equivale ao valor e informa afastamento lateral',
    (end) => {
      const p = segmentFixture();
      const b = { ...p.bars[0], rotation: 37, origin: { x: 52, y: -88 } };
      p.bars[0] = b;
      const tip = world(b.points[end === 'start' ? 0 : 1], b);
      const picked = add(
        tip,
        rotate({ x: end === 'start' ? -300 : 300, y: 120 }, b.rotation),
      );
      const proposal = terminalExtensionAt(b, end, picked);
      expect(proposal.amount).toBeCloseTo(300, 10);
      expect(proposal.offAxis).toBeCloseTo(120, 10);
      const numeric = apply(p, { kind: 'lengthen', end, amount: 300 }).project
        .bars[0];
      const clicked = apply(p, proposal.edit).project.bars[0];
      clicked.points.forEach((v, i) => {
        expect(v.x).toBeCloseTo(numeric.points[i].x, 10);
        expect(v.y).toBeCloseTo(numeric.points[i].y, 10);
      });
    },
  );
  it.each(['start', 'end'] as const)(
    'barra dobrada: ponta %s conserva o restante do caminho e acrescenta exatamente 300 mm',
    (end) => {
      const p = segmentFixture(true),
        old = p.bars[0];
      const q = apply(p, { kind: 'lengthen', end, amount: 300 }).project
        .bars[0];
      expect(geometry(q).length - geometry(old).length).toBeCloseTo(300, 10);
      q.points.forEach((v, i) => {
        if (i !== (end === 'start' ? 0 : 2)) expect(v).toEqual(old.points[i]);
      });
      expect(q.points).toHaveLength(3);
    },
  );
  it.each(['start', 'end'] as const)(
    'segmento com %s fixo desloca apenas o lado móvel da cadeia',
    (fixed) => {
      const p = segmentFixture(true),
        q = apply(p, { ...segment, fixed }).project.bars[0];
      expect(q.points).toEqual(
        fixed === 'start'
          ? [
              { x: 0, y: 0 },
              { x: 1200, y: 0 },
              { x: 1200, y: 500 },
            ]
          : [
              { x: -200, y: 0 },
              { x: 1000, y: 0 },
              { x: 1000, y: 500 },
            ],
      );
      expect(barSegments(q)[0].theoretical).toBe(1200);
    },
  );
  it('a estratégia de ponta única não desloca o vértice posterior', () => {
    const p = segmentFixture(true),
      q = apply(p, { ...segment, strategy: 'endpoint' }).project.bars[0];
    expect(q.points).toEqual([
      { x: 0, y: 0 },
      { x: 1200, y: 0 },
      { x: 1000, y: 500 },
    ]);
    expect(barSegments(q)[1].angle).not.toBe(90);
  });
  it('ângulo absoluto local funciona em barra girada e mantém a direção da perna posterior', () => {
    const p = segmentFixture(true);
    p.bars[0].rotation = 61;
    const q = apply(p, { ...segment, angle: 37 }).project.bars[0];
    expect(q.rotation).toBe(61);
    expect(barSegments(q)[0].angle).toBeCloseTo(37, 10);
    expect(barSegments(q)[0].theoretical).toBeCloseTo(1200, 10);
    expect(q.points[2].x - q.points[1].x).toBeCloseTo(0, 10);
    expect(q.points[2].y - q.points[1].y).toBeCloseTo(500, 10);
  });
  it('comprimento físico entre tangências soma as deduções de ambas as dobras', () => {
    const p = segmentFixture(true);
    p.bars[0].points = [
      { x: 0, y: -500 },
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 500 },
    ];
    expect(barSegments(p.bars[0])[1].straight).toBe(952);
    const q = apply(p, {
      ...segment,
      segment: 1,
      convention: 'straight',
      fixed: 'end',
      length: 1200,
    }).project.bars[0];
    expect(barSegments(q)[1].straight).toBeCloseTo(1200, 10);
    expect(barSegments(q)[1].theoretical).toBeCloseTo(1248, 10);
    expect(q.points[2]).toEqual(p.bars[0].points[2]);
    expect(q.points[3]).toEqual(p.bars[0].points[3]);
  });
  it('a reta física usa as tangências do novo ângulo e recusa estratégia incompatível', () => {
    const p = segmentFixture(true),
      q = apply(p, {
        ...segment,
        convention: 'straight',
        angle: 30,
        length: 500,
      }).project.bars[0];
    expect(barSegments(q)[0].straight).toBeCloseTo(500, 9);
    expect(barSegments(q)[0].theoretical).toBeCloseTo(
      500 + 24 * Math.tan(Math.PI / 6),
      9,
    );
    expect(() =>
      apply(p, { ...segment, convention: 'straight', strategy: 'endpoint' }),
    ).toThrow(/reta física/);
  });
  it('entrada inválida, dobras inviáveis e lote com segunda operação inválida retornam o mesmo projeto', () => {
    const p = segmentFixture(true),
      before = JSON.stringify(p);
    for (const edit of [
      { ...segment, length: 10 },
      { ...segment, angle: -90 },
      { ...segment, length: NaN },
      { ...segment, segment: 999 },
      { kind: 'lengthen', end: 'end', amount: -300 },
      { kind: 'lengthen', end: 'end', amount: 0 },
    ]) {
      const r = executeRebarBatch(
        p,
        [{ type: 'vertices.edit', id: 'a', edit } as never],
        { units: 'mm' },
      );
      expect(r.ok).toBe(false);
      expect(r.project).toBe(p);
    }
    const r = executeRebarBatch(
      p,
      [
        { type: 'vertices.edit', id: 'a', edit: segment },
        {
          type: 'vertices.edit',
          id: 'a',
          edit: { kind: 'lengthen', end: 'end', amount: -1 },
        },
      ],
      { units: 'mm' },
    );
    expect(r.ok).toBe(false);
    expect(r.project).toBe(p);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('trecho degenerado, ponto atrás da ponta e coordenadas não finitas são recusados', () => {
    const p = segmentFixture(),
      b = p.bars[0];
    expect(() => terminalExtensionAt(b, 'end', { x: 900, y: 200 })).toThrow(
      /positivo/,
    );
    expect(() => terminalExtensionAt(b, 'end', { x: NaN, y: 0 })).toThrow(
      /finito/,
    );
    p.bars[0] = {
      ...b,
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
    };
    expect(() =>
      editVertices(p, 'a', { kind: 'lengthen', end: 'end', amount: 300 }),
    ).toThrow(/degenerado/);
  });
  it('desenho, estribo e inserção isolada não são convertidos em aço', () => {
    const p = segmentFixture();
    for (const id of ['poly', 'rep1']) {
      const r = executeRebarBatch(
        p,
        [
          {
            type: 'vertices.edit',
            id,
            edit: { kind: 'lengthen', end: 'end', amount: 300 },
          },
        ],
        { units: 'mm' },
      );
      expect(r.ok).toBe(false);
      expect(r.project).toBe(p);
    }
    p.bars[0].kind = 'stirrup';
    expect(() => apply(p, segment)).toThrow(/estribo/i);
  });
  it('layers, ocultação e isolamento continuam protegendo a operação', () => {
    const p = segmentFixture();
    for (const locked of [
      setLayerState(p, 'model', 'layer:ARMADURAS', { editable: false }),
      hideObjects(p, 'model', ['a']),
    ])
      expect(() => apply(locked, segment)).toThrow();
    const made = createHierarchyNode(
      p,
      'detail',
      'Outro',
      p.hierarchy.elements[0].id,
    );
    const q = moveObjectsToDetail(made.project, ['a'], made.id);
    const r = executeRebarBatch(
      q,
      [{ type: 'vertices.edit', id: 'a', edit: segment }],
      { units: 'mm', scopeDetailId: p.hierarchy.details[0].id },
    );
    expect(r.ok).toBe(false);
    expect(r.project).toBe(q);
  });
  it('desbloqueia RA pela política atual, separa fabricação equivalente e mantém multiplicadores e vínculos', () => {
    let p = segmentFixture();
    p = completeOwnership({
      ...p,
      bars: [
        ...p.bars,
        { ...p.bars[0], id: 'b', mark: 'N2', origin: { x: 2000, y: 0 } },
      ],
    });
    p = groupFabrication(p, ['a', 'b'], 'a');
    p.scheduleLock = createScheduleLock(p);
    const q = apply(p, segment);
    expect(q.receipt.scheduleInvalidated).toBe(true);
    expect(q.project.scheduleLock).toBeUndefined();
    expect(q.project.bars[1]).toEqual(p.bars[1]);
    expect(new Set(q.project.bars.map((b) => b.mark)).size).toBe(2);
    expect(q.project.bars[0]).toMatchObject({
      id: 'a',
      quantity: 2,
      multiplier: 3,
    });
    expect(q.project.hierarchy.objectDetails).toEqual(
      p.hierarchy.objectDetails,
    );
    expect(q.project.details).toEqual(p.details);
    expect(decodeProject(JSON.stringify(q.project))).toEqual(q.project);
  });
  it('unidades explícitas e separador decimal não se confundem com coordenadas', () => {
    expect(parseLength('+300 mm')).toBe(300);
    expect(parseLength('30 cm')).toBe(300);
    expect(parseLength('0,3 m')).toBe(300);
    expect(parseLength('300')).toBe(300);
    for (const invalid of [
      '0',
      '-1',
      'NaN',
      'Infinity',
      '1e400',
      '1300;0',
      '@300<0',
      '',
      '30 px',
    ])
      expect(() => parseLength(invalid)).toThrow();
  });
  it('estender preserva 500 vértices existentes sem adicionar um novo', () => {
    const p = segmentFixture();
    p.bars[0].points = Array.from({ length: 500 }, (_, i) => ({
      x: i * 100,
      y: 0,
    }));
    const q = apply(p, { kind: 'lengthen', end: 'end', amount: 300 }).project;
    expect(q.bars[0].points).toHaveLength(500);
    expect(geometry(q.bars[0]).length).toBe(50200);
  });
  it('uma cota textual sobrescrita permanece anotação e nunca define a perna', () => {
    const p = segmentFixture();
    p.annotations = [
      {
        id: 'dim',
        kind: 'dimension-aligned',
        points: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 500, y: 100 },
        ],
        label: '9999',
        textHeight: 40,
        color: '#8899aa',
        barId: 'a',
      },
    ];
    const before = completeOwnership(p),
      after = apply(before, segment).project;
    expect(geometry(after.bars[0]).length).toBe(1200);
    expect(after.annotations).toEqual(before.annotations);
  });
  it('RA preservada permanece sinalizada como desatualizada; isolamento recusa desbloqueio global implícito', () => {
    const p = segmentFixture();
    p.scheduleLock = createScheduleLock(p);
    const preserved = executeRebarBatch(
      p,
      [{ type: 'vertices.edit', id: 'a', edit: segment }],
      { units: 'mm', schedule: 'preserve-lock' },
    );
    expect(preserved.ok).toBe(true);
    if (preserved.ok) expect(preserved.receipt.scheduleDirty).toBe(true);
    expect(preserved.project.scheduleLock).toEqual(p.scheduleLock);
    const scoped = executeRebarBatch(
      p,
      [{ type: 'vertices.edit', id: 'a', edit: segment }],
      {
        units: 'mm',
        schedule: 'invalidate-lock',
        scopeDetailId: p.hierarchy.objectDetails.a,
      },
    );
    expect(scoped.ok).toBe(false);
    expect(scoped.project).toBe(p);
  });
});
