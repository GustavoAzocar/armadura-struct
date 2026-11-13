import { describe, expect, it } from 'vitest';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import {
  applyDetailTransfer,
  previewDetailTransfer,
} from '../src/domain/detailTransfer';
import {
  completeOwnership,
  createHierarchyNode,
} from '../src/domain/hierarchy';
import { linkProjectFile } from '../src/domain/linkedProjectFiles';
import {
  createScheduleLock,
  decodeProject,
  emptyProject,
  withDistributionBandVersion,
} from '../src/domain/model';
import { criteriaBar, withStirrupRange } from '../src/domain/stirrups';
import { defaultStirrupCriteria } from '../src/domain/stirrupSchema';
import type { Bar, Project } from '../src/domain/types';

const producer = { app: 'ArmaduraStruct', version: '0.6.1' };

function projectWithRange(render: NonNullable<Bar['distribution']>['render']) {
  const criteria = {
    ...defaultStirrupCriteria(),
    spacing: 200,
    startInset: 50,
    endInset: 100,
  };
  const range = withStirrupRange(
    criteriaBar(criteria, { x: -300, y: 0 }, 'N1', 'estribo'),
    criteria,
    { x: 0, y: 0 },
    { x: 1200, y: 0 },
    { x: 0, y: 150 },
  );
  return completeOwnership({
    ...emptyProject(),
    bars: [{ ...range, distribution: { ...range.distribution!, render } }],
  });
}

function withCotation(base: Project) {
  const [bar] = base.bars;
  return completeOwnership({
    ...base,
    bars: [{ ...bar, dimensionConvention: 'external' }],
    details: [
      {
        id: 'rebatimento',
        barId: bar.id,
        origin: { x: 0, y: 0 },
        dimensionConvention: 'axis',
      },
    ],
  });
}

describe('persistência da faixa sem traços individuais', () => {
  it('mantém faixa, vínculos, cotagem e fotografia da RA ao reabrir', () => {
    const base = withCotation(projectWithRange('band'));
    const path = 'Referências/Planta.pdf';
    const project = linkProjectFile(
      withDistributionBandVersion({
        ...base,
        scheduleLock: createScheduleLock(base),
      }),
      path,
    );
    expect(project.schema).toBe('armadurastruct/37');
    const reopened = decodeProject(JSON.stringify(project));
    expect(reopened.schema).toBe('armadurastruct/37');
    expect(reopened.linkedFiles).toEqual([path]);
    expect(reopened.bars[0].dimensionConvention).toBe('external');
    expect(reopened.details[0].dimensionConvention).toBe('axis');
    expect(reopened.scheduleLock?.bars[0].dimensionConvention).toBe('external');
    expect(reopened.bars[0].distribution).toEqual(base.bars[0].distribution);
    expect(reopened.scheduleLock?.bars[0].distribution).toEqual(
      base.bars[0].distribution,
    );
    expect(withDistributionBandVersion(reopened)).toBe(reopened);

    expect(() => decodeProject(JSON.stringify(base))).toThrow(/formato 37/);
    const ticks = projectWithRange('ticks');
    expect(() =>
      decodeProject(
        JSON.stringify({ ...ticks, scheduleLock: project.scheduleLock }),
      ),
    ).toThrow(/formato 37/);
  });

  it.each([undefined, 'ticks', 'bars'] as const)(
    'preserva o formato e a apresentação anterior (%s)',
    (render) => {
      const project = projectWithRange(render);
      expect(withDistributionBandVersion(project)).toBe(project);
      expect(
        decodeProject(JSON.stringify(project)).bars[0].distribution?.render,
      ).toBe(render);
      const pack = createDetailPackage(
        project,
        project.hierarchy.details[0].id,
        {
          producer,
        },
      );
      expect(pack.schema).toBe('openstruct.detail/23');
      for (const schema of ['openstruct.detail/22', pack.schema]) {
        expect(
          readDetailPackage({ ...pack, schema }).project.bars[0].distribution
            ?.render,
        ).toBe(render);
      }
    },
  );

  it.each(['mm', 'cm', 'm'] as const)(
    'transporta a faixa sem traços para outro projeto (%s)',
    (unit) => {
      const project = withDistributionBandVersion(
        withCotation(projectWithRange('band')),
      );
      const sourceDetailId = project.hierarchy.details[0].id;
      const pack = createDetailPackage(project, sourceDetailId, {
        producer,
        unit,
      });
      expect(pack.schema).toBe('openstruct.detail/24');
      expect(() =>
        readDetailPackage({ ...pack, schema: 'openstruct.detail/23' }),
      ).toThrow(/openstruct\.detail\/24/);
      const { package: read, project: source } = readDetailPackage(
        JSON.stringify(pack),
      );
      expect(read.schema).toBe('openstruct.detail/24');
      expect(source.bars[0].distribution).toEqual(project.bars[0].distribution);
      expect(source.bars[0].dimensionConvention).toBe('external');
      expect(source.details[0].dimensionConvention).toBe('axis');

      const target = linkProjectFile(emptyProject(), 'Referências/Destino.pdf');
      const plan = previewDetailTransfer(target, source, {
        mode: 'insert',
        sourceDetailId,
        targetElementId: target.hierarchy.elements[0].id,
      });
      expect(plan.issues).toEqual([]);
      const inserted = applyDetailTransfer(target, plan);
      expect(inserted.schema).toBe('armadurastruct/37');
      expect(inserted.linkedFiles).toEqual(target.linkedFiles);
      expect(inserted.bars[0].dimensionConvention).toBe('external');
      expect(inserted.details[0].dimensionConvention).toBe('axis');
      expect(inserted.bars[0].distribution).toEqual(
        project.bars[0].distribution,
      );
      expect(
        decodeProject(JSON.stringify(inserted)).bars[0].distribution?.render,
      ).toBe('band');
    },
  );

  it('versiona o pacote quando a faixa viaja como dependência', () => {
    const base = withDistributionBandVersion(
      withCotation(projectWithRange('band')),
    );
    const sourceDetailId = base.hierarchy.details[0].id;
    const external = createHierarchyNode(
      base,
      'detail',
      'Dependência da faixa',
      base.hierarchy.elements[0].id,
    );
    const bar = base.bars[0];
    const project = completeOwnership({
      ...external.project,
      hierarchy: {
        ...external.project.hierarchy,
        objectDetails: {
          ...external.project.hierarchy.objectDetails,
          [bar.id]: external.id,
          rebatimento: sourceDetailId,
        },
      },
    });
    const pack = createDetailPackage(project, sourceDetailId, { producer });
    expect(pack.schema).toBe('openstruct.detail/24');
    expect(pack.objects.bars).toEqual([]);
    expect(pack.dependencies[0].distribution?.render).toBe('band');
    expect(pack.dependencies[0].dimensionConvention).toBe('external');
    expect(() =>
      readDetailPackage({ ...pack, schema: 'openstruct.detail/23' }),
    ).toThrow(/openstruct\.detail\/24/);
    const { project: source } = readDetailPackage(pack);
    const target = emptyProject();
    const plan = previewDetailTransfer(target, source, {
      mode: 'insert',
      sourceDetailId,
      targetElementId: target.hierarchy.elements[0].id,
      references: { 'incoming:rebatimento': `import:${bar.id}` },
    });
    expect(plan.issues).toEqual([]);
    expect(plan.project?.schema).toBe('armadurastruct/37');
    expect(plan.project?.bars[0].distribution).toEqual(bar.distribution);
    expect(plan.project?.bars[0].dimensionConvention).toBe('external');
    expect(plan.project?.details[0].dimensionConvention).toBe('axis');
  });
});
