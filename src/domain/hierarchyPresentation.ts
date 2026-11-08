import type { Project, DetailDrawing } from './types';

/** UI terminology; persisted hierarchy IDs/contracts remain unchanged. */
export const elementGroups = [
  'Vigas',
  'Pilares',
  'Lajes',
  'Fundações',
  'Escadas',
  'Outros',
] as const;
const normalize = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
export function nextGroupName(project: Project, floorId: string) {
  const names = new Set(
    project.hierarchy.elements
      .filter((e) => e.floorId === floorId)
      .map((e) => normalize(e.name)),
  );
  return (
    elementGroups.find((name) => !names.has(normalize(name))) ??
    nextName('Grupo ', names)
  );
}
function nextName(prefix: string, names: Set<string>) {
  let n = 1;
  while (names.has(normalize(`${prefix}${n}`))) n++;
  return `${prefix}${n}`;
}
export function nextDetailName(project: Project, elementId: string) {
  const group = normalize(
    project.hierarchy.elements.find((e) => e.id === elementId)?.name ?? '',
  );
  const prefix =
    (
      {
        vigas: 'V',
        pilares: 'P',
        lajes: 'L',
        fundacoes: 'F',
        escadas: 'E',
      } as Record<string, string>
    )[group] ?? 'Detalhamento ';
  return nextName(
    prefix,
    new Set(
      project.hierarchy.details
        .filter((d) => d.elementId === elementId)
        .map((d) => normalize(d.name)),
    ),
  );
}
/** A default drawing is the detail's editing surface, not a fourth visible level. */
export function drawingLabel(project: Project, drawing: DetailDrawing) {
  const detail =
    project.hierarchy.details.find((d) => d.id === drawing.detailId)?.name ??
    '';
  return drawing.name === 'Desenho principal' || drawing.name === detail
    ? detail
    : `${detail} · ${drawing.name}`;
}
