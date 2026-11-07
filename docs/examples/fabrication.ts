import { executeRebarBatch, applyRebarBatch } from '../../src/api';
import { emptyProject, schedule } from '../../src/domain/model';

/** Executable in Node through Vite SSR, or imported by another OpenStruct generator. */
export function createFabricationExample() {
  const project = emptyProject(),
    detailId = project.hierarchy.details[0].id;
  const result = executeRebarBatch(
    project,
    [
      {
        type: 'bar.create',
        id: 'occurrence-a',
        detailId,
        definition: {
          kind: 'free',
          diameter: 10,
          mandrel: 50,
          steel: 'CA-50',
          quantity: 4,
          points: [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
          ],
          manufacturing: { start: { kind: 'coupler', code: 'SPEC-M20' } },
        },
      },
      {
        type: 'bar.create',
        id: 'occurrence-b',
        detailId,
        definition: {
          kind: 'free',
          diameter: 10,
          mandrel: 50,
          steel: 'CA-50',
          quantity: 3,
          origin: { x: 2000, y: 500 },
          points: [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
          ],
          manufacturing: { start: { kind: 'coupler', code: 'SPEC-M20' } },
        },
      },
      {
        type: 'representation.create',
        id: 'presentation-b',
        barId: 'occurrence-b',
        origin: { x: 0, y: -500 },
      },
      {
        type: 'fabrication.group',
        ids: ['occurrence-a', 'occurrence-b'],
        representativeId: 'occurrence-a',
        mark: 'N1',
        reverse: true,
      },
    ],
    { units: 'mm' },
  );
  const next = applyRebarBatch(project, result);
  const rows = schedule(next);
  if (
    next.bars.length !== 2 ||
    rows.length !== 1 ||
    rows[0].quantity !== 7 ||
    rows[0].totalLength !== 7
  )
    throw new Error('Fabrication example invariants failed.');
  return { project: next, result };
}
