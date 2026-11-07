import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createDetailPackage,
  decodeDetailPackage,
  detailPackageProject,
  type DetailPackage,
} from '../src/domain/detailPackage';
import {
  completeOwnership,
  createHierarchyNode,
} from '../src/domain/hierarchy';
import {
  emptyProject,
  newBar,
  decodeProject,
  schedule,
} from '../src/domain/model';
import {
  applyDetailTransfer,
  matchingDetails,
  previewDetailTransfer,
} from '../src/domain/detailTransfer';
import { maskPrimitives } from '../src/cad/import';
import type { Project } from '../src/domain/types';

const options = {
  producer: { app: 'Aplicativo OpenStruct de teste', version: '1.0.0' },
  exportedAt: '2026-11-07T12:00:00Z',
  metadata: { family: 'Viga', reference: 'Teste de intercâmbio' },
};
function fixture() {
  let p = emptyProject();
  p.name = 'Estrutura · integração';
  p.hierarchy.elements[0].name = 'V1';
  p = completeOwnership({
    ...p,
    bars: [
      {
        ...newBar('N1'),
        id: 'bar',
        diameter: 12.5,
        mandrel: 62.5,
        quantity: 4,
        rotation: 30,
        origin: { x: 120, y: 45 },
        points: [
          { x: 0, y: 200 },
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
        ],
        distribution: {
          start: { x: 120, y: 45 },
          end: { x: 320, y: 245 },
          render: 'ticks',
        },
      },
      { ...newBar('N2'), id: 'stirrup', kind: 'stirrup', quantity: 20 },
    ],
    details: [{ id: 'rep', barId: 'bar', origin: { x: 50, y: -500 } }],
    annotations: [
      {
        id: 'call',
        kind: 'leader',
        barId: 'bar',
        points: [
          { x: 120, y: 45 },
          { x: 300, y: 100 },
          { x: 500, y: 100 },
        ],
        label: '',
        textHeight: 40,
        color: '#777777',
      },
    ],
    polylines: [
      {
        id: 'poly',
        points: [
          { x: 0, y: 300 },
          { x: 1000, y: 300 },
        ],
        closed: false,
        color: '#777777',
      },
    ],
    masks: [
      {
        id: 'mask',
        name: 'Referência',
        format: 'DXF',
        sourceUnit: 'cm',
        scale: 10,
        rotation: 90,
        origin: { x: 100, y: 500 },
        opacity: 0.4,
        visible: true,
        layers: { BASE: true },
        warnings: [],
        primitives: [
          {
            layer: 'BASE',
            points: [
              { x: 10, y: 20 },
              { x: 110, y: 20 },
            ],
          },
          {
            layer: 'BASE',
            text: 'V1',
            textHeight: 5,
            points: [{ x: 10, y: 60 }],
          },
        ],
      },
    ],
  });
  return p;
}
const total = (p: Project) => schedule(p).reduce((s, r) => s + r.weight, 0);
const read = (pack: DetailPackage) =>
  detailPackageProject(decodeDetailPackage(JSON.stringify(pack)));

describe('pacotes OpenStruct de detalhamento', () => {
  it.each(['mm', 'cm', 'm'] as const)(
    'preserva toda geometria, quantidades e referências declaradas em %s',
    (unit) => {
      const p = fixture(),
        before = JSON.stringify(p);
      const pack = createDetailPackage(p, p.hierarchy.details[0].id, {
        ...options,
        unit,
      });
      const q = read(pack);
      expect(total(q)).toBeCloseTo(total(p), 10);
      p.bars.forEach((b, i) => {
        expect(q.bars[i].diameter).toBeCloseTo(b.diameter, 10);
        expect(q.bars[i].origin.x).toBeCloseTo(b.origin.x, 10);
        expect(q.bars[i].points).toEqual(b.points);
        expect(q.bars[i].distribution).toEqual(b.distribution);
      });
      expect(q.details).toEqual(p.details);
      expect(q.annotations).toEqual(p.annotations);
      expect(q.polylines).toEqual(p.polylines);
      expect(maskPrimitives(q.masks[0])).toEqual(maskPrimitives(p.masks[0]));
      expect(JSON.stringify(p)).toBe(before);
      expect(q.sheets).toEqual([]);
    },
  );
  it('normaliza uma barra analítica de 1 m e bitola de 0,01 m para 1000 mm e 10 mm', () => {
    const p = completeOwnership({
      ...emptyProject(),
      bars: [{ ...newBar('N1'), diameter: 10, quantity: 2 }],
    });
    const pack = createDetailPackage(p, p.hierarchy.details[0].id, {
      ...options,
      unit: 'm',
    });
    expect(pack.objects.bars[0].points[1].x).toBe(1);
    expect(pack.objects.bars[0].diameter).toBe(0.01);
    const q = read(pack);
    expect(schedule(q)[0].unitLength).toBe(1);
    expect(schedule(q)[0].quantity).toBe(2);
    expect(total(q)).toBeCloseTo(((2 * Math.PI * 0.01 ** 2) / 4) * 7850, 10);
  });
  it('remapeia colisões de IDs/marcas no destino e permite atualizar a mesma origem', () => {
    const source = fixture(),
      sourceId = source.hierarchy.details[0].id;
    let target = completeOwnership({
      ...emptyProject(),
      bars: [{ ...newBar('N1'), id: 'bar', quantity: 7 }],
    });
    const imported = read(createDetailPackage(source, sourceId, options));
    const plan = previewDetailTransfer(target, imported, {
      mode: 'insert',
      sourceDetailId: sourceId,
      targetElementId: target.hierarchy.elements[0].id,
    });
    expect(plan.issues).toEqual([]);
    target = applyDetailTransfer(target, plan);
    expect(target.bars[0].quantity).toBe(7);
    expect(new Set(target.bars.map((b) => b.id)).size).toBe(3);
    const original = target.bars.find((b) => b.quantity === 4)!;
    expect(original.id).not.toBe('bar');
    expect(original.mark).not.toBe('N1');
    expect(target.details[0].barId).toBe(original.id);
    expect(target.annotations[0].barId).toBe(original.id);
    expect(
      matchingDetails(target, imported, sourceId).map((d) => d.id),
    ).toEqual([plan.targetDetailId]);
    expect(
      previewDetailTransfer(target, imported, {
        mode: 'insert',
        sourceDetailId: sourceId,
        targetElementId: target.hierarchy.elements[0].id,
      }).issues.join(),
    ).toMatch(/origem já existe/);
    source.bars[0].quantity = 9;
    const revision = read(createDetailPackage(source, sourceId, options));
    const update = previewDetailTransfer(target, revision, {
      mode: 'replace',
      sourceDetailId: sourceId,
      targetDetailId: plan.targetDetailId,
    });
    expect(update.issues).toEqual([]);
    expect(
      update.project!.bars.find((b) => b.id === original.id)?.quantity,
    ).toBe(9);
    expect(update.project!.bars).toHaveLength(3);
  });
  it('transporta dependências externas sem incluí-las silenciosamente no aço importado', () => {
    let p = fixture();
    const main = p.hierarchy.details[0].id;
    const created = createHierarchyNode(
      p,
      'detail',
      'Outra definição',
      p.hierarchy.elements[0].id,
    );
    p = created.project;
    p.hierarchy.objectDetails.bar = created.id;
    const pack = createDetailPackage(p, main, options);
    expect(pack.dependencies.map((b) => b.id)).toEqual(['bar']);
    expect(pack.objects.bars.map((b) => b.id)).toEqual(['stirrup']);
    const source = read(pack),
      target = emptyProject();
    let plan = previewDetailTransfer(target, source, {
      mode: 'insert',
      sourceDetailId: main,
      targetElementId: target.hierarchy.elements[0].id,
    });
    expect(plan.references).toHaveLength(2);
    expect(plan.issues.length).toBeGreaterThan(0);
    plan = previewDetailTransfer(target, source, {
      mode: 'insert',
      sourceDetailId: main,
      targetElementId: target.hierarchy.elements[0].id,
      references: {
        'incoming:call': 'import:bar',
        'incoming:rep': 'import:bar',
      },
    });
    expect(plan.issues).toEqual([]);
    expect(plan.project!.bars).toHaveLength(2);
    expect(total(plan.project!)).toBeCloseTo(total(p), 10);
  });
  it('preserva proveniência transitiva e metadados ao salvar, reabrir e exportar', () => {
    const source = fixture(),
      id = source.hierarchy.details[0].id,
      target = emptyProject();
    const pack = createDetailPackage(source, id, options);
    const plan = previewDetailTransfer(target, read(pack), {
      mode: 'insert',
      sourceDetailId: id,
      targetElementId: target.hierarchy.elements[0].id,
    });
    const saved = decodeProject(JSON.stringify(plan.project));
    const exported = createDetailPackage(saved, plan.targetDetailId!, {
      producer: { app: 'ArmaduraStruct', version: '0.2.0' },
    });
    expect(exported.origin).toEqual(pack.origin);
    expect(exported.metadata).toEqual(options.metadata);
    expect(Object.values(exported.objectOrigins)).toEqual(
      Object.values(pack.objectOrigins),
    );
    expect(
      saved.hierarchy.details.find((d) => d.id === plan.targetDetailId)?.source
        ?.exchange?.producer,
    ).toEqual(options.producer);
  });
  it('exporta somente o detalhe escolhido, sem folhas, RA bloqueada nem aço de outros elementos', () => {
    let p = fixture();
    const main = p.hierarchy.details[0].id;
    const other = createHierarchyNode(
      p,
      'detail',
      'Outro',
      p.hierarchy.elements[0].id,
    );
    p = completeOwnership(
      {
        ...other.project,
        bars: [...p.bars, { ...newBar('N3'), quantity: 99 }],
      },
      other.id,
    );
    p.scheduleLock = { at: 'snapshot', bars: [] };
    const pack = createDetailPackage(p, main, options);
    expect(pack.objects.bars).toHaveLength(2);
    expect(pack.dependencies).toEqual([]);
    expect(total(read(pack))).toBeCloseTo(
      total({ ...p, scheduleLock: undefined, bars: p.bars.slice(0, 2) }),
      10,
    );
    expect(pack).not.toHaveProperty('sheets');
    expect(pack).not.toHaveProperty('scheduleLock');
  });
  it('recusa versão, unidade, vínculos ausentes, origens inválidas e IDs duplicados', () => {
    const p = fixture(),
      pack = createDetailPackage(p, p.hierarchy.details[0].id, options);
    const invalid = (change: (p: any) => void) => {
      const q = structuredClone(pack);
      change(q);
      expect(() => decodeDetailPackage(JSON.stringify(q))).toThrow();
    };
    invalid((q) => (q.schema = 'openstruct.detail/99'));
    invalid((q) => (q.units.length = 'inch'));
    invalid((q) => (q.units.angle = 'rad'));
    invalid((q) => (q.objects.details[0].barId = 'missing'));
    invalid((q) => (q.objects.bars[1].id = 'bar'));
    invalid((q) => delete q.objectOrigins.bar);
    invalid((q) => (q.objectOrigins.fake = { projectId: 'p', objectId: 'o' }));
    invalid((q) => (q.objectOrigins.stirrup = q.objectOrigins.bar));
    invalid((q) => (q.objects.bars[0].diameter = 101));
    invalid((q) => (q.units.length = 'm'));
  });
  it('lê exemplos públicos produzidos por outro app e por exportação nativa', () => {
    for (const file of ['minimal-mm.osdetail.json', 'viga-cm.osdetail.json']) {
      const pack = decodeDetailPackage(
        readFileSync(`docs/examples/${file}`, 'utf8'),
      );
      const q = read(pack);
      expect(q.bars.length).toBeGreaterThan(0);
      expect(total(q)).toBeGreaterThan(0);
    }
  });
});
