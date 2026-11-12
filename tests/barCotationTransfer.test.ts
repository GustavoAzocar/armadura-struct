import { describe, expect, it } from 'vitest';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import {
  applyDetailTransfer,
  previewDetailTransfer,
} from '../src/domain/detailTransfer';
import { cloneArmatureGraph } from '../src/domain/editing';
import { completeOwnership } from '../src/domain/hierarchy';
import { emptyProject, newBar, schedule } from '../src/domain/model';

const delta = { x: 3000, y: 0 };
function source() {
  return completeOwnership({
    ...emptyProject(),
    bars: [
      {
        ...newBar('N1'),
        id: 'bar',
        quantity: 3,
        dimensionConvention: 'external',
      },
    ],
    details: [
      {
        id: 'axis',
        barId: 'bar',
        origin: { x: 0, y: 300 },
        dimensionConvention: 'axis',
      },
      {
        id: 'external',
        barId: 'bar',
        origin: { x: 0, y: 600 },
        dimensionConvention: 'external',
      },
    ],
  });
}

describe('cotagem de armaduras na cópia e transferência', () => {
  it('remapeia a cópia física e conserva as convenções de cada inserção', () => {
    const p = source();
    const result = cloneArmatureGraph(p, { barIds: ['bar'], delta });
    const clonedBar = result.project.bars.find(
      (b) => b.id === result.idMap.bar,
    );
    expect(clonedBar?.dimensionConvention).toBe('external');
    expect(
      result.project.details
        .filter((d) => d.barId === clonedBar?.id)
        .map((d) => d.dimensionConvention),
    ).toEqual(['axis', 'external']);
    expect(
      schedule(result.project).reduce((sum, row) => sum + row.quantity, 0),
    ).toBe(6);
  });

  it('copia somente a inserção, preservando o vínculo físico e a convenção', () => {
    const p = source();
    const result = cloneArmatureGraph(p, {
      barIds: [],
      objectIds: ['axis'],
      delta,
    });
    expect(
      result.project.details.find((d) => d.id === result.idMap.axis),
    ).toMatchObject({
      barId: 'bar',
      dimensionConvention: 'axis',
    });
    expect(result.project.bars).toEqual(p.bars);
    expect(schedule(result.project)).toEqual(schedule(p));
  });

  it('transfere o pacote para outro projeto com os vínculos e as escolhas', () => {
    const p = source();
    const sourceDetailId = p.hierarchy.details[0].id;
    const parsed = readDetailPackage(
      JSON.stringify(
        createDetailPackage(p, sourceDetailId, {
          producer: { app: 'ArmaduraStruct', version: '0.6.0' },
        }),
      ),
    );
    const target = emptyProject();
    const plan = previewDetailTransfer(target, parsed.project, {
      mode: 'insert',
      sourceDetailId: parsed.project.hierarchy.details[0].id,
      targetElementId: target.hierarchy.elements[0].id,
    });
    expect(plan.issues).toEqual([]);
    const transferred = applyDetailTransfer(target, plan);
    const [bar] = transferred.bars;
    expect(bar.id).not.toBe('bar');
    expect(bar.dimensionConvention).toBe('external');
    expect(
      transferred.details.map((d) => [d.barId, d.dimensionConvention]),
    ).toEqual([
      [bar.id, 'axis'],
      [bar.id, 'external'],
    ]);
    expect(schedule(transferred)[0].quantity).toBe(3);
  });
});
