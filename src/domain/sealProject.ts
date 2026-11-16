import { z } from 'zod';
import type { Project, Sheet } from './types';
import {
  patchProjectSealProperties,
  patchSheetSealBindings,
  patchSheetSealProperties,
  type SealPatch,
} from './sealFieldEdits';
import {
  withSealDataVersion,
  type ProjectSealProperties,
  type SheetSealProperties,
  type SheetSealBinding,
  type TemplateSealBinding,
} from './sealFieldSchema';
import {
  applySheetTemplate,
  saveSheetTemplate,
  type SheetTemplate,
} from './sheetTemplates';

export type SealFieldEdit = {
  fieldId: string;
  definition?: TemplateSealBinding | null;
} & SealPatch<Pick<SheetSealBinding, 'source' | 'manualText'>>;

export type SealBatchEdit = {
  sheetIds: string[];
  name?: string;
  author?: string;
  projectProperties?: SealPatch<ProjectSealProperties>;
  sheetProperties?: SealPatch<SheetSealProperties>;
  revision?: string;
  template?: SheetTemplate;
  fields?: SealFieldEdit[];
};

export const sameSealTemplate = (a?: SheetTemplate, b?: SheetTemplate) =>
  !!a &&
  !!b &&
  a.id === b.id &&
  a.revision === b.revision &&
  (a === b || JSON.stringify(a) === JSON.stringify(b));

/** One pure document change. The application commits it once to its history. */
export function applySealBatch(project: Project, edit: SealBatchEdit): Project {
  const selected = new Set(edit.sheetIds);
  if (
    !selected.size ||
    [...selected].some((id) => !project.sheets.some((s) => s.id === id))
  )
    throw Error('Selecione folhas existentes para preencher o selo.');
  const name =
    edit.name === undefined
      ? project.name
      : z.string().trim().min(1).max(150).parse(edit.name);
  const author =
    edit.author === undefined
      ? project.author
      : z.string().max(150).parse(edit.author);
  const revision =
    edit.revision === undefined
      ? undefined
      : z.string().max(40).parse(edit.revision);
  const properties = patchProjectSealProperties(
    project.sealProperties,
    edit.projectProperties ?? {},
  );
  const fields = edit.fields ?? [];
  let next = project;
  const eligible = project.sheets.filter(
    (s) =>
      selected.has(s.id) && sameSealTemplate(s.paperTemplate, edit.template),
  );
  if (fields.length && !eligible.length)
    throw Error(
      'Selecione uma folha com a revisão do modelo que está sendo editada.',
    );
  const definitions = fields.filter((field) => field.definition !== undefined);
  if (definitions.length && edit.template) {
    const catalog = project.sheetTemplates?.find(
      (t) => t.id === edit.template!.id,
    );
    if (catalog && !sameSealTemplate(catalog, edit.template))
      throw Error(
        'Há outra revisão do modelo na biblioteca. Aplique a revisão atual antes de alterar seus vínculos.',
      );
    const template = {
      ...edit.template,
      fields: edit.template.fields.map((field) => {
        const change = definitions.find((item) => item.fieldId === field.id);
        return change
          ? { ...field, sealBinding: change.definition ?? undefined }
          : field;
      }),
    };
    next = saveSheetTemplate(next, template);
    next = applySheetTemplate(
      next,
      template.id,
      eligible.map((s) => s.id),
    );
  }
  if (
    fields.some(
      (field) => !edit.template?.fields.some((f) => f.id === field.fieldId),
    )
  )
    throw Error(
      'O campo do modelo não existe mais. Reabra o preenchimento do selo.',
    );
  const eligibleIds = new Set(eligible.map((s) => s.id));
  const sheets: Sheet[] = next.sheets.map((sheet) => {
    if (!selected.has(sheet.id)) return sheet;
    let bindings = sheet.sealBindings;
    if (eligibleIds.has(sheet.id) && edit.template)
      for (const field of fields)
        bindings = patchSheetSealBindings(
          bindings,
          {
            templateId: edit.template.id,
            fieldId: field.fieldId,
          },
          { source: field.source, manualText: field.manualText },
        );
    return {
      ...sheet,
      sealProperties: patchSheetSealProperties(
        sheet.sealProperties,
        edit.sheetProperties ?? {},
      ),
      sealBindings: bindings,
      properties:
        revision === undefined
          ? sheet.properties
          : { ...sheet.properties, revision },
    };
  });
  const result = withSealDataVersion({
    ...next,
    name,
    author,
    sealProperties: properties,
    sheets,
  });
  const document = (p: Project) =>
    JSON.stringify([
      p.name,
      p.author,
      p.sealProperties,
      p.sheetTemplates,
      p.sheets,
    ]);
  return document(result) === document(project) ? project : result;
}
