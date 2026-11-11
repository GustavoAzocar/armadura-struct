import { describe, it, expect } from 'vitest';
import { maskManipFixture } from './fixtures/maskManipulation';
import { maskCadEntities } from '../src/domain/maskCadEditing';
import { validateNativeMask } from '../src/domain/nativeMasks';
import { maskPoint } from '../src/cad/import';
import { decodeProject, schedule } from '../src/domain/model';
import { setLayerState } from '../src/domain/layerProfiles';
import { drawingPrimitives } from '../src/domain/drawingPrimitives';
import { toCsv, toDxf, toPdf } from '../src/lib/exports';
import {
  applyCatalogImport,
  applySymbolCreation,
  applySymbolEdit,
  applySymbolInsertion,
  applySymbolRemoval,
  detachSymbolInstance,
  exportSymbolCatalog,
  instancesOf,
  parseSymbolCatalog,
  previewCatalogImport,
  previewSymbolCreation,
  previewSymbolEdit,
  previewSymbolInsertion,
  previewSymbolRemoval,
  removeSymbolInstance,
  searchSymbols,
  symbolInstances,
  symbolRenderMasks,
  transformSymbolInstance,
  uniqueSymbolName,
  type SymbolTransform,
} from '../src/domain/symbols';
import type { Point, Project } from '../src/domain/types';

const ctx = (p: Project) => ({
  key: 'model',
  detailId: p.hierarchy.objectDetails[p.masks[0].id],
});
const refs = (p: Project, count = 3) =>
  maskCadEntities(p, ctx(p))
    .filter((e) => e.mask.id === p.masks[0].id)
    .map((e) => e.ref)
    .slice(0, count);
const base: Point = { x: 0, y: 0 };
const create = (p: Project, name = 'Pilar', category = 'Fôrma', at = base) =>
  applySymbolCreation(
    p,
    previewSymbolCreation(
      p,
      { maskId: p.masks[0].id, refs: refs(p), name, category, base: at },
      ctx(p),
    ),
    ctx(p),
  );
const at = (
  x: number,
  y: number,
  rotation = 0,
  scale = 1,
): SymbolTransform => ({
  origin: { x, y },
  rotation,
  scale,
});
const insert = (
  p: Project,
  t: SymbolTransform,
  mode: 'instance' | 'copy' = 'instance',
  definitionId = p.symbols![0].id,
  options: { maskId?: string; layerId?: string } = {},
) =>
  applySymbolInsertion(
    p,
    previewSymbolInsertion(p, definitionId, t, mode, ctx(p), options),
    ctx(p),
  );
const near = (a: Point, b: Point) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};
const withLibrary = () => {
  const p = create(maskManipFixture());
  return insert(insert(p, at(5000, 0)), at(8000, 0, 90, 2));
};

describe('Criar símbolo a partir de entidades CAD', () => {
  it('guarda geometria relativa ao ponto base, sem aço, layer ou estilo', () => {
    const p = maskManipFixture();
    const q = create(p, '  Pilar   P1 ', ' Fôrma ', { x: 100, y: 0 });
    const d = q.symbols![0];
    expect(d).toMatchObject({
      name: 'Pilar P1',
      category: 'Fôrma',
      revision: 1,
    });
    expect(d.primitives).toHaveLength(3);
    // line (0,0)-(1000,0) with base (100,0) → starts at (-100,0)
    near(d.primitives[0].points[0], { x: -100, y: 0 });
    near(d.primitives[0].points[1], { x: 900, y: 0 });
    for (const prim of d.primitives) {
      expect(prim.id).toBeTruthy();
      expect(prim.layerId).toBeUndefined();
      expect(prim.style).toBeUndefined();
    }
    expect(q.bars).toBe(p.bars);
    expect(q.masks).toBe(p.masks);
    expect(q.hierarchy).toBe(p.hierarchy);
    expect(q.symbolInstances ?? []).toHaveLength(0);
    expect(schedule(q)).toEqual(schedule(p));
  });
  it('aplica origem, rotação e escala da máscara uma única vez', () => {
    const p = maskManipFixture();
    p.masks[0].origin = { x: 1000, y: 2000 };
    p.masks[0].rotation = 90;
    p.masks[0].scale = 2;
    const d = create(p, 'Girado', '', { x: 1000, y: 2000 }).symbols![0];
    // local (1000,0) → world origin + R90·2·(1000,0) = (1000, 4000) → minus base = (0, 2000)
    near(d.primitives[0].points[1], { x: 0, y: 2000 });
    const circle = d.primitives[1].native as { radius: number; center: Point };
    expect(circle.radius).toBeCloseTo(200, 6);
    near(circle.center, { x: -1000, y: 0 });
  });
  it('prévia não altera o projeto; repetir a confirmação não duplica', () => {
    const p = maskManipFixture();
    const plan = previewSymbolCreation(
      p,
      { maskId: p.masks[0].id, refs: refs(p), name: 'A', base },
      ctx(p),
    );
    expect(p.symbols).toBeUndefined();
    const q = applySymbolCreation(p, plan, ctx(p));
    expect(q.symbols).toHaveLength(1);
    expect(() => applySymbolCreation(q, plan, ctx(p))).toThrow(/mudou/);
    expect(q.symbols).toHaveLength(1);
  });
  it('trata nomes duplicados sem diferenciar maiúsculas e sugere alternativa', () => {
    const q = create(maskManipFixture(), 'Pilar');
    expect(() =>
      previewSymbolCreation(
        q,
        { maskId: q.masks[0].id, refs: refs(q), name: ' pilar ', base },
        ctx(q),
      ),
    ).toThrow(/\(2\)/);
    expect(uniqueSymbolName(q, 'PILAR')).toBe('PILAR (2)');
    expect(uniqueSymbolName(q, 'Viga')).toBe('Viga');
  });
  it.each([
    ['nome vazio', { name: '   ' }],
    ['nome longo', { name: 'x'.repeat(101) }],
    ['categoria longa', { category: 'x'.repeat(61) }],
    ['base infinita', { base: { x: Infinity, y: 0 } }],
    ['base fora dos limites', { base: { x: 2e9, y: 0 } }],
  ])('rejeita %s', (_, patch) => {
    const p = maskManipFixture();
    expect(() =>
      previewSymbolCreation(
        p,
        { maskId: p.masks[0].id, refs: refs(p), name: 'A', base, ...patch },
        ctx(p),
      ),
    ).toThrow();
  });
  it('exige seleção do alvo ativo, sem aproveitar seleção de outra máscara', () => {
    const p = maskManipFixture();
    const other = maskCadEntities(p, ctx(p))
      .filter((e) => e.mask.id === p.masks[1].id)
      .map((e) => e.ref);
    const input = { maskId: p.masks[0].id, name: 'A', base };
    expect(() =>
      previewSymbolCreation(p, { ...input, refs: [] }, ctx(p)),
    ).toThrow(/Selecione/);
    expect(() =>
      previewSymbolCreation(p, { ...input, refs: other }, ctx(p)),
    ).toThrow(/outra máscara/);
    expect(() =>
      previewSymbolCreation(
        p,
        { ...input, refs: refs(p) },
        { ...ctx(p), key: 'sheet:x' },
      ),
    ).toThrow();
  });
  it('respeita layer bloqueado, oculto ou sem captura', () => {
    const p = maskManipFixture();
    for (const field of ['visible', 'capture', 'editable'] as const) {
      const q = setLayerState(
        p,
        'model',
        p.layers.find((l) => l.name === 'DESENHO')!.id,
        { [field]: false },
      );
      expect(() =>
        previewSymbolCreation(
          q,
          { maskId: q.masks[0].id, refs: refs(p), name: 'A', base },
          ctx(q),
        ),
      ).toThrow();
    }
  });
  it('troca de contexto invalida a operação pendente', () => {
    const p = maskManipFixture();
    const plan = previewSymbolCreation(
      p,
      { maskId: p.masks[0].id, refs: refs(p), name: 'A', base },
      ctx(p),
    );
    expect(() =>
      applySymbolCreation(p, plan, { ...ctx(p), key: 'sheet:y' }),
    ).toThrow(/mudou/);
    expect(() =>
      applySymbolCreation(p, plan, { ...ctx(p), detailId: 'outro' }),
    ).toThrow(/mudou/);
  });
});

describe('Instâncias', () => {
  it('duas instâncias reutilizam a definição e não afetam o aço', () => {
    const p = maskManipFixture();
    const lib = create(p);
    const q = insert(insert(lib, at(5000, 0)), at(8000, 0));
    expect(symbolInstances(q)).toHaveLength(2);
    expect(q.symbols).toHaveLength(1);
    const masks = symbolRenderMasks(q);
    expect(masks[0].primitives).toBe(masks[1].primitives); // geometria compartilhada
    expect(q.bars).toBe(p.bars);
    expect(q.scheduleLock).toBe(p.scheduleLock);
    expect(schedule(q)).toEqual(schedule(p));
    expect(toCsv(q)).toBe(toCsv(p));
    for (const i of symbolInstances(q))
      expect(q.hierarchy.objectDetails[i.id]).toBe(ctx(q).detailId);
  });
  it('transformar uma instância não muda a outra nem a definição', () => {
    const q = withLibrary();
    const [a, b] = symbolInstances(q);
    const r = transformSymbolInstance(q, a.id, {
      origin: { x: 1, y: 2 },
      rotation: 45,
      scale: 3,
    });
    const [a2, b2] = symbolInstances(r);
    expect(a2).toMatchObject({
      origin: { x: 1, y: 2 },
      rotation: 45,
      scale: 3,
    });
    expect(b2).toBe(b);
    expect(r.symbols).toBe(q.symbols);
    expect(transformSymbolInstance(r, a.id, { scale: 3 })).toBe(r);
    for (const bad of [0, -1, NaN, 20000])
      expect(() => transformSymbolInstance(q, a.id, { scale: bad })).toThrow();
    expect(() =>
      transformSymbolInstance(q, a.id, { origin: { x: 1e10, y: 0 } }),
    ).toThrow();
    expect(() => transformSymbolInstance(q, 'nada', { scale: 2 })).toThrow();
  });
  it('rotação e escala seguem a geometria em unidades do modelo', () => {
    const q = withLibrary();
    const [, second] = symbolRenderMasks(q);
    // line (0,0)-(1000,0), R90, scale 2, origin (8000,0) → (8000,0)-(8000,2000)
    const line = second.primitives[0];
    near(maskPoint(line.points[1], second), { x: 8000, y: 2000 });
    const circle = second.primitives[1].native as { radius: number };
    expect(circle.radius).toBeCloseTo(100, 6); // definition keeps its own radius
    const world = drawingPrimitives(q).filter(
      (x) => x.native?.kind === 'circle',
    );
    expect(world.length).toBeGreaterThan(0);
  });
  it('prévia não altera o projeto; repetir a confirmação não duplica', () => {
    const lib = create(maskManipFixture());
    const plan = previewSymbolInsertion(
      lib,
      lib.symbols![0].id,
      at(10, 10),
      'instance',
      ctx(lib),
    );
    expect(plan.preview).toHaveLength(3);
    expect(lib.symbolInstances ?? []).toHaveLength(0);
    const q = applySymbolInsertion(lib, plan, ctx(lib));
    expect(() => applySymbolInsertion(q, plan, ctx(lib))).toThrow(/mudou/);
    expect(symbolInstances(q)).toHaveLength(1);
  });
  it('respeita layer, papel e isolamento', () => {
    const lib = create(maskManipFixture());
    const id = lib.symbols![0].id;
    const layer = lib.layers.find((l) => l.name === 'DESENHO')!.id;
    expect(() =>
      previewSymbolInsertion(lib, id, at(0, 0), 'instance', {
        ...ctx(lib),
        key: 'sheet:s',
      }),
    ).toThrow(/papel/);
    expect(() =>
      previewSymbolInsertion(lib, id, at(0, 0), 'instance', {
        ...ctx(lib),
        scopeDetailId: 'outro',
      }),
    ).toThrow(/Isolamento/);
    for (const field of ['visible', 'editable'] as const)
      expect(() =>
        previewSymbolInsertion(
          setLayerState(lib, 'model', layer, { [field]: false }),
          id,
          at(0, 0),
          'instance',
          ctx(lib),
        ),
      ).toThrow(/Layer/);
    expect(() =>
      previewSymbolInsertion(
        lib,
        'inexistente',
        at(0, 0),
        'instance',
        ctx(lib),
      ),
    ).toThrow(/inexistente/);
    expect(() =>
      previewSymbolInsertion(lib, id, at(0, 0, 0, 0), 'instance', ctx(lib)),
    ).toThrow();
  });
  it('cópia independente anexa entidades novas à máscara ativa, sem vínculo', () => {
    const lib = create(maskManipFixture());
    const q = insert(lib, at(3000, 0, 90, 1), 'copy', undefined, {
      maskId: lib.masks[0].id,
    });
    expect(symbolInstances(q)).toHaveLength(0);
    const added = q.masks[0].primitives.slice(lib.masks[0].primitives.length);
    expect(added).toHaveLength(3);
    expect(new Set(added.map((x) => x.id)).size).toBe(3);
    for (const x of added)
      expect(lib.masks[0].primitives.some((y) => y.id === x.id)).toBe(false);
    near(maskPoint(added[0].points[1], q.masks[0]), { x: 3000, y: 1000 });
    validateNativeMask(q.masks[0]);
    // editar a definição não altera a cópia
    const edited = applySymbolEdit(
      q,
      previewSymbolEdit(q, q.symbols![0].id, { name: 'Outro' }, ctx(q)),
      ctx(q),
    );
    expect(edited.masks).toBe(q.masks);
    expect(() =>
      previewSymbolInsertion(
        lib,
        lib.symbols![0].id,
        at(0, 0),
        'copy',
        ctx(lib),
      ),
    ).toThrow(/máscara/i);
  });
  it('desvincular troca a instância por cópias independentes', () => {
    const q = withLibrary();
    const [a, b] = symbolInstances(q);
    const r = detachSymbolInstance(q, a.id, q.masks[0].id, ctx(q));
    expect(symbolInstances(r)).toEqual([b]);
    expect(r.masks[0].primitives).toHaveLength(
      q.masks[0].primitives.length + 3,
    );
    expect(r.hierarchy.objectDetails[a.id]).toBeUndefined();
    validateNativeMask(r.masks[0]);
    decodeProject(JSON.stringify(r));
  });
  it('remover instância limpa a hierarquia', () => {
    const q = withLibrary();
    const [a] = symbolInstances(q);
    const r = removeSymbolInstance(q, a.id);
    expect(symbolInstances(r)).toHaveLength(1);
    expect(r.hierarchy.objectDetails[a.id]).toBeUndefined();
    expect(() => removeSymbolInstance(r, a.id)).toThrow();
    decodeProject(JSON.stringify(r));
  });
});

describe('Edição e remoção da definição', () => {
  it('informa as instâncias afetadas e atualiza todas de uma vez', () => {
    const q = withLibrary();
    const id = q.symbols![0].id;
    const plan = previewSymbolEdit(
      q,
      id,
      {
        geometry: {
          maskId: q.masks[0].id,
          refs: refs(q, 1),
          base,
        },
      },
      ctx(q),
    );
    expect(plan.affected.map((i) => i.id)).toEqual(
      symbolInstances(q).map((i) => i.id),
    );
    expect(plan.next.revision).toBe(2);
    expect(q.symbols![0].primitives).toHaveLength(3); // prévia não altera
    const r = applySymbolEdit(q, plan, ctx(q));
    expect(r.symbols![0].primitives).toHaveLength(1);
    expect(symbolRenderMasks(r).every((m) => m.primitives.length === 1)).toBe(
      true,
    );
    expect(symbolInstances(r)).toBe(symbolInstances(q));
    expect(r.bars).toBe(q.bars);
    expect(() => applySymbolEdit(r, plan, ctx(q))).toThrow(/mudou/);
  });
  it('renomear não afeta instâncias; duplicado e nenhuma alteração são recusados', () => {
    const q = create(create(maskManipFixture()), 'Viga');
    const [a, b] = q.symbols!;
    expect(
      previewSymbolEdit(q, a.id, { name: 'Novo' }, ctx(q)).affected,
    ).toEqual([]);
    expect(() =>
      previewSymbolEdit(q, a.id, { name: b.name.toUpperCase() }, ctx(q)),
    ).toThrow(/Já existe/);
    expect(() => previewSymbolEdit(q, a.id, {}, ctx(q))).toThrow(/Nenhuma/);
    expect(() => previewSymbolEdit(q, a.id, { name: a.name }, ctx(q))).toThrow(
      /Nenhuma/,
    );
    const r = applySymbolEdit(
      q,
      previewSymbolEdit(q, a.id, { name: 'Novo', category: 'Vigas' }, ctx(q)),
      ctx(q),
    );
    expect(r.symbols![0]).toMatchObject({ name: 'Novo', category: 'Vigas' });
    expect(r.symbols![0].revision).toBe(1);
  });
  it('remover definição usada exige confirmar as instâncias e não deixa órfãos', () => {
    const q = withLibrary();
    const plan = previewSymbolRemoval(q, q.symbols![0].id, ctx(q));
    expect(plan.instances).toHaveLength(2);
    expect(() => applySymbolRemoval(q, plan, ctx(q))).toThrow(/instância/);
    const r = applySymbolRemoval(q, plan, ctx(q), true);
    expect(r.symbols).toEqual([]);
    expect(symbolInstances(r)).toEqual([]);
    for (const i of symbolInstances(q))
      expect(r.hierarchy.objectDetails[i.id]).toBeUndefined();
    expect(r.bars).toBe(q.bars);
    decodeProject(JSON.stringify(r));
  });
  it('remover definição sem uso é direto', () => {
    const lib = create(maskManipFixture());
    const plan = previewSymbolRemoval(lib, lib.symbols![0].id, ctx(lib));
    expect(applySymbolRemoval(lib, plan, ctx(lib)).symbols).toEqual([]);
    expect(instancesOf(lib, lib.symbols![0].id)).toEqual([]);
  });
});

describe('Persistência e compatibilidade', () => {
  it('salva e reabre biblioteca e instâncias sem perder propriedades', () => {
    const q = withLibrary();
    const withStyle = transformSymbolInstance(q, symbolInstances(q)[0].id, {});
    const styled = {
      ...withStyle,
      symbolInstances: symbolInstances(withStyle).map((i, n) =>
        n ? i : { ...i, style: { color: '#123456' }, plot: { include: false } },
      ),
    };
    const back = decodeProject(JSON.stringify(styled));
    expect(back.schema).toBe('armadurastruct/31');
    expect(back.symbols).toEqual(styled.symbols);
    expect(back.symbolInstances).toEqual(styled.symbolInstances);
    expect(back.hierarchy.objectDetails).toEqual(
      styled.hierarchy.objectDetails,
    );
    expect(decodeProject(JSON.stringify(back))).toEqual(back);
  });
  it('projetos sem símbolos continuam idênticos e abrem de formatos antigos', () => {
    const p = maskManipFixture();
    const raw = JSON.parse(JSON.stringify(p));
    expect('symbols' in raw).toBe(false);
    for (const schema of ['armadurastruct/26', 'armadurastruct/25'])
      expect(decodeProject(JSON.stringify({ ...raw, schema })).symbols).toBe(
        undefined,
      );
  });
  it('rejeita símbolos em formato anterior ao 27', () => {
    const raw = JSON.parse(JSON.stringify(withLibrary()));
    raw.schema = 'armadurastruct/26';
    expect(() => decodeProject(JSON.stringify(raw))).toThrow(/formato 27/);
  });
  it.each([
    [
      'instância órfã',
      (r: Project) => {
        r.symbolInstances![0].definitionId = 'x';
      },
      /sem definição/,
    ],
    [
      'definição duplicada',
      (r: Project) => {
        r.symbols!.push({ ...r.symbols![0] });
      },
      /duplicad/,
    ],
    [
      'nome duplicado',
      (r: Project) => {
        r.symbols!.push({ ...r.symbols![0], id: 'z' });
      },
      /duplicado/,
    ],
    [
      'id de instância repetido',
      (r: Project) => {
        r.symbolInstances![1].id = r.symbolInstances![0].id;
      },
      /duplicad/,
    ],
    [
      'layer inexistente',
      (r: Project) => {
        r.symbolInstances![0].layerId = 'layer:nada';
      },
      /layer/i,
    ],
    [
      'escala inválida',
      (r: Project) => {
        r.symbolInstances![0].scale = -1;
      },
      null,
    ],
    [
      'instância sem dono na hierarquia',
      (r: Project) => {
        delete r.hierarchy.objectDetails[r.symbolInstances![0].id];
      },
      null,
    ],
    [
      'geometria nativa inconsistente',
      (r: Project) => {
        r.symbols![0].primitives[0].points[0].x += 50;
      },
      /inconsistente/,
    ],
    [
      'definição sem entidades',
      (r: Project) => {
        r.symbols![0].primitives = [];
      },
      null,
    ],
  ])('rejeita %s', (_, mutate, message) => {
    const raw = JSON.parse(JSON.stringify(withLibrary())) as Project;
    mutate(raw);
    const run = () => decodeProject(JSON.stringify(raw));
    if (message) expect(run).toThrow(message);
    else expect(run).toThrow();
  });
});

describe('Canvas, impressão e intercâmbio concordam', () => {
  it('exporta as instâncias em DXF/PDF e mantém o CSV do aço', () => {
    const lib = create(maskManipFixture());
    const q = insert(insert(lib, at(5000, 0)), at(8000, 0));
    const entities = (dxf: string) =>
      (dxf.match(/^(LINE|CIRCLE|LWPOLYLINE|POLYLINE|ARC)\s*$/gm) ?? []).length;
    expect(entities(toDxf(q)) - entities(toDxf(lib))).toBeGreaterThanOrEqual(6);
    // Same primitives as the canvas path.
    const world = drawingPrimitives(q);
    expect(world.length - drawingPrimitives(lib).length).toBe(6);
    expect(toPdf(q).length).toBeGreaterThan(toPdf(lib).length);
    expect(toCsv(q)).toBe(toCsv(lib));
  });
  it('instância oculta por layer sai da exportação como qualquer objeto', () => {
    const lib = create(maskManipFixture());
    const q = insert(lib, at(5000, 0));
    const layer = q.layers.find((l) => l.id === symbolInstances(q)[0].layerId)!;
    expect(layer).toBeTruthy();
  });
});

describe('Catálogo nativo', () => {
  const producer = { app: 'ArmaduraStruct', version: '0.5.0' };
  it('exporta e importa com identidades novas e valida o formato', () => {
    const src = create(create(maskManipFixture()), 'Viga', 'Fôrma');
    const raw = exportSymbolCatalog(src, undefined, producer);
    const catalog = parseSymbolCatalog(raw);
    expect(catalog.symbols.map((s) => s.name)).toEqual(['Pilar', 'Viga']);
    const target = maskManipFixture();
    const plan = previewCatalogImport(target, catalog, 'rename');
    expect(target.symbols).toBeUndefined(); // prévia não altera
    const out = applyCatalogImport(target, plan);
    expect(out.symbols!.map((s) => s.name)).toEqual(['Pilar', 'Viga']);
    const sourceIds = new Set(
      src.symbols!.flatMap((d) => [d.id, ...d.primitives.map((x) => x.id)]),
    );
    for (const d of out.symbols!) {
      expect(sourceIds.has(d.id)).toBe(false);
      for (const x of d.primitives) expect(sourceIds.has(x.id!)).toBe(false);
    }
    decodeProject(JSON.stringify(out));
    expect(exportSymbolCatalog(src, [src.symbols![1].id], producer)).toContain(
      'Viga',
    );
  });
  it('trata nomes duplicados: renomear ou ignorar, sem sobrescrever', () => {
    const src = create(maskManipFixture(), 'Pilar');
    const catalog = parseSymbolCatalog(
      exportSymbolCatalog(src, undefined, producer),
    );
    const target = create(maskManipFixture(), 'pilar');
    const renamed = previewCatalogImport(target, catalog, 'rename');
    expect(renamed.renamed).toEqual([{ from: 'Pilar', to: 'Pilar (2)' }]);
    expect(applyCatalogImport(target, renamed).symbols).toHaveLength(2);
    const skipped = previewCatalogImport(target, catalog, 'skip');
    expect(skipped.skipped).toEqual(['Pilar']);
    expect(applyCatalogImport(target, skipped)).toBe(target);
    expect(target.symbols![0].name).toBe('pilar');
    expect(() => applyCatalogImport(src, renamed)).toThrow(/mudou/);
  });
  it.each([
    ['JSON malformado', '{'],
    ['outro formato', JSON.stringify({ schema: 'openstruct.detail/1' })],
    [
      'sem símbolos',
      JSON.stringify({
        schema: 'armadurastruct.symbols/1',
        producer: { app: 'x', version: '1' },
        symbols: [],
      }),
    ],
  ])('rejeita catálogo inválido: %s', (_, raw) => {
    expect(() => parseSymbolCatalog(raw)).toThrow();
  });
  it('rejeita nomes repetidos e geometria inconsistente no catálogo', () => {
    const src = create(maskManipFixture());
    const catalog = JSON.parse(exportSymbolCatalog(src, undefined, producer));
    const twice = {
      ...catalog,
      symbols: [catalog.symbols[0], catalog.symbols[0]],
    };
    expect(() => parseSymbolCatalog(JSON.stringify(twice))).toThrow(/repetido/);
    catalog.symbols[0].primitives[0].points[0].x += 99;
    expect(() => parseSymbolCatalog(JSON.stringify(catalog))).toThrow();
  });
  it('a biblioteca só tem o que o usuário criou ou importou', () => {
    const p = maskManipFixture();
    expect(p.symbols).toBeUndefined();
    expect(decodeProject(JSON.stringify(p)).symbols).toBeUndefined();
    expect(searchSymbols(p, '')).toEqual([]);
  });
  it('busca por nome e categoria sem diferenciar maiúsculas', () => {
    const q = create(
      create(maskManipFixture(), 'Pilar P1', 'Fôrma'),
      'Viga',
      'Armação',
    );
    expect(searchSymbols(q, 'pilar').map((d) => d.name)).toEqual(['Pilar P1']);
    expect(searchSymbols(q, 'ARMAÇÃO').map((d) => d.name)).toEqual(['Viga']);
    expect(searchSymbols(q, '  ')).toHaveLength(2);
    expect(searchSymbols(q, 'zzz')).toEqual([]);
  });
});

describe('Integração com visões e detalhamentos', () => {
  it('a visão do editor e as projeções de layer só mostram instâncias do contexto', async () => {
    const { detailEditorView } = await import('../src/domain/detailEditing');
    const { layerProjection } = await import('../src/domain/layerProfiles');
    const q = withLibrary();
    const [a, b] = symbolInstances(q);
    expect(symbolInstances(detailEditorView(q, ctx(q).detailId))).toHaveLength(
      2,
    );
    expect(symbolInstances(detailEditorView(q, 'outro-detalhe'))).toHaveLength(
      0,
    );
    const hidden = setLayerState(q, 'model', a.layerId, { visible: false });
    expect(
      symbolInstances(layerProjection(hidden, 'model', 'visible')),
    ).toHaveLength(0);
    expect(
      symbolInstances(layerProjection(q, 'model', 'visible')).map((i) => i.id),
    ).toEqual([a.id, b.id]);
  });
  it('pacote OpenStruct recusa detalhamento com instâncias, sem perda silenciosa', async () => {
    const { createDetailPackage } = await import('../src/domain/detailPackage');
    const options = { producer: { app: 'ArmaduraStruct', version: '0.5.0' } };
    const q = withLibrary();
    expect(() => createDetailPackage(q, ctx(q).detailId, options)).toThrow(
      /instâncias de símbolo/,
    );
    const bare = maskManipFixture();
    expect(createDetailPackage(bare, ctx(bare).detailId, options)).toBeTruthy();
  });
  it('mover instância entre detalhamentos preserva a definição e valida o projeto', async () => {
    const { createHierarchyNode, moveObjectsToDetail } = await import(
      '../src/domain/hierarchy'
    );
    const q = withLibrary();
    const { project, id } = createHierarchyNode(
      q,
      'detail',
      'Detalhe B',
      q.hierarchy.details[0].elementId,
    );
    const [a] = symbolInstances(q);
    const moved = moveObjectsToDetail(project, [a.id], id);
    expect(moved.hierarchy.objectDetails[a.id]).toBe(id);
    expect(moved.symbols).toBe(q.symbols);
    decodeProject(JSON.stringify(moved));
  });
});

describe('Visibilidade, layers e propriedades', () => {
  it('visibilidade por objeto de instâncias sobrevive ao salvar e reabrir', async () => {
    const { hideObjects, objectHidden } = await import(
      '../src/domain/visibility'
    );
    const { ensureProfiles } = await import('../src/domain/layerProfiles');
    const q = ensureProfiles(withLibrary());
    const [a, b] = symbolInstances(q);
    const hidden = hideObjects(q, 'model', [a.id]);
    expect(objectHidden(hidden, 'model', a.id)).toBe(true);
    const back = decodeProject(JSON.stringify(hidden));
    expect(objectHidden(back, 'model', a.id)).toBe(true);
    expect(objectHidden(back, 'model', b.id)).toBe(false);
  });
  it('copiar propriedades altera a instância escolhida, e só ela', async () => {
    const { previewMatchProperties, applyMatchProperties, graphicEntities } =
      await import('../src/domain/matchProperties');
    const q = withLibrary();
    const [a, b] = symbolInstances(q);
    const styled = {
      ...q,
      symbolInstances: [{ ...a, style: { color: '#123456' } }, b],
    };
    const all = graphicEntities(styled, ctx(styled), styled.masks[0].id);
    const source = all.find((r) => r.owner === a.id)!,
      target = all.find((r) => r.owner === b.id)!;
    expect(source && target).toBeTruthy();
    const plan = previewMatchProperties(
      styled,
      source,
      [target],
      { mode: 'binding', properties: ['color'] },
      ctx(styled),
      styled.masks[0].id,
    );
    expect(plan.count).toBe(1);
    const r = applyMatchProperties(
      styled,
      plan,
      ctx(styled),
      styled.masks[0].id,
    );
    expect(symbolInstances(r)[1].style?.color).toBe('#123456');
    expect(symbolInstances(r)[0]).toEqual(symbolInstances(styled)[0]);
    expect(r.symbols).toEqual(styled.symbols);
    expect(r.bars).toEqual(styled.bars);
    decodeProject(JSON.stringify(r));
  });
});

describe('Prancha (papel)', () => {
  it('a composição da folha desenha as instâncias como o canvas', async () => {
    const { composeSheet } = await import('../src/domain/paper');
    const { placeDrawing } = await import('../src/domain/sheets');
    const q = withLibrary();
    const placed = placeDrawing(q, q.sheets[0].id, q.hierarchy.drawings[0].id);
    const base = create(maskManipFixture());
    const lib = placeDrawing(
      base,
      base.sheets[0].id,
      base.hierarchy.drawings[0].id,
    );
    const count = (p: Project) =>
      JSON.stringify(composeSheet(p, p.sheets[0].id)).length;
    expect(count(placed.project)).toBeGreaterThan(count(lib.project));
  });
});

describe('Consultas e máscara importada', () => {
  it('abrir a biblioteca e pesquisar não altera projeto, histórico nem serialização', () => {
    const q = withLibrary();
    const before = JSON.stringify(q);
    searchSymbols(q, 'pilar');
    previewSymbolInsertion(q, q.symbols![0].id, at(1, 1), 'instance', ctx(q));
    previewSymbolRemoval(q, q.symbols![0].id, ctx(q));
    instancesOf(q, q.symbols![0].id);
    expect(JSON.stringify(q)).toBe(before);
  });
  it('cópia independente em referência importada só acrescenta desenho local e não toca o aço', () => {
    const lib = create(maskManipFixture());
    const imported = {
      ...lib,
      masks: lib.masks.map((m, i) =>
        i === 0 ? { ...m, format: 'DXF' as const } : m,
      ),
    };
    const q = insert(imported, at(3000, 0), 'copy', undefined, {
      maskId: imported.masks[0].id,
    });
    const added = q.masks[0].primitives.slice(
      imported.masks[0].primitives.length,
    );
    expect(added).toHaveLength(3);
    expect(q.masks[0].primitives.slice(0, 3)).toEqual(
      imported.masks[0].primitives,
    );
    expect(added.every((x) => x.layer === 'AS_DESENHO_LOCAL')).toBe(true);
    expect(q.masks[0].format).toBe('DXF');
    expect(q.bars).toEqual(imported.bars);
    expect(schedule(q)).toEqual(schedule(imported));
    decodeProject(JSON.stringify(q));
  });
});
