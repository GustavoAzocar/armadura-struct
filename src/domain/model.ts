import { z } from 'zod';
import { geometry, vertices, world } from './geometry';
import { uid, type Bar, type Project, type ScheduleRow } from './types';
const number = z.number().finite();
const point = z.object({ x: number, y: number });
const barSchema = z.object({
  id: z.string(),
  mark: z.string().min(1).max(40),
  element: z.string().max(100),
  kind: z.enum(['free', 'stirrup']),
  origin: point,
  rotation: number,
  points: z.array(point).min(2).max(500),
  width: number.positive(),
  height: number.positive(),
  hook: number.nonnegative(),
  diameter: number.positive().max(100),
  mandrel: number.positive().max(2000),
  steel: z.enum(['CA-50', 'CA-60']),
  quantity: z.number().int().min(1).max(100000),
  distribution: z.object({ end: point }).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
const schema = z.object({
  schema: z.literal('armadurastruct/1'),
  name: z.string().min(1).max(150),
  author: z.string().max(150),
  notes: z.string().max(5000),
  bars: z.array(barSchema).max(10000),
  details: z
    .array(z.object({ id: z.string(), barId: z.string(), origin: point }))
    .max(10000),
  masks: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().max(200),
        format: z.enum(['DXF', 'DWG', 'DEMO']),
        primitives: z
          .array(
            z.object({
              layer: z.string(),
              points: z.array(point).max(100000),
              closed: z.boolean().optional(),
              text: z.string().optional(),
              textHeight: number.optional(),
              textRotation: number.optional(),
            }),
          )
          .max(100000),
        layers: z.record(z.string(), z.boolean()),
        visible: z.boolean(),
        opacity: number.min(0).max(1),
        scale: number.positive().max(1000000),
        origin: point,
        rotation: number,
        sourceUnit: z.string(),
        warnings: z.array(z.string()),
      }),
    )
    .max(20),
});
export function decodeProject(raw: string): Project {
  const p = schema.parse(JSON.parse(raw));
  const ids = p.bars.map((b) => b.id);
  if (new Set(ids).size !== ids.length)
    throw new Error('IDs de armadura duplicados.');
  if (new Set(p.bars.map((b) => b.mark)).size !== p.bars.length)
    throw new Error('Cada posição deve ter uma identificação única.');
  if (p.details.some((d) => !ids.includes(d.barId)))
    throw new Error('Rebatimento sem armadura correspondente.');
  if (
    new Set(p.details.map((d) => d.id)).size !== p.details.length ||
    new Set(p.masks.map((m) => m.id)).size !== p.masks.length
  )
    throw new Error('Identificadores duplicados em detalhes ou máscaras.');
  if (p.bars.some((b) => b.distribution && b.quantity < 2))
    throw new Error('Uma distribuição precisa de pelo menos duas peças.');
  return p;
}
export function newBar(mark: string): Bar {
  return {
    id: uid(),
    mark,
    element: 'Geral',
    kind: 'free',
    origin: { x: 0, y: 0 },
    rotation: 0,
    points: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
    ],
    width: 250,
    height: 500,
    hook: 80,
    diameter: 8,
    mandrel: 40,
    steel: 'CA-50',
    quantity: 1,
    color: '#4b71e8',
  };
}
export function nextMark(p: Project) {
  let i = 1;
  while (p.bars.some((b) => b.mark === `N${i}`)) i++;
  return `N${i}`;
}
export const emptyProject = (): Project => ({
  schema: 'armadurastruct/1',
  name: 'Novo projeto',
  author: '',
  notes: '',
  bars: [],
  details: [],
  masks: [],
});
export function schedule(p: Project): ScheduleRow[] {
  return p.bars.map((bar) => {
    const g = geometry(bar),
      totalLength = (g.length * bar.quantity) / 1000;
    return {
      mark: bar.mark,
      element: bar.element,
      steel: bar.steel,
      diameter: bar.diameter,
      quantity: bar.quantity,
      unitLength: g.length / 1000,
      totalLength,
      weight: totalLength * ((Math.PI * (bar.diameter / 1000) ** 2) / 4) * 7850,
      errors: g.errors,
      bar,
    };
  });
}
export function projectPoints(p: Project) {
  const out = p.bars.flatMap((b) => vertices(b).map((v) => world(v, b)));
  for (const d of p.details) {
    const b = p.bars.find((b) => b.id === d.barId);
    if (b)
      out.push(
        ...vertices(b).map((v) => ({
          x: v.x + d.origin.x,
          y: v.y + d.origin.y,
        })),
      );
  }
  for (const b of p.bars) if (b.distribution) out.push(b.distribution.end);
  return out;
}
export function demoProject(): Project {
  const p = emptyProject();
  p.name = 'Detalhamento · Viga V01';
  p.author = 'OpenStruct';
  const a = {
    ...newBar('N1'),
    element: 'V01 · Inferior',
    diameter: 12.5,
    mandrel: 62.5,
    quantity: 3,
    origin: { x: 100, y: 130 },
    points: [
      { x: 0, y: 260 },
      { x: 0, y: 0 },
      { x: 4800, y: 0 },
      { x: 4800, y: 260 },
    ],
  };
  const b = {
    ...newBar('N2'),
    element: 'V01 · Superior',
    diameter: 10,
    mandrel: 50,
    quantity: 2,
    origin: { x: 100, y: 480 },
    color: '#20a990',
    points: [
      { x: 0, y: -180 },
      { x: 0, y: 0 },
      { x: 4800, y: 0 },
      { x: 4800, y: -180 },
    ],
  };
  const c = {
    ...newBar('N3'),
    element: 'V01 · Estribos',
    kind: 'stirrup' as const,
    diameter: 6.3,
    mandrel: 31.5,
    quantity: 25,
    width: 220,
    height: 440,
    hook: 65,
    origin: { x: 5600, y: 100 },
    color: '#d49432',
  };
  p.bars = [a, b, c];
  p.details = [
    { id: uid(), barId: a.id, origin: { x: 100, y: -700 } },
    { id: uid(), barId: b.id, origin: { x: 100, y: -1450 } },
  ];
  p.masks = [
    {
      id: uid(),
      name: 'Fôrma V01 · exemplo',
      format: 'DEMO',
      visible: true,
      opacity: 0.6,
      origin: { x: 0, y: 0 },
      rotation: 0,
      scale: 1,
      sourceUnit: 'mm',
      layers: { FORMAS: true, EIXOS: true },
      warnings: [],
      primitives: [
        {
          layer: 'FORMAS',
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 5000, y: 0 },
            { x: 5000, y: 600 },
            { x: 0, y: 600 },
          ],
        },
        {
          layer: 'FORMAS',
          closed: true,
          points: [
            { x: 5550, y: 0 },
            { x: 5870, y: 0 },
            { x: 5870, y: 600 },
            { x: 5550, y: 600 },
          ],
        },
        {
          layer: 'EIXOS',
          points: [
            { x: -200, y: 300 },
            { x: 5200, y: 300 },
          ],
        },
        ...Array.from({ length: 25 }, (_, i) => ({
          layer: 'FORMAS',
          points: [
            { x: 100 + i * 200, y: 90 },
            { x: 100 + i * 200, y: 510 },
          ],
        })),
      ],
    },
  ];
  return p;
}
