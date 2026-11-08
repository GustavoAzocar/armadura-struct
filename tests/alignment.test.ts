import { describe, expect, it } from 'vitest';
import {
  alignSelection,
  modelAlignmentItems,
  paperAlignmentItems,
  planAlignmentItems,
  type AlignmentItem,
  type AlignmentOptions,
} from '../src/domain/alignment';
import {
  emptyProject,
  newBar,
  schedule,
  decodeProject,
  createScheduleLock,
} from '../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
  moveObjectsToDetail,
} from '../src/domain/hierarchy';
import { executeRebarBatch } from '../src/domain/rebarApi';
import { setLayerState } from '../src/domain/layerProfiles';
import { hideObjects } from '../src/domain/visibility';
import { geometry, distance } from '../src/domain/geometry';
import { placeDrawing } from '../src/domain/sheets';
import { annotationPrimitives } from '../src/domain/drafting';
const options: AlignmentOptions = {
  mode: 'align',
  axis: 'x',
  anchor: 'min',
  fixedId: 'a',
  gap: 100,
};
const item = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
): AlignmentItem => ({
  id,
  label: id,
  ids: [id],
  points: [
    { x, y },
    { x: x + w, y: y + h },
  ],
});
const mass = (p: ReturnType<typeof emptyProject>) =>
  schedule(p).reduce((s, r) => s + r.weight, 0);
function fixture() {
  return completeOwnership({
    ...emptyProject(),
    bars: [
      { ...newBar('N1'), id: 'a', origin: { x: 500, y: 200 }, quantity: 4 },
      { ...newBar('N2'), id: 'b', origin: { x: 2200, y: 700 }, quantity: 3 },
      { ...newBar('N3'), id: 'c', origin: { x: -1500, y: 1200 }, quantity: 2 },
    ],
    annotations: [
      {
        id: 'call',
        kind: 'leader',
        barId: 'b',
        points: [
          { x: 2200, y: 700 },
          { x: 2100, y: 500 },
          { x: 3000, y: 500 },
        ],
        label: '',
        textHeight: 40,
        color: '#777777',
      },
      {
        id: 'dim',
        kind: 'dimension-orthogonal',
        points: [
          { x: 4000, y: 0 },
          { x: 5000, y: 300 },
          { x: 4300, y: 600 },
        ],
        label: '',
        textHeight: 40,
        color: '#777777',
      },
      {
        id: 'text',
        kind: 'leader',
        points: [
          { x: 6000, y: 0 },
          { x: 6010, y: 10 },
          { x: 6100, y: 10 },
        ],
        label: 'Texto grande para alinhar',
        textHeight: 100,
        color: '#777777',
      },
    ],
    polylines: [
      {
        id: 'line',
        points: [
          { x: 2000, y: -500 },
          { x: 2500, y: -500 },
        ],
        closed: false,
        color: '#777777',
      },
    ],
  });
}
describe('AS-23 · caixas, referência e afastamentos', () => {
  it.each(['min', 'center', 'max'] as const)(
    'alinha %s pelo conjunto fixo sem mutar os itens',
    (anchor) => {
      const items = [
          item('a', 20, 0, 10, 10),
          item('b', 100, 50, 30, 15),
          item('c', -20, -40, 20, 20),
        ],
        before = structuredClone(items);
      const moves = planAlignmentItems(items, { ...options, anchor });
      const value = (i: AlignmentItem) =>
        i.points[0].x +
        (anchor === 'min'
          ? 0
          : anchor === 'max'
            ? i.points[1].x - i.points[0].x
            : (i.points[1].x - i.points[0].x) / 2);
      moves.forEach((m, i) => {
        expect(value(items[i]) + m.delta.x).toBeCloseTo(value(items[0]));
        expect(m.delta.y).toBeCloseTo(0);
      });
      expect(moves[0].delta).toEqual({ x: 0, y: 0 });
      expect(items).toEqual(before);
    },
  );
  it('distribui caixas de larguras distintas com o fixo intermediário e ordenação estável', () => {
    const items = [
      item('c', 100, 0, 30, 10),
      item('a', 0, 0, 10, 10),
      item('b', 30, 0, 20, 10),
    ];
    const moves = planAlignmentItems(items, {
      ...options,
      mode: 'distribute',
      fixedId: 'b',
      gap: 7,
    });
    const boxes = items
      .map((v) => {
        const d = moves.find((m) => m.id === v.id)!.delta;
        return { min: v.points[0].x + d.x, max: v.points[1].x + d.x };
      })
      .sort((a, b) => a.min - b.min);
    expect(moves.find((v) => v.id === 'b')!.delta).toEqual({ x: 0, y: 0 });
    expect(boxes[1].min - boxes[0].max).toBe(7);
    expect(boxes[2].min - boxes[1].max).toBe(7);
    expect(
      planAlignmentItems([...items].reverse(), {
        ...options,
        mode: 'distribute',
        fixedId: 'b',
        gap: 7,
      }),
    ).toEqual(moves);
  });
  it('linha oblíqua projeta bordas e desloca só na normal; vertical usa Y', () => {
    const items = [item('a', 0, 0, 10, 10), item('b', 30, 60, 20, 20)];
    const moves = planAlignmentItems(items, {
      ...options,
      axis: 'reference',
      reference: { start: { x: 0, y: 0 }, end: { x: 100, y: 100 } },
    });
    expect(moves[1].delta.x + moves[1].delta.y).toBeCloseTo(0);
    const v = items[1].points[0],
      d = moves[1].delta;
    expect(v.y + d.y - v.x - d.x).toBeCloseTo(0);
    const vertical = planAlignmentItems(items, { ...options, axis: 'y' })[1]
      .delta;
    expect(vertical.x).toBeCloseTo(0);
    expect(vertical.y).toBe(-60);
  });
  it('recusa referência nula, fixo inválido e caixas vazias', () => {
    const items = [item('a', 0, 0, 1, 1), item('b', 10, 0, 1, 1)];
    expect(() =>
      planAlignmentItems(items, { ...options, fixedId: 'missing' }),
    ).toThrow(/fixo/);
    expect(() =>
      planAlignmentItems(items, {
        ...options,
        axis: 'reference',
        reference: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
      }),
    ).toThrow(/distintos/);
    expect(() =>
      planAlignmentItems([items[0], { ...items[1], points: [] }], options),
    ).toThrow(/Caixa/);
  });
});
describe('AS-23 · objetos, conjuntos e folhas', () => {
  it('move seleção mista com chamadas próprias, inclui extensão dos textos e conserva cotas/aço/IDs', () => {
    const p = fixture(),
      before = JSON.stringify(p),
      ids = ['a', 'b', 'c', 'dim', 'line', 'text'];
    const items = modelAlignmentItems(p, ids);
    expect(items.find((v) => v.id === 'b')!.ids).toContain('call');
    const text = items.find((v) => v.id === 'text')!;
    expect(Math.max(...text.points.map((v) => v.x))).toBeGreaterThan(6000);
    const { project: q, moves } = alignSelection(p, ids, options);
    const after = modelAlignmentItems(q, ids),
      min = (v: AlignmentItem) => Math.min(...v.points.map((p) => p.x));
    after.forEach((v) => expect(min(v)).toBeCloseTo(min(after[0]), 7));
    for (let i = 0; i < p.bars.length; i++) {
      expect(q.bars[i].points).toEqual(p.bars[i].points);
      expect(geometry(q.bars[i]).length).toBe(geometry(p.bars[i]).length);
    }
    const delta = moves.find((v) => v.id === 'b')!.delta;
    expect(
      q.annotations[0].points[0].x - p.annotations[0].points[0].x,
    ).toBeCloseTo(delta.x);
    expect(
      annotationPrimitives(q.annotations[1], q).find((v) => v.text)?.text,
    ).toBe(annotationPrimitives(p.annotations[1], p).find((v) => v.text)?.text);
    expect(mass(q)).toBe(mass(p));
    expect(JSON.stringify(p)).toBe(before);
    expect(decodeProject(JSON.stringify(q))).toEqual(q);
  });
  it('três detalhamentos agrupados movem cada conjunto e suas inserções uma só vez', () => {
    let p = fixture();
    for (const id of ['a', 'b', 'c']) {
      const made = createHierarchyNode(
        p,
        'detail',
        `Grupo ${id}`,
        p.hierarchy.elements[0].id,
      );
      p = made.project;
      p = moveObjectsToDetail(
        p,
        [id, ...(id === 'b' ? ['call'] : [])],
        made.id,
      );
      p = {
        ...p,
        hierarchy: {
          ...p.hierarchy,
          details: p.hierarchy.details.map((d) =>
            d.id === made.id ? { ...d, grouped: true } : d,
          ),
        },
      };
    }
    p = completeOwnership({
      ...p,
      details: [
        {
          id: 'rep',
          barId: 'b',
          origin: { x: 2200, y: -1000 },
          rotation: 30,
          scale: 2,
        },
      ],
    });
    p = moveObjectsToDetail(p, ['rep'], p.hierarchy.objectDetails.b);
    const items = modelAlignmentItems(p, ['a', 'b', 'call', 'c', 'rep']);
    expect(items).toHaveLength(3);
    const q = alignSelection(p, ['a', 'b', 'call', 'c', 'rep'], {
      ...options,
      fixedId: items[0].id,
    }).project;
    expect(distance(q.bars[1].origin, q.details[0].origin)).toBeCloseTo(
      distance(p.bars[1].origin, p.details[0].origin),
      8,
    );
    expect(q.details[0].rotation).toBe(30);
    expect(q.details[0].scale).toBe(2);
    expect(mass(q)).toBe(mass(p));
  });
  it('layer/objeto protegido impede movimento atomicamente; fixo protegido é permitido', () => {
    const p = fixture();
    const locked = setLayerState(p, 'model', 'layer:ARMADURAS', {
      editable: false,
    });
    const cmd = { type: 'selection.align' as const, ids: ['a', 'b'], options };
    const result = executeRebarBatch(locked, [cmd], { units: 'mm' });
    expect(result.ok).toBe(false);
    expect(result.project).toBe(locked);
    const hidden = hideObjects(p, 'model', ['b']);
    expect(executeRebarBatch(hidden, [cmd], { units: 'mm' }).ok).toBe(false);
    const fixed = hideObjects(p, 'model', ['a']);
    expect(executeRebarBatch(fixed, [cmd], { units: 'mm' }).ok).toBe(true);
    expect(
      executeRebarBatch(p, [cmd, { ...cmd, ids: ['a', 'missing'] }], {
        units: 'mm',
      }).project,
    ).toBe(p);
  });
  it('papel alinha três vistas incluindo moldura/textos, sem alterar modelo, escala e RA bloqueada', () => {
    let p = fixture();
    for (let i = 0; i < 3; i++)
      p = placeDrawing(p, p.sheets[0].id, p.hierarchy.drawings[0].id).project;
    p = {
      ...p,
      hierarchy: {
        ...p.hierarchy,
        placements: p.hierarchy.placements.map((v, i) => ({
          ...v,
          origin: { x: 30 + i * 120, y: 40 + i * 25 },
          scale: 25 * (i + 1),
        })),
      },
    };
    p.scheduleLock = createScheduleLock(p);
    const items = paperAlignmentItems(p, p.sheets[0].id),
      ids = items.map((v) => v.id);
    const result = executeRebarBatch(
      p,
      [
        {
          type: 'selection.align',
          ids,
          sheetId: p.sheets[0].id,
          options: { ...options, axis: 'y', fixedId: ids[1], anchor: 'center' },
        },
      ],
      { units: 'mm' },
    );
    expect(result.ok).toBe(true);
    const q = result.project;
    const boxes = paperAlignmentItems(q, p.sheets[0].id).map((v) =>
      v.points.map((v) => v.y),
    );
    const centers = boxes.map((v) => (Math.min(...v) + Math.max(...v)) / 2);
    centers.forEach((v) => expect(v).toBeCloseTo(centers[0]));
    expect(q.bars).toEqual(p.bars);
    expect(q.scheduleLock).toEqual(p.scheduleLock);
    expect(mass(q)).toBe(mass(p));
    expect(q.hierarchy.placements.map((v) => v.scale)).toEqual(
      p.hierarchy.placements.map((v) => v.scale),
    );
  });
});
