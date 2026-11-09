import { z } from 'zod';
import { detailTitle } from './detailQuantities';
import { contentObjects } from './hierarchy';
import {
  uid,
  type DetailDrawing,
  type DrawingDetail,
  type Floor,
  type Project,
  type StructuralElement,
} from './types';

export const DRAWING_METADATA_LIMITS = {
  name: 100,
  author: 150,
  notes: 5000,
} as const;

export type DrawingMetadataInput = {
  name: string;
  author?: string;
  date?: string;
  notes?: string;
};

export type DrawingMetadataField = 'name' | 'author' | 'date' | 'notes';

export type DrawingMetadataIssue = {
  field: DrawingMetadataField;
  message: string;
};

export type DrawingHierarchyContext = {
  drawing: DetailDrawing;
  floor: Floor;
  element: StructuralElement;
  detail: DrawingDetail;
  detailLabel: string;
  path: string;
};

const singleLineControl = /[\x00-\x1f\x7f]/;
const multiLineControl = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

/** Pure civil calendar check (AAAA-MM-DD); never uses Date or timezone offsets. */
export function isValidDrawingDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1)
    return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const maxDay = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ];
  return day <= maxDay;
}

/** Formats AAAA-MM-DD as DD/MM/AAAA without Date/timezone conversion. */
export function formatDrawingDate(date?: string): string {
  if (!date || !isValidDrawingDate(date)) return '';
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

export function hasDrawingMetadata(drawing: {
  author?: unknown;
  date?: unknown;
  notes?: unknown;
}): boolean {
  return (
    drawing.author !== undefined ||
    drawing.date !== undefined ||
    drawing.notes !== undefined
  );
}

const identity = z.string().min(1).max(200);

export const drawingSchema = z
  .object({
    id: identity,
    detailId: identity,
    name: z
      .string()
      .refine(
        (v) => !singleLineControl.test(v),
        'O título do desenho não pode conter caracteres de controle.',
      )
      .transform((v) => v.trim())
      .refine(
        (v) => v.length >= 1 && v.length <= DRAWING_METADATA_LIMITS.name,
        `Informe um título de 1 a ${DRAWING_METADATA_LIMITS.name} caracteres.`,
      ),
    author: z
      .string()
      .refine(
        (v) => !singleLineControl.test(v),
        'O autor do desenho não pode conter caracteres de controle.',
      )
      .transform((v) => v.trim())
      .refine(
        (v) => v.length <= DRAWING_METADATA_LIMITS.author,
        `Use até ${DRAWING_METADATA_LIMITS.author} caracteres para o autor.`,
      )
      .optional(),
    date: z
      .string()
      .transform((v) => v.trim())
      .refine(
        (v) => v === '' || isValidDrawingDate(v),
        'Informe uma data documental válida (AAAA-MM-DD) sem horário.',
      )
      .optional(),
    notes: z
      .string()
      .transform((v) => v.replace(/\r\n?/g, '\n'))
      .refine(
        (v) => !multiLineControl.test(v),
        'Os comentários do desenho não podem conter caracteres de controle inválidos.',
      )
      .transform((v) => v.trim())
      .refine(
        (v) => v.length <= DRAWING_METADATA_LIMITS.notes,
        `Use até ${DRAWING_METADATA_LIMITS.notes} caracteres nos comentários.`,
      )
      .optional(),
  })
  .transform(
    (d): DetailDrawing => ({
      id: d.id,
      detailId: d.detailId,
      name: d.name,
      ...(d.author ? { author: d.author } : {}),
      ...(d.date ? { date: d.date } : {}),
      ...(d.notes ? { notes: d.notes } : {}),
    }),
  );

export function drawingMetadataIssues(
  input: DrawingMetadataInput,
): DrawingMetadataIssue[] {
  const issues: DrawingMetadataIssue[] = [];
  if (singleLineControl.test(input.name)) {
    issues.push({
      field: 'name',
      message: 'O título do desenho não pode conter caracteres de controle.',
    });
  } else {
    const name = input.name.trim();
    if (!name || name.length > DRAWING_METADATA_LIMITS.name)
      issues.push({
        field: 'name',
        message: `Informe um título de 1 a ${DRAWING_METADATA_LIMITS.name} caracteres.`,
      });
  }

  const rawAuthor = input.author ?? '';
  if (singleLineControl.test(rawAuthor)) {
    issues.push({
      field: 'author',
      message: 'O autor do desenho não pode conter caracteres de controle.',
    });
  } else if (rawAuthor.trim().length > DRAWING_METADATA_LIMITS.author) {
    issues.push({
      field: 'author',
      message: `Use até ${DRAWING_METADATA_LIMITS.author} caracteres para o autor.`,
    });
  }

  const rawDate = (input.date ?? '').trim();
  if (rawDate && !isValidDrawingDate(rawDate)) {
    issues.push({
      field: 'date',
      message:
        'Informe uma data documental válida (AAAA-MM-DD) ou deixe em branco.',
    });
  }

  const rawNotes = (input.notes ?? '').replace(/\r\n?/g, '\n');
  if (multiLineControl.test(rawNotes)) {
    issues.push({
      field: 'notes',
      message:
        'Os comentários do desenho não podem conter caracteres de controle inválidos.',
    });
  } else if (rawNotes.trim().length > DRAWING_METADATA_LIMITS.notes) {
    issues.push({
      field: 'notes',
      message: `Use até ${DRAWING_METADATA_LIMITS.notes} caracteres nos comentários.`,
    });
  }

  return issues;
}

export function normalizeDrawingMetadata(
  input: DrawingMetadataInput,
): Omit<DetailDrawing, 'id' | 'detailId'> {
  const issues = drawingMetadataIssues(input);
  if (issues.length) throw new Error(issues[0].message);
  const name = input.name.trim();
  const author = (input.author ?? '').trim();
  const date = (input.date ?? '').trim();
  const notes = (input.notes ?? '').replace(/\r\n?/g, '\n').trim();
  return {
    name,
    ...(author ? { author } : {}),
    ...(date ? { date } : {}),
    ...(notes ? { notes } : {}),
  };
}

export function sameDrawingMetadata(
  a: DetailDrawing,
  b: DetailDrawing,
): boolean {
  return (
    a.id === b.id &&
    a.detailId === b.detailId &&
    a.name === b.name &&
    (a.author ?? undefined) === (b.author ?? undefined) &&
    (a.date ?? undefined) === (b.date ?? undefined) &&
    (a.notes ?? undefined) === (b.notes ?? undefined)
  );
}

/** Creates an independent copy of documentary fields with no shared mutable state. */
export function cloneDrawingMetadata(
  source: DetailDrawing,
  overrides: { id: string; detailId: string; name?: string },
): DetailDrawing {
  const normalized = normalizeDrawingMetadata({
    name: overrides.name ?? source.name,
    author: source.author,
    date: source.date,
    notes: source.notes,
  });
  return {
    id: overrides.id,
    detailId: overrides.detailId,
    ...normalized,
  };
}

export function drawingHierarchyContext(
  project: Project,
  drawingId: string,
): DrawingHierarchyContext | undefined {
  const h = project.hierarchy;
  const drawing = h.drawings.find((d) => d.id === drawingId);
  if (!drawing) return undefined;
  const detail = h.details.find((d) => d.id === drawing.detailId);
  if (!detail) return undefined;
  const element = h.elements.find((e) => e.id === detail.elementId);
  if (!element) return undefined;
  const floor = h.floors.find((f) => f.id === element.floorId);
  if (!floor) return undefined;
  const detailLabel = detailTitle(project, detail.id);
  return {
    drawing,
    floor,
    element,
    detail,
    detailLabel,
    path: `${floor.name} / ${element.name} / ${detailLabel}`,
  };
}

export function updateDrawingMetadata(
  project: Project,
  drawingId: string,
  input: DrawingMetadataInput,
): Project {
  const existing = project.hierarchy.drawings.find((d) => d.id === drawingId);
  if (!existing) throw new Error('Desenho inexistente.');
  const normalized = normalizeDrawingMetadata(input);
  const updated: DetailDrawing = {
    id: existing.id,
    detailId: existing.detailId,
    ...normalized,
  };
  if (sameDrawingMetadata(existing, updated)) return project;
  return {
    ...project,
    hierarchy: {
      ...project.hierarchy,
      drawings: project.hierarchy.drawings.map((d) =>
        d.id === drawingId ? updated : d,
      ),
    },
  };
}

function nextUniqueId(project: Project): string {
  const h = project.hierarchy;
  const occupied = new Set([
    project.id,
    ...contentObjects(project).map((o) => o.id),
    ...h.floors.map((o) => o.id),
    ...h.elements.map((o) => o.id),
    ...h.details.map((o) => o.id),
    ...h.drawings.map((o) => o.id),
    ...h.placements.map((o) => o.id),
    ...project.sheets.map((o) => o.id),
  ]);
  let id = uid();
  while (occupied.has(id)) id = uid();
  return id;
}

export function duplicateDrawing(
  project: Project,
  drawingId: string,
): { id: string; project: Project } {
  const source = project.hierarchy.drawings.find((d) => d.id === drawingId);
  if (!source) throw new Error('Desenho inexistente.');
  if (project.hierarchy.drawings.length >= 10000)
    throw new Error('Limite de 10000 desenhos atingido.');
  const id = nextUniqueId(project);
  const copy = cloneDrawingMetadata(source, {
    id,
    detailId: source.detailId,
    name: `${source.name.slice(0, DRAWING_METADATA_LIMITS.name - 8)} (cópia)`,
  });
  const drawings = [...project.hierarchy.drawings];
  const index = drawings.findIndex((d) => d.id === drawingId);
  drawings.splice(index + 1, 0, copy);
  const context = project.layerEnvironment?.contexts[`drawing:${drawingId}`];
  return {
    id,
    project: {
      ...project,
      ...(context && project.layerEnvironment
        ? {
            layerEnvironment: {
              ...project.layerEnvironment,
              contexts: {
                ...project.layerEnvironment.contexts,
                [`drawing:${id}`]: structuredClone(context),
              },
            },
          }
        : {}),
      hierarchy: {
        ...project.hierarchy,
        drawings,
      },
    },
  };
}
