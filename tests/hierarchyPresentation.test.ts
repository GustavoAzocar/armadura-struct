import { describe, it, expect } from 'vitest';
import {
  newProjectSetup,
  addProjectSetupNode,
  prepareProjectSetup,
} from '../src/domain/projectSetup';
import {
  drawingLabel,
  nextDetailName,
} from '../src/domain/hierarchyPresentation';
import {
  completeOwnership,
  createHierarchyNode,
  updateHierarchyNode,
} from '../src/domain/hierarchy';
import { newBar, schedule, decodeProject } from '../src/domain/model';
import { previewMergeRepetitions } from '../src/domain/detailRepetition';

describe('pavimento → grupo → detalhamento', () => {
  it('V1 em dois pavimentos mantém nomes qualificados e ocorrências distintas ao reunir', () => {
    let d = newProjectSetup();
    const first = d.activeDetailId;
    const floor = addProjectSetupNode(d, 'floor');
    const group = addProjectSetupNode(floor.draft, 'element', floor.id);
    d = group.draft;
    const second = d.project.hierarchy.details.at(-1)!.id;
    let p = completeOwnership(
      { ...d.project, bars: [{ ...newBar('N1'), id: 'first', quantity: 4 }] },
      first,
    );
    p = completeOwnership(
      {
        ...p,
        bars: [...p.bars, { ...newBar('N2'), id: 'second', quantity: 4 }],
      },
      second,
    );
    const plan = previewMergeRepetitions(p, first, [second]);
    expect(plan.issues).toEqual([]);
    expect(plan.names).toEqual([
      'Térreo / Vigas / V1',
      'Pavimento 1 / Vigas / V1',
    ]);
    expect(plan.afterPieces).toBe(8);
    expect(plan.afterWeight).toBeCloseTo(plan.beforeWeight, 10);
  });
  it('sugere V1/V2/V3 e P1 por grupo, mantendo o mesmo nome em outro pavimento independente', () => {
    let d = newProjectSetup();
    const floor = d.project.hierarchy.floors[0].id,
      group = d.project.hierarchy.elements[0].id;
    for (let i = 0; i < 2; i++)
      d = addProjectSetupNode(d, 'detail', group).draft;
    expect(d.project.hierarchy.details.map((x) => x.name)).toEqual([
      'V1',
      'V2',
      'V3',
    ]);
    const pillars = addProjectSetupNode(d, 'element', floor);
    d = pillars.draft;
    expect(d.project.hierarchy.elements.at(-1)?.name).toBe('Pilares');
    expect(d.project.hierarchy.details.at(-1)).toMatchObject({
      name: 'P1',
      elementId: pillars.id,
    });
    const upper = addProjectSetupNode(d, 'floor');
    const beams = addProjectSetupNode(upper.draft, 'element', upper.id);
    expect(beams.draft.project.hierarchy.details.at(-1)?.name).toBe('V1');
    expect(prepareProjectSetup(beams.draft).ok).toBe(true);
    expect(decodeProject(JSON.stringify(beams.draft.project))).toEqual(
      beams.draft.project,
    );
    expect(schedule(beams.draft.project)).toEqual([]);
  });
  it('abrir/rotular o desenho não modifica IDs, propriedade, nomes personalizados nem o arquivo', () => {
    const { project: p } = newProjectSetup(),
      drawing = p.hierarchy.drawings[0];
    const before = JSON.stringify(p);
    expect(drawingLabel(p, drawing)).toBe('V1');
    expect(drawingLabel(p, { ...drawing, name: 'Corte A' })).toBe(
      'V1 · Corte A',
    );
    expect(JSON.stringify(p)).toBe(before);
    const renamed = updateHierarchyNode(
      p,
      'detail',
      p.hierarchy.details[0].id,
      'V8',
      p.hierarchy.elements[0].id,
    );
    expect(drawingLabel(renamed, drawing)).toBe('V8');
    expect(renamed.hierarchy.drawings).toEqual(p.hierarchy.drawings);
    expect(nextDetailName(renamed, p.hierarchy.elements[0].id)).toBe('V1');
  });
  it('reunir V1/V2 do mesmo grupo usa os nomes dos detalhamentos, sem duplicar grupo ou somar aço duas vezes', () => {
    let { project: p } = newProjectSetup();
    const first = p.hierarchy.details[0].id;
    const second = createHierarchyNode(
      p,
      'detail',
      'V2',
      p.hierarchy.elements[0].id,
    );
    p = completeOwnership(
      { ...second.project, bars: [{ ...newBar('N1'), id: 'b1', quantity: 4 }] },
      first,
    );
    p = completeOwnership(
      { ...p, bars: [...p.bars, { ...newBar('N2'), id: 'b2', quantity: 4 }] },
      second.id,
    );
    const before = schedule(p).reduce((n, r) => n + r.quantity, 0),
      plan = previewMergeRepetitions(p, first, [second.id]);
    expect(plan.issues).toEqual([]);
    expect(plan.names).toEqual(['V1', 'V2']);
    expect(plan.project!.hierarchy.details[0].repetition?.elements).toEqual([
      { name: 'V1' },
      { name: 'V2' },
    ]);
    expect(plan.afterPieces).toBe(before);
    expect(plan.afterWeight).toBeCloseTo(plan.beforeWeight, 10);
    expect(decodeProject(JSON.stringify(plan.project))).toEqual(plan.project);
  });
});
