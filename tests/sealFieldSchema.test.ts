import { describe, expect, it } from 'vitest';
import {
  projectSealPropertiesSchema,
  sheetSealBindingsSchema,
  sheetSealPropertiesSchema,
  templateSealBindingSchema,
} from '../src/domain/sealFieldSchema';

import {
  patchProjectSealProperties,
  patchSheetSealBindings,
  patchSheetSealProperties,
} from '../src/domain/sealFieldEdits';

import { sealBindingForField } from '../src/domain/sealFields';

describe('AS-13 · contratos dos dados do selo', () => {
  it('preserva herança, valor local vazio e datas civis válidas', () => {
    const project = { work: 'Edifício Rio', date: '2024-02-29', address: '' };
    expect(projectSealPropertiesSchema.parse(project)).toEqual(project);
    const sheet = {
      revision: 'inherit',
      address: { mode: 'local', value: '' },
      author: { mode: 'inherit' },
      date: { mode: 'local', value: '2000-02-29' },
    };
    expect(sheetSealPropertiesSchema.parse(sheet)).toEqual(sheet);
  });

  it('rejeita valores de cadastro, datas e estados inválidos', () => {
    expect(() =>
      projectSealPropertiesSchema.parse({ address: 'Rua\nSul' }),
    ).toThrow();
    expect(() =>
      projectSealPropertiesSchema.parse({ date: '1900-02-29' }),
    ).toThrow();
    expect(() =>
      sheetSealPropertiesSchema.parse({
        date: { mode: 'local', value: '2024-02-29T00:00:00Z' },
      }),
    ).toThrow();
    expect(() =>
      sheetSealPropertiesSchema.parse({ author: { mode: 'local' } }),
    ).toThrow();
    expect(() =>
      sheetSealPropertiesSchema.parse({
        author: { mode: 'inherit', value: '' },
      }),
    ).toThrow();
    expect(() => sheetSealPropertiesSchema.parse({ revision: 'R2' })).toThrow();
  });

  it('preserva identificadores de catálogo desconhecidos sem aceitar textos como identificadores', () => {
    expect(
      templateSealBindingSchema.parse({
        field: '@OUTRO_CAMPO',
        source: 'sheet',
      }),
    ).toEqual({
      field: '@OUTRO_CAMPO',
      source: 'sheet',
    });
    expect(() =>
      templateSealBindingSchema.parse({ field: 'Texto @PROJETO' }),
    ).toThrow();
    expect(() =>
      templateSealBindingSchema.parse({ field: '@DATA', source: 'drawing' }),
    ).toThrow();
    expect(() =>
      templateSealBindingSchema.parse({ field: '@DATA', drawingId: 'desenho' }),
    ).toThrow();
  });

  it('mantém fonte direta e texto manual vazio na instância de cada modelo', () => {
    const bindings = [
      {
        templateId: 'modelo-a',
        fieldId: 'autor',
        source: { kind: 'drawing', drawingId: 'desenho removido' },
        manualText: '',
      },
      {
        templateId: 'modelo-b',
        fieldId: 'autor',
        manualText: 'Nádia\nEngenharia',
      },
    ];
    expect(sheetSealBindingsSchema.parse(bindings)).toEqual(bindings);
    expect(() =>
      sheetSealBindingsSchema.parse([...bindings, bindings[0]]),
    ).toThrow();
    expect(() =>
      sheetSealBindingsSchema.parse([{ templateId: 'm', fieldId: 'f' }]),
    ).toThrow();
    expect(() =>
      sheetSealBindingsSchema.parse([
        { templateId: 'm', fieldId: 'f', manualText: 'Nádia\tEngenharia' },
      ]),
    ).toThrow();
  });
});

describe('AS-13 · alterações documentais', () => {
  it('combina o modelo e a instância somente quando ambas as identidades coincidem', () => {
    const bindings = [
      { templateId: 'modelo-a', fieldId: 'autor', manualText: '' },
      {
        templateId: 'modelo-b',
        fieldId: 'autor',
        source: { kind: 'drawing', drawingId: 'd' },
      },
    ] as const;
    const field = {
      id: 'autor',
      sealBinding: { field: '@AUTOR', source: 'project' },
    } as const;
    expect(sealBindingForField('modelo-a', field, bindings)).toEqual({
      field: '@AUTOR',
      source: { kind: 'project' },
      manualText: '',
    });
    expect(sealBindingForField('modelo-b', field, bindings)).toEqual({
      field: '@AUTOR',
      source: { kind: 'drawing', drawingId: 'd' },
    });
    expect(
      sealBindingForField('modelo-a', { id: 'autor' }, bindings),
    ).toBeUndefined();
    expect(sealBindingForField('modelo-c', field, bindings)).toEqual({
      field: '@AUTOR',
      source: { kind: 'project' },
    });
  });
  it('altera somente as propriedades informadas e distingue remoção de vazio', () => {
    const project = { address: 'Rua Sul', client: 'Clara' };
    expect(patchProjectSealProperties(project, { client: 'Clara' })).toBe(
      project,
    );
    expect(
      patchProjectSealProperties(project, { address: '', client: null }),
    ).toEqual({ address: '' });
    expect(
      patchProjectSealProperties(project, { address: null, client: null }),
    ).toBeUndefined();
    expect(project).toEqual({ address: 'Rua Sul', client: 'Clara' });

    const sheet = {
      author: { mode: 'local', value: 'Clara' },
      revision: 'inherit',
    } as const;
    expect(
      patchSheetSealProperties(sheet, { author: { mode: 'local', value: '' } }),
    ).toEqual({
      author: { mode: 'local', value: '' },
      revision: 'inherit',
    });
    expect(() =>
      patchSheetSealProperties(sheet, {
        date: { mode: 'local', value: '2025-02-29' },
      }),
    ).toThrow();
    expect(sheet.author.value).toBe('Clara');
  });

  it('restaura o automático sem remover a origem escolhida nem atingir outro modelo', () => {
    const identity = { templateId: 'modelo-a', fieldId: 'autor' };
    const source = { kind: 'drawing', drawingId: 'desenho-a' } as const;
    const before = [
      { ...identity, source, manualText: 'Manual' },
      { ...identity, templateId: 'modelo-b', manualText: 'Outro' },
    ];
    const empty = patchSheetSealBindings(before, identity, { manualText: '' });
    expect(empty).toEqual([{ ...identity, source, manualText: '' }, before[1]]);
    const restored = patchSheetSealBindings(empty, identity, {
      manualText: null,
    });
    expect(restored).toEqual([{ ...identity, source }, before[1]]);
    expect(
      patchSheetSealBindings(restored, identity, { manualText: null }),
    ).toBe(restored);
    expect(
      patchSheetSealBindings(restored, identity, { source: null }),
    ).toEqual([before[1]]);
    expect(before[0].manualText).toBe('Manual');
  });
});
