import { z } from 'zod';
import {
  weldedMeshCriteriaIssues,
  weldedMeshCriteriaSchema,
  type WeldedMeshCriteria,
} from './weldedMesh';
import {
  planWeldedMeshLayout,
  type LayoutResult,
  type WeldedMeshLayout,
} from './weldedMeshLayout';
import { buildRegion, outlineFromPoints } from './weldedMeshRegion';
import { layerBindingShape } from './layerSchema';
// Só o tipo: transforms.ts importa model.ts, que importa este módulo.
import type { SelectionTransform } from './transforms';
import { uid, type Point, type Project } from './types';

/**
 * Tela soldada lançada no projeto (formato 29).
 *
 * Guarda a cópia dos critérios efetivamente usados e a região estática, em mm
 * do modelo. Os quantitativos não são guardados: `weldedMeshPlan` os recalcula
 * de forma determinística a partir desses dados. Mudar o catálogo, os critérios
 * padrão ou a máscara de referência não altera um lançamento existente.
 */
const n = z.number().finite();
const point = z
  .object({ x: n.min(-1e9).max(1e9), y: n.min(-1e9).max(1e9) })
  .strict();
export const weldedMeshLaunchSchema = z
  .object({
    /** Camada, estilo e plotagem: o mesmo vínculo de todo objeto desenhável. */
    ...layerBindingShape,
    id: z.string().min(1).max(200),
    /**
     * Cópia dos critérios efetivos, sem a camada: a camada do lançamento é só o
     * vínculo acima (`layerId`), mantido pelo sistema de camadas. A camada dos
     * critérios configura os próximos lançamentos e, ao lançar ou editar, vira
     * esse vínculo; guardá-la também aqui criaria uma segunda fonte, que ficaria
     * desatualizada ao reassociar ou apagar a camada.
     */
    criteria: weldedMeshCriteriaSchema.omit({ layerId: true }),
    region: z
      .object({
        outer: z.array(point).min(3).max(50000),
        openings: z.array(z.array(point).min(3).max(50000)).max(1000),
      })
      .strict(),
    /** Ponto de partida explícito da paginação, se escolhido. */
    anchor: point.optional(),
    /** Como a região foi capturada; proveniência, sem vínculo vivo com a máscara. */
    source: z
      .object({
        mode: z.enum(['contour', 'click', 'points']),
        maskId: z.string().max(200).optional(),
        entityIds: z.array(z.string().max(200)).max(1000).optional(),
      })
      .strict(),
    exactness: z.enum(['exact', 'approximation']),
    /** Lacunas fechadas por ajuste e confirmadas no lançamento. */
    adjustments: z.array(z.string().max(500)).max(100),
  })
  .strict();
export type WeldedMeshLaunch = z.infer<typeof weldedMeshLaunchSchema>;
/** Entrada do lançamento: os critérios podem trazer a camada escolhida. */
export type WeldedMeshLaunchInput = Omit<
  WeldedMeshLaunch,
  'id' | 'criteria'
> & {
  criteria: WeldedMeshCriteria;
};
/** Região redefinida traz junto a sua proveniência, exatidão e ajustes. */
export type WeldedMeshPatch = Partial<
  Pick<
    WeldedMeshLaunch,
    'region' | 'anchor' | 'source' | 'exactness' | 'adjustments'
  >
> & { criteria?: WeldedMeshCriteria };

/** Plano (painéis, áreas, massas) recalculado a partir do lançamento. */
export function weldedMeshPlan(l: WeldedMeshLaunch): LayoutResult {
  return planWeldedMeshLayout(
    l.region,
    l.criteria,
    l.anchor ? { anchor: l.anchor } : {},
  );
}

/** Problemas do lançamento (estrutura, critérios, região e plano); vazia quando válido. */
export function weldedMeshLaunchIssues(l: WeldedMeshLaunch): string[] {
  if (!weldedMeshLaunchSchema.safeParse(l).success)
    return ['Dados do lançamento inválidos.'];
  const criteria = weldedMeshCriteriaIssues(l.criteria);
  if (criteria.length) return criteria;
  const outer = outlineFromPoints(l.region.outer);
  if (!outer.ok) return [`Contorno: ${outer.reason}`];
  const openings = [];
  for (const o of l.region.openings) {
    const r = outlineFromPoints(o);
    if (!r.ok) return [`Abertura: ${r.reason}`];
    openings.push(r.outline);
  }
  const region = buildRegion(outer.outline, openings);
  if (!region.ok) return [region.reason];
  const plan = weldedMeshPlan(l);
  return plan.ok ? [] : [plan.reason];
}

const usedIds = (p: Project) =>
  new Set(
    [
      ...p.bars,
      ...p.details,
      ...p.masks,
      ...p.annotations,
      ...p.polylines,
      ...(p.symbolInstances ?? []),
      ...(p.weldedMeshes ?? []),
    ].map((o) => o.id),
  );
const find = (p: Project, id: string) => {
  const l = p.weldedMeshes?.find((m) => m.id === id);
  if (!l) throw new Error('Tela soldada inexistente.');
  return l;
};
const assertValid = (p: Project, l: WeldedMeshLaunch) => {
  if (l.layerId && !p.layers.some((x) => x.id === l.layerId))
    throw new Error('Layer inexistente.');
  const issues = weldedMeshLaunchIssues(l);
  if (issues.length) throw new Error(issues.join(' '));
};

/**
 * Confirma um lançamento numa única operação: nova entidade, dono no
 * detalhamento e critérios padrão para os próximos lançamentos. Não altera o
 * projeto recebido; qualquer problema impede o lançamento inteiro.
 */
export function launchWeldedMesh(
  p: Project,
  input: WeldedMeshLaunchInput,
  detailId: string,
  id: string = uid(),
): Project {
  if (!p.hierarchy.details.some((d) => d.id === detailId))
    throw new Error('Detalhamento de destino inexistente.');
  const { layerId, ...criteria } = structuredClone(input.criteria);
  const launch: WeldedMeshLaunch = { id, ...structuredClone(input), criteria };
  // A camada escolhida nos critérios vira o vínculo do próprio lançamento,
  // visível ao sistema de camadas (uso, reassociação, exclusão).
  if (!launch.layerId && layerId) launch.layerId = layerId;
  assertValid(p, launch);
  if (usedIds(p).has(id)) throw new Error('Identificador já usado no projeto.');
  return {
    ...p,
    weldedMeshes: [...(p.weldedMeshes ?? []), launch],
    weldedMeshDefaults: structuredClone(input.criteria),
    hierarchy: {
      ...p.hierarchy,
      objectDetails: { ...p.hierarchy.objectDetails, [id]: detailId },
    },
  };
}

const normalizeAngle = (deg: number) => {
  const a = deg % 360;
  return a > 180 ? a - 360 : a <= -180 ? a + 360 : a;
};
function movePoint(p: Point, t: SelectionTransform): Point {
  if (t.kind === 'translate') return { x: p.x + t.delta.x, y: p.y + t.delta.y };
  if (t.kind === 'rotate') {
    const a = (t.angle * Math.PI) / 180,
      dx = p.x - t.base.x,
      dy = p.y - t.base.y;
    return {
      x: t.base.x + dx * Math.cos(a) - dy * Math.sin(a),
      y: t.base.y + dx * Math.sin(a) + dy * Math.cos(a),
    };
  }
  throw new Error(
    'Espelhar tela soldada não é suportado: inverteria a posição dos fios longitudinais e transversais. Mova, gire ou lance outra tela.',
  );
}

/** Move ou gira o lançamento inteiro; girar soma o ângulo à orientação da tela. */
export function transformWeldedMesh(
  l: WeldedMeshLaunch,
  t: SelectionTransform,
): WeldedMeshLaunch {
  const move = (pts: Point[]) => pts.map((p) => movePoint(p, t));
  const next: WeldedMeshLaunch = {
    ...structuredClone(l),
    region: {
      outer: move(l.region.outer),
      openings: l.region.openings.map(move),
    },
  };
  if (l.anchor) next.anchor = movePoint(l.anchor, t);
  if (t.kind === 'rotate')
    next.criteria.orientation = normalizeAngle(
      l.criteria.orientation + t.angle,
    );
  return next;
}

/** Cópia física: novo ID, mesma propriedade do detalhamento, nova contribuição no quadro. */
export function copyWeldedMesh(
  p: Project,
  id: string,
  t: SelectionTransform,
  newId: string = uid(),
): Project {
  const copy = { ...transformWeldedMesh(find(p, id), t), id: newId };
  assertValid(p, copy);
  if (usedIds(p).has(newId))
    throw new Error('Identificador já usado no projeto.');
  return {
    ...p,
    weldedMeshes: [...(p.weldedMeshes ?? []), copy],
    hierarchy: {
      ...p.hierarchy,
      objectDetails: {
        ...p.hierarchy.objectDetails,
        [newId]: p.hierarchy.objectDetails[id],
      },
    },
  };
}

/** Remove o lançamento e o vínculo dele com o detalhamento. */
export function deleteWeldedMesh(p: Project, id: string): Project {
  find(p, id);
  const owners = { ...p.hierarchy.objectDetails };
  delete owners[id];
  const origins = { ...p.hierarchy.objectOrigins };
  delete origins[id];
  return {
    ...p,
    weldedMeshes: (p.weldedMeshes ?? []).filter((l) => l.id !== id),
    hierarchy: {
      ...p.hierarchy,
      objectDetails: owners,
      objectOrigins: origins,
    },
  };
}

/**
 * Edição explícita de um lançamento: devolve o projeto atualizado e os planos
 * antes/depois, para a prévia do impacto. Não muda os critérios padrão. Uma
 * camada informada nos critérios passa a ser o vínculo do lançamento.
 */
export function previewWeldedMeshUpdate(
  p: Project,
  id: string,
  patch: WeldedMeshPatch,
): { project: Project; before: WeldedMeshLayout; after: WeldedMeshLayout } {
  const current = find(p, id);
  const before = weldedMeshPlan(current);
  if (!before.ok) throw new Error(before.reason);
  const { criteria, ...rest } = structuredClone(patch);
  const next: WeldedMeshLaunch = { ...structuredClone(current), ...rest, id };
  if (criteria) {
    const { layerId, ...own } = criteria;
    next.criteria = own;
    if (layerId) next.layerId = layerId;
  }
  assertValid(p, next);
  const after = weldedMeshPlan(next);
  if (!after.ok) throw new Error(after.reason);
  return {
    project: {
      ...p,
      weldedMeshes: (p.weldedMeshes ?? []).map((l) => (l.id === id ? next : l)),
    },
    before: before.layout,
    after: after.layout,
  };
}
