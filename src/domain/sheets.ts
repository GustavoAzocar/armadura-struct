import { sheetSteelScheduleSchema } from './sheetSchedule';
import {
  uid,
  type Project,
  type Sheet,
  type SheetFormat,
  type SheetPlacement,
} from './types';

import {
  initialSheet,
  sheetSize,
  paper,
  validateSheetLayout,
} from './paperFormat';
import { fitPlacement, alignPlacement } from './paper';
export { initialSheet, sheetSize } from './paperFormat';

function title(name: string) {
  const value = name.trim();
  if (!value || value.length > 100)
    throw new Error('Informe um nome de 1 a 100 caracteres.');
  return value;
}
function requireSheet(p: Project, id: string) {
  const sheet = p.sheets.find((s) => s.id === id);
  if (!sheet) throw new Error('Folha inexistente.');
  return sheet;
}
export function createSheet(p: Project, name: string) {
  const sheet = {
    ...initialSheet(uid(), p.drawing.revision),
    name: title(name),
  };
  return { project: { ...p, sheets: [...p.sheets, sheet] }, id: sheet.id };
}
export function updateSheet(
  p: Project,
  id: string,
  patch: Partial<Omit<Sheet, 'id'>>,
): Project {
  const sheet = requireSheet(p, id);
  const next = { ...sheet, ...patch, name: title(patch.name ?? sheet.name) };
  validateSheetLayout(next);
  if (next.steelSchedule) sheetSteelScheduleSchema.parse(next.steelSchedule);
  if (
    (next.format !== 'custom' && !paper[next.format]) ||
    !['portrait', 'landscape'].includes(next.orientation)
  )
    throw new Error('Formato ou orientação inválidos.');
  if (
    next.properties.revision.length > 40 ||
    next.properties.notes.length > 5000
  )
    throw new Error('Propriedades da folha excedem o limite.');
  return { ...p, sheets: p.sheets.map((s) => (s.id === id ? next : s)) };
}
export function reorderSheet(p: Project, id: string, offset: -1 | 1): Project {
  requireSheet(p, id);
  const sheets = [...p.sheets],
    index = sheets.findIndex((s) => s.id === id),
    target = index + offset;
  if (target < 0 || target >= sheets.length) return p;
  [sheets[index], sheets[target]] = [sheets[target], sheets[index]];
  return { ...p, sheets };
}
function copyViewContexts(
  p: Project,
  pairs: [string, string][],
): Project['layerEnvironment'] {
  if (!p.layerEnvironment) return undefined;
  const contexts = { ...p.layerEnvironment.contexts };
  for (const [source, target] of pairs) {
    const c = contexts[`view:${source}`];
    if (c) contexts[`view:${target}`] = structuredClone(c);
  }
  return { ...p.layerEnvironment, contexts };
}
export function duplicateSheet(
  p: Project,
  id: string,
): { id: string; project: Project } {
  const source = requireSheet(p, id),
    nextId = uid();
  const copy = {
    ...source,
    id: nextId,
    name: title(`${source.name.slice(0, 92)} (cópia)`),
    properties: { ...source.properties },
    customSize: { ...source.customSize },
    margins: { ...source.margins },
    seal: { ...source.seal },
    ...(source.steelSchedule
      ? {
          steelSchedule: {
            ...source.steelSchedule,
            origin: { ...source.steelSchedule.origin },
          },
        }
      : {}),
  };
  const originalViews = p.hierarchy.placements.filter((v) => v.sheetId === id);
  const copies = originalViews.map((v) => ({
    ...v,
    id: uid(),
    sheetId: nextId,
    origin: { ...v.origin },
    frame: { ...v.frame },
    modelOrigin: { ...v.modelOrigin },
  }));
  const sheets = [...p.sheets];
  sheets.splice(sheets.findIndex((s) => s.id === id) + 1, 0, copy);
  return {
    id: nextId,
    project: {
      ...p,
      sheets,
      layerEnvironment: copyViewContexts(
        p,
        originalViews.map((v, i) => [v.id, copies[i].id]),
      ),
      hierarchy: {
        ...p.hierarchy,
        placements: [...p.hierarchy.placements, ...copies],
      },
    },
  };
}
/** Only placements belong to a sheet. Physical objects and drawing definitions survive. */
export function deleteSheet(p: Project, id: string): Project {
  requireSheet(p, id);
  return {
    ...p,
    sheets: p.sheets.filter((s) => s.id !== id),
    hierarchy: {
      ...p.hierarchy,
      placements: p.hierarchy.placements.filter((v) => v.sheetId !== id),
    },
  };
}
export function placeDrawing(p: Project, sheetId: string, drawingId: string) {
  const sheet = requireSheet(p, sheetId);
  if (!p.hierarchy.drawings.some((d) => d.id === drawingId))
    throw new Error('Desenho inexistente.');
  const count = p.hierarchy.placements.filter(
    (v) => v.sheetId === sheetId,
  ).length;
  const size = sheetSize(sheet),
    width = Math.min(160, size.width - 30),
    height = Math.min(100, size.height - 30);
  const view: SheetPlacement = {
    id: uid(),
    sheetId,
    drawingId,
    origin: {
      x: sheet.margins.left + 5 + (count % 2) * (width + 10),
      y:
        sheet.margins.bottom +
        (sheet.seal.enabled ? sheet.seal.height : 0) +
        5 +
        (Math.floor(count / 2) % 2) * (height + 10),
    },
    rotation: 0,
    scale: 50,
    modelOrigin: { x: 0, y: 0 },
    textHeight: 2.5,
    title: '',
    frame: { width, height },
  };
  // Additional views may overlap, but never change or clone their source objects.
  view.origin.x = Math.min(view.origin.x, size.width - width - 10);
  view.origin.y = Math.min(view.origin.y, size.height - height - 10);
  const project = {
    ...p,
    hierarchy: {
      ...p.hierarchy,
      placements: [...p.hierarchy.placements, view],
    },
  };
  try {
    return { id: view.id, project: fitPlacement(project, view.id) };
  } catch {
    try {
      return { id: view.id, project: alignPlacement(project, view.id) };
    } catch {
      return { id: view.id, project };
    } // Keep the reference editable; composition reports the source error.
  }
}
export function updatePlacement(
  p: Project,
  id: string,
  patch: Partial<
    Pick<
      SheetPlacement,
      | 'origin'
      | 'rotation'
      | 'scale'
      | 'frame'
      | 'modelOrigin'
      | 'textHeight'
      | 'title'
    >
  >,
): Project {
  const view = p.hierarchy.placements.find((v) => v.id === id);
  if (!view) throw new Error('Vista inexistente.');
  const next = { ...view, ...patch };
  if (
    ![
      next.origin.x,
      next.origin.y,
      next.rotation,
      next.scale,
      next.frame.width,
      next.frame.height,
      next.modelOrigin.x,
      next.modelOrigin.y,
      next.textHeight,
    ].every(Number.isFinite) ||
    next.scale <= 0 ||
    next.textHeight < 2 ||
    next.textHeight > 10 ||
    next.title.length > 200 ||
    next.frame.width <= 0 ||
    next.frame.height <= 0 ||
    next.frame.width > 100000 ||
    next.frame.height > 100000 ||
    next.scale > 1000000
  )
    throw new Error('Posição, escala ou tamanho da vista inválidos.');
  return {
    ...p,
    hierarchy: {
      ...p.hierarchy,
      placements: p.hierarchy.placements.map((v) => (v.id === id ? next : v)),
    },
  };
}
export function removePlacement(p: Project, id: string): Project {
  if (!p.hierarchy.placements.some((v) => v.id === id))
    throw new Error('Vista inexistente.');
  return {
    ...p,
    hierarchy: {
      ...p.hierarchy,
      placements: p.hierarchy.placements.filter((v) => v.id !== id),
    },
  };
}
export function duplicatePlacement(
  p: Project,
  id: string,
): { id: string; project: Project } {
  const source = p.hierarchy.placements.find((v) => v.id === id);
  if (!source) throw new Error('Vista inexistente.');
  const view = {
    ...source,
    id: uid(),
    origin: { x: source.origin.x + 10, y: source.origin.y + 10 },
    frame: { ...source.frame },
    modelOrigin: { ...source.modelOrigin },
  };
  return {
    id: view.id,
    project: {
      ...p,
      layerEnvironment: copyViewContexts(p, [[id, view.id]]),
      hierarchy: {
        ...p.hierarchy,
        placements: [...p.hierarchy.placements, view],
      },
    },
  };
}
export function unplacedDrawings(p: Project) {
  const placed = new Set(p.hierarchy.placements.map((v) => v.drawingId));
  return p.hierarchy.drawings.filter((d) => !placed.has(d.id));
}
