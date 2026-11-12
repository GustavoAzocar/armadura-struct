import { pruneVisibility } from './visibilitySchema';
import { completeLayers } from './layers';
import { armatureReferences } from './armatureReferences';
import { recalculateBarQuantity } from './detailQuantities';
import { reconcileFabrication } from './fabrication';
import { uid, type Project, type ProjectHierarchy } from './types';

export type HierarchyKind = 'floor' | 'element' | 'detail';
type Content = Pick<
  Project,
  | 'bars'
  | 'details'
  | 'annotations'
  | 'masks'
  | 'polylines'
  | 'symbolInstances'
  | 'weldedMeshes'
>;

export function contentObjects(project: Content) {
  return [
    ...project.bars,
    ...project.details,
    ...project.annotations,
    ...project.masks,
    ...project.polylines,
    ...(project.symbolInstances ?? []),
    ...(project.weldedMeshes ?? []),
  ];
}

/** Deterministic IDs for reopening the same v1/v2 file, without rewriting object IDs. */
export function legacyProjectId(raw: string) {
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++)
    hash = Math.imul(hash ^ raw.charCodeAt(i), 16777619);
  return `legacy-${(hash >>> 0).toString(16)}`;
}

export function initialHierarchy(
  project: Content,
  projectId: string,
  floorName = '',
): ProjectHierarchy {
  const id = (kind: string) => {
    const occupied = new Set(contentObjects(project).map((o) => o.id));
    let candidate = `${projectId}:${kind}`;
    while (occupied.has(candidate)) candidate += '-';
    return candidate;
  };
  const floorId = id('floor'),
    elementId = id('element'),
    detailId = id('detail'),
    drawingId = id('drawing');
  return {
    floors: [{ id: floorId, name: floorName.trim() || 'Pavimento 1' }],
    elements: [{ id: elementId, floorId, name: 'Geral' }],
    details: [{ id: detailId, elementId, name: 'Detalhamento 1' }],
    drawings: [{ id: drawingId, detailId, name: 'Desenho principal' }],
    placements: [],
    objectOrigins: {},
    objectDetails: Object.fromEntries(
      contentObjects(project).map((o) => [o.id, detailId]),
    ),
  };
}

export function detailPath(project: Project, detailId: string) {
  const detail = project.hierarchy.details.find((d) => d.id === detailId);
  const element = project.hierarchy.elements.find(
    (e) => e.id === detail?.elementId,
  );
  const floor = project.hierarchy.floors.find((f) => f.id === element?.floorId);
  return [floor?.name, element?.name, detail?.name].filter(Boolean).join(' / ');
}

/** Called at the editor transaction boundary; removes deleted keys and owns new objects. */
export function completeOwnership(
  project: Project,
  activeDetailId = project.hierarchy.details[0].id,
): Project {
  project = completeLayers(pruneVisibility(project));
  const h = project.hierarchy;
  if (!h.details.some((d) => d.id === activeDetailId))
    throw new Error('Detalhamento de destino inexistente.');
  const objects = contentObjects(project),
    live = new Set(objects.map((o) => o.id));
  const owners = Object.fromEntries(
    Object.entries(h.objectDetails).filter(([id]) => live.has(id)),
  );
  const valid = new Set(h.details.map((d) => d.id));
  // Physical bars first, then annotations/representations may inherit their owner.
  for (const object of objects) {
    if (Object.hasOwn(owners, object.id)) {
      if (!valid.has(owners[object.id]))
        throw new Error('Objeto associado a detalhamento inexistente.');
      continue;
    }
    const reference = 'barId' in object ? object.barId : undefined;
    owners[object.id] =
      (reference && Object.hasOwn(owners, reference) && owners[reference]) ||
      activeDetailId;
  }
  const objectOrigins = Object.fromEntries(
    Object.entries(h.objectOrigins).filter(([id]) => live.has(id)),
  );
  const bars = project.bars.map(recalculateBarQuantity);
  return reconcileFabrication({
    ...project,
    bars: bars.every((b, i) => b === project.bars[i]) ? project.bars : bars,
    hierarchy: { ...h, objectDetails: owners, objectOrigins },
  });
}

export function hierarchyName(name: string) {
  const text = name.trim();
  if (!text || text.length > 100)
    throw new Error('Informe um nome de 1 a 100 caracteres.');
  return text;
}

export function createHierarchyNode(
  project: Project,
  kind: HierarchyKind,
  name: string,
  parentId?: string,
) {
  const h = project.hierarchy,
    id = uid(),
    title = hierarchyName(name);
  if (kind === 'floor')
    return {
      project: {
        ...project,
        hierarchy: { ...h, floors: [...h.floors, { id, name: title }] },
      },
      id,
    };
  if (kind === 'element') {
    if (!h.floors.some((f) => f.id === parentId))
      throw new Error('Pavimento inexistente.');
    return {
      project: {
        ...project,
        hierarchy: {
          ...h,
          elements: [...h.elements, { id, floorId: parentId!, name: title }],
        },
      },
      id,
    };
  }
  if (!h.elements.some((e) => e.id === parentId))
    throw new Error('Elemento inexistente.');
  const drawingId = uid();
  return {
    project: {
      ...project,
      hierarchy: {
        ...h,
        details: [...h.details, { id, elementId: parentId!, name: title }],
        drawings: [
          ...h.drawings,
          { id: drawingId, detailId: id, name: 'Desenho principal' },
        ],
      },
    },
    id,
  };
}

export function updateHierarchyNode(
  project: Project,
  kind: HierarchyKind,
  id: string,
  name: string,
  parentId?: string,
): Project {
  const h = project.hierarchy,
    title = hierarchyName(name);
  if (kind === 'floor') {
    if (!h.floors.some((f) => f.id === id))
      throw new Error('Pavimento inexistente.');
    return {
      ...project,
      hierarchy: {
        ...h,
        floors: h.floors.map((f) => (f.id === id ? { ...f, name: title } : f)),
      },
    };
  }
  if (kind === 'element') {
    if (
      !h.elements.some((e) => e.id === id) ||
      !h.floors.some((f) => f.id === parentId)
    )
      throw new Error('Elemento ou pavimento inexistente.');
    return {
      ...project,
      hierarchy: {
        ...h,
        elements: h.elements.map((e) =>
          e.id === id ? { ...e, name: title, floorId: parentId! } : e,
        ),
      },
    };
  }
  if (
    !h.details.some((d) => d.id === id) ||
    !h.elements.some((e) => e.id === parentId)
  )
    throw new Error('Detalhamento ou elemento inexistente.');
  return {
    ...project,
    hierarchy: {
      ...h,
      details: h.details.map((d) =>
        d.id === id ? { ...d, name: title, elementId: parentId! } : d,
      ),
    },
  };
}

/** Deletion never cascades into steel, masks or annotations. Move contents first. */
export function deleteHierarchyNode(
  project: Project,
  kind: HierarchyKind,
  id: string,
): Project {
  const h = project.hierarchy;
  if (kind === 'floor') {
    if (!h.floors.some((f) => f.id === id))
      throw new Error('Pavimento inexistente.');
    if (h.floors.length === 1 || h.elements.some((e) => e.floorId === id))
      throw new Error(
        'Mova ou exclua os elementos antes de excluir o pavimento. Mantenha ao menos um pavimento.',
      );
    return {
      ...project,
      hierarchy: { ...h, floors: h.floors.filter((f) => f.id !== id) },
    };
  }
  if (kind === 'element') {
    if (!h.elements.some((e) => e.id === id))
      throw new Error('Elemento inexistente.');
    if (
      h.details.some((d) =>
        d.repetition?.elements.some((e) => e.elementId === id),
      )
    )
      throw new Error(
        'O elemento participa de uma repetição. Remova ou altere esse vínculo antes de excluí-lo.',
      );
    if (h.elements.length === 1 || h.details.some((d) => d.elementId === id))
      throw new Error(
        'Mova ou exclua os detalhamentos antes de excluir o elemento. Mantenha ao menos um elemento.',
      );
    return {
      ...project,
      hierarchy: { ...h, elements: h.elements.filter((e) => e.id !== id) },
    };
  }
  if (!h.details.some((d) => d.id === id))
    throw new Error('Detalhamento inexistente.');
  if (h.details.length === 1 || Object.values(h.objectDetails).includes(id))
    throw new Error(
      'Mova os objetos antes de excluir o detalhamento. Mantenha ao menos um detalhamento.',
    );
  const drawings = h.drawings.filter((d) => d.detailId !== id),
    drawingIds = new Set(drawings.map((d) => d.id));
  return {
    ...project,
    hierarchy: {
      ...h,
      details: h.details.filter((d) => d.id !== id),
      drawings,
      placements: h.placements.filter((p) => drawingIds.has(p.drawingId)),
    },
  };
}

export function moveObjectsToDetail(
  project: Project,
  objectIds: string[],
  detailId: string,
): Project {
  if (!project.hierarchy.details.some((d) => d.id === detailId))
    throw new Error('Detalhamento de destino inexistente.');
  const ids = new Set(objectIds),
    objects = contentObjects(project);
  const targetFactor =
    project.hierarchy.details.find((d) => d.id === detailId)?.repetition
      ?.factor ?? 1;
  // Barras e telas são posições físicas: o fator de repetição multiplica as duas.
  const physical = [...project.bars, ...(project.weldedMeshes ?? [])];
  for (const o of physical.filter((o) => ids.has(o.id))) {
    const factor =
      project.hierarchy.details.find(
        (d) => d.id === project.hierarchy.objectDetails[o.id],
      )?.repetition?.factor ?? 1;
    if (factor !== targetFactor)
      throw new Error(
        'A transferência mudaria a quantidade efetiva. Configure o mesmo fator de repetição no destino antes de mover posições físicas.',
      );
  }
  if (!objectIds.every((id) => objects.some((o) => o.id === id)))
    throw new Error('Objeto inexistente.');
  // Rebatimentos and linked callouts accompany their physical bar, without a geometric transform.
  for (const o of [
    ...project.details,
    ...project.annotations,
    ...project.polylines,
  ])
    if (armatureReferences(o).some((id) => ids.has(id))) ids.add(o.id);
  return {
    ...project,
    hierarchy: {
      ...project.hierarchy,
      objectDetails: {
        ...project.hierarchy.objectDetails,
        ...Object.fromEntries([...ids].map((id) => [id, detailId])),
      },
    },
  };
}

export function validateHierarchy(project: Project) {
  const h = project.hierarchy;
  const floors = new Set(h.floors.map((f) => f.id)),
    elements = new Set(h.elements.map((e) => e.id)),
    details = new Set(h.details.map((d) => d.id)),
    drawings = new Set(h.drawings.map((d) => d.id));
  const allIds = [
    project.id,
    ...contentObjects(project).map((o) => o.id),
    ...h.floors.map((f) => f.id),
    ...h.elements.map((e) => e.id),
    ...h.details.map((d) => d.id),
    ...h.drawings.map((d) => d.id),
    ...h.placements.map((p) => p.id),
    ...project.sheets.map((s) => s.id),
  ];
  for (const d of h.details)
    if (d.repetition) {
      const r = d.repetition;
      if (
        !Number.isInteger(r.factor) ||
        r.factor < 1 ||
        r.factor > 10000 ||
        (r.elements.length && r.elements.length !== r.factor)
      )
        throw new Error('Fator/lista de nomes da repetição inválidos.');
      if (r.elements.some((m) => m.elementId && !elements.has(m.elementId)))
        throw new Error('Repetição vinculada a elemento inexistente.');
      const refs = r.elements
        .filter((m) => m.elementId)
        .map((m) => m.elementId);
      if (new Set(refs).size !== refs.length)
        throw new Error(
          'Um elemento estrutural não pode aparecer duas vezes na mesma repetição. Use nomes de ocorrências distintos.',
        );
      const aliases = r.elements
        .filter((m) => !m.elementId)
        .map((m) => m.name.toLocaleLowerCase());
      if (new Set(aliases).size !== aliases.length)
        throw new Error('Os nomes das ocorrências devem ser distintos.');
    }
  if (new Set(allIds).size !== allIds.length)
    throw new Error('Identificadores duplicados na hierarquia.');
  if (
    h.elements.some((e) => !floors.has(e.floorId)) ||
    h.details.some((d) => !elements.has(d.elementId)) ||
    h.drawings.some((d) => !details.has(d.detailId)) ||
    h.placements.some(
      (p) =>
        !drawings.has(p.drawingId) ||
        !project.sheets.some((s) => s.id === p.sheetId),
    )
  )
    throw new Error('Vínculo de hierarquia inexistente.');
  const objects = new Set(contentObjects(project).map((o) => o.id));
  if (Object.keys(h.objectOrigins).some((id) => !objects.has(id)))
    throw new Error('Origem de objeto sem objeto local correspondente.');
  if (
    [...objects].some((id) => !details.has(h.objectDetails[id])) ||
    Object.keys(h.objectDetails).some((id) => !objects.has(id))
  )
    throw new Error('Associação de objeto ao detalhamento inválida.');
  const drawnDetails = new Set(h.drawings.map((d) => d.detailId));
  if (h.details.some((d) => !drawnDetails.has(d.id)))
    throw new Error('Detalhamento sem desenho.');
}
