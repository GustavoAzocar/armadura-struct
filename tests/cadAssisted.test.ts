import { describe, expect, it } from 'vitest';
import {
  applyCadInterpretation,
  previewCadInterpretation,
  type CadAssignment,
} from '../src/cad/assisted';
import { normalizeCad, parseDxf } from '../src/cad/import';
import { readFileSync } from 'node:fs';
import { emptyProject, schedule, decodeProject } from '../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
} from '../src/domain/hierarchy';
import { assertDetailEdit } from '../src/domain/detailEditing';
import {
  createDetailPackage,
  detailPackageProject,
} from '../src/domain/detailPackage';
import { previewDetailTransfer } from '../src/domain/detailTransfer';

function fixture() {
  const mask = normalizeCad(
    {
      header: { $INSUNITS: 5 },
      entities: [
        {
          type: 'LINE',
          vertices: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
          layer: 'BARRAS',
        },
        {
          type: 'TEXT',
          startPoint: { x: 50, y: 20 },
          text: '4 N1 Ø10',
          textHeight: 4,
          layer: 'TEXTOS',
        },
        {
          type: 'LINE',
          vertices: [
            { x: 0, y: 50 },
            { x: 100, y: 50 },
          ],
          layer: 'FORMAS',
        },
      ],
    },
    'viga.dxf',
    'DXF',
  );
  mask.origin = { x: 100, y: 200 };
  mask.rotation = 90;
  const project = completeOwnership({ ...emptyProject(), masks: [mask] });
  const input: CadAssignment = {
    maskId: mask.id,
    contour: 0,
    text: 1,
    scale: 10,
    mark: 'N1',
    diameter: 10,
    mandrel: 50,
    steel: 'CA-50',
    quantity: 4,
    confirmed: true,
  };
  return { project, input, detailId: project.hierarchy.details[0].id };
}
describe('atribuição assistida CAD', () => {
  it('mantém a identidade do contorno após transportar a máscara e a barra em um pacote', () => {
    const { project, input, detailId } = fixture();
    const assigned = applyCadInterpretation(
      project,
      previewCadInterpretation(project, detailId, input),
    );
    const source = detailPackageProject(
      createDetailPackage(assigned, detailId, {
        producer: { app: 'teste', version: '1' },
      }),
    );
    const target = emptyProject();
    const imported = previewDetailTransfer(target, source, {
      mode: 'insert',
      sourceDetailId: detailId,
      targetElementId: target.hierarchy.elements[0].id,
    });
    expect(imported.issues).toEqual([]);
    const next = imported.project!;
    expect(
      previewCadInterpretation(next, imported.targetDetailId!, {
        ...input,
        mark: 'N2',
        maskId: next.masks[0].id,
      }).issues.join(),
    ).toMatch(/já originou/);
  });
  it('um DXF comum permanece referência sem gerar aço por conter linhas ou textos', () => {
    const mask = parseDxf(
      readFileSync('tests/fixtures/entities-2d.dxf', 'utf8'),
      'entities-2d.dxf',
    );
    const p = completeOwnership({ ...emptyProject(), masks: [mask] });
    expect(p.bars).toEqual([]);
    expect(schedule(p)).toEqual([]);
    expect(decodeProject(JSON.stringify(p)).masks).toEqual([mask]);
  });
  it('exige seleção, propriedades físicas e confirmação explícitas', () => {
    const { project, input, detailId } = fixture();
    for (const patch of [
      { confirmed: false },
      { contour: -1 },
      { contour: 1 },
      { diameter: 0 },
      { quantity: 0 },
      { quantity: 1.5 },
      { steel: '' },
      { mandrel: 0 },
      { scale: 0 },
    ]) {
      const plan = previewCadInterpretation(project, detailId, {
        ...input,
        ...patch,
      } as CadAssignment);
      expect(plan.project).toBeUndefined();
      expect(plan.issues.length).toBeGreaterThan(0);
    }
    expect(project.bars).toEqual([]);
  });
  it('aplica escala/rotação/origem, cria chamada vinculada e mantém TODA a referência', () => {
    const { project, input, detailId } = fixture(),
      before = JSON.stringify(project);
    project.scheduleLock = { at: 'locked', bars: [] };
    const plan = previewCadInterpretation(project, detailId, input);
    expect(plan.issues).toEqual([]);
    const p = applyCadInterpretation(project, plan),
      b = p.bars[0];
    expect(b.origin).toEqual({ x: 100, y: 200 });
    expect(b.points[1].x).toBeCloseTo(0, 10);
    expect(b.points[1].y).toBeCloseTo(1000, 10);
    expect(schedule(p)[0].unitLength).toBeCloseTo(1, 10);
    expect(schedule(p)[0].quantity).toBe(4);
    expect(p.annotations[0].barId).toBe(b.id);
    expect(p.annotations[0].label).toBe('4 N1 Ø10');
    expect(p.masks).toEqual(project.masks);
    expect(p.scheduleLock).toBeUndefined();
    expect(plan.raInvalidated).toBe(true);
    expect(decodeProject(JSON.stringify(p))).toEqual(p);
    expect(project.bars).toEqual([]);
    delete project.scheduleLock;
    expect(JSON.stringify(project)).toBe(before);
  });
  it('protege outros detalhamentos e conserva o contrato de edição isolada', () => {
    const { project, input, detailId } = fixture();
    const other = createHierarchyNode(
      project,
      'detail',
      'Outro',
      project.hierarchy.elements[0].id,
    );
    expect(
      previewCadInterpretation(other.project, other.id, input).issues.join(),
    ).toMatch(/pertencente/);
    const plan = previewCadInterpretation(other.project, detailId, input);
    expect(() =>
      assertDetailEdit(other.project, plan.project!, detailId),
    ).not.toThrow();
  });
  it('impede interpretar o mesmo contorno duas vezes e recusa um plano desatualizado', () => {
    const { project, input, detailId } = fixture();
    const plan = previewCadInterpretation(project, detailId, input),
      next = applyCadInterpretation(project, plan);
    expect(
      previewCadInterpretation(next, detailId, {
        ...input,
        mark: 'N2',
      }).issues.join(),
    ).toMatch(/já originou/);
    expect(() => applyCadInterpretation({ ...project }, plan)).toThrow(/mudou/);
    const second = previewCadInterpretation(next, detailId, {
      ...input,
      mark: 'N2',
      contour: 2,
      text: undefined,
    });
    expect(second.issues).toEqual([]);
    expect(second.project!.bars).toHaveLength(2);
    expect(second.project!.annotations).toHaveLength(1);
  });
  it('recusa dobras inviáveis e textos inválidos sem criar aço parcial', () => {
    const { project, input, detailId } = fixture();
    project.masks[0].primitives[0].points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(
      previewCadInterpretation(project, detailId, input).issues.join(),
    ).toMatch(/insuficiente/);
    input.contour = 2;
    input.text = 2;
    expect(
      previewCadInterpretation(project, detailId, input).issues.join(),
    ).toMatch(/texto CAD válido/);
  });
});
