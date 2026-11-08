import { emptyProject, newBar } from '../src/domain/model';
import { completeOwnership } from '../src/domain/hierarchy';
export function zoomFixture() {
  const a = {
    ...newBar('N1'),
    id: 'straight',
    points: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
    ],
    quantity: 4,
  };
  return completeOwnership({
    ...emptyProject(),
    name: 'Proporção de textos',
    bars: [
      a,
      {
        ...newBar('N2'),
        id: 'bent',
        origin: { x: 1500, y: 0 },
        points: [
          { x: 0, y: 0 },
          { x: 800, y: 0 },
          { x: 800, y: 500 },
        ],
      },
      {
        ...newBar('N3'),
        id: 'stirrup',
        kind: 'stirrup',
        origin: { x: 0, y: 1000 },
        width: 500,
        height: 700,
      },
      {
        ...newBar('N4'),
        id: 'distributed',
        quantity: 5,
        origin: { x: 3000, y: 0 },
        distribution: { end: { x: 4000, y: 0 } },
      },
    ],
    details: [
      { id: 'legacy', barId: a.id, origin: { x: 0, y: -800 } },
      {
        id: 'rotated',
        barId: a.id,
        origin: { x: 1800, y: 1800 },
        rotation: 37,
        scale: 2,
        identification: 'mark',
        label: { origin: { x: 500, y: -100 }, rotation: 20, height: 25 },
      },
    ],
    annotations: [
      {
        id: 'leader',
        kind: 'leader',
        points: [
          { x: 2000, y: 0 },
          { x: 2200, y: 600 },
          { x: 2600, y: 600 },
        ],
        label: 'Chamada de teste',
        textHeight: 60,
        color: '#8899aa',
      },
      {
        id: 'dim',
        kind: 'dimension-aligned',
        points: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 500, y: 350 },
        ],
        label: '',
        textHeight: 30,
        color: '#8899aa',
      },
    ],
    masks: [
      {
        id: 'imported',
        name: 'Texto DXF',
        format: 'DXF',
        origin: { x: 0, y: 0 },
        rotation: 0,
        scale: 1,
        opacity: 1,
        visible: true,
        sourceUnit: 'mm',
        warnings: [],
        layers: { TEXTO: true },
        primitives: [
          {
            layer: 'TEXTO',
            points: [{ x: 0, y: 2300 }],
            text: 'Pequeno',
            textHeight: 12,
            textRotation: 17,
          },
          {
            layer: 'TEXTO',
            points: [{ x: 0, y: 2500 }],
            text: 'Grande',
            textHeight: 90,
            textAlign: 'right',
          },
        ],
      },
    ],
  });
}
