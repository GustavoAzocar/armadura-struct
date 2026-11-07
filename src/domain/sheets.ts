import {
  uid,
  type Project,
  type Sheet,
  type SheetFormat,
  type SheetPlacement,
} from './types';

const paper: Record<SheetFormat, [number, number]> = {
  A0: [841, 1189],
  A1: [594, 841],
  A2: [420, 594],
  A3: [297, 420],
  A4: [210, 297],
};
export function sheetSize(sheet: Pick<Sheet, 'format' | 'orientation'>) {
  const [short, long] = paper[sheet.format];
  return sheet.orientation === 'landscape'
    ? { width: long, height: short }
    : { width: short, height: long };
}
export function initialSheet(id: string, revision = '00'): Sheet {
  return {
    id,
    name: 'Folha 1',
    format: 'A3',
    orientation: 'landscape',
    properties: { revision, notes: '' },
  };
}
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
  if (
    !paper[next.format] ||
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
export function duplicateSheet(p: Project, id: string) {
  const source = requireSheet(p, id),
    nextId = uid();
  const copy = {
    ...source,
    id: nextId,
    name: title(`${source.name.slice(0, 92)} (cópia)`),
    properties: { ...source.properties },
  };
  const sheets = [...p.sheets];
  sheets.splice(sheets.findIndex((s) => s.id === id) + 1, 0, copy);
  return {
    id: nextId,
    project: {
      ...p,
      sheets,
      hierarchy: {
        ...p.hierarchy,
        placements: [
          ...p.hierarchy.placements,
          ...p.hierarchy.placements
            .filter((v) => v.sheetId === id)
            .map((v) => ({
              ...v,
              id: uid(),
              sheetId: nextId,
              origin: { ...v.origin },
              frame: { ...v.frame },
            })),
        ],
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
      x: 15 + (count % 2) * (width + 10),
      y: 15 + (Math.floor(count / 2) % 2) * (height + 10),
    },
    rotation: 0,
    scale: 1,
    frame: { width, height },
  };
  // Additional views may overlap, but never change or clone their source objects.
  view.origin.x = Math.min(view.origin.x, size.width - width - 10);
  view.origin.y = Math.min(view.origin.y, size.height - height - 10);
  return {
    id: view.id,
    project: {
      ...p,
      hierarchy: {
        ...p.hierarchy,
        placements: [...p.hierarchy.placements, view],
      },
    },
  };
}
export function updatePlacement(
  p: Project,
  id: string,
  patch: Partial<
    Pick<SheetPlacement, 'origin' | 'rotation' | 'scale' | 'frame'>
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
    ].every(Number.isFinite) ||
    next.scale <= 0 ||
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
export function duplicatePlacement(p: Project, id: string) {
  const source = p.hierarchy.placements.find((v) => v.id === id);
  if (!source) throw new Error('Vista inexistente.');
  const view = {
    ...source,
    id: uid(),
    origin: { x: source.origin.x + 10, y: source.origin.y + 10 },
    frame: { ...source.frame },
  };
  return {
    id: view.id,
    project: {
      ...p,
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
