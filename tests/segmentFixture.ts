import { emptyProject, newBar } from '../src/domain/model';
import { completeOwnership } from '../src/domain/hierarchy';
export function segmentFixture(bent = false) {
  return completeOwnership({
    ...emptyProject(),
    name: 'AS-26 · dimensões',
    bars: [
      {
        ...newBar('N1'),
        id: 'a',
        quantity: 2,
        multiplier: 3,
        points: bent
          ? [
              { x: 0, y: 0 },
              { x: 1000, y: 0 },
              { x: 1000, y: 500 },
            ]
          : [
              { x: 0, y: 0 },
              { x: 1000, y: 0 },
            ],
      },
    ],
    details: [1, 2, 3].map((i) => ({
      id: `rep${i}`,
      barId: 'a',
      origin: { x: i * 1500, y: -1000 },
      rotation: 30,
      scale: 2,
    })),
    polylines: [
      {
        id: 'poly',
        color: '#8899aa',
        points: [
          { x: 0, y: 2000 },
          { x: 1000, y: 2000 },
        ],
        closed: false,
      },
    ],
  });
}
