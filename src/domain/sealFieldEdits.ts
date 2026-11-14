import { z } from 'zod';
import {
  projectSealPropertiesSchema,
  sheetSealBindingsSchema,
  sheetSealPropertiesSchema,
  type ProjectSealProperties,
  type SheetSealBinding,
  type SheetSealProperties,
} from './sealFieldSchema';

type SealPatch<T> = { [K in keyof T]?: T[K] | null };

function patchProperties<T extends object>(
  current: T | undefined,
  patch: SealPatch<T>,
  schema: z.ZodType<T>,
): T | undefined {
  const draft: Partial<T> = { ...current };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value === null) delete draft[key];
    else if (value !== undefined) draft[key] = value;
  }
  const next = schema.parse(draft);
  if (JSON.stringify(next) === JSON.stringify(current)) return current;
  return Object.keys(next).length ? next : undefined;
}

export function patchProjectSealProperties(
  current: ProjectSealProperties | undefined,
  patch: SealPatch<ProjectSealProperties>,
): ProjectSealProperties | undefined {
  return patchProperties(current, patch, projectSealPropertiesSchema);
}

export function patchSheetSealProperties(
  current: SheetSealProperties | undefined,
  patch: SealPatch<SheetSealProperties>,
): SheetSealProperties | undefined {
  return patchProperties(current, patch, sheetSealPropertiesSchema);
}

type FieldIdentity = Pick<SheetSealBinding, 'templateId' | 'fieldId'>;
type FieldPatch = SealPatch<Pick<SheetSealBinding, 'source' | 'manualText'>>;

export function patchSheetSealBindings(
  current: SheetSealBinding[] | undefined,
  { templateId, fieldId }: FieldIdentity,
  patch: FieldPatch,
): SheetSealBinding[] | undefined {
  const bindings = current ?? [];
  const index = bindings.findIndex(
    (binding) =>
      binding.templateId === templateId && binding.fieldId === fieldId,
  );
  const before = bindings[index];
  const source =
    patch.source === undefined ? before?.source : (patch.source ?? undefined);
  const manualText =
    patch.manualText === undefined
      ? before?.manualText
      : (patch.manualText ?? undefined);
  if (
    JSON.stringify(source) === JSON.stringify(before?.source) &&
    manualText === before?.manualText
  )
    return current;

  const next = bindings.slice();
  if (source === undefined && manualText === undefined) {
    next.splice(index, 1);
  } else {
    const binding = {
      templateId,
      fieldId,
      ...(source === undefined ? {} : { source }),
      ...(manualText === undefined ? {} : { manualText }),
    };
    if (index === -1) next.push(binding);
    else next[index] = binding;
  }
  return next.length ? sheetSealBindingsSchema.parse(next) : undefined;
}
