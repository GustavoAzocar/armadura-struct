import { describe, expect, it } from 'vitest';
import { completeOwnership } from '../src/domain/hierarchy';
import { linkProjectFile } from '../src/domain/linkedProjectFiles';
import {
  createScheduleLock,
  decodeProject,
  emptyProject,
  newBar,
  schedule,
} from '../src/domain/model';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import {
  applyDetailTransfer,
  previewDetailTransfer,
} from '../src/domain/detailTransfer';

const path = 'Referências/Detalhe.armstruct.json';
function fixture() {
  const p = completeOwnership({
    ...emptyProject(),
    bars: [{ ...newBar('N1'), id: 'bar', dimensionConvention: 'external' }],
    details: [
      {
        id: 'view',
        barId: 'bar',
        origin: { x: 0, y: 500 },
        dimensionConvention: 'axis',
      },
    ],
  });
  return linkProjectFile(
    { ...p, scheduleLock: createScheduleLock(p, 'Teste') },
    path,
  );
}

describe('compatibilidade entre vínculos e cotagem (#190/#172)', () => {
  it('migra o formato 34 da #190 sem perder vínculos ou dados físicos', () => {
    const p = fixture();
    const legacy = {
      ...p,
      schema: 'armadurastruct/34',
      bars: p.bars.map(({ dimensionConvention: _choice, ...b }) => b),
      details: p.details.map(({ dimensionConvention: _choice, ...d }) => d),
      scheduleLock: {
        ...p.scheduleLock!,
        bars: p.scheduleLock!.bars.map(
          ({ dimensionConvention: _choice, ...b }) => b,
        ),
      },
    };
    const migrated = decodeProject(JSON.stringify(legacy));
    expect(migrated).toEqual({ ...legacy, schema: 'armadurastruct/35' });
    expect(decodeProject(JSON.stringify(migrated))).toEqual(migrated);
    const quantities = (project: typeof p) =>
      schedule(project).map(({ bar: _bar, ...row }) => row);
    expect(quantities(migrated)).toEqual(quantities(p));
  });

  it('migra o formato 34 da #172 e vincula arquivos sem rebaixar o formato', () => {
    const { linkedFiles: _links, ...p } = fixture();
    const legacy = { ...p, schema: 'armadurastruct/34' };
    const migrated = decodeProject(JSON.stringify(legacy));
    expect(migrated).toEqual({ ...p, schema: 'armadurastruct/35' });
    const linked = linkProjectFile(migrated, path);
    expect(linked.schema).toBe('armadurastruct/35');
    expect(linked.linkedFiles).toEqual([path]);
    expect(decodeProject(JSON.stringify(linked))).toEqual(linked);
    expect(schedule(linked)).toEqual(schedule(migrated));
  });

  it.each(['armadurastruct/34', 'armadurastruct/35'])(
    'preserva os dois recursos e o quadro bloqueado ao reabrir %s',
    (schema) => {
      const p = fixture();
      const q = decodeProject(JSON.stringify({ ...p, schema }));
      expect(q).toEqual(p);
      expect(q.linkedFiles).toEqual([path]);
      expect(q.bars[0].dimensionConvention).toBe('external');
      expect(q.details[0].dimensionConvention).toBe('axis');
      expect(q.scheduleLock?.bars[0].dimensionConvention).toBe('external');
      expect(decodeProject(JSON.stringify(q))).toEqual(p);
    },
  );

  it('exporta cotagem em pacote 23 e conserva os vínculos do destino na transferência', () => {
    const p = fixture();
    const detailId = p.hierarchy.details[0].id;
    const pack = createDetailPackage(p, detailId, {
      producer: { app: 'ArmaduraStruct', version: '0.6.1' },
    });
    expect(pack.schema).toBe('openstruct.detail/23');
    const source = readDetailPackage(JSON.stringify(pack)).project;
    expect(source.schema).toBe('armadurastruct/35');
    expect(source.linkedFiles).toBeUndefined();
    const target = linkProjectFile(emptyProject(), 'Refs/Destino.pdf');
    const plan = previewDetailTransfer(target, source, {
      mode: 'insert',
      sourceDetailId: detailId,
      targetElementId: target.hierarchy.elements[0].id,
    });
    expect(plan.issues).toEqual([]);
    const transferred = applyDetailTransfer(target, plan);
    expect(transferred.linkedFiles).toEqual(target.linkedFiles);
    expect(transferred.bars[0].dimensionConvention).toBe('external');
    expect(transferred.details[0].dimensionConvention).toBe('axis');
    expect(decodeProject(JSON.stringify(transferred))).toEqual(transferred);
  });

  it.each(['armadurastruct/33', 'armadurastruct/36'])(
    'recusa os dados novos sob a versão incompatível %s',
    (schema) => {
      expect(() =>
        decodeProject(JSON.stringify({ ...fixture(), schema })),
      ).toThrow();
    },
  );

  it('mantém a validação de caminhos ao migrar qualquer variante do formato 34', () => {
    for (const linkedFiles of [['../externo.txt'], ['a', 'A'], 'arquivo'])
      expect(() =>
        decodeProject(
          JSON.stringify({
            ...fixture(),
            schema: 'armadurastruct/34',
            linkedFiles,
          }),
        ),
      ).toThrow();
  });
});
