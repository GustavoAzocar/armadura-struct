import { hasDrawingMetadata } from './drawingMetadata';
import { defaultLayers } from './layers';
import { initialSheet } from './paperFormat';
import { emptyProject, decodeProject } from './model';
import {
  createHierarchyNode,
  deleteHierarchyNode,
  hierarchyName,
  validateHierarchy,
  contentObjects,
  type HierarchyKind,
} from './hierarchy';
import type { Project } from './types';
import { nextGroupName, nextDetailName } from './hierarchyPresentation';
/** Only a detached native project and its initial editing destination; no second registry. */
export type ProjectSetupDraft = { project: Project; activeDetailId: string };
export type ProjectSetupIssue = {
  objectId?: string;
  field: 'name' | 'author' | 'parent' | 'structure' | 'activeDetailId';
  message: string;
};
export const PROJECT_SETUP_LIMITS = {
  floors: 1000,
  elements: 10000,
  details: 10000,
  drawings: 10000,
} as const;
export function newProjectSetup(): ProjectSetupDraft {
  const project = emptyProject();
  project.hierarchy.floors[0].name = 'Térreo';
  project.hierarchy.elements[0].name = 'Vigas';
  project.hierarchy.details[0].name = 'V1';
  return { project, activeDetailId: project.hierarchy.details[0].id };
}
export function projectSetupIssues(
  draft: ProjectSetupDraft,
): ProjectSetupIssue[] {
  const p = draft.project,
    h = p.hierarchy,
    issues: ProjectSetupIssue[] = [];
  if (!p.name.trim() || p.name.trim().length > 150)
    issues.push({
      field: 'name',
      message: 'Informe um nome de projeto de 1 a 150 caracteres.',
    });
  if (p.author.trim().length > 150)
    issues.push({
      field: 'author',
      message: 'Use até 150 caracteres para o responsável.',
    });
  for (const kind of ['floors', 'elements', 'details', 'drawings'] as const) {
    if (!h[kind].length || h[kind].length > PROJECT_SETUP_LIMITS[kind])
      issues.push({
        field: 'structure',
        message: `Mantenha de 1 a ${PROJECT_SETUP_LIMITS[kind]} itens em ${kind === 'floors' ? 'pavimentos' : kind === 'elements' ? 'grupos de elementos' : kind === 'details' ? 'detalhamentos' : 'desenhos'}.`,
      });
    for (const o of h[kind])
      try {
        hierarchyName(o.name);
      } catch (e) {
        issues.push({
          objectId: o.id,
          field: 'name',
          message: (e as Error).message,
        });
      }
  }
  const floors = new Set(h.floors.map((f) => f.id)),
    elements = new Set(h.elements.map((e) => e.id));
  for (const e of h.elements)
    if (!floors.has(e.floorId))
      issues.push({
        objectId: e.id,
        field: 'parent',
        message: 'Escolha um pavimento existente para este grupo.',
      });
  for (const d of h.details)
    if (!elements.has(d.elementId))
      issues.push({
        objectId: d.id,
        field: 'parent',
        message: 'Escolha um grupo existente para este detalhamento.',
      });
  if (!h.details.some((d) => d.id === draft.activeDetailId))
    issues.push({
      field: 'activeDetailId',
      message: 'Escolha um detalhamento inicial existente.',
    });
  if (
    contentObjects(p).length ||
    h.placements.length ||
    Object.keys(h.objectDetails).length ||
    Object.keys(h.objectOrigins).length ||
    p.scheduleLock
  )
    issues.push({
      field: 'structure',
      message:
        'A organização inicial não pode conter armaduras, desenhos colocados ou objetos CAD.',
    });
  try {
    validateHierarchy(p);
  } catch (e) {
    issues.push({ field: 'structure', message: (e as Error).message });
  }
  return issues;
}
/** Validate and normalize atomically, preserving every preview ID and parent relationship. */
export function prepareProjectSetup(
  draft: ProjectSetupDraft,
):
  | { ok: true; project: Project; activeDetailId: string }
  | { ok: false; issues: ProjectSetupIssue[] } {
  const issues = projectSetupIssues(draft);
  if (issues.length) return { ok: false, issues };
  try {
    let p = {
      ...draft.project,
      name: draft.project.name.trim(),
      author: draft.project.author.trim(),
    };
    const h = p.hierarchy;
    p = {
      ...p,
      hierarchy: {
        ...h,
        floors: h.floors.map((n) => ({ ...n, name: hierarchyName(n.name) })),
        elements: h.elements.map((n) => ({
          ...n,
          name: hierarchyName(n.name),
        })),
        details: h.details.map((n) => ({ ...n, name: hierarchyName(n.name) })),
        drawings: h.drawings.map((n) => ({
          ...n,
          name: hierarchyName(n.name),
        })),
      },
    };
    return {
      ok: true,
      project: decodeProject(JSON.stringify(p)),
      activeDetailId: draft.activeDetailId,
    };
  } catch (e) {
    return {
      ok: false,
      issues: [{ field: 'structure', message: (e as Error).message }],
    };
  }
}
/** Name fields intentionally permit temporary blanks; native rules are checked before commit. */
export function editProjectSetupNode(
  draft: ProjectSetupDraft,
  kind: HierarchyKind,
  id: string,
  name: string,
  parentId?: string,
): ProjectSetupDraft {
  const p = draft.project,
    h = p.hierarchy;
  const array =
    kind === 'floor' ? h.floors : kind === 'element' ? h.elements : h.details;
  if (!array.some((n) => n.id === id))
    throw new Error('Item inexistente no rascunho.');
  if (kind === 'element' && !h.floors.some((n) => n.id === parentId))
    throw new Error('Pavimento inexistente.');
  if (kind === 'detail' && !h.elements.some((n) => n.id === parentId))
    throw new Error('Grupo inexistente.');
  return {
    ...draft,
    project: {
      ...p,
      hierarchy: {
        ...h,
        ...(kind === 'floor'
          ? { floors: h.floors.map((n) => (n.id === id ? { ...n, name } : n)) }
          : kind === 'element'
            ? {
                elements: h.elements.map((n) =>
                  n.id === id ? { ...n, name, floorId: parentId! } : n,
                ),
              }
            : {
                details: h.details.map((n) =>
                  n.id === id ? { ...n, name, elementId: parentId! } : n,
                ),
              }),
      },
    },
  };
}
export function addProjectSetupNode(
  draft: ProjectSetupDraft,
  kind: HierarchyKind,
  parentId?: string,
) {
  const h = draft.project.hierarchy,
    key =
      kind === 'floor' ? 'floors' : kind === 'element' ? 'elements' : 'details';
  if (h[key].length >= PROJECT_SETUP_LIMITS[key])
    throw new Error(`Limite de ${PROJECT_SETUP_LIMITS[key]} itens atingido.`);
  if (kind === 'element' && h.details.length >= PROJECT_SETUP_LIMITS.details)
    throw new Error('Limite de detalhamentos atingido.');
  const siblings =
    kind === 'floor'
      ? h.floors
      : kind === 'element'
        ? h.elements.filter((e) => e.floorId === parentId)
        : h.details.filter((d) => d.elementId === parentId);
  const base = 'Pavimento';
  let suffix = 1;
  while (siblings.some((n) => n.name === `${base} ${suffix}`)) suffix++;
  const made = createHierarchyNode(
    draft.project,
    kind,
    kind === 'floor'
      ? `${base} ${suffix}`
      : kind === 'element'
        ? nextGroupName(draft.project, parentId!)
        : nextDetailName(draft.project, parentId!),
    parentId,
  );
  const project =
    kind === 'element'
      ? createHierarchyNode(
          made.project,
          'detail',
          nextDetailName(made.project, made.id),
          made.id,
        ).project
      : made.project;
  return { draft: { ...draft, project }, id: made.id };
}
export function projectSetupRemoval(
  draft: ProjectSetupDraft,
  kind: HierarchyKind,
  id: string,
) {
  const h = draft.project.hierarchy;
  const floors = kind === 'floor' ? h.floors.filter((f) => f.id === id) : [];
  const elements =
    kind === 'floor'
      ? h.elements.filter((e) => e.floorId === id)
      : kind === 'element'
        ? h.elements.filter((e) => e.id === id)
        : [];
  const details =
    kind === 'detail'
      ? h.details.filter((d) => d.id === id)
      : h.details.filter((d) => elements.some((e) => e.id === d.elementId));
  if (
    !(kind === 'floor'
      ? floors.length
      : kind === 'element'
        ? elements.length
        : details.length)
  )
    throw new Error('Item inexistente no rascunho.');
  const drawings = h.drawings.filter((d) =>
    details.some((n) => n.id === d.detailId),
  );
  const blocked =
    h.floors.length - floors.length < 1 ||
    h.elements.length - elements.length < 1 ||
    h.details.length - details.length < 1;
  return {
    floors,
    elements,
    details,
    drawings,
    blocked,
    message: blocked
      ? 'Mantenha ao menos um pavimento, um grupo e um detalhamento. Renomeie os itens mínimos ou prepare outro conjunto antes de remover este.'
      : `Serão removidos deste rascunho ${floors.length} pavimento(s), ${elements.length} grupo(s) e ${details.length} detalhamento(s), com seus desenhos vinculados. Os filhos não serão transferidos.`,
  };
}
export function removeProjectSetupNode(
  draft: ProjectSetupDraft,
  kind: HierarchyKind,
  id: string,
  confirmed = false,
): ProjectSetupDraft {
  const impact = projectSetupRemoval(draft, kind, id);
  if (impact.blocked) throw new Error(impact.message);
  if (!confirmed)
    throw new Error('Confirme a remoção do item e de seus filhos no rascunho.');
  let p = draft.project;
  for (const d of impact.details) p = deleteHierarchyNode(p, 'detail', d.id);
  for (const e of impact.elements) p = deleteHierarchyNode(p, 'element', e.id);
  if (kind === 'floor') p = deleteHierarchyNode(p, 'floor', id);
  return {
    project: p,
    activeDetailId: p.hierarchy.details.some(
      (d) => d.id === draft.activeDetailId,
    )
      ? draft.activeDetailId
      : p.hierarchy.details[0].id,
  };
}

/** An untouched default document needs no replacement acknowledgement. */
export function hasProjectSetupToReplace(p: Project) {
  const h = p.hierarchy;
  return !!(
    contentObjects(p).length ||
    p.name !== 'Novo projeto' ||
    p.author ||
    p.notes ||
    p.scheduleLock ||
    p.plotting ||
    p.layerEnvironment ||
    p.numbering ||
    h.placements.length ||
    h.floors.length !== 1 ||
    h.elements.length !== 1 ||
    h.details.length !== 1 ||
    h.drawings.length !== 1 ||
    ![
      ['Pavimento 1', 'Geral', 'Detalhamento 1'],
      ['Térreo', 'Vigas', 'V1'],
    ].some(
      ([f, e, d]) =>
        h.floors[0]?.name === f &&
        h.elements[0]?.name === e &&
        h.details[0]?.name === d,
    ) ||
    h.drawings[0]?.name !== 'Desenho principal' ||
    h.drawings.some(hasDrawingMetadata) ||
    h.details.some((d) => d.grouped || d.repetition || d.source) ||
    JSON.stringify(p.layers) !== JSON.stringify(defaultLayers()) ||
    p.drawing.floor !== '' ||
    p.drawing.revision !== '00' ||
    p.drawing.scale !== 0 ||
    p.sheets.length !== 1 ||
    p.sheets.some(
      (s) => JSON.stringify(s) !== JSON.stringify(initialSheet(s.id)),
    ) ||
    p.sheets.some(
      (s) =>
        s.steelSchedule ||
        s.name !== 'Folha 1' ||
        s.properties.notes ||
        s.properties.revision !== '00',
    )
  );
}
