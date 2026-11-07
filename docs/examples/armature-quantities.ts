import { executeRebarBatch, applyRebarBatch } from '../../src/api';
import { emptyProject, schedule, decodeProject } from '../../src/domain/model';
import { setDetailRepetition } from '../../src/domain/detailRepetition';
import { placeDrawing, duplicatePlacement } from '../../src/domain/sheets';

export function createArmatureQuantityExample() {
  const p = emptyProject(),
    detailId = p.hierarchy.details[0].id;
  const result = executeRebarBatch(
    p,
    [
      {
        type: 'bar.create',
        id: 'quantity-example',
        detailId,
        definition: {
          kind: 'free',
          points: [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
          ],
          diameter: 10,
          mandrel: 50,
          steel: 'CA-50',
          quantity: 2,
          multiplier: 3,
          comment: 'Montagem por nervura',
          ribbed: true,
          showRibbed: true,
          columnLevel: 'L2',
        },
      },
      {
        type: 'representation.create',
        id: 'quantity-representation',
        barId: 'quantity-example',
        origin: { x: 0, y: -400 },
      },
    ],
    { units: 'mm' },
  );
  let next = applyRebarBatch(p, result);
  next = setDetailRepetition(next, detailId, { factor: 4, elements: [] });
  next = placeDrawing(
    next,
    next.sheets[0].id,
    next.hierarchy.drawings[0].id,
  ).project;
  next = duplicatePlacement(next, next.hierarchy.placements[0].id).project;
  const project = decodeProject(JSON.stringify(next)),
    row = schedule(project)[0];
  if (
    row.quantity !== 24 ||
    row.baseQuantity !== 2 ||
    row.multiplier !== 3 ||
    row.repetitions !== 4 ||
    row.totalLength !== 24 ||
    project.hierarchy.placements.length !== 2
  )
    throw new Error('Armature quantity example invariants failed.');
  return { project, detailId };
}
