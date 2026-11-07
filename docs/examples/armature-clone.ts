import { applyRebarBatch, executeRebarBatch } from '../../src/api';
import { emptyProject } from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';

/** Two insertions, one call, a linked auxiliary and a physical distribution. */
export function createCloneSource() {
  const base = emptyProject();
  base.name = 'AS-53 · armadura e variante independente';
  const result = executeRebarBatch(
    base,
    [
      {
        type: 'bar.create',
        id: 'original',
        detailId: base.hierarchy.details[0].id,
        definition: {
          kind: 'free',
          mark: 'N1',
          diameter: 10,
          mandrel: 50,
          steel: 'CA-50',
          quantity: 4,
          multiplier: 2,
          comment: 'Montagem em pares',
          ribbed: true,
          columnLevel: 'Lance 1',
          origin: { x: 100, y: 200 },
          points: [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
          ],
        },
      },
      {
        type: 'distribution.set',
        barId: 'original',
        distribution: {
          start: { x: 100, y: 200 },
          end: { x: 100, y: 800 },
          render: 'ticks',
        },
        count: { mode: 'quantity', quantity: 4 },
      },
      {
        type: 'representation.create',
        id: 'view-a',
        barId: 'original',
        origin: { x: 100, y: -400 },
        identification: 'primary',
        label: { origin: { x: 250, y: -150 }, rotation: 0, height: 40 },
      },
      {
        type: 'representation.create',
        id: 'view-b',
        barId: 'original',
        origin: { x: 1800, y: 200 },
        rotation: 90,
        scale: 2,
        identification: 'mark',
      },
    ],
    { units: 'mm' },
  );
  return completeOwnership({
    ...applyRebarBatch(base, result),
    annotations: [
      {
        id: 'call',
        barId: 'original',
        kind: 'leader',
        points: [
          { x: 100, y: 200 },
          { x: 300, y: 400 },
          { x: 700, y: 400 },
        ],
        label: '',
        textHeight: 40,
        color: '#777777',
      },
    ],
    polylines: [
      {
        id: 'aux',
        barIds: ['original'],
        points: [
          { x: 0, y: 150 },
          { x: 1100, y: 150 },
        ],
        closed: false,
        color: '#888888',
      },
    ],
  });
}
export function createArmatureCloneExample() {
  const source = createCloneSource();
  const result = executeRebarBatch(
    source,
    [
      {
        type: 'armature.clone',
        barIds: ['original'],
        delta: { x: 3500, y: 0 },
        ids: {
          original: 'variant',
          'view-a': 'variant-a',
          'view-b': 'variant-b',
          call: 'variant-call',
          aux: 'variant-aux',
        },
      },
      {
        type: 'bar.update',
        id: 'variant',
        patch: { kind: 'free', diameter: 12.5 },
      },
    ],
    { units: 'mm' },
  );
  return { source, result, project: applyRebarBatch(source, result) };
}
