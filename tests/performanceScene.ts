import { completeOwnership } from '../src/domain/hierarchy';
import { emptyProject, newBar } from '../src/domain/model';
import type { Project } from '../src/domain/types';

/** Fixed dimensions and IDs for repeatable CAD interaction measurements. */
export function performanceScene(withMask = true): Project {
  const p = emptyProject();
  p.id = 'performance:large';
  p.name = 'CAD — cena de desempenho';
  p.bars = Array.from({ length: 400 }, (_, i) => ({
    ...newBar(`N${i + 1}`),
    id: `performance:bar:${i}`,
    kind: i % 5 === 0 ? ('stirrup' as const) : ('free' as const),
    origin: { x: (i % 20) * 1600, y: Math.floor(i / 20) * 1200 },
    points: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 400 },
    ],
    width: 500,
    height: 700,
    quantity: 4,
  }));
  p.details = p.bars.map((b, i) => ({
    id: `performance:representation:${i}`,
    barId: b.id,
    origin: { x: b.origin.x, y: b.origin.y + 700 },
    rotation: 15,
    scale: 0.5,
  }));
  p.masks = withMask
    ? [
        {
          id: 'performance:mask',
          name: 'Referência sintética DXF',
          format: 'DXF',
          origin: { x: 0, y: 0 },
          rotation: 0,
          scale: 1,
          opacity: 0.5,
          visible: true,
          sourceUnit: 'mm',
          warnings: [],
          layers: { FORMA: true },
          primitives: Array.from({ length: 20000 }, (_, i) => ({
            layer: 'FORMA',
            points: [
              { x: (i % 200) * 160, y: Math.floor(i / 200) * 240 },
              { x: (i % 200) * 160 + 100, y: Math.floor(i / 200) * 240 + 60 },
            ],
          })),
        },
      ]
    : [];
  return completeOwnership(p);
}
