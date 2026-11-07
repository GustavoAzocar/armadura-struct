import { expect, it } from 'vitest';
import {
  emptyProject,
  newBar,
  schedule,
  decodeProject,
} from '../src/domain/model';
import { completeOwnership } from '../src/domain/hierarchy';
import {
  setLayerState,
  layerState,
  layerProjection,
  saveLayerProfile,
  applyLayerProfile,
  profileLabel,
  assertLayerEdit,
  ensureProfiles,
} from '../src/domain/layerProfiles';
import { executeRebarBatch } from '../src/api';
const fixture = () =>
  completeOwnership({
    ...emptyProject(),
    bars: [{ ...newBar('N1'), id: 'a', quantity: 4 }],
  });
it('visible locked objects remain drawn and captured but every physical batch is atomic', () => {
  const p = setLayerState(fixture(), 'model', 'layer:ARMADURAS', {
    editable: false,
  });
  expect(layerProjection(p, 'model', 'visible').bars).toHaveLength(1);
  expect(layerProjection(p, 'model', 'capture').bars).toHaveLength(1);
  const r = executeRebarBatch(
    p,
    [{ type: 'bar.update', id: 'a', patch: { kind: 'free', quantity: 9 } }],
    { units: 'mm' },
  );
  expect(r.ok).toBe(false);
  expect(r.project).toBe(p);
  expect(() => assertLayerEdit(p, { ...p, bars: [] }, 'model')).toThrow(
    /protegido/,
  );
});
it('visibility and capture follow coherent prerequisites without altering quantities', () => {
  const p = fixture();
  let q = setLayerState(p, 'model', 'layer:ARMADURAS', { capture: false });
  expect(layerState(q, 'model', 'layer:ARMADURAS')).toEqual({
    visible: true,
    capture: false,
    editable: false,
  });
  expect(layerProjection(q, 'model', 'capture').bars).toHaveLength(0);
  q = setLayerState(q, 'model', 'layer:ARMADURAS', { visible: false });
  expect(layerProjection(q, 'model', 'visible').bars).toHaveLength(0);
  expect(schedule(q)[0].weight).toBe(schedule(p)[0].weight);
  q = setLayerState(q, 'model', 'layer:ARMADURAS', { editable: true });
  expect(layerState(q, 'model', 'layer:ARMADURAS')).toEqual({
    visible: true,
    capture: true,
    editable: true,
  });
});
it('profiles restore exact states, indicate customized changes and persist independent contexts', () => {
  let p = setLayerState(fixture(), 'drawing:one', 'layer:ARMADURAS', {
    editable: false,
  });
  p = saveLayerProfile(p, 'drawing:one', 'Revisão');
  const id = p.layerEnvironment!.profiles.at(-1)!.id;
  p = setLayerState(p, 'drawing:one', 'layer:ARMADURAS', { capture: false });
  expect(profileLabel(p, 'drawing:one')).toBe('Personalizado');
  p = applyLayerProfile(p, 'drawing:one', id);
  expect(profileLabel(p, 'drawing:one')).toBe('Revisão');
  expect(layerState(p, 'drawing:two', 'layer:ARMADURAS').editable).toBe(true);
  expect(layerState(p, 'view:one', 'layer:ARMADURAS').editable).toBe(true);
  expect(decodeProject(JSON.stringify(p))).toEqual(p);
});
it('default presets and legacy migration preserve the steel model', () => {
  const p = ensureProfiles(fixture());
  expect(p.layerEnvironment!.profiles.map((x) => x.name)).toEqual([
    'Conferência',
    'Armaduras',
    'Fôrma',
  ]);
  const hidden = applyLayerProfile(p, 'model', 'profile:2');
  expect(layerProjection(hidden, 'model', 'visible').bars).toHaveLength(0);
  expect(schedule(hidden)[0].quantity).toBe(4);
  const legacy = {
    ...p,
    schema: 'armadurastruct/14',
    layerEnvironment: undefined,
  };
  expect(decodeProject(JSON.stringify(legacy)).bars).toEqual(p.bars);
});
it('the API protects the supplied drawing context independently of model context', () => {
  const p = fixture(),
    key = `drawing:${p.hierarchy.drawings[0].id}`,
    q = setLayerState(p, key, 'layer:ARMADURAS', { editable: false });
  const command = {
    type: 'bar.update' as const,
    id: 'a',
    patch: { kind: 'free' as const, quantity: 9 },
  };
  expect(
    executeRebarBatch(q, [command], { units: 'mm', layerContext: key }).ok,
  ).toBe(false);
  expect(executeRebarBatch(q, [command], { units: 'mm' }).ok).toBe(true);
});
it('reopening a locked project compares values, without treating serialization key order as an edit', () => {
  const p = setLayerState(fixture(), 'model', 'layer:ARMADURAS', {
    editable: false,
  });
  expect(() =>
    assertLayerEdit(p, decodeProject(JSON.stringify(p)), 'model'),
  ).not.toThrow();
});
