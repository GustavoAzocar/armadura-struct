import { describe, expect, it } from 'vitest';
import { beamClampPlacementStage } from '../src/components/BeamClampLaunchPanel';
import { defaultBeamClampCriteria } from '../src/domain/beamClampSchema';

describe('retomada do lançamento de grampo após ações opcionais', () => {
  const insertion = { x: 2000, y: 0 };
  const start = { x: 0, y: 0 };
  const end = { x: 1100, y: 0 };

  it('só libera confirmação quando as capturas necessárias estão completas', () => {
    const c = { ...defaultBeamClampCriteria(), distribute: true };
    expect(beamClampPlacementStage({ c })).toBe('insertion');
    expect(beamClampPlacementStage({ c, insertion })).toBe('range-start');
    expect(beamClampPlacementStage({ c, insertion, start })).toBe('range-end');
    expect(beamClampPlacementStage({ c, insertion, start, end })).toBe('ready');
  });

  it('retoma quantidade manual sem exigir nem reutilizar uma faixa desativada', () => {
    const c = defaultBeamClampCriteria();
    expect(beamClampPlacementStage({ c, insertion })).toBe('ready');
    expect(beamClampPlacementStage({ c, insertion, start })).toBe('ready');
  });
});
