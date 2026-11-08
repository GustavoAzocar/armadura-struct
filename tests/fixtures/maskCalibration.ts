import {
  emptyProject,
  newBar,
  createScheduleLock,
} from '../../src/domain/model';
import { completeOwnership } from '../../src/domain/hierarchy';
import { newNativeMask, nativePrimitive } from '../../src/domain/nativeMasks';
import type { Mask } from '../../src/domain/types';
export function calibrationFixture(format: Mask['format'] = 'NATIVE') {
  const m: Mask = {
    ...newNativeMask('Referência de calibração'),
    id: 'calibration-mask',
    format,
    sourceUnit: format === 'NATIVE' ? 'mm' : 'cm',
    layers: { FORMA: true },
    primitives: [
      nativePrimitive(
        {
          kind: 'line',
          points: [
            { x: 100, y: 100 },
            { x: 600, y: 100 },
          ],
          closed: false,
        },
        'native-line',
        'FORMA',
      ),
      nativePrimitive(
        { kind: 'circle', center: { x: 350, y: 400 }, radius: 50 },
        'native-circle',
        'FORMA',
      ),
      ...(format !== 'NATIVE'
        ? [
            {
              layer: 'FORMA',
              text: 'Referência',
              points: [{ x: 100, y: 150 }],
              textHeight: 25,
              textAlign: 'center' as const,
              textRotation: 30,
            },
          ]
        : []),
    ],
  };
  let p = completeOwnership({
    ...emptyProject(),
    bars: [{ ...newBar('N1'), id: 'physical-bar', quantity: 8 }],
    masks: [m, { ...newNativeMask('Outra máscara'), id: 'other-mask' }],
    annotations: [
      {
        id: 'external-dimension',
        kind: 'dimension-aligned',
        points: [
          { x: 100, y: 100 },
          { x: 600, y: 100 },
          { x: 100, y: 250 },
        ],
        label: '',
        textHeight: 50,
        color: '#8899aa',
      },
    ],
  });
  p = { ...p, scheduleLock: createScheduleLock(p) };
  return {
    p,
    m: p.masks[0],
    context: { key: 'model', detailId: p.hierarchy.details[0].id },
  };
}
