import {
  emptyProject,
  newBar,
  createScheduleLock,
} from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import { newNativeMask, nativePrimitive } from '../../src/domain/nativeMasks';
export function maskCadFixture(kind: 'trim' | 'extend' | 'circle' = 'trim') {
  const line = (id: string, a: number, b: number, c: number, d: number) =>
    nativePrimitive(
      {
        kind: 'line',
        points: [
          { x: a, y: b },
          { x: c, y: d },
        ],
        closed: false,
      },
      id,
      'DESENHO',
    );
  const target = {
    ...newNativeMask('Fôrma ativa'),
    id: 'target-mask',
    primitives:
      kind === 'circle'
        ? [
            nativePrimitive(
              { kind: 'circle', center: { x: 500, y: 0 }, radius: 200 },
              'circle',
              'DESENHO',
            ),
            line('vertical', 500, -300, 500, 300),
            line('arc-limit', 650, 0, 750, 0),
          ]
        : kind === 'extend'
          ? [
              line('target', 0, 0, 400, 0),
              line('near', 700, -300, 700, 300),
              line('far', 1000, -300, 1000, 300),
            ]
          : [
              line('target', 0, 0, 1000, 0),
              line('second', 0, 100, 1000, 100),
              line('limit-a', 300, -300, 300, 300),
              line('limit-b', 700, -300, 700, 300),
            ],
  };
  let p = completeOwnership({
    ...emptyProject(),
    name: 'Máscaras CAD',
    bars: [{ ...newBar('N1'), quantity: 8, origin: { x: 0, y: -1000 } }],
    masks: [
      target,
      { ...newNativeMask('Referência externa'), id: 'external-mask' },
    ],
  });
  p = { ...p, scheduleLock: createScheduleLock(p) };
  return p;
}
