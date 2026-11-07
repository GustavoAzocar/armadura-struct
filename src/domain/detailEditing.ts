import type { Project } from './types';
import {
  contentObjects,
  createHierarchyNode,
  moveObjectsToDetail,
} from './hierarchy';

export function detailObjectIds(project: Project, detailId: string): string[] {
  return contentObjects(project)
    .filter((o) => project.hierarchy.objectDetails[o.id] === detailId)
    .map((o) => o.id);
}

export function groupedDetailForObject(project: Project, objectId: string) {
  const owner = project.hierarchy.objectDetails[objectId];
  return project.hierarchy.details.find((d) => d.id === owner && d.grouped);
}

export function expandDetailSelection(
  project: Project,
  ids: string[],
  isolatedDetailId?: string,
): string[] {
  const live = new Set(contentObjects(project).map((o) => o.id));
  const chosen = new Set(
    ids.filter(
      (id) =>
        live.has(id) &&
        (!isolatedDetailId ||
          project.hierarchy.objectDetails[id] === isolatedDetailId),
    ),
  );
  if (isolatedDetailId) return [...chosen];
  const grouped = new Set(
    project.hierarchy.details.filter((d) => d.grouped).map((d) => d.id),
  );
  const groups = new Set(
    [...chosen]
      .map((id) => project.hierarchy.objectDetails[id])
      .filter((id) => grouped.has(id)),
  );
  for (const [id, owner] of Object.entries(project.hierarchy.objectDetails))
    if (live.has(id) && groups.has(owner)) chosen.add(id);
  return [...chosen];
}

export function toggleDetailSelection(
  project: Project,
  selected: string[],
  objectId: string,
  additive: boolean,
  isolatedDetailId?: string,
) {
  const unit = expandDetailSelection(project, [objectId], isolatedDetailId);
  if (!additive) return unit;
  const selectedSet = new Set(selected),
    unitSet = new Set(unit);
  const remove = unit.every((id) => selectedSet.has(id));
  return remove
    ? selected.filter((id) => !unitSet.has(id))
    : [...new Set([...selected, ...unit])];
}

export function groupInDetail(
  project: Project,
  objectIds: string[],
  name: string,
  elementId: string,
) {
  if (!objectIds.length) throw new Error('Selecione os objetos a agrupar.');
  const live = new Set(contentObjects(project).map((o) => o.id));
  if (objectIds.some((id) => !live.has(id)))
    throw new Error('Objeto inexistente na seleção.');
  const ids = expandDetailSelection(project, objectIds);
  const created = createHierarchyNode(project, 'detail', name, elementId);
  const sourceDetails = project.hierarchy.details.filter((d) =>
    project.bars.some(
      (b) =>
        ids.includes(b.id) && project.hierarchy.objectDetails[b.id] === d.id,
    ),
  );
  const repetition = sourceDetails[0]?.repetition;
  if (
    sourceDetails.some(
      (d) =>
        JSON.stringify({
          factor: d.repetition?.factor ?? 1,
          elements: d.repetition?.elements ?? [],
        }) !==
        JSON.stringify({
          factor: repetition?.factor ?? 1,
          elements: repetition?.elements ?? [],
        }),
    )
  )
    throw new Error(
      'Selecione posições com a mesma repetição para agrupar sem alterar quantitativos.',
    );
  if (repetition)
    created.project = {
      ...created.project,
      hierarchy: {
        ...created.project.hierarchy,
        details: created.project.hierarchy.details.map((d) =>
          d.id === created.id
            ? {
                ...d,
                repetition: { ...repetition, absorbedOrigins: undefined },
              }
            : d,
        ),
      },
    };
  const moved = moveObjectsToDetail(created.project, ids, created.id);
  return { id: created.id, project: setDetailGrouped(moved, created.id, true) };
}

export function setDetailGrouped(
  project: Project,
  detailId: string,
  grouped: boolean,
): Project {
  if (!project.hierarchy.details.some((d) => d.id === detailId))
    throw new Error('Detalhamento inexistente.');
  return {
    ...project,
    hierarchy: {
      ...project.hierarchy,
      details: project.hierarchy.details.map((d) =>
        d.id === detailId ? { ...d, grouped } : d,
      ),
    },
  };
}

/** A projection for the editor only. Calculations and persistence use the full project. */
export function detailEditorView(project: Project, detailId?: string): Project {
  if (!detailId) return project;
  const owns = (o: { id: string }) =>
    project.hierarchy.objectDetails[o.id] === detailId;
  return {
    ...project,
    bars: project.bars.filter(owns),
    details: project.details.filter(owns),
    annotations: project.annotations.filter(owns),
    polylines: project.polylines.filter(owns),
    masks: project.masks.filter(owns),
  };
}

const same = (a: unknown, b: unknown) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

/** Protect every write route, including commands, history and async import callbacks. */
export function assertDetailEdit(
  before: Project,
  after: Project,
  detailId: string,
) {
  const fail = () => {
    throw new Error(
      'Conclua a edição isolada antes de alterar objetos ou dados de outro detalhamento.',
    );
  };
  if (
    before.id !== after.id ||
    !after.hierarchy.details.some((d) => d.id === detailId)
  )
    fail();
  for (const field of [
    'name',
    'author',
    'notes',
    'drawing',
    'sheets',
    'scheduleLock',
    'layers',
  ] as const)
    if (!same(before[field], after[field])) fail();
  for (const field of ['floors', 'elements', 'drawings', 'placements'] as const)
    if (!same(before.hierarchy[field], after.hierarchy[field])) fail();
  if (
    before.hierarchy.details !== after.hierarchy.details &&
    !same(
      before.hierarchy.details.filter((d) => d.id !== detailId),
      after.hierarchy.details.filter((d) => d.id !== detailId),
    )
  )
    fail();
  const oldDetail = before.hierarchy.details.find((d) => d.id === detailId),
    newDetail = after.hierarchy.details.find((d) => d.id === detailId);
  if (
    oldDetail?.elementId !== newDetail?.elementId ||
    !same(oldDetail?.source, newDetail?.source)
  )
    fail();
  const oldObjects = new Map(contentObjects(before).map((o) => [o.id, o]));
  const newObjects = new Map(contentObjects(after).map((o) => [o.id, o]));
  for (const [id, object] of oldObjects) {
    const oldOwner = before.hierarchy.objectDetails[id],
      newOwner = after.hierarchy.objectDetails[id];
    if (
      oldOwner !== detailId &&
      (oldOwner !== newOwner ||
        !same(object, newObjects.get(id)) ||
        !same(
          before.hierarchy.objectOrigins[id],
          after.hierarchy.objectOrigins[id],
        ))
    )
      fail();
    if (oldOwner === detailId && newObjects.has(id) && newOwner !== detailId)
      fail();
  }
  for (const [id] of newObjects)
    if (!oldObjects.has(id) && after.hierarchy.objectDetails[id] !== detailId)
      fail();
}

export function canEditDetailChange(
  before: Project,
  after: Project | undefined,
  detailId?: string,
) {
  if (!after) return false;
  if (!detailId) return true;
  try {
    assertDetailEdit(before, after, detailId);
    return true;
  } catch {
    return false;
  }
}
