import { describe, expect, it } from 'vitest';
import { nativePrimitive, newNativeMask } from '../src/domain/nativeMasks';
import { emptyProject } from '../src/domain/model';
import { layerId } from '../src/domain/layers';
import {
  catalogWeldedMesh,
  defaultWeldedMeshCriteria,
  type WeldedMeshCriteria,
} from '../src/domain/weldedMesh';
import {
  outlineFromMaskEntity,
  outlineFromPoints,
  type RegionOutline,
} from '../src/domain/weldedMeshRegion';
import { previewWeldedMeshDraft } from '../src/domain/weldedMeshDraft';
import {
  launchWeldedMesh,
  weldedMeshPlan,
} from '../src/domain/weldedMeshLaunch';
import type { Point } from '../src/domain/types';

const P = (x: number, y: number): Point => ({ x, y });
const rect = (x: number, y: number, w: number, h: number): Point[] => [
  P(x, y),
  P(x + w, y),
  P(x + w, y + h),
  P(x, y + h),
];
const outline = (points: Point[]): RegionOutline => {
  const r = outlineFromPoints(points);
  if (!r.ok) throw new Error(r.reason);
  return r.outline;
};
const criteria = (patch: Partial<WeldedMeshCriteria> = {}) => ({
  ...defaultWeldedMeshCriteria(),
  ...patch,
});

describe('Rascunho do lançamento (prévia da interface)', () => {
  it('sem região, nada a mostrar', () => {
    const r = previewWeldedMeshDraft({
      criteria: criteria(),
      mode: 'points',
      openings: [],
    });
    expect(r).toEqual({ ok: false, reason: 'Defina a região da tela.' });
  });

  it('caso 2 da issue: a prévia tem os números e o desenho do lançamento confirmado', () => {
    const r = previewWeldedMeshDraft({
      criteria: criteria({ widthOverlap: 150, layerId: layerId('DESENHO') }),
      mode: 'points',
      openings: [],
      outer: outline(rect(0, 0, 6000, 4750)),
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.layout.basePanels).toBe(2);
    expect(r.layout.usefulArea).toBeCloseTo(28.5e6, 3);
    expect(r.layout.appliedArea).toBeCloseTo(29.4e6, 3);
    expect(r.needsConfirmation).toBe(false);
    expect(r.lines.some((l) => l.text === 'TS1 · Q92 · 2 painéis')).toBe(true);
    // A entrada leva a camada escolhida; o lançamento a transforma em vínculo.
    expect(r.input.criteria.layerId).toBe(layerId('DESENHO'));
    expect(r.input.source).toEqual({ mode: 'points' });
    const p = emptyProject();
    const next = launchWeldedMesh(p, r.input, p.hierarchy.details[0].id, 'TS');
    const launched = next.weldedMeshes![0];
    expect(launched.layerId).toBe(layerId('DESENHO'));
    const plan = weldedMeshPlan(launched);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.layout).toEqual(r.layout);
  });

  it('abertura reduz a área; abertura encostada no contorno é recusada com o motivo', () => {
    const outer = outline(rect(0, 0, 6000, 4750));
    const base = previewWeldedMeshDraft({
      criteria: criteria({ mesh: catalogWeldedMesh('Q138')! }),
      mode: 'points',
      openings: [],
      outer,
    });
    const holed = previewWeldedMeshDraft({
      criteria: criteria({ mesh: catalogWeldedMesh('Q138')! }),
      mode: 'points',
      openings: [outline(rect(1000, 1000, 1000, 1000))],
      outer,
    });
    if (!base.ok || !holed.ok) throw new Error('prévia');
    expect(base.layout.usefulArea - holed.layout.usefulArea).toBeCloseTo(
      1e6,
      3,
    );
    const touching = previewWeldedMeshDraft({
      criteria: criteria(),
      mode: 'points',
      openings: [outline(rect(0, 1000, 1000, 1000))],
      outer,
    });
    expect(touching.ok).toBe(false);
    expect(touching.ok ? '' : touching.reason).toMatch(
      /abertura 1 cruza, toca/,
    );
  });

  it('contorno da máscara com lacuna de 0,5 mm: prévia sai, mas exige confirmação', () => {
    const m = newNativeMask('Fôrma');
    const q = nativePrimitive(
      {
        kind: 'polyline',
        points: [P(0, 0), P(3000, 0), P(3000, 2000), P(0, 2000), P(0, 0.5)],
        closed: false,
      },
      'laje',
    );
    const o = outlineFromMaskEntity(m, q);
    if (!o.ok) throw new Error(o.reason);
    const r = previewWeldedMeshDraft({
      criteria: criteria(),
      mode: 'contour',
      openings: [],
      outer: o.outline,
      maskId: m.id,
      entityIds: ['laje'],
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.needsConfirmation).toBe(true);
    expect(r.adjustments.length).toBeGreaterThan(0);
    expect(r.input.adjustments).toEqual(r.adjustments);
    expect(r.input.source).toEqual({
      mode: 'contour',
      maskId: m.id,
      entityIds: ['laje'],
    });
  });

  it('ponto de partida e critérios inválidos: a âncora entra na entrada; sobreposição maior que o painel não gera prévia', () => {
    const outer = outline(rect(0, 0, 6000, 4750));
    const anchored = previewWeldedMeshDraft({
      criteria: criteria(),
      mode: 'points',
      openings: [],
      outer,
      anchor: P(-1000, 0),
    });
    if (!anchored.ok) throw new Error(anchored.reason);
    expect(anchored.input.anchor).toEqual(P(-1000, 0));
    const bad = previewWeldedMeshDraft({
      criteria: criteria({ lengthOverlap: 7000 }),
      mode: 'points',
      openings: [],
      outer,
    });
    expect(bad.ok).toBe(false);
  });
});
