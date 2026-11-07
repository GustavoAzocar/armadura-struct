import { z } from 'zod';
import { geometry, vertices, world } from './geometry';
import { uid, type Bar, type Project, type ScheduleRow } from './types';
import {
  completeOwnership,
  initialHierarchy,
  legacyProjectId,
  validateHierarchy,
} from './hierarchy';
import { initialSheet, placeDrawing } from './sheets';
import { fitPlacement } from './paper';
import { validateSheetLayout } from './paperFormat';
const number = z.number().finite();
const point = z.object({ x: number, y: number });
const identity = z.string().min(1).max(200);
const named = { id: identity, name: z.string().trim().min(1).max(100) };
const hierarchySchema = z.object({
  floors: z
    .array(z.object({ ...named, name: z.string().min(1).max(150) }))
    .min(1)
    .max(1000),
  elements: z
    .array(z.object({ ...named, floorId: identity }))
    .min(1)
    .max(10000),
  details: z
    .array(
      z.object({
        ...named,
        elementId: identity,
        grouped: z.boolean().optional(),
        source: z
          .object({
            origin: z.object({
              projectId: identity,
              floorId: identity,
              elementId: identity,
              detailId: identity,
            }),
            projectName: z.string().max(150),
            path: z.string().max(500),
            revision: z.string().max(40),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(10000),
  drawings: z
    .array(z.object({ ...named, detailId: identity }))
    .min(1)
    .max(10000),
  placements: z
    .array(
      z.object({
        id: identity,
        drawingId: identity,
        sheetId: identity.optional(),
        modelOrigin: point.optional(),
        textHeight: number.min(2).max(10).optional(),
        title: z.string().max(200).optional(),
        legacyScale: number.positive().optional(),
        frame: z
          .object({
            width: number.positive().max(100000),
            height: number.positive().max(100000),
          })
          .optional(),
        origin: point,
        rotation: number,
        scale: number.positive().max(1000000),
      }),
    )
    .max(10000),
  objectDetails: z.record(z.string(), identity),
  objectOrigins: z
    .record(z.string(), z.object({ projectId: identity, objectId: identity }))
    .optional(),
});
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
  distribution: z
    .object({
      start: point.optional(),
      end: point,
      render: z.enum(['ticks', 'bars']).optional(),
    })
    .optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
const schema = z.object({
  schema: z.enum([
    'armadurastruct/1',
    'armadurastruct/2',
    'armadurastruct/3',
    'armadurastruct/4',
    'armadurastruct/5',
    'armadurastruct/6',
  ]),
  sheets: z
    .array(
      z.object({
        ...named,
        format: z.enum(['A0', 'A1', 'A2', 'A3', 'A4', 'custom']),
        customSize: z
          .object({
            width: number.min(50).max(5000),
            height: number.min(50).max(5000),
          })
          .optional(),
        margins: z
          .object({
            left: number.nonnegative(),
            right: number.nonnegative(),
            top: number.nonnegative(),
            bottom: number.nonnegative(),
          })
          .optional(),
        seal: z
          .object({
            enabled: z.boolean(),
            width: number.positive().max(5000),
            height: number.positive().max(5000),
          })
          .optional(),
        orientation: z.enum(['portrait', 'landscape']),
        properties: z.object({
          revision: z.string().max(40),
          notes: z.string().max(5000),
        }),
      }),
    )
    .max(1000)
    .optional(),
  id: identity.optional(),
  hierarchy: hierarchySchema.optional(),
  name: z.string().min(1).max(150),
  author: z.string().max(150),
  notes: z.string().max(5000),
  bars: z.array(barSchema).max(10000),
  polylines: z
    .array(
      z.object({
        id: z.string(),
        points: z.array(point).min(2).max(500),
        closed: z.boolean(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      }),
    )
    .max(10000)
    .default([]),
  annotations: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum([
          'dimension-aligned',
          'dimension-orthogonal',
          'leader',
          'section',
          'section-arc',
        ]),
        points: z.array(point).length(3),
        barId: z.string().optional(),
        label: z.string().max(200),
        textHeight: number.positive().max(10000),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      }),
    )
    .max(10000)
    .default([]),
  drawing: z
    .object({
      floor: z.string().max(150),
      revision: z.string().max(40),
      scale: number.min(0).max(10000),
    })
    .default({ floor: '', revision: '00', scale: 0 }),
  scheduleLock: z
    .object({ at: z.string(), bars: z.array(barSchema).max(10000) })
    .optional(),
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
export function decodeProject(
  raw: string,
  options: { allowOrphanReferences?: boolean } = {},
): Project {
  const parsed = schema.parse(JSON.parse(raw));
  const modern =
    parsed.schema === 'armadurastruct/3' ||
    parsed.schema === 'armadurastruct/4' ||
    parsed.schema === 'armadurastruct/5' ||
    parsed.schema === 'armadurastruct/6';
  if (modern && (!parsed.id || !parsed.hierarchy))
    throw new Error('Projeto sem identidade ou hierarquia.');
  let id = modern ? parsed.id! : legacyProjectId(raw);
  if (!modern) {
    const oldIds = new Set(
      [
        ...parsed.bars,
        ...parsed.details,
        ...parsed.annotations,
        ...parsed.polylines,
        ...parsed.masks,
      ].map((o) => o.id),
    );
    while (oldIds.has(id)) id += '-';
  }
  const hierarchy = modern
    ? parsed.hierarchy!
    : initialHierarchy(parsed, id, parsed.drawing.floor);
  const occupied = new Set(
    [
      id,
      ...parsed.bars,
      ...parsed.details,
      ...parsed.annotations,
      ...parsed.polylines,
      ...parsed.masks,
      ...hierarchy.floors,
      ...hierarchy.elements,
      ...hierarchy.details,
      ...hierarchy.drawings,
      ...hierarchy.placements,
    ].map((o) => (typeof o === 'string' ? o : o.id)),
  );
  let sheetId = `${id}:sheet`;
  while (occupied.has(sheetId)) sheetId += '-';
  const v6 = parsed.schema === 'armadurastruct/6';
  const v5 = parsed.schema === 'armadurastruct/5' || v6;
  if (v6 && !parsed.hierarchy?.objectOrigins)
    throw new Error('Projeto v6 sem identidades de origem.');
  const v4 = parsed.schema === 'armadurastruct/4' || v5;
  if (
    v5 &&
    (!parsed.sheets ||
      parsed.sheets.some((s) => !s.customSize || !s.margins || !s.seal) ||
      hierarchy.placements.some(
        (v) =>
          !v.modelOrigin || v.textHeight === undefined || v.title === undefined,
      ))
  )
    throw new Error('Projeto v5 com composição incompleta.');
  if (
    v4 &&
    (!parsed.sheets || hierarchy.placements.some((v) => !v.sheetId || !v.frame))
  )
    throw new Error('Projeto v4 sem folhas ou com vista incompleta.');
  const placements = hierarchy.placements.map((v) => ({
    ...v,
    sheetId: v4 ? v.sheetId! : sheetId,
    frame: v.frame ?? { width: 160, height: 100 },
    modelOrigin: v.modelOrigin ?? { x: 0, y: 0 },
    textHeight: v.textHeight ?? 2.5,
    title: v.title ?? '',
    ...(!v5 ? { legacyScale: v.scale } : {}),
  }));
  if (
    !modern &&
    [
      ...parsed.bars,
      ...parsed.details,
      ...parsed.annotations,
      ...parsed.polylines,
      ...parsed.masks,
    ].length
  ) {
    let placementId = `${id}:placement`;
    while (occupied.has(placementId) || placementId === sheetId)
      placementId += '-';
    placements.push({
      id: placementId,
      drawingId: hierarchy.drawings[0].id,
      sheetId,
      origin: { x: 0, y: 0 },
      rotation: 0,
      scale: 1,
      modelOrigin: { x: 0, y: 0 },
      textHeight: 2.5,
      title: '',
      legacyScale: 1,
      frame: { width: 160, height: 100 },
    });
  }
  let p: Project = {
    ...parsed,
    id,
    schema: 'armadurastruct/6',
    sheets: v4
      ? parsed.sheets!.map((s) => ({
          ...initialSheet(s.id),
          ...s,
          customSize: s.customSize ?? { width: 210, height: 297 },
          margins: s.margins ?? { left: 10, right: 10, top: 10, bottom: 10 },
          seal: s.seal ?? { enabled: false, width: 160, height: 40 },
        }))
      : [initialSheet(sheetId, parsed.drawing.revision)],
    hierarchy: {
      ...hierarchy,
      placements,
      objectOrigins: hierarchy.objectOrigins ?? {},
    },
  };
  for (const sheet of p.sheets) validateSheetLayout(sheet);
  const ids = p.bars.map((b) => b.id);
  if (new Set(ids).size !== ids.length)
    throw new Error('IDs de armadura duplicados.');
  if (new Set(p.bars.map((b) => b.mark)).size !== p.bars.length)
    throw new Error('Cada posição deve ter uma identificação única.');
  if (
    !options.allowOrphanReferences &&
    p.details.some((d) => !ids.includes(d.barId))
  )
    throw new Error('Rebatimento sem armadura correspondente.');
  if (
    new Set(p.details.map((d) => d.id)).size !== p.details.length ||
    new Set(p.masks.map((m) => m.id)).size !== p.masks.length
  )
    throw new Error('Identificadores duplicados em detalhes ou máscaras.');
  if (p.bars.some((b) => b.distribution && b.quantity < 2))
    throw new Error('Uma distribuição precisa de pelo menos duas peças.');
  const allIds = [
    ...p.bars,
    ...p.details,
    ...p.masks,
    ...p.annotations,
    ...p.polylines,
  ].map((o) => o.id);
  if (new Set(allIds).size !== allIds.length)
    throw new Error('Identificadores de objetos duplicados.');
  if (
    !options.allowOrphanReferences &&
    p.annotations.some((a) => a.barId && !ids.includes(a.barId))
  )
    throw new Error('Chamada sem armadura correspondente.');
  validateHierarchy(p);
  if (!v5)
    for (const view of p.hierarchy.placements) {
      try {
        p = fitPlacement(p, view.id);
      } catch {
        // A tiny legacy frame remains editable and reports overflow; never drop content.
        p = {
          ...p,
          hierarchy: {
            ...p.hierarchy,
            placements: p.hierarchy.placements.map((v) =>
              v.id === view.id ? { ...v, scale: 50 } : v,
            ),
          },
        };
      }
    }
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
export const emptyProject = (): Project => {
  const id = uid();
  const content = {
    bars: [],
    details: [],
    masks: [],
    annotations: [],
    polylines: [],
  };
  return {
    schema: 'armadurastruct/6',
    sheets: [initialSheet(`${id}:sheet`)],
    id,
    hierarchy: initialHierarchy(content, id),
    name: 'Novo projeto',
    author: '',
    notes: '',
    bars: [],
    details: [],
    masks: [],
    annotations: [],
    polylines: [],
    drawing: { floor: '', revision: '00', scale: 0 },
  };
};
export function schedule(p: Project): ScheduleRow[] {
  return (p.scheduleLock?.bars ?? p.bars).map((bar) => {
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
export function scheduleChanged(p: Project) {
  const fingerprint = (bars: Bar[]) =>
    JSON.stringify(
      bars.map((b) => ({
        id: b.id,
        mark: b.mark,
        element: b.element,
        steel: b.steel,
        diameter: b.diameter,
        quantity: b.quantity,
        kind: b.kind,
        points: b.points,
        width: b.width,
        height: b.height,
        hook: b.hook,
        mandrel: b.mandrel,
      })),
    );
  return (
    !!p.scheduleLock && fingerprint(p.bars) !== fingerprint(p.scheduleLock.bars)
  );
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
  for (const b of p.bars)
    if (b.distribution) {
      for (const origin of [
        b.distribution.start ?? b.origin,
        b.distribution.end,
      ])
        out.push(...vertices(b).map((v) => world(v, { ...b, origin })));
    }
  out.push(
    ...p.annotations.flatMap((a) => a.points),
    ...p.polylines.flatMap((l) => l.points),
  );
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
  p.drawing.floor = 'Pavimento tipo';
  p.hierarchy.floors[0].name = 'Pavimento tipo';
  p.annotations = [
    {
      id: uid(),
      kind: 'dimension-orthogonal',
      barId: c.id,
      points: [
        { x: 100, y: 0 },
        { x: 4900, y: 0 },
        { x: 2500, y: -300 },
      ],
      label: '',
      textHeight: 50,
      color: '#8c9bb3',
    },
    {
      id: uid(),
      kind: 'leader',
      barId: c.id,
      points: [
        { x: 5820, y: 540 },
        { x: 6050, y: 800 },
        { x: 6250, y: 800 },
      ],
      label: '',
      textHeight: 50,
      color: '#c89a4d',
    },
  ];
  return placeDrawing(
    completeOwnership(p),
    p.sheets[0].id,
    p.hierarchy.drawings[0].id,
  ).project;
}
