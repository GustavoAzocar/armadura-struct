import { describe, expect, it } from 'vitest';
import {
  editVertices,
  editablePath,
  vertexEditAt,
} from '../src/domain/vertices';
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
import { geometry, world } from '../src/domain/geometry';
import { executeRebarBatch } from '../src/domain/rebarApi';
import { representationPoints } from '../src/domain/representations';
import { setLayerState } from '../src/domain/layerProfiles';
import { hideObjects } from '../src/domain/visibility';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import { setDetailRepetition } from '../src/domain/detailRepetition';
import { groupFabrication } from '../src/domain/fabrication';
import { toDxf, toPdf } from '../src/lib/exports';
function fixture() {
  return completeOwnership({
    ...emptyProject(),
    bars: [{ ...newBar('N1'), id: 'a', quantity: 8 }],
    details: [
      {
        id: 'rep',
        barId: 'a',
        origin: { x: 2000, y: 1000 },
        rotation: 30,
        scale: 2,
      },
    ],
    annotations: [
      {
        id: 'call',
        kind: 'leader',
        barId: 'a',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: -100 },
          { x: 1000, y: -100 },
        ],
        label: '',
        textHeight: 40,
        color: '#777777',
      },
    ],
    polylines: [
      {
        id: 'line',
        closed: false,
        points: [
          { x: 0, y: 2000 },
          { x: 1000, y: 2000 },
        ],
        color: '#777777',
      },
    ],
  });
}
describe('AS-25 · vértices estáveis e geometria física', () => {
  it('continua 300 mm sem recriar posição; colinear conserva comprimento e remapeia segmentos', () => {
    const p = fixture(),
      before = JSON.stringify(p),
      q = editVertices(p, 'a', {
        kind: 'extend',
        end: 'end',
        point: { x: 1300, y: 0 },
      });
    expect(q.project.bars[0].id).toBe('a');
    expect(q.project.bars[0].mark).toBe('N1');
    expect(geometry(q.project.bars[0]).length).toBe(1300);
    expect(q.vertexMap).toEqual([0, 1]);
    expect(q.segmentMap).toEqual([[0]]);
    const r = editVertices(p, 'a', {
      kind: 'insert',
      segment: 0,
      point: { x: 400, y: 0 },
    });
    expect(geometry(r.project.bars[0]).length).toBe(1000);
    expect(r.vertexMap).toEqual([0, 2]);
    expect(r.segmentMap).toEqual([[0, 1]]);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('dobra de 90° usa o raio da linha média; comprimento e peso atualizam todas as inserções', () => {
    const p = fixture(),
      q = editVertices(p, 'a', {
        kind: 'extend',
        end: 'end',
        point: { x: 1000, y: 300 },
      }).project;
    const radius = (p.bars[0].mandrel + p.bars[0].diameter) / 2,
      expected = 1300 - 2 * radius + (Math.PI * radius) / 2;
    expect(geometry(q.bars[0]).length).toBeCloseTo(expected, 9);
    expect(schedule(q)[0].quantity).toBe(8);
    expect(schedule(q)[0].weight / schedule(p)[0].weight).toBeCloseTo(
      expected / 1000,
    );
    expect(q.details).toEqual(p.details);
    expect(q.annotations[0].barId).toBe('a');
    expect(representationPoints(q.bars[0], q.details[0])).not.toEqual(
      representationPoints(p.bars[0], p.details[0]),
    );
    expect(toDxf(q)).toContain('N1');
    expect(toPdf(q).length).toBeGreaterThan(1000);
  });
  it('continuação na ponta inicial de barra girada converte coordenadas do mundo para locais uma vez', () => {
    const p = fixture();
    p.bars[0] = { ...p.bars[0], origin: { x: 400, y: 500 }, rotation: 90 };
    const q = editVertices(p, 'a', {
      kind: 'extend',
      end: 'start',
      point: { x: 400, y: 200 },
    });
    const v = world(q.project.bars[0].points[0], q.project.bars[0]);
    expect(v.x).toBeCloseTo(400);
    expect(v.y).toBeCloseTo(200);
    expect(geometry(q.project.bars[0]).length).toBeCloseTo(1300);
    expect(q.vertexMap).toEqual([1, 2]);
    expect(q.segmentMap).toEqual([[1]]);
    expect(q.project.bars[0].origin).toEqual(p.bars[0].origin);
  });
  it('remoção recompõe comprimento e retorna mapas de nó removido, fusão e segmento perdido', () => {
    const p = editVertices(fixture(), 'a', {
      kind: 'insert',
      segment: 0,
      point: { x: 500, y: 0 },
    }).project;
    const middle = editVertices(p, 'a', { kind: 'remove', vertex: 1 });
    expect(middle.vertexMap).toEqual([0, null, 1]);
    expect(middle.segmentMap).toEqual([[0], [0]]);
    expect(middle.warnings).not.toHaveLength(0);
    expect(geometry(middle.project.bars[0]).length).toBe(1000);
    const start = editVertices(p, 'a', { kind: 'remove', vertex: 0 });
    expect(start.segmentMap).toEqual([[], [0]]);
    expect(geometry(start.project.bars[0]).length).toBe(500);
  });
  it('rejeita degenerações, retornos, dobra sem espaço, família paramétrica e menos de dois pontos', () => {
    const p = fixture(),
      before = JSON.stringify(p);
    expect(() => editVertices(p, 'a', { kind: 'remove', vertex: 0 })).toThrow(
      /dois/,
    );
    expect(() =>
      editVertices(p, 'a', {
        kind: 'extend',
        end: 'end',
        point: { x: 1000, y: 0 },
      }),
    ).toThrow(/coincidir/);
    expect(() =>
      editVertices(p, 'a', {
        kind: 'extend',
        end: 'end',
        point: { x: 900, y: 0 },
      }),
    ).toThrow(/180/);
    expect(() =>
      editVertices(p, 'a', {
        kind: 'extend',
        end: 'end',
        point: { x: 1000, y: 5 },
      }),
    ).toThrow(/insuficiente/);
    expect(() =>
      editVertices(p, 'a', {
        kind: 'insert',
        segment: 2,
        point: { x: 100, y: 0 },
      }),
    ).toThrow(/inexistente/);
    expect(() =>
      editablePath({ ...p, bars: [{ ...p.bars[0], kind: 'stirrup' }] }, 'a'),
    ).toThrow(/paramétrico/);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('não permite remover canto se o resultado criar retorno impossível', () => {
    const p = fixture();
    p.bars[0].points = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 500 },
      { x: 500, y: 0 },
    ];
    expect(geometry(p.bars[0]).errors).toEqual([]);
    expect(() => editVertices(p, 'a', { kind: 'remove', vertex: 2 })).toThrow(
      /180/,
    );
  });
  it('polilinhas fechadas aceitam inserção no fechamento e remoção com mapa circular, sem aço adicional', () => {
    const p = fixture();
    p.polylines[0] = {
      ...p.polylines[0],
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1000 },
      ],
    };
    const q = editVertices(p, 'line', {
      kind: 'insert',
      segment: 2,
      point: { x: 500, y: 500 },
    });
    expect(q.segmentMap).toEqual([[0], [1], [2, 3]]);
    const r = editVertices(q.project, 'line', { kind: 'remove', vertex: 0 });
    expect(r.segmentMap).toEqual([[2], [0], [1], [2]]);
    expect(() =>
      editVertices(p, 'line', { kind: 'remove', vertex: 0 }),
    ).toThrow(/três/);
    expect(() =>
      editVertices(p, 'line', {
        kind: 'extend',
        end: 'end',
        point: { x: 0, y: 100 },
      }),
    ).toThrow(/fechada/);
    expect(schedule(r.project)).toEqual(schedule(p));
    expect(vertexEditAt(p, 'line', 'insert', { x: 500, y: 499 })).toMatchObject(
      { segment: 2 },
    );
    expect(vertexEditAt(p, 'line', 'remove', { x: 1001, y: 998 })).toEqual({
      kind: 'remove',
      vertex: 2,
    });
  });
  it('API usa lote atômico, invalida RA física e preserva vínculo e persistência', () => {
    const p = fixture();
    p.scheduleLock = createScheduleLock(p);
    const commands = [
      {
        type: 'vertices.edit' as const,
        id: 'a',
        edit: {
          kind: 'extend' as const,
          end: 'end' as const,
          point: { x: 1300, y: 0 },
        },
      },
    ];
    const ok = executeRebarBatch(p, commands, {
      units: 'mm',
      schedule: 'invalidate-lock',
    });
    expect(ok.ok).toBe(true);
    if (ok.ok)
      expect(ok.receipt.operations[0].topology).toEqual({
        vertexMap: [0, 1],
        segmentMap: [[0]],
        warnings: [],
      });
    expect(ok.project.scheduleLock).toBeUndefined();
    expect(decodeProject(JSON.stringify(ok.project))).toEqual(ok.project);
    expect(ok.project.hierarchy.objectDetails).toEqual(
      p.hierarchy.objectDetails,
    );
    const bad = executeRebarBatch(
      p,
      [...commands, { ...commands[0], edit: { kind: 'remove', vertex: 999 } }],
      { units: 'mm', schedule: 'invalidate-lock' },
    );
    expect(bad.ok).toBe(false);
    expect(bad.project).toBe(p);
    const locked = setLayerState(p, 'model', 'layer:ARMADURAS', {
      editable: false,
    });
    expect(
      executeRebarBatch(locked, commands, {
        units: 'mm',
        schedule: 'invalidate-lock',
      }).project,
    ).toBe(locked);
    const hidden = hideObjects(p, 'model', ['a']);
    expect(
      executeRebarBatch(hidden, commands, {
        units: 'mm',
        schedule: 'invalidate-lock',
      }).ok,
    ).toBe(false);
  });
  it('faixas, multiplicador e repetição permanecem únicos; uma variante se separa da fabricação equivalente', () => {
    let p = fixture();
    p.bars[0] = {
      ...p.bars[0],
      quantity: 2,
      multiplier: 3,
      quantitySource: { kind: 'distribution', mode: 'quantity' },
      distribution: { start: { x: 0, y: 0 }, end: { x: 0, y: 300 } },
    };
    p = completeOwnership({
      ...p,
      bars: [
        ...p.bars,
        { ...p.bars[0], id: 'b', mark: 'N2', origin: { x: 2000, y: 0 } },
      ],
    });
    p = setDetailRepetition(p, p.hierarchy.objectDetails.a, {
      factor: 4,
      elements: [],
    });
    p = groupFabrication(p, ['a', 'b'], 'a');
    const r = executeRebarBatch(
      p,
      [
        {
          type: 'vertices.edit',
          id: 'a',
          edit: { kind: 'extend', end: 'end', point: { x: 1300, y: 0 } },
        },
      ],
      { units: 'mm' },
    );
    expect(r.ok).toBe(true);
    expect(
      schedule(r.project)
        .map((v) => v.quantity)
        .sort(),
    ).toEqual([24, 24]);
    expect(r.project.bars[0].distribution).toEqual(p.bars[0].distribution);
    expect(r.project.bars[1]).toEqual(p.bars[1]);
    expect(new Set(r.project.bars.map((v) => v.mark)).size).toBe(2);
    expect(r.project.details[0].barId).toBe('a');
  });
  it('edição isolada protege o outro detalhamento e o limite de 500 pontos é explícito', () => {
    let p = fixture();
    const made = createHierarchyNode(
      p,
      'detail',
      'Outro',
      p.hierarchy.elements[0].id,
    );
    p = moveObjectsToDetail(made.project, ['line'], made.id);
    expect(() =>
      editVertices(
        p,
        'line',
        { kind: 'extend', end: 'end', point: { x: 1300, y: 2000 } },
        { scopeDetailId: p.hierarchy.objectDetails.a },
      ),
    ).toThrow(/isolada/);
    p.bars[0].points = Array.from({ length: 500 }, (_, i) => ({
      x: i * 100,
      y: 0,
    }));
    expect(() =>
      editVertices(p, 'a', {
        kind: 'extend',
        end: 'end',
        point: { x: 50000, y: 0 },
      }),
    ).toThrow(/Limite/);
  });
  it.each(['mm', 'cm', 'm'] as const)(
    'pacote v10 em %s preserva nova geometria e referências sem nova migração',
    (unit) => {
      const p = editVertices(fixture(), 'a', {
        kind: 'extend',
        end: 'end',
        point: { x: 1000, y: 300 },
      }).project;
      const pack = createDetailPackage(p, p.hierarchy.objectDetails.a, {
          producer: { app: 'AS25', version: '1' },
          unit,
        }),
        q = readDetailPackage(pack).project;
      expect(q.bars[0]).toEqual(p.bars[0]);
      expect(q.details).toEqual(p.details);
      expect(schedule(q)).toEqual(schedule(p));
    },
  );
});
