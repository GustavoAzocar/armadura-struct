import { rotate } from './geometry';
import { paperPrimitiveBounds, type PaperPrimitive } from './paperText';
import { sealBindingForField, resolveSealField } from './sealFields';
import type {
  ProjectSealProperties,
  SheetSealBinding,
  SheetSealProperties,
  TemplateSealBinding,
} from './sealFieldSchema';
import {
  formatSheetScheduleNumber,
  formatSheetSchedulePercent,
  sheetScheduleData,
  sheetSteelMass,
} from './sheetSchedule';
import {
  fieldPrimitive,
  paperContains,
  sheetTemplateDecorations,
  type SheetTemplateField,
} from './sheetTemplates';
import { hasReservedDxfText, unsupportedTextChars } from './textStyle';
import type { PaperIssue } from './paper';
import type { Project, Sheet } from './types';

/** Documentary inputs for one composition. The caller supplies the revision's bindings. */
export type SheetSealContent = {
  templateId: string;
  definitions: ReadonlyMap<string, TemplateSealBinding>;
  project?: ProjectSealProperties;
  sheet?: SheetSealProperties;
  bindings?: readonly SheetSealBinding[];
};

function layoutField(
  field: SheetTemplateField,
  text: string,
): PaperPrimitive[] | undefined {
  const lines: PaperPrimitive[] = [];
  let row = 0;
  const primitive = (line: string) => {
    const offset = rotate(
      { x: 0, y: -row * field.height * 1.3 },
      field.rotation,
    );
    return fieldPrimitive(field, line, {
      x: field.origin.x + offset.x,
      y: field.origin.y + offset.y,
    });
  };
  const fits = (line: string) =>
    paperPrimitiveBounds(primitive(line)).every((point) =>
      paperContains(field.box, point),
    );

  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim() || fits(paragraph)) {
      if (paragraph.trim()) lines.push(primitive(paragraph));
      row += 1;
      continue;
    }
    let line = '';
    for (const segment of paragraph.match(/ +[^ ]+|[^ ]+/g) ?? []) {
      const candidate = line + segment;
      if (fits(candidate)) {
        line = candidate;
        continue;
      }
      if (!line) return undefined;
      lines.push(primitive(line));
      row += 1;
      line = segment.trimStart();
      if (!fits(line)) return undefined;
    }
    if (line) lines.push(primitive(line));
    row += 1;
  }
  return lines;
}

const diagnosticMessages = {
  'unknown-field': 'Identificador do campo desconhecido.',
  'unsupported-source': 'Origem incompatível com este campo.',
  'missing-source': 'Origem removida ou indisponível. Escolha outra origem.',
  'invalid-date': 'Data documental inválida.',
  mixed: 'A folha tem valores distintos para este campo.',
  partial: 'Um ou mais desenhos da folha estão sem valor para este campo.',
  'calculation-unavailable': 'O valor calculado está indisponível.',
};

export function composeTemplateSeal(
  project: Project,
  sheet: Sheet,
  template: NonNullable<Sheet['paperTemplate']>,
  content: SheetSealContent,
  tableData?: ReturnType<typeof sheetScheduleData>,
) {
  const issues: PaperIssue[] = [];
  const notices: PaperIssue[] = [];
  let data = tableData;
  const decorations = sheetTemplateDecorations(template, (field) => {
    const binding = sealBindingForField(
      template.id,
      { id: field.id, sealBinding: content.definitions.get(field.id) },
      content.bindings,
    );
    if (!binding) return undefined;
    const message = (code: string, text: string): PaperIssue => ({
      code: 'seal-field-' + code,
      fieldId: field.id,
      message: 'Campo “' + field.label + '”. ' + text,
    });
    const resolved = resolveSealField(project, sheet.id, binding, content);
    for (const diagnostic of resolved.diagnostics) {
      if (
        diagnostic === 'calculation-unavailable' &&
        binding.field === '@PESO_ACO'
      )
        continue;
      const destination =
        diagnostic === 'mixed' || diagnostic === 'partial' ? notices : issues;
      destination.push(message(diagnostic, diagnosticMessages[diagnostic]));
    }

    if (
      resolved.source?.kind === 'manual' &&
      ['@PESO_ACO', '@NUMERO', '@TOTAL', '@ESCALAS'].includes(binding.field)
    ) {
      notices.push(
        message('manual', 'Texto manual. Este valor não foi calculado.'),
      );
    }
    let text = resolved.text;
    if (binding.field === '@PESO_ACO') {
      data ??= sheetScheduleData(project, sheet.id);
      const stale = data.scheduleDirty;
      const invalid = data.rows.some((row) => row.errors.length);
      if (stale && !tableData)
        issues.push({
          ...message(
            'schedule-stale',
            'RA bloqueada e desatualizada. Atualize ou desbloqueie a RA.',
          ),
          code: 'schedule-stale',
        });
      if (invalid && !tableData)
        issues.push(
          message(
            'schedule-geometry',
            'Corrija as geometrias inválidas das armaduras da folha.',
          ),
        );
      if (
        resolved.source?.kind === 'aggregate' &&
        !stale &&
        !invalid &&
        resolved.diagnostics.includes('calculation-unavailable')
      ) {
        const mass = sheetSteelMass(
          data.summary,
          sheet.steelSchedule?.allowancePercent ?? 0,
        );
        const allowance = formatSheetSchedulePercent(mass.allowancePercent);
        const label = mass.allowancePercent
          ? 'com acréscimo de ' + allowance + '%'
          : 'líquido, 0%';
        text =
          'Barras da folha: ' +
          formatSheetScheduleNumber(mass.totalKg) +
          ' kg (' +
          label +
          ')';
      }
    }
    if (
      text
        .split('\n')
        .some(
          (line) =>
            unsupportedTextChars(line).length || hasReservedDxfText(line),
        )
    ) {
      issues.push(
        message(
          'text-encoding',
          'O texto contém caracteres ou códigos que PDF e DXF não reproduzem literalmente.',
        ),
      );
      return [];
    }
    if (!text.trim()) return [];
    const lines = layoutField(field, text);
    if (!lines) {
      issues.push(
        message(
          'overflow',
          'O texto ultrapassa a caixa. Ajuste a caixa, o texto ou sua apresentação.',
        ),
      );
      return [];
    }
    return lines;
  });
  return { decorations, issues, notices };
}
