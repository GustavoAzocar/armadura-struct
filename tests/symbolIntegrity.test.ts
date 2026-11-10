import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { maskManipFixture } from './fixtures/maskManipulation';
import { maskCadEntities } from '../src/domain/maskCadEditing';
import {
  completeOwnership,
  createHierarchyNode,
} from '../src/domain/hierarchy';
import { assertLayerEdit, setLayerState } from '../src/domain/layerProfiles';
import { assertVisibilityEdit, hideObjects } from '../src/domain/visibility';
import { assertDetailEdit } from '../src/domain/detailEditing';
import { validateRebarChange } from '../src/domain/rebarApi';
import {
  applyDetailTransfer,
  previewDetailTransfer,
} from '../src/domain/detailTransfer';
import { emptyProject, decodeProject } from '../src/domain/model';
import { SymbolPreview } from '../src/components/SymbolLibraryDialog';
import {
  applySymbolCreation,
  previewSymbolCreation,
  applySymbolInsertion,
  previewSymbolInsertion,
  applySymbolEdit,
  previewSymbolEdit,
  validateSymbolPrimitives,
  symbolRenderMasks,
} from '../src/domain/symbols';
import type { Project, Primitive } from '../src/domain/types';

const ctx = (p: Project) => ({
  key: 'model',
  detailId: p.hierarchy.objectDetails[p.masks[0].id],
});
const refs = (p: Project) =>
  maskCadEntities(p, ctx(p))
    .filter((e) => e.mask.id === p.masks[0].id)
    .map((e) => e.ref);
function library() {
  const p = maskManipFixture();
  return applySymbolCreation(
    p,
    previewSymbolCreation(
      p,
      {
        maskId: p.masks[0].id,
        refs: refs(p),
        name: 'Review',
        base: { x: 0, y: 0 },
      },
      ctx(p),
    ),
    ctx(p),
  );
}
function insert(p: Project, context = ctx(p)) {
  return applySymbolInsertion(
    p,
    previewSymbolInsertion(
      p,
      p.symbols![0].id,
      {
        origin: { x: 5000, y: 0 },
        rotation: 0,
        scale: 1,
      },
      'instance',
      context,
      { layerId: p.layers[0].id },
    ),
    context,
  );
}
function commitGuards(before: Project, after: Project, scope?: string) {
  assertVisibilityEdit(before, after, 'model');
  assertLayerEdit(before, after, 'model');
  const complete = completeOwnership(after, ctx(before).detailId);
  const issues = validateRebarChange(before, complete);
  if (issues.length) throw new Error(JSON.stringify(issues));
  if (scope) assertDetailEdit(before, complete, scope);
  return complete;
}
function edited(p: Project, scope?: string) {
  const context = { ...ctx(p), ...(scope ? { scopeDetailId: scope } : {}) };
  return applySymbolEdit(
    p,
    previewSymbolEdit(
      p,
      p.symbols![0].id,
      {
        geometry: {
          maskId: p.masks[0].id,
          refs: refs(p).slice(0, 1),
          base: { x: 0, y: 0 },
        },
      },
      context,
    ),
    context,
  );
}
const geometryCandidate = (p: Project): Project => ({
  ...p,
  symbols: p.symbols!.map((d) => ({
    ...d,
    revision: d.revision + 1,
    primitives: d.primitives.slice(0, 1),
  })),
});
describe('Integridade dos símbolos nos fluxos compartilhados', () => {
  it('impede alterar a geometria de uma instância em layer bloqueado pela definição compartilhada', () => {
    const p = setLayerState(insert(library()), 'model', 'layer:ARMADURAS', {
      editable: false,
    });
    expect(() => edited(p)).toThrow(/Layer protegido/);
    const next = geometryCandidate(p);
    expect(symbolRenderMasks(next)[0].primitives).not.toEqual(
      symbolRenderMasks(p)[0].primitives,
    );
    expect(() => commitGuards(p, next)).toThrow();
  });
  it('impede a edição isolada de alterar uma instância em outro detalhamento pela definição compartilhada', () => {
    const lib = library();
    const { project: extended, id: other } = createHierarchyNode(
      lib,
      'detail',
      'Outro',
      lib.hierarchy.elements[0].id,
    );
    const p = insert(extended, { key: 'model', detailId: other });
    const scope = ctx(p).detailId;
    expect(() => edited(p, scope)).toThrow(/edição isolada/);
    const next = geometryCandidate(p);
    expect(symbolRenderMasks(next)[0].primitives).not.toEqual(
      symbolRenderMasks(p)[0].primitives,
    );
    expect(() => commitGuards(p, next, scope)).toThrow();
  });
  it('protege instâncias ocultas por objeto ao editar a definição', () => {
    const lib = insert(library());
    const p = hideObjects(lib, 'model', [lib.symbolInstances![0].id]);
    expect(() => edited(p)).toThrow(/Objeto oculto/);
    expect(() => commitGuards(p, geometryCandidate(p))).toThrow(
      /Objeto oculto/,
    );
  });
  it.each(['visible', 'capture', 'editable'] as const)(
    'recusa cópia independente quando %s do layer de destino está desligado',
    (field) => {
      const p = setLayerState(library(), 'model', 'layer:DESENHO', {
        [field]: false,
      });
      expect(() => {
        const plan = previewSymbolInsertion(
          p,
          p.symbols![0].id,
          {
            origin: { x: 5000, y: 0 },
            rotation: 0,
            scale: 1,
          },
          'copy',
          ctx(p),
          { maskId: p.masks[0].id, layerId: 'layer:ARMADURAS' },
        );
        const next = applySymbolInsertion(p, plan, ctx(p));
        expect(next.masks[0].primitives.at(-1)!.layerId).toBe('layer:DESENHO');
        commitGuards(p, next);
      }).toThrow(/Layer do desenho local/);
    },
  );
  it('recusa cópia independente em camada local oculta mesmo com outro layer escolhido', () => {
    const p = library();
    p.masks[0].layers.DESENHO = false;
    expect(() =>
      previewSymbolInsertion(
        p,
        p.symbols![0].id,
        {
          origin: { x: 5000, y: 0 },
          rotation: 0,
          scale: 1,
        },
        'copy',
        ctx(p),
        { maskId: p.masks[0].id, layerId: 'layer:ARMADURAS' },
      ),
    ).toThrow(/Layer do desenho local/);
  });
  it('cópia usa o layer do desenho local mesmo se o layer anteriormente escolhido para instância estiver bloqueado', () => {
    const p = setLayerState(library(), 'model', 'layer:ARMADURAS', {
      editable: false,
    });
    const plan = previewSymbolInsertion(
      p,
      p.symbols![0].id,
      {
        origin: { x: 5000, y: 0 },
        rotation: 0,
        scale: 1,
      },
      'copy',
      ctx(p),
      { maskId: p.masks[0].id, layerId: 'layer:ARMADURAS' },
    );
    expect(plan.layerId).toBe('layer:DESENHO');
    const next = applySymbolInsertion(p, plan, ctx(p));
    expect(() => commitGuards(p, next)).not.toThrow();
    expect(next.masks[0].primitives).toHaveLength(
      p.masks[0].primitives.length + 3,
    );
  });
  it('transferir um detalhamento de um projeto nativo preserva seus símbolos', () => {
    const source = insert(library());
    const target = emptyProject();
    const plan = previewDetailTransfer(target, source, {
      mode: 'insert',
      sourceDetailId: ctx(source).detailId,
      targetElementId: target.hierarchy.elements[0].id,
    });
    expect(plan.issues).toEqual([]);
    expect(plan.project).toBeDefined();
    expect(plan.warnings.join(' ')).not.toMatch(/símbolo/i);
    expect(plan.project!.symbolInstances).toHaveLength(1);
    const transferred = plan.project!.symbolInstances![0];
    expect(transferred.id).not.toBe(source.symbolInstances![0].id);
    expect(plan.project!.hierarchy.objectDetails[transferred.id]).toBe(
      plan.targetDetailId,
    );
    expect(plan.project!.symbols).toHaveLength(1);
    expect(plan.project!.symbols![0].id).toBe(transferred.definitionId);
    expect(decodeProject(JSON.stringify(plan.project)).symbolInstances).toEqual(
      plan.project!.symbolInstances,
    );
    expect(
      symbolRenderMasks(plan.project!)[0].primitives.map((q) => q.points),
    ).toEqual(symbolRenderMasks(source)[0].primitives.map((q) => q.points));
  });
  it('transferência não importa definições sem uso nem altera o projeto de origem', () => {
    const p = insert(library());
    const source = applySymbolCreation(
      p,
      previewSymbolCreation(
        p,
        {
          maskId: p.masks[0].id,
          refs: refs(p),
          name: 'Sem uso',
          base: { x: 0, y: 0 },
        },
        ctx(p),
      ),
      ctx(p),
    );
    const snapshot = JSON.stringify(source);
    const target = emptyProject();
    const plan = previewDetailTransfer(target, source, {
      mode: 'insert',
      sourceDetailId: ctx(source).detailId,
      targetElementId: target.hierarchy.elements[0].id,
    });
    expect(plan.issues).toEqual([]);
    expect(plan.project!.symbols).toHaveLength(1);
    expect(plan.project!.symbols![0].name).toBe('Review');
    expect(JSON.stringify(source)).toBe(snapshot);
  });
  it('duas instâncias transferidas compartilham uma definição; atualizar preserva seus IDs', () => {
    const source = insert(insert(library()));
    const target = emptyProject();
    const plan = previewDetailTransfer(target, source, {
      mode: 'insert',
      sourceDetailId: ctx(source).detailId,
      targetElementId: target.hierarchy.elements[0].id,
    });
    expect(plan.issues).toEqual([]);
    const imported = applyDetailTransfer(target, plan);
    expect(imported.symbolInstances).toHaveLength(2);
    expect(imported.symbols).toHaveLength(1);
    expect(
      new Set(imported.symbolInstances!.map((i) => i.definitionId)).size,
    ).toBe(1);
    const updated = previewDetailTransfer(imported, source, {
      mode: 'replace',
      sourceDetailId: ctx(source).detailId,
      targetDetailId: plan.targetDetailId,
    });
    expect(updated.issues).toEqual([]);
    expect(updated.project!.symbolInstances!.map((i) => i.id)).toEqual(
      imported.symbolInstances!.map((i) => i.id),
    );
    expect(updated.project!.symbols).toHaveLength(1);
  });
  it('transferência renomeia definições conflitantes e preserva as instâncias locais', () => {
    const source = insert(library());
    const target = insert(library());
    target.symbols![0].category = 'Local';
    const plan = previewDetailTransfer(target, source, {
      mode: 'insert',
      sourceDetailId: ctx(source).detailId,
      targetElementId: target.hierarchy.elements[0].id,
    });
    expect(plan.issues).toEqual([]);
    expect(plan.project!.symbols!.map((d) => d.name)).toEqual([
      'Review',
      'Review (2)',
    ]);
    expect(plan.project!.symbolInstances).toHaveLength(2);
    expect(plan.project!.symbolInstances![0]).toEqual(
      target.symbolInstances![0],
    );
    expect(plan.warnings.join(' ')).toContain('Review (2)');
  });
  it('renderiza prévia de geometria válida com 200 mil pontos sem estourar a pilha', () => {
    const primitives: Primitive[] = [0, 1].map((n) => ({
      id: `poly-${n}`,
      layer: 'DESENHO',
      points: Array.from({ length: 100000 }, (_, i) => ({
        x: i,
        y: n * 100 + (i % 10),
      })),
    }));
    expect(() => validateSymbolPrimitives(primitives)).not.toThrow();
    expect(() =>
      renderToStaticMarkup(SymbolPreview({ primitives, label: 'Review' })),
    ).not.toThrow();
  });
});
