import type { Point, Primitive } from './types';
import type { WeldedMeshCriteria } from './weldedMesh';
import { weldedMeshPrimitives } from './weldedMeshDrawing';
import {
  weldedMeshPlan,
  type WeldedMeshLaunch,
  type WeldedMeshLaunchInput,
} from './weldedMeshLaunch';
import type { WeldedMeshLayout } from './weldedMeshLayout';
import { buildRegion, type RegionOutline } from './weldedMeshRegion';

/**
 * Rascunho de um lançamento montado pela interface, ainda fora do projeto.
 *
 * A prévia usa as mesmas funções do lançamento confirmado (região, plano e
 * desenho): o que aparece antes de confirmar é o que fica no projeto.
 */
export type WeldedMeshDraft = {
  criteria: WeldedMeshCriteria;
  mode: 'contour' | 'click' | 'points';
  outer?: RegionOutline;
  openings: RegionOutline[];
  /** Proveniência: máscara e entidades usadas, sem vínculo vivo. */
  maskId?: string;
  entityIds?: string[];
  anchor?: Point;
};
export type WeldedMeshDraftPreview =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** Entrada pronta para `launchWeldedMesh`. */
      input: WeldedMeshLaunchInput;
      layout: WeldedMeshLayout;
      /** Lacunas fechadas por ajuste: confirmação explícita antes de lançar. */
      needsConfirmation: boolean;
      adjustments: string[];
      notes: string[];
      /** Desenho da tela como ficará (peças, fios e identificação). */
      lines: Primitive[];
    };

export function previewWeldedMeshDraft(
  d: WeldedMeshDraft,
  textHeight = 40,
): WeldedMeshDraftPreview {
  if (!d.outer) return { ok: false, reason: 'Defina a região da tela.' };
  const r = buildRegion(d.outer, d.openings);
  if (!r.ok) return r;
  const input: WeldedMeshLaunchInput = {
    criteria: structuredClone(d.criteria),
    region: r.region,
    ...(d.anchor ? { anchor: { ...d.anchor } } : {}),
    source: {
      mode: d.mode,
      ...(d.maskId ? { maskId: d.maskId } : {}),
      ...(d.entityIds?.length ? { entityIds: d.entityIds.slice(0, 1000) } : {}),
    },
    exactness: r.exactness,
    adjustments: r.adjustments,
  };
  // Mesma normalização do lançamento: a camada vira o vínculo do objeto.
  const { layerId, ...criteria } = input.criteria;
  const launch: WeldedMeshLaunch = {
    ...input,
    id: 'preview',
    criteria,
    ...(layerId ? { layerId } : {}),
  };
  const plan = weldedMeshPlan(launch);
  if (!plan.ok) return plan;
  return {
    ok: true,
    input,
    layout: plan.layout,
    needsConfirmation: r.needsConfirmation,
    adjustments: r.adjustments,
    notes: [...r.notes],
    lines: weldedMeshPrimitives(launch, textHeight),
  };
}
