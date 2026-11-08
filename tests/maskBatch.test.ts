import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
} from '../src/domain/hierarchy';
import {
  maskProjectBytes,
  importMaskBatch,
  associateMasks,
} from '../src/domain/maskBatch';
import { parseDxf, maskPrimitives } from '../src/cad/import';
import { setLayerState } from '../src/domain/layerProfiles';
import { hideObjects, visibilityState } from '../src/domain/visibility';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import {
  placeDrawing,
  createSheet,
  removePlacement,
} from '../src/domain/sheets';
import { composeSheet } from '../src/domain/paper';
import { toCsv, toDxf, toPdf } from '../src/lib/exports';
import { layerId } from '../src/domain/layers';
import { uid, type Project } from '../src/domain/types';
const context = { key: 'model' };
function mask(name = 'forma.dxf') {
  return parseDxf(
    readFileSync('tests/fixtures/follow-sapata.dxf', 'utf8'),
    name,
  );
}
function fixture() {
  let p = completeOwnership({
    ...emptyProject(),
    bars: [{ ...newBar('N1'), quantity: 4 }],
  });
  p = { ...p, scheduleLock: createScheduleLock(p) };
  const other = createHierarchyNode(
    p,
    'detail',
    'V02',
    p.hierarchy.elements[0].id,
  );
  return { p, draft: other.project, a: p.hierarchy.details[0].id, b: other.id };
}
describe('preparação atômica e associação de máscaras', () => {
  it('mede bytes UTF-8 incluindo a indentação do arquivo salvo', () => {
    expect(maskProjectBytes({ v: 'á' })).toBe(15);
  });
  it('importa três referências, com homônimos e dois destinos, sem alterar aço/RA ou o rascunho', () => {
    const { p, draft, a, b } = fixture(),
      before = JSON.stringify(p),
      csv = toCsv(p);
    const masks = [mask(), mask(), mask('outra.dxf')];
    const next = importMaskBatch(
      p,
      draft,
      masks.map((mask, i) => ({ mask, detailId: i === 2 ? b : a })),
      context,
    );
    expect(new Set(next.masks.map((m) => m.id)).size).toBe(3);
    expect(next.masks.map((m) => next.hierarchy.objectDetails[m.id])).toEqual([
      a,
      a,
      b,
    ]);
    expect(next.hierarchy.details).toHaveLength(2);
    expect(next.bars).toBe(p.bars);
    expect(next.scheduleLock).toBe(p.scheduleLock);
    expect(schedule(next)).toEqual(schedule(p));
    expect(toCsv(next)).toBe(csv);
    expect(JSON.stringify(p)).toBe(before);
    expect(draft.masks).toEqual([]);
    const reopened = decodeProject(JSON.stringify(next));
    expect(reopened.masks).toEqual(next.masks);
    expect(reopened.hierarchy).toEqual(next.hierarchy);
  });
  it('revalida destino, capacidade, escala, colisão de IDs e isolamento sem aplicação parcial', () => {
    const { p, draft, a, b } = fixture(),
      before = JSON.stringify(p),
      m = mask();
    const apply = (
      items: Parameters<typeof importMaskBatch>[2],
      ctx = context,
    ) => importMaskBatch(p, draft, items, ctx);
    expect(() => apply([{ mask: m, detailId: 'missing' }])).toThrow(
      /inexistente/,
    );
    expect(() => apply([{ mask: m, detailId: a }], { key: 'sheet:x' })).toThrow(
      /desenho/,
    );
    expect(() =>
      importMaskBatch(p, draft, [{ mask: m, detailId: b }], {
        key: 'model',
        scopeDetailId: a,
      }),
    ).toThrow(/isolada|modelo geral/);
    for (const scale of [0, -1, NaN, Infinity])
      expect(() => apply([{ mask: { ...m, scale }, detailId: a }])).toThrow(
        /escala/,
      );
    expect(() =>
      apply([
        { mask: m, detailId: a },
        { mask: m, detailId: b },
      ]),
    ).toThrow(/duplicado/);
    expect(() =>
      apply(
        Array.from({ length: 21 }, () => ({
          mask: { ...m, id: uid() },
          detailId: a,
        })),
      ),
    ).toThrow(/20/);
    expect(() =>
      importMaskBatch(
        p,
        { ...draft, id: 'changed' },
        [{ mask: m, detailId: a }],
        context,
      ),
    ).toThrow(/projeto/);
    const renamed = {
      ...draft,
      hierarchy: {
        ...draft.hierarchy,
        floors: draft.hierarchy.floors.map((f) => ({ ...f, name: 'changed' })),
      },
    };
    expect(() =>
      importMaskBatch(p, renamed, [{ mask: m, detailId: a }], context),
    ).toThrow(/acrescentar/);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('escala cm/m, rotação e translação são aplicadas uma única vez e sobrevivem ao pacote/saída', () => {
    const { p, draft, a } = fixture();
    for (const [unit, scale, length] of [
      ['cm', 10, 100],
      ['m', 1000, 1],
    ] as const) {
      const m = {
        ...mask(),
        sourceUnit: unit,
        scale,
        rotation: 37,
        origin: { x: 800, y: -200 },
        primitives: [
          {
            layer: 'FORMA',
            points: [
              { x: 0, y: 0 },
              { x: length, y: 0 },
            ],
          },
        ],
      };
      const next = importMaskBatch(
        p,
        draft,
        [{ mask: m, detailId: a }],
        context,
      );
      const points = maskPrimitives(next.masks[0])[0].points;
      expect(
        Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
      ).toBeCloseTo(1000, 9);
      const pack = createDetailPackage(next, a, {
          producer: { app: 'test', version: '1' },
        }),
        back = readDetailPackage(JSON.stringify(pack)).project;
      expect(back.masks[0]).toMatchObject(
        JSON.parse(JSON.stringify(next.masks[0])),
      );
      expect(toDxf(next)).toContain('LWPOLYLINE');
      expect(toPdf(next).length).toBeGreaterThan(100);
    }
  });
  it('duas vistas 1:50/1:100 dão 20/10mm para 1000mm, sem duplicar referências nem quantitativos', () => {
    const { p, draft, a } = fixture();
    const m = {
      ...mask(),
      primitives: [
        {
          layer: 'FORMA',
          points: [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
          ],
        },
      ],
    };
    let next = importMaskBatch(p, draft, [{ mask: m, detailId: a }], context);
    const draw = next.hierarchy.drawings.find((d) => d.detailId === a)!.id;
    next = placeDrawing(next, next.sheets[0].id, draw).project;
    const second = createSheet(next, 'Folha 2');
    next = placeDrawing(second.project, second.id, draw).project;
    next = {
      ...next,
      hierarchy: {
        ...next.hierarchy,
        placements: next.hierarchy.placements.map((v, i) => ({
          ...v,
          scale: i ? 100 : 50,
        })),
      },
    };
    const lengths = next.sheets.map((s) =>
      composeSheet(next, s.id)
        .views.flatMap((v) => v.lines)
        .filter((q) => q.layer === 'FORMA')
        .map((q) =>
          Math.hypot(
            q.points[1].x - q.points[0].x,
            q.points[1].y - q.points[0].y,
          ),
        ),
    );
    expect(lengths).toEqual([[20], [10]]);
    const after = removePlacement(next, next.hierarchy.placements[1].id);
    expect(after.masks).toEqual(next.masks);
    expect(schedule(after)).toEqual(schedule(p));
  });
  it('mover uma ou várias máscaras preserva IDs, coordenadas, avisos, aço e layers', () => {
    const { p, draft, a, b } = fixture(),
      m1 = mask(),
      m2 = {
        ...mask(),
        rotation: 43,
        origin: { x: 50, y: 100 },
        warnings: ['teste'],
      };
    const base = importMaskBatch(
      p,
      draft,
      [m1, m2].map((mask) => ({ mask, detailId: a })),
      context,
    );
    const next = associateMasks(base, [m1.id, m2.id], b, 'move', context);
    expect(next.masks).toEqual(base.masks);
    expect(next.bars).toBe(base.bars);
    expect(next.layers).toEqual(base.layers);
    expect(next.hierarchy.objectDetails[m1.id]).toBe(b);
    expect(next.hierarchy.objectDetails[m2.id]).toBe(b);
    expect(toCsv(next)).toBe(toCsv(base));
    expect(decodeProject(JSON.stringify(next)).hierarchy).toEqual(
      next.hierarchy,
    );
  });
  it('copiar é explícito, usa novos IDs e preserva dados nativos locais sem copiar aço', () => {
    const { p, draft, a, b } = fixture();
    const original = mask();
    const m = {
      ...original,
      primitives: [
        ...original.primitives,
        {
          id: 'local-line',
          closed: false,
          layer: 'LOCAL',
          points: [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
          ],
          native: {
            kind: 'line' as const,
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 1000, y: 0 },
            ],
          },
        },
      ],
      layers: { FORMA: true, LOCAL: true },
    };
    const base = importMaskBatch(p, draft, [{ mask: m, detailId: a }], context),
      next = associateMasks(base, [m.id], b, 'copy', context);
    expect(next.masks).toHaveLength(2);
    expect(next.masks[1].id).not.toBe(m.id);
    expect(next.masks[1].primitives.at(-1)?.id).not.toBe('local-line');
    expect(next.hierarchy.objectDetails[next.masks[1].id]).toBe(b);
    expect(next.masks[1].primitives).not.toBe(next.masks[0].primitives);
    expect(schedule(next)).toEqual(schedule(base));
  });
  it('não burla proteção global/local, layers de entidades e isolamento ao reassociar', () => {
    const { p, draft, a, b } = fixture(),
      m = mask();
    const base = importMaskBatch(p, draft, [{ mask: m, detailId: a }], context);
    const blocked: Project[] = [
      hideObjects(base, 'model', [m.id]),
      { ...base, masks: base.masks.map((m) => ({ ...m, visible: false })) },
      setLayerState(
        base,
        'model',
        base.masks[0].layerId ?? layerId('MASCARA'),
        { editable: false },
      ),
      setLayerState(
        base,
        'model',
        base.masks[0].primitives[0].layerId ?? layerId('MASCARA'),
        {
          capture: false,
        },
      ),
    ];
    for (const q of blocked)
      expect(() => associateMasks(q, [m.id], b, 'move', context)).toThrow(
        /ocult|proteg|layer/i,
      );
    expect(() =>
      associateMasks(base, [m.id], b, 'move', {
        key: 'model',
        scopeDetailId: a,
      }),
    ).toThrow(/isolada/);
    expect(() => associateMasks(base, ['missing'], b, 'move', context)).toThrow(
      /inexistente/,
    );
  });
  it('remove vínculos de ocultação apenas das vistas do proprietário anterior ao mover', () => {
    const { p, draft, a, b } = fixture(),
      m = mask();
    let base = importMaskBatch(p, draft, [{ mask: m, detailId: a }], context);
    base = placeDrawing(
      base,
      base.sheets[0].id,
      base.hierarchy.drawings.find((d) => d.detailId === a)!.id,
    ).project;
    const key = `view:${base.hierarchy.placements[0].id}`;
    base = hideObjects(base, key, [m.id]);
    const next = associateMasks(base, [m.id], b, 'move', context);
    expect(visibilityState(next, key).hiddenIds).toEqual([]);
    expect(visibilityState(base, key).hiddenIds).toEqual([m.id]);
    expect(next.masks).toEqual(base.masks);
    expect(
      decodeProject(JSON.stringify(next)).hierarchy.objectDetails[m.id],
    ).toBe(b);
  });
});
