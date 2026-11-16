import { describe, expect, it } from 'vitest';
import { createHierarchyNode } from '../src/domain/hierarchy';
import { emptyProject } from '../src/domain/model';
import {
  createSheet,
  deleteSheet,
  duplicateSheet,
  placeDrawing,
  reorderSheet,
  updatePlacement,
} from '../src/domain/sheets';
import {
  resolveSealField,
  sealFieldCatalog,
  type SealFieldId,
  type SealFieldSource,
} from '../src/domain/sealFields';
import type { Project } from '../src/domain/types';

function addDrawing(
  project: Project,
  floorName: string,
  author?: string,
  date?: string,
) {
  const floor = createHierarchyNode(project, 'floor', floorName);
  const element = createHierarchyNode(
    floor.project,
    'element',
    'Viga',
    floor.id,
  );
  const detail = createHierarchyNode(
    element.project,
    'detail',
    'Armadura',
    element.id,
  );
  const drawing = detail.project.hierarchy.drawings.find(
    (d) => d.detailId === detail.id,
  )!;
  return {
    id: drawing.id,
    project: {
      ...detail.project,
      hierarchy: {
        ...detail.project.hierarchy,
        drawings: detail.project.hierarchy.drawings.map((d) =>
          d.id === drawing.id ? { ...d, author, date } : d,
        ),
      },
    },
  };
}

describe('AS-13 · resolução dos campos do selo', () => {
  it('cobre o catálogo controlado e não interpreta identificadores desconhecidos', () => {
    const p = emptyProject();
    const sheet = p.sheets[0].id;
    expect(Object.keys(sealFieldCatalog)).toEqual([
      '@PROJETO',
      '@OBRA',
      '@CODIGO',
      '@ENDERECO',
      '@CLIENTE',
      '@AUTOR',
      '@RESPONSAVEL',
      '@PRANCHA',
      '@PAVIMENTO',
      '@ESCALAS',
      '@NUMERO',
      '@TOTAL',
      '@REVISAO',
      '@DATA',
      '@PESO_ACO',
      '@NOTAS',
    ]);
    for (const field of ['@DESCONHECIDO', 'constructor', 'Projeto @AUTOR']) {
      expect(resolveSealField(p, sheet, { field })).toMatchObject({
        text: '',
        diagnostics: ['unknown-field'],
      });
    }
    expect(resolveSealField(p, sheet, { field: '@PESO_ACO' })).toMatchObject({
      text: '',
      diagnostics: ['calculation-unavailable'],
    });
  });

  it('aplica manual, local, vazio explícito e herança sem trocar as fontes diretas', () => {
    const p = { ...emptyProject(), author: 'Eng. Global' };
    const sheet = p.sheets[0].id;
    const local = {
      project: { address: 'Rua do Projeto' },
      sheet: {
        author: { mode: 'local', value: 'Eng. Local' },
        address: { mode: 'local', value: '' },
      },
    } as const;
    expect(
      resolveSealField(p, sheet, { field: '@AUTOR', manualText: '' }, local),
    ).toEqual({
      text: '',
      source: { kind: 'manual' },
      diagnostics: [],
    });
    expect(
      resolveSealField(p, sheet, { field: '@AUTOR' }, local),
    ).toMatchObject({
      text: 'Eng. Local',
      source: { kind: 'sheet' },
    });
    expect(
      resolveSealField(p, sheet, { field: '@ENDERECO' }, local),
    ).toMatchObject({
      text: '',
      source: { kind: 'sheet' },
    });
    expect(
      resolveSealField(
        p,
        sheet,
        { field: '@ENDERECO', source: { kind: 'project' } },
        local,
      ),
    ).toMatchObject({
      text: 'Rua do Projeto',
      source: { kind: 'project' },
    });
    expect(
      resolveSealField(
        { ...p, author: 'Eng. Atual' },
        sheet,
        { field: '@AUTOR' },
        {
          sheet: { author: { mode: 'inherit' } },
        },
      ),
    ).toMatchObject({
      text: 'Eng. Atual',
      source: { kind: 'project' },
      inherited: true,
    });
    expect(resolveSealField(p, sheet, { field: '@AUTOR' })).toMatchObject({
      text: 'Eng. Global',
      source: { kind: 'project' },
    });
  });

  it('lê o cadastro sem duplicar nome, revisão e notas existentes', () => {
    const p = { ...emptyProject(), name: 'Edifício A', notes: 'Geral' };
    const sheet = {
      ...p.sheets[0],
      name: 'Cortes',
      properties: { revision: 'R2', notes: 'Nota local' },
    };
    const project = {
      ...p,
      drawing: { ...p.drawing, revision: 'R3' },
      sheets: [sheet],
    };
    const data = {
      project: {
        work: 'Ampliação',
        code: 'A-01',
        client: 'Cliente A',
        responsible: 'Eng. Rita',
      },
    };
    const text = (field: SealFieldId) =>
      resolveSealField(project, sheet.id, { field }, data).text;
    expect(text('@PROJETO')).toBe('Edifício A');
    expect(text('@OBRA')).toBe('Ampliação');
    expect(text('@CODIGO')).toBe('A-01');
    expect(text('@CLIENTE')).toBe('Cliente A');
    expect(text('@RESPONSAVEL')).toBe('Eng. Rita');
    expect(text('@PRANCHA')).toBe('Cortes');
    expect(text('@REVISAO')).toBe('R2');
    expect(text('@NOTAS')).toBe('Nota local');
    expect(
      resolveSealField(
        project,
        sheet.id,
        { field: '@REVISAO' },
        {
          sheet: { revision: 'inherit' },
        },
      ).text,
    ).toBe('R3');
    expect(
      resolveSealField(project, sheet.id, {
        field: '@NOTAS',
        source: { kind: 'project' },
      }).text,
    ).toBe('Geral');
    expect(
      resolveSealField(project, sheet.id, {
        field: '@REVISAO',
        source: { kind: 'drawing', drawingId: 'qualquer' },
      }).diagnostics,
    ).toEqual(['unsupported-source']);
  });

  it('resolve por ID estável e sinaliza remoção sem adotar outro desenho ou autor global', () => {
    const first = addDrawing(
      { ...emptyProject(), author: 'Autor global' },
      'Térreo',
      'Nádia',
    );
    const second = addDrawing(first.project, 'Cobertura', 'Luís');
    const sheet = second.project.sheets[0].id;
    const source: SealFieldSource = { kind: 'drawing', drawingId: first.id };
    expect(
      resolveSealField(second.project, sheet, { field: '@AUTOR', source }),
    ).toEqual({
      text: 'Nádia',
      source,
      diagnostics: [],
    });
    const removed = {
      ...second.project,
      hierarchy: {
        ...second.project.hierarchy,
        drawings: second.project.hierarchy.drawings.filter(
          (d) => d.id !== first.id,
        ),
      },
    };
    expect(
      resolveSealField(removed, sheet, { field: '@AUTOR', source }),
    ).toEqual({
      text: '',
      source,
      diagnostics: ['missing-source'],
    });
    expect(
      resolveSealField(second.project, sheet, {
        field: '@AUTOR',
        source: {
          kind: 'drawing',
          drawingId: second.project.hierarchy.drawings[0].id,
        },
      }).text,
    ).toBe('');
  });

  it('deduplica escalas por valor e agrega desenhos da folha com divergência e ausência parcial', () => {
    const first = addDrawing(emptyProject(), 'Térreo', 'Nádia', '2024-02-29');
    const second = addDrawing(first.project, 'Cobertura', 'Luís', '2024-12-01');
    const third = addDrawing(second.project, 'Térreo');
    const other = createSheet(third.project, 'Outra folha');
    const sheet = other.project.sheets[0].id;
    let p = other.project;
    for (const [sheetId, drawing, scale] of [
      [sheet, first.id, 50],
      [sheet, first.id, 25],
      [sheet, second.id, 50],
      [sheet, third.id, 50],
      [other.id, p.hierarchy.drawings[0].id, 100],
    ] as const) {
      const placement = placeDrawing(p, sheetId, drawing);
      p = updatePlacement(placement.project, placement.id, { scale });
    }
    const snapshot = structuredClone(p);
    expect(resolveSealField(p, sheet, { field: '@ESCALAS' }).text).toBe(
      '1:25 / 1:50',
    );
    expect(resolveSealField(p, sheet, { field: '@PAVIMENTO' })).toMatchObject({
      text: 'Cobertura / Térreo',
      diagnostics: ['mixed'],
    });
    expect(
      resolveSealField(p, sheet, {
        field: '@AUTOR',
        source: { kind: 'aggregate' },
      }),
    ).toMatchObject({
      text: 'Luís / Nádia',
      diagnostics: ['mixed', 'partial'],
    });
    expect(
      resolveSealField(p, sheet, {
        field: '@DATA',
        source: { kind: 'aggregate' },
      }),
    ).toMatchObject({
      text: '29/02/2024 / 01/12/2024',
      diagnostics: ['mixed', 'partial'],
    });
    const withoutSecond = {
      ...p,
      hierarchy: {
        ...p.hierarchy,
        placements: p.hierarchy.placements.filter(
          (view) => view.drawingId !== second.id,
        ),
      },
    };
    expect(
      resolveSealField(withoutSecond, sheet, {
        field: '@AUTOR',
        source: { kind: 'aggregate' },
      }),
    ).toMatchObject({
      text: 'Nádia',
      diagnostics: ['partial'],
    });
    expect(
      resolveSealField(p, other.id, {
        field: '@AUTOR',
        source: { kind: 'aggregate' },
      }),
    ).toMatchObject({
      text: '',
      diagnostics: [],
    });
    expect(p).toEqual(snapshot);
  });

  it('usa data civil explícita, inclusive vazia e bissexta, sem fallback', () => {
    const p = emptyProject();
    const sheet = p.sheets[0].id;
    const inheritedDate = (date: string) =>
      resolveSealField(
        p,
        sheet,
        { field: '@DATA' },
        {
          project: { date },
          sheet: { date: { mode: 'inherit' } },
        },
      );
    expect(inheritedDate('2000-02-29')).toMatchObject({
      text: '29/02/2000',
      diagnostics: [],
    });
    expect(inheritedDate('1900-02-29')).toMatchObject({
      text: '',
      diagnostics: ['invalid-date'],
    });
    expect(inheritedDate('2024-02-29T00:00:00Z')).toMatchObject({
      text: '',
      diagnostics: ['invalid-date'],
    });
    expect(inheritedDate('')).toMatchObject({ text: '', diagnostics: [] });
    expect(
      resolveSealField(
        p,
        sheet,
        { field: '@DATA' },
        { project: { date: '2024-02-29' } },
      ),
    ).toMatchObject({
      text: '',
      source: { kind: 'sheet' },
    });
    expect(resolveSealField(p, sheet, { field: '@ESCALAS' }).text).toBe('');
  });

  it('calcula número e total pela ordem do projeto ao criar, duplicar, reordenar e excluir', () => {
    const start = emptyProject();
    const second = createSheet(start, 'Segunda');
    const copy = duplicateSheet(second.project, second.id);
    const reordered = reorderSheet(copy.project, copy.id, -1);
    const number = (p: Project, sheet: string) =>
      resolveSealField(p, sheet, { field: '@NUMERO' });
    expect(number(second.project, second.id).text).toBe('2');
    expect(number(copy.project, copy.id).text).toBe('3');
    expect(number(reordered, copy.id).text).toBe('2');
    expect(resolveSealField(reordered, copy.id, { field: '@TOTAL' }).text).toBe(
      '3',
    );
    const removed = deleteSheet(reordered, start.sheets[0].id);
    expect(number(removed, copy.id).text).toBe('1');
    expect(number(removed, start.sheets[0].id)).toMatchObject({
      text: '',
      diagnostics: ['missing-source'],
    });
    expect(resolveSealField(removed, copy.id, { field: '@TOTAL' }).text).toBe(
      '2',
    );
  });
});
