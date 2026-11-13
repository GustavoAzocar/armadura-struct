import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import exchangeV22 from '../docs/openstruct-detail-v22.schema.json';
import exchangeV23 from '../docs/openstruct-detail-v23.schema.json';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import {
  completeOwnership,
  createHierarchyNode,
} from '../src/domain/hierarchy';
import {
  createScheduleLock,
  decodeProject,
  emptyProject,
  newBar,
  schedule,
} from '../src/domain/model';
import type { BarDimensionConvention } from '../src/domain/types';

const options = { producer: { app: 'Teste', version: '1' } };
const external: BarDimensionConvention = 'external';
const axis: BarDimensionConvention = 'axis';
const at = { x: 300, y: 200 };

function fixture() {
  const project = completeOwnership({
    ...emptyProject(),
    bars: [{ ...newBar('N1'), id: 'bar', dimensionConvention: external }],
    details: [
      { id: 'axis', barId: 'bar', origin: at, dimensionConvention: axis },
      {
        id: 'external',
        barId: 'bar',
        origin: { x: 600, y: 200 },
        dimensionConvention: external,
        scale: 2,
      },
    ],
  });
  return { ...project, scheduleLock: createScheduleLock(project, 'Teste') };
}

describe('convenção de cotagem nos arquivos', () => {
  it('reabre o projeto com cada escolha independente e o quadro de aço bloqueado', () => {
    const p = fixture();
    const q = decodeProject(JSON.stringify(p));
    expect(q.schema).toBe('armadurastruct/35');
    expect(q.bars[0].dimensionConvention).toBe('external');
    expect(q.details.map((d) => d.dimensionConvention)).toEqual([
      'axis',
      'external',
    ]);
    expect(q.scheduleLock?.bars[0].dimensionConvention).toBe('external');
    expect(schedule(q)).toEqual(schedule(p));
  });

  it.each(['mm', 'cm', 'm'] as const)(
    'preserva a convenção de cada objeto no pacote em %s',
    (unit) => {
      const p = fixture();
      const pack = createDetailPackage(p, p.hierarchy.details[0].id, {
        ...options,
        unit,
      });
      const validate = new Ajv2020({
        strict: false,
        formats: { 'date-time': true },
      }).compile(exchangeV23);
      expect(pack.schema).toBe('openstruct.detail/23');
      expect(validate(pack), JSON.stringify(validate.errors)).toBe(true);
      const q = readDetailPackage(JSON.stringify(pack)).project;
      expect(q.bars[0].dimensionConvention).toBe('external');
      expect(q.details).toEqual(p.details);
      expect(schedule(q)[0].unitLength).toBe(schedule(p)[0].unitLength);
    },
  );

  it('valida e lê a convenção em dependências sem transformá-las em aço do detalhe', () => {
    const original = fixture();
    const { project, id } = createHierarchyNode(
      original,
      'detail',
      'Vista externa',
      original.hierarchy.elements[0].id,
    );
    project.hierarchy.objectDetails.external = id;
    const pack = createDetailPackage(project, id, options);
    const validate = new Ajv2020({
      strict: false,
      formats: { 'date-time': true },
    }).compile(exchangeV23);
    expect(validate(pack), JSON.stringify(validate.errors)).toBe(true);
    expect(pack.objects.bars).toEqual([]);
    expect(pack.dependencies[0].dimensionConvention).toBe('external');
    expect(readDetailPackage(pack).project.details[0].dimensionConvention).toBe(
      'external',
    );
    expect(() =>
      readDetailPackage({
        ...pack,
        schema: 'openstruct.detail/22',
        objects: {
          ...pack.objects,
          details: pack.objects.details.map(
            ({ dimensionConvention: _choice, ...d }) => d,
          ),
        },
      }),
    ).toThrow(/Convenção de cotagem exige pacote/);
  });

  it('mantém os formatos anteriores válidos e recusa a convenção sob versões antigas', () => {
    const p = fixture();
    const detailId = p.hierarchy.details[0].id;
    const pack = createDetailPackage(p, detailId, options);
    expect(() =>
      decodeProject(JSON.stringify({ ...p, schema: 'armadurastruct/33' })),
    ).toThrow(/formato 34/);
    expect(() =>
      readDetailPackage({ ...pack, schema: 'openstruct.detail/22' }),
    ).toThrow(/Convenção de cotagem exige pacote/);

    const oldProject = {
      ...p,
      schema: 'armadurastruct/33',
      bars: p.bars.map(({ dimensionConvention: _choice, ...b }) => b),
      details: p.details.map(({ dimensionConvention: _choice, ...d }) => d),
      scheduleLock: undefined,
    };
    const decoded = decodeProject(JSON.stringify(oldProject));
    expect(decoded.bars[0].dimensionConvention).toBeUndefined();
    expect(
      decoded.details.every((d) => d.dimensionConvention === undefined),
    ).toBe(true);
    const legacy = {
      ...createDetailPackage(decoded, detailId, options),
      schema: 'openstruct.detail/22',
    };
    const validate = new Ajv2020({
      strict: false,
      formats: { 'date-time': true },
    }).compile(exchangeV22);
    expect(validate(legacy), JSON.stringify(validate.errors)).toBe(true);
    expect(readDetailPackage(legacy).project.details).toEqual(decoded.details);
  });
});
