import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  DRAWING_METADATA_LIMITS,
  drawingHierarchyContext,
  duplicateDrawing,
  formatDrawingDate,
  isValidDrawingDate,
  updateDrawingMetadata,
} from '../src/domain/drawingMetadata';
import {
  createScheduleLock,
  decodeProject,
  demoProject,
  emptyProject,
  newBar,
  schedule,
  scheduleChanged,
} from '../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
  updateHierarchyNode,
} from '../src/domain/hierarchy';
import {
  assertDetailEdit,
  canEditDetailChange,
} from '../src/domain/detailEditing';
import {
  applyDetailTransfer,
  previewDetailTransfer,
} from '../src/domain/detailTransfer';
import {
  applyMergeRepetitions,
  previewMergeRepetitions,
} from '../src/domain/detailRepetition';
import { duplicatePlacement, duplicateSheet } from '../src/domain/sheets';
import { composeSheet } from '../src/domain/paper';
import {
  hasProjectSetupToReplace,
  newProjectSetup,
} from '../src/domain/projectSetup';
import { setLayerState } from '../src/domain/layerProfiles';
import { exportLines, toCsv, toDxf } from '../src/lib/exports';

describe('metadados documentais por desenho', () => {
  it('mantém independência entre dois desenhos do mesmo detalhamento e das propriedades do projeto/prancha', () => {
    const base = demoProject();
    base.author = 'Autor Global do Projeto';
    base.notes = 'Notas globais do projeto';
    const firstId = base.hierarchy.drawings[0].id;
    const dup = duplicateDrawing(base, firstId);
    const secondId = dup.id;

    const editedA = updateDrawingMetadata(dup.project, firstId, {
      name: 'Elevação longitudinal',
      author: 'Eng. Marina Alves',
      date: '2026-11-09',
      notes: 'Conferir cobrimento de 30 mm\nSem emendas no vão central.',
    });

    const drawingA = editedA.hierarchy.drawings.find((d) => d.id === firstId)!;
    const drawingB = editedA.hierarchy.drawings.find((d) => d.id === secondId)!;
    expect(drawingA.detailId).toBe(drawingB.detailId);
    expect(drawingA).toEqual({
      id: firstId,
      detailId: base.hierarchy.details[0].id,
      name: 'Elevação longitudinal',
      author: 'Eng. Marina Alves',
      date: '2026-11-09',
      notes: 'Conferir cobrimento de 30 mm\nSem emendas no vão central.',
    });
    expect(drawingB).toEqual({
      id: secondId,
      detailId: base.hierarchy.details[0].id,
      name: 'Desenho principal (cópia)',
    });
    expect(editedA.author).toBe('Autor Global do Projeto');
    expect(editedA.notes).toBe('Notas globais do projeto');
    expect(editedA.sheets).toBe(base.sheets);

    const editedB = updateDrawingMetadata(editedA, secondId, {
      name: 'Seções transversais',
      author: 'Eng. Carlos Rocha',
      date: '2026-12-01',
      notes: 'Apenas seções S1 e S2.',
    });
    expect(
      editedB.hierarchy.drawings.find((d) => d.id === firstId),
    ).toStrictEqual(drawingA);
    expect(editedB.hierarchy.drawings.find((d) => d.id === secondId)).toEqual({
      id: secondId,
      detailId: base.hierarchy.details[0].id,
      name: 'Seções transversais',
      author: 'Eng. Carlos Rocha',
      date: '2026-12-01',
      notes: 'Apenas seções S1 e S2.',
    });
  });

  it('deriva pavimento, elemento e detalhamento da hierarquia sem gravar cópia nos metadados do desenho', () => {
    const base = demoProject();
    const drawingId = base.hierarchy.drawings[0].id;
    const floorId = base.hierarchy.floors[0].id;
    const elementId = base.hierarchy.elements[0].id;
    const detailId = base.hierarchy.details[0].id;

    let p = updateDrawingMetadata(base, drawingId, {
      name: 'Armação positiva',
      author: 'Equipe Estrutural',
      date: '2026-05-14',
      notes: 'Revisão interna.',
    });
    const drawingsSnapshot = p.hierarchy.drawings;

    p = updateHierarchyNode(p, 'floor', floorId, '2º Pavimento');
    p = updateHierarchyNode(
      p,
      'element',
      elementId,
      'Vigas principais',
      floorId,
    );
    p = updateHierarchyNode(p, 'detail', detailId, 'V201', elementId);

    expect(p.hierarchy.drawings).toBe(drawingsSnapshot);
    const ctx = drawingHierarchyContext(p, drawingId)!;
    expect(ctx.floor.name).toBe('2º Pavimento');
    expect(ctx.element.name).toBe('Vigas principais');
    expect(ctx.detailLabel).toBe('V201');
    expect(ctx.path).toBe('2º Pavimento / Vigas principais / V201');
  });

  it('conserva todos os campos em round-trip, trata vazios como opcionais e evita mutação em confirmação idêntica', () => {
    const p0 = emptyProject();
    const id = p0.hierarchy.drawings[0].id;
    expect(p0.hierarchy.drawings[0].author).toBeUndefined();
    expect(p0.hierarchy.drawings[0].date).toBeUndefined();
    expect(p0.hierarchy.drawings[0].notes).toBeUndefined();

    const p1 = updateDrawingMetadata(p0, id, {
      name: '  Corte AA  ',
      author: '  Joana D’Arc  ',
      date: '2026-11-09',
      notes: '  Linha 1\r\nLinha 2  ',
    });
    expect(p1.schema).toBe('armadurastruct/31');
    expect(
      updateDrawingMetadata(p1, id, {
        name: 'Corte AA',
        author: 'Joana D’Arc',
        date: '2026-11-09',
        notes: 'Linha 1\nLinha 2',
      }),
    ).toBe(p1);

    const reopened = decodeProject(JSON.stringify(p1));
    expect(reopened).toStrictEqual(p1);

    const cleared = updateDrawingMetadata(reopened, id, {
      name: 'Desenho principal',
      author: '   ',
      date: '   ',
      notes: '\r\n   ',
    });
    expect(cleared.hierarchy.drawings[0]).toStrictEqual({
      id,
      detailId: p0.hierarchy.details[0].id,
      name: 'Desenho principal',
    });
    expect(Object.keys(cleared.hierarchy.drawings[0]).sort()).toEqual([
      'detailId',
      'id',
      'name',
    ]);
    expect(decodeProject(JSON.stringify(cleared))).toStrictEqual(cleared);
  });

  it('migra projetos antigos sem inventar autor/data e rejeita metadados novos em versões anteriores', () => {
    const base = demoProject();
    for (const version of [1, 2, 12, 24, 25]) {
      const cloned = structuredClone(base);
      if (version < 14) {
        for (const o of [
          ...cloned.bars,
          ...cloned.details,
          ...cloned.annotations,
          ...cloned.polylines,
          ...cloned.masks,
        ])
          delete o.layerId;
        for (const m of cloned.masks) {
          delete m.layerDefinitions;
          for (const q of m.primitives) delete q.layerId;
        }
      }
      const legacy: Record<string, unknown> = {
        ...cloned,
        schema: `armadurastruct/${version}`,
      };
      if (version < 3) {
        delete legacy.id;
        delete legacy.hierarchy;
      }
      if (version < 4) delete legacy.sheets;
      if (version < 14) delete legacy.layers;
      const migrated = decodeProject(JSON.stringify(legacy));
      expect(migrated.schema).toBe('armadurastruct/31');
      for (const d of migrated.hierarchy.drawings) {
        expect(d.author).toBeUndefined();
        expect(d.date).toBeUndefined();
        expect(d.notes).toBeUndefined();
      }
    }

    const withMeta = updateDrawingMetadata(
      base,
      base.hierarchy.drawings[0].id,
      {
        name: 'Desenho principal',
        author: 'Autor',
      },
    );
    expect(() =>
      decodeProject(
        JSON.stringify({ ...withMeta, schema: 'armadurastruct/25' }),
      ),
    ).toThrow(/formato 26/);
  });

  it('valida data documental civil sem horário e mantém o mesmo dia em fusos extremos', () => {
    expect(isValidDrawingDate('2026-11-09')).toBe(true);
    expect(isValidDrawingDate('2024-02-29')).toBe(true);
    expect(isValidDrawingDate('2000-02-29')).toBe(true);
    expect(isValidDrawingDate('1900-02-29')).toBe(false);
    expect(isValidDrawingDate('2026-02-29')).toBe(false);
    expect(isValidDrawingDate('2026-04-31')).toBe(false);
    expect(isValidDrawingDate('2026-13-01')).toBe(false);
    expect(isValidDrawingDate('2026-00-10')).toBe(false);
    expect(isValidDrawingDate('2026-11-09T00:00:00Z')).toBe(false);
    expect(isValidDrawingDate('09/11/2026')).toBe(false);
    expect(formatDrawingDate('2026-11-09')).toBe('09/11/2026');
    expect(formatDrawingDate('')).toBe('');

    const base = emptyProject();
    const p = updateDrawingMetadata(base, base.hierarchy.drawings[0].id, {
      name: 'Desenho principal',
      date: '2026-01-01',
    });
    const serialized = JSON.stringify(p);
    for (const tz of [
      'UTC',
      'America/Sao_Paulo',
      'Pacific/Kiritimati',
      'Pacific/Niue',
    ]) {
      const out = execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `const data = JSON.parse(${JSON.stringify(serialized)});
           const d = data.hierarchy.drawings[0].date;
           const [y, m, day] = d.split('-');
           process.stdout.write(d + '|' + day + '/' + m + '/' + y);`,
        ],
        { env: { ...process.env, TZ: tz }, encoding: 'utf8' },
      );
      expect(out).toBe('2026-01-01|01/01/2026');
    }
  });

  it('trata limites excedidos, caracteres de controle, especiais e conteúdo semelhante a HTML com segurança', () => {
    const p = emptyProject();
    const id = p.hierarchy.drawings[0].id;

    expect(() => updateDrawingMetadata(p, id, { name: '   ' })).toThrow(
      /1 a 100/,
    );
    expect(() =>
      updateDrawingMetadata(p, id, {
        name: 'T'.repeat(DRAWING_METADATA_LIMITS.name + 1),
      }),
    ).toThrow(/1 a 100/);
    expect(() =>
      updateDrawingMetadata(p, id, {
        name: 'Válido',
        author: 'A'.repeat(DRAWING_METADATA_LIMITS.author + 1),
      }),
    ).toThrow(/150/);
    expect(() =>
      updateDrawingMetadata(p, id, {
        name: 'Válido',
        notes: 'C'.repeat(DRAWING_METADATA_LIMITS.notes + 1),
      }),
    ).toThrow(/5000/);
    expect(() =>
      updateDrawingMetadata(p, id, {
        name: 'Válido',
        date: '2026-11-09T10:00:00Z',
      }),
    ).toThrow(/data documental/);
    expect(() =>
      updateDrawingMetadata(p, id, { name: 'Linha\nquebrada' }),
    ).toThrow(/controle/);
    expect(() =>
      updateDrawingMetadata(p, id, { name: 'Ok', notes: 'Nulo\x00inválido' }),
    ).toThrow(/controle/);

    const htmlLike = {
      name: '<img src=x onerror=alert(1)> · Ø12,5',
      author: '<b>Eng. "Teste" & Cia</b>',
      date: '2026-11-09',
      notes:
        '<script>window.evil=true</script>\nCobrimento >= 30 mm & Ø <= 25 mm',
    };
    const saved = updateDrawingMetadata(p, id, htmlLike);
    const decoded = decodeProject(JSON.stringify(saved));
    expect(decoded.hierarchy.drawings[0]).toMatchObject(htmlLike);
  });

  it('preserva metadados na duplicação, reunião e transferência de desenhos sem compartilhar objetos mutáveis', () => {
    let source = demoProject();
    const sourceDrawingId = source.hierarchy.drawings[0].id;
    source = setLayerState(
      source,
      `drawing:${sourceDrawingId}`,
      'layer:MASCARA',
      { visible: false },
    );
    source = updateDrawingMetadata(source, sourceDrawingId, {
      name: 'Armação principal',
      author: 'Autor Origem',
      date: '2026-08-20',
      notes: 'Nota original do desenho 1',
    });
    const dup = duplicateDrawing(source, sourceDrawingId);
    source = updateDrawingMetadata(dup.project, dup.id, {
      name: 'Detalhe do apoio',
      author: 'Autor Apoio',
      date: '2026-08-21',
      notes: 'Nota exclusiva do desenho 2',
    });
    expect(source.layerEnvironment!.contexts[`drawing:${dup.id}`]).not.toBe(
      source.layerEnvironment!.contexts[`drawing:${sourceDrawingId}`],
    );

    const sheetDup = duplicateSheet(source, source.sheets[0].id).project;
    const viewDup = duplicatePlacement(
      sheetDup,
      sheetDup.hierarchy.placements[0].id,
    ).project;
    expect(viewDup.hierarchy.drawings).toEqual(source.hierarchy.drawings);

    const target = emptyProject();
    const insertPlan = previewDetailTransfer(target, source, {
      mode: 'insert',
      sourceDetailId: source.hierarchy.details[0].id,
      targetElementId: target.hierarchy.elements[0].id,
    });
    expect(insertPlan.issues).toEqual([]);
    const transferred = applyDetailTransfer(target, insertPlan);
    const importedDrawings = transferred.hierarchy.drawings.filter(
      (d) => d.detailId === insertPlan.targetDetailId,
    );
    expect(importedDrawings).toHaveLength(2);
    expect(importedDrawings[0].id).not.toBe(sourceDrawingId);
    expect(importedDrawings[1].id).not.toBe(dup.id);
    expect(importedDrawings[0]).not.toBe(source.hierarchy.drawings[0]);
    expect(
      importedDrawings.map(({ id: _id, detailId: _det, ...rest }) => rest),
    ).toEqual([
      {
        name: 'Armação principal',
        author: 'Autor Origem',
        date: '2026-08-20',
        notes: 'Nota original do desenho 1',
      },
      {
        name: 'Detalhe do apoio',
        author: 'Autor Apoio',
        date: '2026-08-21',
        notes: 'Nota exclusiva do desenho 2',
      },
    ]);

    // Em modo replace, os desenhos locais e sua autoria local são preservados.
    const locallyEdited = updateDrawingMetadata(
      transferred,
      importedDrawings[0].id,
      {
        name: 'Armação local conferida',
        author: 'Revisor Local',
        date: '2026-09-10',
        notes: 'Mantido no destino',
      },
    );
    const replacePlan = previewDetailTransfer(locallyEdited, source, {
      mode: 'replace',
      sourceDetailId: source.hierarchy.details[0].id,
      targetDetailId: insertPlan.targetDetailId,
    });
    expect(replacePlan.issues).toEqual([]);
    const replaced = applyDetailTransfer(locallyEdited, replacePlan);
    expect(replaced.hierarchy.drawings).toEqual(
      locallyEdited.hierarchy.drawings,
    );

    // Reunião de detalhamentos repetidos preserva metadados independentes dos desenhos reunidos.
    let rep = newProjectSetup().project;
    const d1 = rep.hierarchy.details[0].id;
    const created = createHierarchyNode(
      rep,
      'detail',
      'V2',
      rep.hierarchy.elements[0].id,
    );
    rep = completeOwnership(
      {
        ...created.project,
        bars: [{ ...newBar('N1'), id: 'b1', quantity: 2 }],
      },
      d1,
    );
    rep = completeOwnership(
      {
        ...rep,
        bars: [...rep.bars, { ...newBar('N2'), id: 'b2', quantity: 2 }],
      },
      created.id,
    );
    const draw1 = rep.hierarchy.drawings.find((d) => d.detailId === d1)!.id;
    const draw2 = rep.hierarchy.drawings.find(
      (d) => d.detailId === created.id,
    )!.id;
    rep = updateDrawingMetadata(rep, draw1, {
      name: 'Desenho V1',
      author: 'Autor 1',
    });
    rep = updateDrawingMetadata(rep, draw2, {
      name: 'Desenho V2',
      author: 'Autor 2',
    });
    const mergePlan = previewMergeRepetitions(rep, d1, [created.id]);
    expect(mergePlan.issues).toEqual([]);
    const merged = applyMergeRepetitions(rep, mergePlan);
    expect(
      merged.hierarchy.drawings.map((d) => ({
        id: d.id,
        detailId: d.detailId,
        name: d.name,
        author: d.author,
      })),
    ).toEqual([
      { id: draw1, detailId: d1, name: 'Desenho V1', author: 'Autor 1' },
      { id: draw2, detailId: d1, name: 'Desenho V2', author: 'Autor 2' },
    ]);
  });

  it('permite desfazer/refazer no detalhamento isolado, bloqueia alterações em outro detalhamento e sinaliza projeto modificado', () => {
    const setup = newProjectSetup().project;
    expect(hasProjectSetupToReplace(setup)).toBe(false);
    const touched = updateDrawingMetadata(
      setup,
      setup.hierarchy.drawings[0].id,
      {
        name: 'Desenho principal',
        author: 'Eng. Responsável',
      },
    );
    expect(hasProjectSetupToReplace(touched)).toBe(true);

    const second = createHierarchyNode(
      setup,
      'detail',
      'V2',
      setup.hierarchy.elements[0].id,
    ).project;
    const d1 = second.hierarchy.details[0].id;
    const draw1 = second.hierarchy.drawings.find((d) => d.detailId === d1)!.id;
    const draw2 = second.hierarchy.drawings.find((d) => d.detailId !== d1)!.id;

    const validIsolated = updateDrawingMetadata(second, draw1, {
      name: 'V1 revisado',
      notes: 'Ok no isolamento',
    });
    expect(() => assertDetailEdit(second, validIsolated, d1)).not.toThrow();
    expect(canEditDetailChange(validIsolated, second, d1)).toBe(true);

    const foreignIsolated = updateDrawingMetadata(second, draw2, {
      name: 'V2 indevido',
    });
    expect(() => assertDetailEdit(second, foreignIsolated, d1)).toThrow(
      /edição isolada/,
    );
  });

  it('mantém geometria, quantidades, pesos, RA bloqueada, pranchas e exportações equivalentes antes e depois da edição', () => {
    let before = demoProject();
    before = {
      ...before,
      scheduleLock: createScheduleLock(before, '2026-11-09T00:00:00Z'),
    };

    const after = updateDrawingMetadata(
      before,
      before.hierarchy.drawings[0].id,
      {
        name: 'Armação longitudinal e transversal',
        author: 'Eng. Responsável pelo Desenho',
        date: '2026-11-09',
        notes: 'Observação estritamente documental.',
      },
    );

    expect(after.bars).toBe(before.bars);
    expect(after.details).toBe(before.details);
    expect(after.annotations).toBe(before.annotations);
    expect(after.masks).toBe(before.masks);
    expect(after.polylines).toBe(before.polylines);
    expect(after.sheets).toBe(before.sheets);
    expect(after.hierarchy.placements).toBe(before.hierarchy.placements);
    expect(schedule(after)).toEqual(schedule(before));
    expect(scheduleChanged(after)).toBe(false);
    expect(exportLines(after)).toEqual(exportLines(before));
    expect(toCsv(after)).toBe(toCsv(before));
    expect(toDxf(after)).toBe(toDxf(before));
    expect(composeSheet(after, after.sheets[0].id)).toEqual(
      composeSheet(before, before.sheets[0].id),
    );
  });
});
