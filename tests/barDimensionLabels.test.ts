import { expect, it } from 'vitest';
import {
  drawingPrimitives,
  physicalBarTextPrimitives,
} from '../src/domain/drawingPrimitives';
import { fabricationSignature } from '../src/domain/fabrication';
import { completeOwnership } from '../src/domain/hierarchy';
import { emptyProject, newBar, schedule } from '../src/domain/model';
import { representationPrimitives } from '../src/domain/representations';
import { defaultStirrupCriteria } from '../src/domain/stirrupSchema';
import { criteriaBar } from '../src/domain/stirrups';
import type { Bar, Detail, Primitive } from '../src/domain/types';

const origin = { x: 0, y: 0 };
const elbow = (): Bar => ({
  ...newBar('N1'),
  points: [origin, { x: 1000, y: 0 }, { x: 1000, y: 500 }],
  diameter: 10,
  mandrel: 50,
});
const dimensions = (items: Primitive[]) =>
  items.filter((item) => (item.role ?? item.layer) === 'COTAS');
const captions = (items: Primitive[]) =>
  dimensions(items).map((item) => item.text);

it('preserva a apresentação legada e posiciona as duas convenções nas mesmas âncoras', () => {
  const b = elbow();
  const p = { ...emptyProject(), bars: [b] };
  const labels = (bar: Bar) => dimensions(physicalBarTextPrimitives(bar, p));
  expect(labels(b)).toEqual([]);
  const axis = labels({ ...b, dimensionConvention: 'axis' });
  const external = labels({ ...b, dimensionConvention: 'external' });
  expect(axis.map((item) => item.text)).toEqual([
    '100,0 cm (eixo)',
    '50,0 cm (eixo)',
  ]);
  expect(external.map((item) => item.text)).toEqual([
    '100,5 cm (ext.)',
    '50,5 cm (ext.)',
  ]);
  expect(external.map((item) => item.points)).toEqual(
    axis.map((item) => item.points),
  );
  expect(
    captions(
      drawingPrimitives({
        ...p,
        bars: [{ ...b, dimensionConvention: 'external' }],
      }),
    ),
  ).toEqual(captions(external));
});

it('usa a convenção de cada rebatimento com valores reais em escala, rotação e espelho', () => {
  const b = { ...elbow(), dimensionConvention: 'external' } as const;
  const p = { ...emptyProject(), bars: [b] };
  const d: Detail = { id: 'r1', barId: b.id, origin };
  expect(captions(representationPrimitives(b, d, p))).toEqual([
    '100,0',
    '50,0',
  ]);
  expect(
    captions(
      representationPrimitives(b, { ...d, dimensionConvention: 'axis' }, p),
    ),
  ).toEqual(['100,0 cm (eixo)', '50,0 cm (eixo)']);
  const view: Detail = {
    ...d,
    id: 'r2',
    origin: { x: 2000, y: 0 },
    dimensionConvention: 'external',
    scale: 2,
    rotation: 90,
    mirrored: true,
  };
  expect(captions(representationPrimitives(b, view, p))).toEqual([
    '100,5 cm (ext.)',
    '50,5 cm (ext.)',
  ]);
  const moved = dimensions(representationPrimitives(b, view, p))[0];
  expect(moved.points[0].x).toBeCloseTo(2080);
  expect(moved.points[0].y).toBeCloseTo(1000);
  expect(
    captions(
      representationPrimitives(b, { ...view, showDimensions: false }, p),
    ),
  ).toEqual([]);
  expect(
    captions(representationPrimitives({ ...b, diameter: 20 }, view, p)),
  ).toEqual(['101,0 cm (ext.)', '51,0 cm (ext.)']);
});

it('usa as faces do corpo do estribo retangular e mantém o eixo nas formas sem convenção externa', () => {
  const c = defaultStirrupCriteria();
  Object.assign(c, { diameter: 10, mandrel: 50, width: 250, height: 500 });
  c.profile.start.angle = c.profile.end.angle = 0;
  const b = criteriaBar(c, origin, 'N1', 'stirrup');
  const p = { ...emptyProject(), bars: [b] };
  expect(
    captions(
      physicalBarTextPrimitives({ ...b, dimensionConvention: 'external' }, p),
    ),
  ).toEqual(['26,0 cm (ext.)', '51,0 cm (ext.)']);
  expect(
    captions(
      physicalBarTextPrimitives(
        {
          ...b,
          dimensionConvention: 'external',
          stirrupProfile: { ...b.stirrupProfile!, closed: false },
        },
        p,
      ),
    ),
  ).toEqual(['25,0 cm (eixo)', '50,0 cm (eixo)']);
  const angular = {
    ...elbow(),
    points: [origin, { x: 1000, y: 0 }, { x: 1400, y: 300 }],
  };
  expect(
    captions(
      physicalBarTextPrimitives(
        { ...angular, dimensionConvention: 'external' },
        p,
      ),
    ),
  ).toEqual(['100,0 cm (eixo)', '50,0 cm (eixo)']);
});

it('conserva assinatura, corte, massa e 24 peças com duas convenções gráficas', () => {
  const b = { ...elbow(), quantity: 3, multiplier: 2 };
  const owned = completeOwnership({ ...emptyProject(), bars: [b] });
  const p = {
    ...owned,
    hierarchy: {
      ...owned.hierarchy,
      details: owned.hierarchy.details.map((d) => ({
        ...d,
        repetition: { factor: 4, elements: [] },
      })),
    },
  };
  const graphical = {
    ...b,
    dimensionConvention: 'external' as const,
  };
  const q = {
    ...p,
    bars: [graphical],
    details: [
      {
        id: 'r1',
        barId: b.id,
        origin,
        dimensionConvention: 'external' as const,
      },
      { id: 'r2', barId: b.id, origin, dimensionConvention: 'axis' as const },
    ],
  };
  const measure = ({
    quantity,
    unitLength,
    totalLength,
    weight,
  }: ReturnType<typeof schedule>[number]) => ({
    quantity,
    unitLength,
    totalLength,
    weight,
  });
  expect(schedule(p)[0].quantity).toBe(24);
  expect(schedule(q).map(measure)).toEqual(schedule(p).map(measure));
  expect(fabricationSignature(b)).toBeTypeOf('string');
  expect(fabricationSignature(graphical)).toBe(fabricationSignature(b));
});
