import { describe, expect, it } from 'vitest';
import {
  executeRebarBatch,
  applyRebarBatch,
  RebarApiError,
  REBAR_CAPABILITIES,
  type RebarCommand,
  type RebarDefinition,
  type RebarOptions,
} from '../src/api';
import { createRebarApiExample } from '../docs/examples/rebar-api';
import {
  emptyProject,
  decodeProject,
  newBar,
  schedule,
} from '../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
} from '../src/domain/hierarchy';
import { geometry } from '../src/domain/geometry';
import { duplicatePlacement, placeDrawing } from '../src/domain/sheets';
import {
  createDetailPackage,
  detailPackageProject,
} from '../src/domain/detailPackage';
import type { Project } from '../src/domain/types';

const free: RebarDefinition = {
  kind: 'free',
  diameter: 10,
  mandrel: 50,
  steel: 'CA-50',
  quantity: 3,
  points: [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
  ],
};
const stirrup: RebarDefinition = {
  kind: 'stirrup',
  diameter: 10,
  mandrel: 50,
  steel: 'CA-50',
  quantity: 4,
  width: 250,
  height: 500,
  hook: 100,
};
function create(p = emptyProject(), def: RebarDefinition = free, id = 'bar') {
  return applyRebarBatch(
    p,
    executeRebarBatch(
      p,
      [
        {
          type: 'bar.create',
          id,
          detailId: p.hierarchy.details[0].id,
          definition: def,
        },
      ],
      { units: 'mm' },
    ),
  );
}
function run(
  p: Project,
  commands: RebarCommand[],
  options: RebarOptions = { units: 'mm' },
) {
  return applyRebarBatch(p, executeRebarBatch(p, commands, options));
}
function freeze(value: any) {
  for (const v of Object.values(value))
    if (v && typeof v === 'object' && !Object.isFrozen(v)) freeze(v);
  return Object.freeze(value);
}
describe('API executável e transacional de armaduras', () => {
  it('campos opcionais undefined não apagam padrões ou valores válidos', () => {
    let p = create(emptyProject(), {
      ...free,
      mark: undefined,
      origin: undefined,
      color: undefined,
    });
    expect(p.bars[0]).toMatchObject({ mark: 'N1', origin: { x: 0, y: 0 } });
    p = run(p, [
      {
        type: 'bar.update',
        id: 'bar',
        patch: {
          kind: 'free',
          diameter: undefined,
          origin: undefined,
          quantity: 5,
        },
      },
    ]);
    expect(p.bars[0]).toMatchObject({
      diameter: 10,
      quantity: 5,
      origin: { x: 0, y: 0 },
    });
  });
  it('origem de uma posição nativa também impede duplicar aço com outro ID', () => {
    const p = create();
    const result = executeRebarBatch(
      p,
      [
        {
          type: 'bar.create',
          id: 'duplicate',
          detailId: p.hierarchy.details[0].id,
          definition: free,
          provenance: { projectId: p.id, objectId: 'bar' },
        },
      ],
      { units: 'mm' },
    );
    expect(result.issues[0]).toMatchObject({
      code: 'SOURCE_CONFLICT',
      objectId: 'duplicate',
    });
    expect(result.project).toBe(p);
    expect(
      executeRebarBatch(p, [{ type: 'bar.delete', id: 'bar' }], {
        units: 'mm',
        scopeDetailId: '',
      }).issues[0].field,
    ).toBe('scopeDetailId');
  });
  it('recusa valores finitos que produziriam overflow em geometria/quantitativos derivados', () => {
    const p = emptyProject();
    const result = executeRebarBatch(
      p,
      [
        {
          type: 'bar.create',
          id: 'overflow',
          detailId: p.hierarchy.details[0].id,
          definition: {
            ...free,
            quantity: 100000,
            points: [
              { x: 0, y: 0 },
              { x: 1e308, y: 0 },
            ],
          },
        },
      ],
      { units: 'mm' },
    );
    expect(result.issues[0]).toMatchObject({
      code: 'INVALID_GEOMETRY',
      objectId: 'overflow',
    });
    expect(result.project).toBe(p);
  });
  it('cria uma barra analítica e uma representação sem multiplicar peso ou quantidade', () => {
    const p = emptyProject(),
      before = JSON.stringify(p);
    freeze(p);
    freeze(free);
    const result = executeRebarBatch(
      p,
      [
        {
          type: 'bar.create',
          id: 'b1',
          detailId: p.hierarchy.details[0].id,
          definition: free,
        },
        {
          type: 'representation.create',
          id: 'r1',
          barId: 'b1',
          origin: { x: 0, y: -300 },
        },
      ],
      { units: 'mm' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.createdIds).toEqual(['b1', 'r1']);
    expect(result.receipt.operations).toHaveLength(2);
    expect(schedule(result.project)[0].totalLength).toBe(3);
    expect(schedule(result.project)[0].weight).toBeCloseTo(
      ((3 * Math.PI * 0.01 ** 2) / 4) * 7850,
      10,
    );
    expect(result.project.details[0].barId).toBe('b1');
    expect(JSON.stringify(p)).toBe(before);
  });
  it('gancho e bitola atualizam o mesmo estribo, rebatimentos, vistas e quantitativo', () => {
    let p = create(emptyProject(), stirrup);
    p = run(p, [
      {
        type: 'representation.create',
        id: 'r',
        barId: 'bar',
        origin: { x: 0, y: -300 },
      },
    ]);
    p = placeDrawing(p, p.sheets[0].id, p.hierarchy.drawings[0].id).project;
    p = duplicatePlacement(p, p.hierarchy.placements[0].id).project;
    const views = structuredClone(p.hierarchy.placements);
    const result = executeRebarBatch(
      p,
      [
        {
          type: 'bar.update',
          id: 'bar',
          patch: { kind: 'stirrup', hook: 120, diameter: 12.5 },
        },
      ],
      { units: 'mm' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const q = result.project,
      r = (50 + 12.5) / 2;
    const expected =
      2 * (250 + 500) +
      2 * 120 -
      2 * r * Math.tan((3 * Math.PI) / 8) -
      6 * r +
      3 * Math.PI * r;
    expect(geometry(q.bars[0]).length).toBeCloseTo(expected, 10);
    expect(schedule(q)[0].weight).toBeCloseTo(
      (((expected / 1000) * 4 * Math.PI * 0.0125 ** 2) / 4) * 7850,
      10,
    );
    expect(q.bars[0].id).toBe('bar');
    expect(q.details).toEqual(p.details);
    expect(q.hierarchy.placements).toEqual(views);
    expect(result.receipt.affectedViews).toEqual(views.map((v) => v.id));
    expect(result.receipt.steelChanged).toBe(true);
    expect(
      run(p, [
        {
          type: 'bar.update',
          id: 'bar',
          patch: { kind: 'stirrup', hook: 120 },
        },
      ]).bars[0],
    ).toMatchObject({ id: 'bar', hook: 120 });
    expect(
      geometry(
        run(p, [
          {
            type: 'bar.update',
            id: 'bar',
            patch: { kind: 'stirrup', hook: 120 },
          },
        ]).bars[0],
      ).length - geometry(p.bars[0]).length,
    ).toBeCloseTo(40, 10);
  });
  it('qualquer falha no lote devolve a instância original sem objetos ou IDs parciais', () => {
    const p = create(),
      before = JSON.stringify(p);
    freeze(p);
    const result = executeRebarBatch(
      p,
      [
        { type: 'bar.update', id: 'bar', patch: { kind: 'free', quantity: 9 } },
        {
          type: 'bar.create',
          id: 'valid',
          detailId: p.hierarchy.details[0].id,
          definition: free,
        },
        {
          type: 'bar.create',
          id: 'invalid',
          detailId: p.hierarchy.details[0].id,
          definition: {
            ...free,
            points: [
              { x: 0, y: 0 },
              { x: 0, y: 0 },
            ],
          },
        },
      ],
      { units: 'mm' },
    );
    expect(result.ok).toBe(false);
    expect(result.project).toBe(p);
    expect(JSON.stringify(p)).toBe(before);
    expect(result.issues[0]).toMatchObject({
      code: 'INVALID_GEOMETRY',
      objectId: 'invalid',
      field: 'points',
      operationIndex: 2,
    });
    expect(() => applyRebarBatch(p, result)).toThrow(RebarApiError);
  });
  it('retorna erros úteis para tipo incompatível, ID inexistente, unidade e versão', () => {
    const p = create();
    const invalid = (commands: unknown[], options: unknown = { units: 'mm' }) =>
      executeRebarBatch(p, commands as RebarCommand[], options as RebarOptions);
    expect(
      invalid([
        { type: 'bar.update', id: 'bar', patch: { kind: 'stirrup', hook: 20 } },
      ]).issues[0],
    ).toMatchObject({
      code: 'FAMILY_MISMATCH',
      objectId: 'bar',
      field: 'patch.kind',
    });
    expect(
      invalid([
        { type: 'bar.update', id: 'bar', patch: { kind: 'free', hook: 20 } },
      ]).issues[0],
    ).toMatchObject({
      code: 'INVALID_FIELD',
      objectId: 'bar',
      field: 'patch.hook',
    });
    expect(
      invalid([
        {
          type: 'bar.update',
          id: 'missing',
          patch: { kind: 'free', quantity: 4 },
        },
      ]).issues[0],
    ).toMatchObject({ code: 'NOT_FOUND', objectId: 'missing', field: 'id' });
    expect(
      invalid([{ type: 'bar.delete', id: 'bar' }], { units: 'cm' }).issues[0],
    ).toMatchObject({ code: 'UNSUPPORTED_UNIT', field: 'units' });
    expect(
      invalid([{ type: 'bar.delete', id: 'bar' }], {
        units: 'mm',
        apiVersion: '99',
      }).issues[0],
    ).toMatchObject({ code: 'UNSUPPORTED_VERSION', field: 'apiVersion' });
  });
  it('recusa IDs globais/marcas duplicadas e origem já existente', () => {
    const p = create(),
      detailId = p.hierarchy.details[0].id;
    const result = (id: string, definition = free) =>
      executeRebarBatch(p, [{ type: 'bar.create', id, detailId, definition }], {
        units: 'mm',
      });
    expect(result(detailId).issues[0].code).toBe('ID_CONFLICT');
    expect(result('other', { ...free, mark: 'N1' }).issues[0].code).toBe(
      'MARK_CONFLICT',
    );
    const withSource = run(p, [
      {
        type: 'bar.create',
        id: 'imported',
        detailId,
        definition: free,
        provenance: { projectId: 'external', objectId: 'b1' },
      },
    ]);
    expect(
      executeRebarBatch(
        withSource,
        [
          {
            type: 'bar.create',
            detailId,
            definition: free,
            provenance: { projectId: 'external', objectId: 'b1' },
          },
        ],
        { units: 'mm' },
      ).issues[0].code,
    ).toBe('SOURCE_CONFLICT');
  });
  it('associa faixa com arredondamento de espaçamento, mantém uma posição e remove a faixa sem retirar aço', () => {
    let p = create();
    p = run(p, [
      {
        type: 'distribution.set',
        barId: 'bar',
        distribution: { end: { x: 1000, y: 0 }, render: 'bars' },
        count: { mode: 'spacing', spacing: 150 },
      },
    ]);
    expect(p.bars[0].quantity).toBe(8);
    expect(schedule(p)).toHaveLength(1);
    expect(schedule(p)[0].totalLength).toBe(8);
    const moved = run(p, [
      { type: 'bar.move', id: 'bar', delta: { x: 500, y: 100 } },
    ]);
    expect(moved.bars[0].origin).toEqual({ x: 500, y: 100 });
    expect(moved.bars[0].distribution!.end).toEqual({ x: 1500, y: 100 });
    const q = run(moved, [{ type: 'distribution.remove', barId: 'bar' }]);
    expect(q.bars[0].quantity).toBe(8);
    expect(q.bars[0].distribution).toBeUndefined();
    const bad = executeRebarBatch(
      q,
      [
        {
          type: 'distribution.set',
          barId: 'bar',
          distribution: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
          count: { mode: 'quantity', quantity: 4 },
        },
      ],
      { units: 'mm' },
    );
    expect(bad.ok).toBe(false);
    expect(bad.issues[0].code).toBe('INVALID_DISTRIBUTION');
  });
  it('preserva vínculos ao editar/reatribuir representações e exige política de exclusão física explícita', () => {
    let p = create();
    p = create(p, stirrup, 'other');
    p = run(p, [
      {
        type: 'representation.create',
        id: 'r',
        barId: 'bar',
        origin: { x: 0, y: -300 },
      },
    ]);
    const blocked = executeRebarBatch(p, [{ type: 'bar.delete', id: 'bar' }], {
      units: 'mm',
    });
    expect(blocked.issues[0].code).toBe('REFERENCE_IN_USE');
    p = run(p, [
      {
        type: 'representation.update',
        id: 'r',
        barId: 'other',
        origin: { x: 100, y: 100 },
      },
      { type: 'bar.delete', id: 'bar' },
    ]);
    expect(p.details[0]).toEqual({
      id: 'r',
      barId: 'other',
      origin: { x: 100, y: 100 },
    });
    const q = run(p, [
      { type: 'bar.delete', id: 'other', references: 'remove' },
    ]);
    expect(q.bars).toEqual([]);
    expect(q.details).toEqual([]);
    expect(q.hierarchy.objectDetails).toEqual({});
  });
  it('protege outros detalhamentos durante criação/edição/exclusão e preserva o projeto após falha', () => {
    const p = create(),
      main = p.hierarchy.details[0].id;
    const other = createHierarchyNode(
      p,
      'detail',
      'Outro',
      p.hierarchy.elements[0].id,
    );
    const q = create(other.project, free, 'foreign');
    const scoped = executeRebarBatch(
      q,
      [{ type: 'bar.update', id: 'bar', patch: { kind: 'free', quantity: 9 } }],
      { units: 'mm', scopeDetailId: other.id },
    );
    expect(scoped.issues[0].code).toBe('SCOPE_VIOLATION');
    expect(scoped.project).toBe(q);
    const allowed = executeRebarBatch(
      q,
      [{ type: 'bar.create', detailId: main, definition: free }],
      { units: 'mm', scopeDetailId: main },
    );
    expect(allowed.ok).toBe(true);
  });
  it('preserva RA bloqueada por padrão e invalida somente quando solicitado e permitido pelo escopo', () => {
    const p = create();
    p.scheduleLock = { at: 'locked', bars: structuredClone(p.bars) };
    const command: RebarCommand = {
      type: 'bar.update',
      id: 'bar',
      patch: { kind: 'free', quantity: 8 },
    };
    const kept = executeRebarBatch(p, [command], { units: 'mm' });
    expect(kept.ok).toBe(true);
    if (kept.ok) {
      expect(kept.project.scheduleLock).toEqual(p.scheduleLock);
      expect(kept.receipt.scheduleDirty).toBe(true);
    }
    const cleared = executeRebarBatch(p, [command], {
      units: 'mm',
      schedule: 'invalidate-lock',
    });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.project.scheduleLock).toBeUndefined();
      expect(cleared.receipt.scheduleInvalidated).toBe(true);
    }
    expect(
      executeRebarBatch(p, [command], {
        units: 'mm',
        schedule: 'invalidate-lock',
        scopeDetailId: p.hierarchy.details[0].id,
      }).issues[0].code,
    ).toBe('SCOPE_VIOLATION');
  });
  it('reusa divisão/união sem duplicar quantidades e copia com ID e origem física novos', () => {
    let p = create();
    p = run(p, [{ type: 'bar.split', id: 'bar', station: 500, lap: 0 }]);
    expect(p.bars).toHaveLength(2);
    expect(schedule(p).reduce((n, r) => n + r.totalLength, 0)).toBe(3);
    p = run(p, [
      { type: 'bar.join', ids: [p.bars[0].id, p.bars[1].id] },
      { type: 'bar.copy', id: 'bar', newId: 'copy', delta: { x: 0, y: 500 } },
    ]);
    expect(p.bars).toHaveLength(2);
    expect(p.bars[1]).toMatchObject({ id: 'copy', origin: { x: 0, y: 500 } });
    expect(schedule(p).reduce((n, r) => n + r.totalLength, 0)).toBe(6);
    p = run(p, [
      { type: 'bar.transform', id: 'bar', operation: 'mirror' },
      { type: 'bar.renumber' },
    ]);
    expect(p.bars.map((b) => b.mark)).toEqual(['N2', 'N1']);
  });
  it('rejeita aplicação de um lote executado sobre um estado anterior', () => {
    const p = create(),
      result = executeRebarBatch(
        p,
        [
          {
            type: 'bar.update',
            id: 'bar',
            patch: { kind: 'free', quantity: 8 },
          },
        ],
        { units: 'mm' },
      );
    expect(() => applyRebarBatch({ ...p }, result)).toThrow(/mudou/);
    expect(() => applyRebarBatch({ ...p }, result)).toThrow(RebarApiError);
  });
  it('exemplo executável reabre com os mesmos quantitativos e reutiliza o pacote AS-09', () => {
    const { project, result } = createRebarApiExample();
    expect(result.ok).toBe(true);
    expect(project.bars.map((b) => b.quantity)).toEqual([3, 8]);
    expect(decodeProject(JSON.stringify(project))).toEqual(project);
    const pack = createDetailPackage(project, project.hierarchy.details[0].id, {
      producer: {
        app: 'Gerador OpenStruct',
        version: REBAR_CAPABILITIES.version,
      },
    });
    expect(schedule(detailPackageProject(pack)).map((r) => r.weight)).toEqual(
      schedule(project).map((r) => r.weight),
    );
  });
  it('permite abrir legado inválido e rejeita alterações físicas inválidas sem impedir sua correção completa', () => {
    const p = completeOwnership({
      ...emptyProject(),
      bars: [
        {
          ...newBar('N1'),
          id: 'legacy',
          points: [
            { x: 0, y: 0 },
            { x: 0, y: 0 },
          ],
        },
      ],
    });
    expect(decodeProject(JSON.stringify(p)).bars).toHaveLength(1);
    expect(
      executeRebarBatch(
        p,
        [
          {
            type: 'bar.update',
            id: 'legacy',
            patch: { kind: 'free', quantity: 8 },
          },
        ],
        { units: 'mm' },
      ).issues[0].code,
    ).toBe('INVALID_GEOMETRY');
    const fixed = run(p, [
      {
        type: 'bar.update',
        id: 'legacy',
        patch: {
          kind: 'free',
          points: [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
          ],
        },
      },
    ]);
    expect(geometry(fixed.bars[0]).errors).toEqual([]);
  });
});
