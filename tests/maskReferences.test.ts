import {
  captureMaskReference,
  dimensionReferenceIssue,
} from '../src/domain/maskDimensions';
import type { Annotation } from '../src/domain/types';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  emptyProject,
  decodeProject,
  newBar,
  schedule,
} from '../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
  validateHierarchy,
} from '../src/domain/hierarchy';
import {
  appendMaskShape,
  assertLocalMaskEdit,
  createDrawingMask,
  maskDrawingState,
} from '../src/domain/maskDrawing';
import {
  alignMaskReference,
  detailMaskReferences,
  referenceMask,
  referenceMasks,
  setMaskReference,
  MASK_REFERENCE_PROJECT_SCHEMA,
} from '../src/domain/maskReferences';
import {
  assertDetailEdit,
  canEditDetailChange,
} from '../src/domain/detailEditing';
import {
  importMaskBatch,
  INDEPENDENT_MASK_DESTINATION,
} from '../src/domain/maskBatch';
import { maskPoint, parseDxf } from '../src/cad/import';
import { maskCadEntities } from '../src/domain/maskCadEditing';
import { contourMeasureCandidates } from '../src/domain/maskContourMeasure';
import { followEdges } from '../src/domain/followForm';
import { drawingPrimitives } from '../src/domain/drawingPrimitives';
import { toCsv, toDxf } from '../src/lib/exports';
import { composeSheet } from '../src/domain/paper';
import { placeDrawing } from '../src/domain/sheets';

const v = (x: number, y: number) => ({ x, y });
function fixture() {
  let p = emptyProject();
  const a = p.hierarchy.details[0].id;
  const other = createHierarchyNode(
    p,
    'detail',
    'Detalhe B',
    p.hierarchy.elements[0].id,
  );
  p = completeOwnership({
    ...other.project,
    bars: [{ ...newBar('N1'), quantity: 3 }],
  });
  const ctx = { key: 'model', detailId: a };
  for (const name of ['Fôrma A', 'Fôrma B', 'Referência adicional']) {
    const created = createDrawingMask(p, name, '', ctx);
    p = appendMaskShape(
      created.project,
      created.mask.id,
      'line',
      [v(0, 0), v(1000, 0)],
      { ...ctx, editingMaskId: created.mask.id },
      created.mask,
    );
  }
  return { p, a, b: other.id, ctx, ids: p.masks.map((m) => m.id) };
}
describe('máscaras independentes e referências por detalhamento (#213)', () => {
  it('cria e edita sem proprietário fictício ou aço; salva e reabre no formato 41', () => {
    const { p, a, ctx, ids } = fixture();
    expect(p.schema).toBe(MASK_REFERENCE_PROJECT_SCHEMA);
    expect(p.hierarchy.details).toHaveLength(2);
    expect(p.hierarchy.objectDetails[ids[0]]).toBeUndefined();
    expect(maskDrawingState(p, ids[0], ctx).editable).toBe(false);
    expect(
      maskDrawingState(p, ids[0], { ...ctx, editingMaskId: ids[0] }).editable,
    ).toBe(true);
    expect(() => validateHierarchy(p)).not.toThrow();
    const q = decodeProject(JSON.stringify(p));
    expect(q.masks).toEqual(p.masks);
    expect(q.hierarchy.objectDetails).toEqual(p.hierarchy.objectDetails);
    expect(schedule(q)[0].quantity).toBe(3);
    expect(() =>
      createDrawingMask(p, 'Nova', '', { ...ctx, scopeDetailId: a }),
    ).toThrow();
  });
  it.each(['DXF', 'DWG'] as const)(
    'importa %s sem vínculo e preserva o caminho explícito e o lote',
    (format) => {
      const { p, a, ctx } = fixture();
      const original = {
        ...parseDxf(
          readFileSync('tests/fixtures/entities-2d.dxf', 'utf8'),
          `base.${format.toLowerCase()}`,
        ),
        format,
      };
      const other = { ...original, id: 'outro-arquivo' };
      const q = importMaskBatch(
        p,
        p,
        [
          { mask: original, detailId: INDEPENDENT_MASK_DESTINATION },
          { mask: other, detailId: a },
        ],
        ctx,
      );
      expect(q.masks.find((m) => m.id === original.id)?.independent).toBe(true);
      expect(q.hierarchy.objectDetails[original.id]).toBeUndefined();
      expect(q.hierarchy.objectDetails[other.id]).toBe(a);
      expect(q.masks.find((m) => m.id === original.id)?.primitives).toEqual(
        original.primitives,
      );
      expect(decodeProject(JSON.stringify(q)).masks).toEqual(q.masks);
      expect(() =>
        importMaskBatch(
          p,
          p,
          [{ mask: original, detailId: INDEPENDENT_MASK_DESTINATION }],
          { ...ctx, scopeDetailId: a },
        ),
      ).toThrow();
    },
  );
  it('reutiliza sem cópias, troca A → B → A, mantém a adicional e isola a visibilidade', () => {
    const {
      p,
      a,
      b,
      ctx,
      ids: [ma, mb, extra],
    } = fixture();
    let q = setMaskReference(p, a, ma, 'replace');
    q = setMaskReference(q, a, extra, 'show');
    q = setMaskReference(q, b, ma, 'show');
    const bState = q.maskReferences![b];
    for (const id of [mb, ma]) {
      q = setMaskReference(q, a, id, 'replace');
      expect(detailMaskReferences(q, a).currentMaskId).toBe(id);
      expect(
        referenceMasks(q, ctx)
          .map((m) => m.id)
          .sort(),
      ).toEqual([id, extra].sort());
      expect(q.maskReferences![b]).toEqual(bState);
      expect(q.masks).toBe(p.masks);
    }
    q = setMaskReference(q, a, ma, 'hide');
    expect(referenceMask(q, a, ma)).toBeUndefined();
    expect(referenceMask(q, b, ma)).toBeDefined();
    expect(q.bars).toBe(p.bars);
    expect(decodeProject(JSON.stringify(q)).maskReferences).toEqual(
      q.maskReferences,
    );
  });
  it('atualiza candidatos de CAD, contorno e Seguir fôrma sem permitir editar a referência reutilizada', () => {
    const {
      p,
      a,
      ctx,
      ids: [ma, mb],
    } = fixture();
    const q = setMaskReference(
      setMaskReference(p, a, ma, 'replace'),
      a,
      mb,
      'replace',
    );
    expect(maskCadEntities(q, ctx).map((e) => e.mask.id)).toEqual([mb]);
    expect(contourMeasureCandidates(q, ctx).map((e) => e.mask.id)).toEqual([
      mb,
    ]);
    expect(followEdges(q, ctx).map((e) => e.maskId)).toEqual([mb]);
    expect(maskCadEntities(q, ctx).every((e) => !e.editable)).toBe(true);
    const captured = captureMaskReference(q, ctx, ma, v(0, 0), 0);
    expect(captured?.maskId).toBe(mb);
    const annotation: Annotation = {
      id: 'cota-compartilhada',
      kind: 'dimension-aligned',
      points: [v(0, 0), v(500, 0), v(250, 100)],
      maskReferences: [captured!],
      label: '50',
      textHeight: 25,
      color: '#abcdef',
    };
    const dimensioned = completeOwnership(
      { ...q, annotations: [annotation] },
      a,
    );
    expect(dimensionReferenceIssue(dimensioned, annotation)).toBeUndefined();
    expect(
      dimensionReferenceIssue(
        setMaskReference(dimensioned, a, mb, 'hide'),
        annotation,
      ),
    ).toBeUndefined();
    expect(
      referenceMasks(q, { ...ctx, scopeDetailId: 'outro-detalhamento' }),
    ).toEqual([]);
    expect(
      maskCadEntities(q, { ...ctx, scopeDetailId: 'outro-detalhamento' }),
    ).toEqual([]);
    const m = q.masks.find((m) => m.id === mb)!;
    expect(() =>
      assertLocalMaskEdit(q, m, { ...m, name: 'Novo nome' }, ctx),
    ).toThrow();
  });
  it('alinha um ponto local com escala 10 e rotação 37° uma vez, sem mover B ou o aço', () => {
    const {
      p,
      a,
      b,
      ids: [id],
    } = fixture();
    const m = {
      ...p.masks[0],
      format: 'DXF' as const,
      sourceUnit: 'cm',
      scale: 10,
      rotation: 37,
      origin: v(800, -300),
    };
    const base = { ...p, masks: [m, ...p.masks.slice(1)] };
    const before = setMaskReference(
      setMaskReference(base, a, id, 'show'),
      b,
      id,
      'show',
    );
    const local = v(23, -41);
    const q = alignMaskReference(before, a, id, local);
    const aligned = referenceMask(q, a, id)!;
    expect(maskPoint(local, aligned).x).toBeCloseTo(0, 8);
    expect(maskPoint(local, aligned).y).toBeCloseTo(0, 8);
    const r = (37 * Math.PI) / 180;
    expect(aligned.origin.x).toBeCloseTo(
      -10 * (23 * Math.cos(r) + 41 * Math.sin(r)),
      8,
    );
    expect(q.masks).toBe(before.masks);
    expect(q.bars).toBe(before.bars);
    expect(q.maskReferences![b]).toBe(before.maskReferences![b]);
    expect(q.maskReferences![a].items[0].anchor).toEqual(local);
    expect(decodeProject(JSON.stringify(q)).maskReferences).toEqual(
      q.maskReferences,
    );
    expect(canEditDetailChange(q, before, a)).toBe(true);
    expect(canEditDetailChange(before, q, a)).toBe(true);
    expect(() =>
      assertDetailEdit(before, alignMaskReference(before, b, id, local), a),
    ).toThrow();
  });
  it('preserva geometria compartilhada em todas as referências e protege isolamento de alterações globais', () => {
    const {
      p,
      a,
      b,
      ctx,
      ids: [id],
    } = fixture();
    const base = setMaskReference(
      setMaskReference(p, a, id, 'show'),
      b,
      id,
      'show',
    );
    const m = base.masks[0];
    const edited = appendMaskShape(
      base,
      id,
      'line',
      [v(0, 50), v(2000, 50)],
      { ...ctx, editingMaskId: id },
      m,
    );
    expect(referenceMask(edited, a, id)?.primitives).toBe(
      edited.masks[0].primitives,
    );
    expect(referenceMask(edited, b, id)?.primitives).toHaveLength(2);
    expect(() => assertDetailEdit(base, edited, a)).toThrow();
    expect(() =>
      assertDetailEdit(base, setMaskReference(base, a, id, 'hide'), a),
    ).not.toThrow();
    const reopened = decodeProject(JSON.stringify(base));
    const after = completeOwnership(setMaskReference(reopened, a, id, 'hide'));
    expect(after.maskReferences![b]).toBe(reopened.maskReferences![b]);
    expect(() => assertDetailEdit(reopened, after, a)).not.toThrow();
    expect(canEditDetailChange(after, reopened, a)).toBe(true);
  });
  it('preserva arquivos antigos e recusa dados novos sob cabeçalho anterior e referências inválidas', () => {
    const {
      p,
      a,
      ids: [id],
    } = fixture();
    const legacy = completeOwnership({
      ...emptyProject(),
      masks: [
        parseDxf(
          readFileSync('tests/fixtures/entities-2d.dxf', 'utf8'),
          'antigo.dxf',
        ),
      ],
    });
    expect(decodeProject(JSON.stringify(legacy))).toEqual(legacy);
    expect(
      referenceMasks(legacy, {
        key: 'model',
        detailId: legacy.hierarchy.details[0].id,
      }),
    ).toEqual(legacy.masks);
    expect(() =>
      decodeProject(JSON.stringify({ ...p, schema: 'armadurastruct/39' })),
    ).toThrow('exigem formato 41');
    const q = setMaskReference(p, a, id, 'show');
    const broken = {
      ...q,
      maskReferences: {
        [a]: {
          items: [{ maskId: 'inexistente', visible: true, origin: v(0, 0) }],
        },
      },
    };
    expect(() => decodeProject(JSON.stringify(broken))).toThrow('inexistente');
    expect(() =>
      decodeProject(
        JSON.stringify({
          ...q,
          hierarchy: {
            ...q.hierarchy,
            objectDetails: { ...q.hierarchy.objectDetails, [id]: a },
          },
        }),
      ),
    ).toThrow('independente');
    expect(() =>
      decodeProject(
        JSON.stringify({
          ...q,
          maskReferences: {
            [a]: {
              ...q.maskReferences![a],
              items: [
                ...q.maskReferences![a].items,
                ...q.maskReferences![a].items,
              ],
            },
          },
        }),
      ),
    ).toThrow('repetida');
  });
  it('edita máscaras vinculadas no espaço original, mesmo quando sua referência está alinhada', () => {
    const base = emptyProject(),
      a = base.hierarchy.details[0].id;
    const ctx = { key: 'model', detailId: a };
    const created = createDrawingMask(base, 'Vinculada', a, ctx);
    const drawn = appendMaskShape(
      created.project,
      created.mask.id,
      'line',
      [v(100, 0), v(1100, 0)],
      ctx,
      created.mask,
    );
    const aligned = alignMaskReference(drawn, a, created.mask.id, v(100, 0));
    const editing = referenceMasks(aligned, {
      ...ctx,
      editingMaskId: created.mask.id,
    });
    expect(editing[0]).toBe(aligned.masks[0]);
    expect(maskPoint(editing[0].primitives[0].points[0], editing[0])).toEqual(
      v(100, 0),
    );
    expect(
      maskPoint(
        aligned.masks[0].primitives[0].points[0],
        referenceMask(aligned, a, created.mask.id)!,
      ),
    ).toEqual(v(0, 0));
  });

  it('não muda PDF/prancha, DXF e CSV ao ligar, desligar ou alinhar referências novas', () => {
    const {
      p,
      a,
      ids: [id],
    } = fixture();
    const base = placeDrawing(
      p,
      p.sheets[0].id,
      p.hierarchy.drawings[0].id,
    ).project;
    const q = alignMaskReference(
      setMaskReference(base, a, id, 'show'),
      a,
      id,
      v(250, 30),
    );
    expect(drawingPrimitives(q)).toEqual(drawingPrimitives(base));
    expect(composeSheet(q, q.sheets[0].id)).toEqual(
      composeSheet(base, base.sheets[0].id),
    );
    expect(toDxf(q)).toBe(toDxf(base));
    expect(toCsv(q)).toBe(toCsv(base));
    expect(schedule(q)).toEqual(schedule(base));
    const deleted = completeOwnership({
      ...q,
      masks: q.masks.filter((m) => m.id !== id),
    });
    expect(deleted.maskReferences![a].items).toEqual([]);
    expect(decodeProject(JSON.stringify(deleted)).masks).toEqual(deleted.masks);
  });
});
