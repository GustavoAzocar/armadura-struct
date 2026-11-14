import {
  drawingHierarchyContext,
  formatDrawingDate,
  isValidDrawingDate,
} from './drawingMetadata';
import type { Project, Sheet } from './types';

export type SealFieldSource =
  | { kind: 'project' }
  | { kind: 'sheet' }
  | { kind: 'drawing'; drawingId: string }
  | { kind: 'aggregate' };

type AutomaticSourceKind = Exclude<SealFieldSource['kind'], 'drawing'>;

const inheritedSources = ['project', 'sheet'] as const;
const metadataSources = ['project', 'sheet', 'drawing', 'aggregate'] as const;
const projectProperties = {
  '@OBRA': 'work',
  '@CODIGO': 'code',
  '@ENDERECO': 'address',
  '@CLIENTE': 'client',
  '@RESPONSAVEL': 'responsible',
} as const;

export const sealFieldCatalog = {
  '@PROJETO': { label: 'Projeto', sources: ['project'] },
  '@OBRA': { label: 'Obra', sources: inheritedSources },
  '@CODIGO': { label: 'Código', sources: inheritedSources },
  '@ENDERECO': { label: 'Endereço', sources: inheritedSources },
  '@CLIENTE': { label: 'Cliente', sources: inheritedSources },
  '@AUTOR': { label: 'Autor', sources: metadataSources },
  '@RESPONSAVEL': { label: 'Responsável', sources: inheritedSources },
  '@PRANCHA': { label: 'Título da folha', sources: ['sheet'] },
  '@PAVIMENTO': { label: 'Pavimento', sources: ['aggregate', 'drawing'] },
  '@ESCALAS': { label: 'Escalas', sources: ['aggregate'] },
  '@NUMERO': { label: 'Número da folha', sources: ['sheet'] },
  '@TOTAL': { label: 'Total de folhas', sources: ['sheet'] },
  '@REVISAO': { label: 'Revisão', sources: ['sheet', 'project'] },
  '@DATA': {
    label: 'Data documental',
    sources: ['sheet', 'project', 'drawing', 'aggregate'],
  },
  '@PESO_ACO': { label: 'Peso do aço', sources: ['aggregate'] },
  '@NOTAS': { label: 'Notas', sources: ['sheet', 'project', 'drawing'] },
} as const satisfies Record<
  string,
  {
    label: string;
    sources: readonly [AutomaticSourceKind, ...SealFieldSource['kind'][]];
  }
>;

export type SealFieldId = keyof typeof sealFieldCatalog;
type ProjectPropertyField = keyof typeof projectProperties;
type ProjectProperty = (typeof projectProperties)[ProjectPropertyField];
type InheritableProperty = ProjectProperty | 'author' | 'date';
type SheetSealValue = { mode: 'inherit' } | { mode: 'local'; value: string };

export type ProjectSealProperties = Partial<
  Record<ProjectProperty | 'date', string>
>;
export type SheetSealProperties = Partial<
  Record<InheritableProperty, SheetSealValue>
> & {
  /** Local revision continues to use the existing sheet properties. */
  revision?: 'inherit';
};

type SealFieldData = {
  project?: ProjectSealProperties;
  sheet?: SheetSealProperties;
};

export type SealFieldBinding = {
  field: string;
  source?: SealFieldSource;
  /** Absence uses the automatic source. An empty string is an explicit override. */
  manualText?: string;
};

type SealFieldDiagnostic =
  | 'unknown-field'
  | 'unsupported-source'
  | 'missing-source'
  | 'invalid-date'
  | 'mixed'
  | 'partial'
  | 'calculation-unavailable';

type SealFieldValue = { text: string; diagnostics: SealFieldDiagnostic[] };

export type ResolvedSealField = SealFieldValue & {
  source?: SealFieldSource | { kind: 'manual' };
  inherited?: true;
};

function isProjectPropertyField(
  field: SealFieldId,
): field is ProjectPropertyField {
  return Object.hasOwn(projectProperties, field);
}

function value(
  text = '',
  ...diagnostics: SealFieldDiagnostic[]
): SealFieldValue {
  return { text, diagnostics };
}

function documentValue(field: SealFieldId, text?: string): SealFieldValue {
  if (field !== '@DATA' || !text) return value(text);
  return isValidDrawingDate(text)
    ? value(formatDrawingDate(text))
    : value('', 'invalid-date');
}

function projectValue(
  project: Project,
  field: SealFieldId,
  data?: ProjectSealProperties,
) {
  if (isProjectPropertyField(field))
    return value(data?.[projectProperties[field]]);
  switch (field) {
    case '@PROJETO':
      return value(project.name);
    case '@AUTOR':
      return value(project.author);
    case '@REVISAO':
      return value(project.drawing.revision);
    case '@DATA':
      return documentValue(field, data?.date);
    case '@NOTAS':
      return value(project.notes);
    default:
      return value('', 'unsupported-source');
  }
}

function localProperty(setting?: SheetSealValue): string | undefined {
  return setting?.mode === 'local' ? setting.value : undefined;
}

function sheetValue(
  project: Project,
  sheet: Sheet,
  index: number,
  field: SealFieldId,
  data?: SheetSealProperties,
) {
  if (isProjectPropertyField(field))
    return value(localProperty(data?.[projectProperties[field]]));
  switch (field) {
    case '@PRANCHA':
      return value(sheet.name);
    case '@REVISAO':
      return value(sheet.properties.revision);
    case '@NOTAS':
      return value(sheet.properties.notes);
    case '@AUTOR':
      return value(localProperty(data?.author));
    case '@DATA':
      return documentValue(field, localProperty(data?.date));
    case '@NUMERO':
      return value(String(index + 1));
    case '@TOTAL':
      return value(String(project.sheets.length));
    default:
      return value('', 'unsupported-source');
  }
}

function drawingValue(
  project: Project,
  drawingId: string,
  field: SealFieldId,
): SealFieldValue {
  if (field === '@PAVIMENTO') {
    const floor = drawingHierarchyContext(project, drawingId)?.floor;
    return floor ? value(floor.name) : value('', 'missing-source');
  }
  const drawing = project.hierarchy.drawings.find(
    (entry) => entry.id === drawingId,
  );
  if (!drawing) return value('', 'missing-source');
  switch (field) {
    case '@AUTOR':
      return value(drawing.author);
    case '@DATA':
      // Keep the valid ISO date until after ordering the aggregate chronologically.
      return drawing.date && !isValidDrawingDate(drawing.date)
        ? value('', 'invalid-date')
        : value(drawing.date);
    case '@NOTAS':
      return value(drawing.notes);
    default:
      return value('', 'unsupported-source');
  }
}

function aggregateValue(
  project: Project,
  sheetId: string,
  field: SealFieldId,
): SealFieldValue {
  if (field === '@PESO_ACO') return value('', 'calculation-unavailable');

  const placements = project.hierarchy.placements.filter(
    (view) => view.sheetId === sheetId,
  );
  if (field === '@ESCALAS') {
    const scales = [...new Set(placements.map((view) => view.scale))].sort(
      (a, b) => a - b,
    );
    return value(scales.map((scale) => '1:' + scale).join(' / '));
  }

  const drawingIds = new Set(placements.map((view) => view.drawingId));
  const values = [...drawingIds].map((id) => drawingValue(project, id, field));
  const distinct = [
    ...new Set(values.map((entry) => entry.text).filter(Boolean)),
  ].sort();
  const diagnostics = new Set<SealFieldDiagnostic>();
  if (distinct.length > 1) diagnostics.add('mixed');
  if (distinct.length && values.some((entry) => !entry.text))
    diagnostics.add('partial');
  for (const entry of values)
    for (const diagnostic of entry.diagnostics) diagnostics.add(diagnostic);

  const display =
    field === '@DATA' ? distinct.map(formatDrawingDate) : distinct;
  return value(display.join(' / '), ...diagnostics);
}

function inheritedSetting(
  field: SealFieldId,
  data?: SheetSealProperties,
): SheetSealValue | undefined {
  if (isProjectPropertyField(field)) return data?.[projectProperties[field]];
  if (field === '@AUTOR') return data?.author;
  if (field === '@DATA') return data?.date;
  if (field === '@REVISAO' && data?.revision === 'inherit')
    return { mode: 'inherit' };
}

export function resolveSealField(
  project: Project,
  sheetId: string,
  binding: SealFieldBinding,
  data: SealFieldData = {},
): ResolvedSealField {
  const index = project.sheets.findIndex((sheet) => sheet.id === sheetId);
  if (index === -1)
    return { ...value('', 'missing-source'), source: binding.source };
  if (!Object.hasOwn(sealFieldCatalog, binding.field))
    return { ...value('', 'unknown-field'), source: binding.source };

  const field = binding.field as SealFieldId;
  if (binding.manualText !== undefined)
    return { ...value(binding.manualText), source: { kind: 'manual' } };

  const definition = sealFieldCatalog[field];
  const setting = binding.source
    ? undefined
    : inheritedSetting(field, data.sheet);
  const inherited = setting?.mode === 'inherit';
  const source = binding.source ?? {
    kind: inherited
      ? 'project'
      : setting?.mode === 'local'
        ? 'sheet'
        : definition.sources[0],
  };
  if (!definition.sources.some((kind) => kind === source.kind))
    return { ...value('', 'unsupported-source'), source };

  switch (source.kind) {
    case 'project':
      return {
        ...projectValue(project, field, data.project),
        source,
        ...(inherited ? { inherited: true } : {}),
      };
    case 'sheet':
      return {
        ...sheetValue(project, project.sheets[index], index, field, data.sheet),
        source,
      };
    case 'drawing': {
      const result = drawingValue(project, source.drawingId, field);
      const text =
        field === '@DATA' ? formatDrawingDate(result.text) : result.text;
      return { ...result, text, source };
    }
    case 'aggregate':
      return { ...aggregateValue(project, sheetId, field), source };
  }
}
