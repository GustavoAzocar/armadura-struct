import { cadBinding, cadDefaults } from './cadDefaults';
import type { Mask, Project, Point } from './types';
import { completeOwnership, detailPath } from './hierarchy';
import { layerId } from './layers';
import { layerState, objectState } from './layerProfiles';
import { objectHidden } from './visibility';
import {
  newNativeMask,
  nativePrimitive,
  shapeFromWorld,
  validateNativeMask,
  type NativeDrawKind,
} from './nativeMasks';

export type MaskDrawingContext = {
  key: string;
  detailId: string;
  scopeDetailId?: string;
};
export const localDrawingLayer = (m: Mask) =>
  m.format === 'NATIVE' ? 'DESENHO' : 'AS_DESENHO_LOCAL';
export const drawingLayerId = (p: Project, m: Mask) =>
  p.cadDefaults?.masks.entity.layerId ??
  p.layers.find((l) => l.id === layerId('DESENHO'))?.id ??
  m.layerId ??
  p.layers[0].id;
export const maskPath = (p: Project, id: string) =>
  detailPath(p, p.hierarchy.objectDetails[id]);
export function maskDrawingState(
  p: Project,
  id: string | undefined,
  context: MaskDrawingContext,
) {
  const mask = p.masks.find((m) => m.id === id);
  let reason = '';
  if (!mask) reason = 'Escolha uma máscara para desenhar.';
  else if (context.key.startsWith('sheet:'))
    reason = 'Ative a máscara para abrir seu desenho; não se desenha no papel.';
  else if (
    p.hierarchy.objectDetails[mask.id] !== context.detailId ||
    (context.scopeDetailId &&
      context.scopeDetailId !== p.hierarchy.objectDetails[mask.id])
  )
    reason = 'Outro detalhamento: ative a máscara para abrir seu contexto.';
  else if (
    !mask.visible ||
    mask.opacity === 0 ||
    objectHidden(p, context.key, mask.id)
  )
    reason = 'Máscara oculta nesta vista. Recupere sua exibição para desenhar.';
  else if (!objectState(p, context.key, mask).visible)
    reason = 'Layer da máscara desligado.';
  else if (!objectState(p, context.key, mask).capture)
    reason = 'Layer da máscara sem captura.';
  else if (!objectState(p, context.key, mask).editable)
    reason = 'Layer da máscara bloqueado para edição.';
  else if (!layerState(p, context.key, drawingLayerId(p, mask)).editable)
    reason = 'Layer do desenho local bloqueado ou desligado.';
  else if (mask.layers[localDrawingLayer(mask)] === false)
    reason = 'Camada do desenho local desligada na máscara.';
  else if (
    !Number.isFinite(mask.scale) ||
    mask.scale <= 0 ||
    ![mask.rotation, mask.origin.x, mask.origin.y].every(Number.isFinite)
  )
    reason = 'Transformação da máscara inválida.';
  return {
    mask,
    editable: !reason,
    reason,
    path: mask ? maskPath(p, mask.id) : '',
    label: mask
      ? `${mask.visible && mask.opacity > 0 && !objectHidden(p, context.key, mask.id) ? 'Visível' : 'Oculta'} · ${reason || 'editável'}`
      : reason,
  };
}
export function createDrawingMask(
  p: Project,
  name: string,
  detailId: string,
  context: MaskDrawingContext,
) {
  if (
    !p.hierarchy.details.some((d) => d.id === detailId) ||
    detailId !== context.detailId ||
    context.key.startsWith('sheet:') ||
    (context.scopeDetailId && context.scopeDetailId !== detailId)
  )
    throw new Error('Abra o contexto de criação antes de confirmar a máscara.');
  if (p.masks.length >= 20)
    throw new Error('Limite de 20 máscaras por projeto.');
  const mask = newNativeMask(name, p);
  if (
    p.masks.some(
      (m) =>
        p.hierarchy.objectDetails[m.id] === detailId &&
        m.name.trim().toLocaleLowerCase() === mask.name.toLocaleLowerCase(),
    )
  )
    throw new Error(
      'Já existe uma máscara com esse nome neste detalhamento. Use outro nome; nada foi sobrescrito.',
    );
  const project = completeOwnership(
    { ...p, masks: [...p.masks, mask] },
    detailId,
  );
  const state = maskDrawingState(project, mask.id, context);
  if (!state.editable) throw new Error(state.reason);
  return { project, mask: project.masks.find((m) => m.id === mask.id)! };
}
export function appendMaskShape(
  p: Project,
  maskId: string,
  kind: NativeDrawKind,
  points: Point[],
  context: MaskDrawingContext,
  expected: Mask,
  closed = false,
) {
  const state = maskDrawingState(p, maskId, context),
    m = state.mask;
  if (!m || !state.editable) throw new Error(state.reason);
  if (m !== expected)
    throw new Error(
      'A máscara mudou. Reinicie o desenho para conferir o destino.',
    );
  if (m.primitives.length >= 100000)
    throw new Error('Limite de entidades da máscara atingido.');
  const primitive = {
    ...nativePrimitive(
      shapeFromWorld(kind, points, m, closed),
      undefined,
      localDrawingLayer(m),
    ),
    layerId: drawingLayerId(p, m),
    ...(p.cadDefaults ? cadBinding(p, cadDefaults(p).masks.entity) : {}),
  };
  const next = {
    ...m,
    layers: { ...m.layers, [primitive.layer]: true },
    primitives: [...m.primitives, primitive],
  };
  validateNativeMask(next);
  return { ...p, masks: p.masks.map((o) => (o.id === maskId ? next : o)) };
}
export function assertLocalMaskEdit(
  p: Project,
  before: Mask,
  after: Mask,
  context: MaskDrawingContext,
) {
  if (p.masks.find((m) => m.id === before.id) !== before)
    throw new Error(
      'A máscara mudou durante a edição. Reabra suas propriedades.',
    );
  if (
    p.hierarchy.objectDetails[before.id] !== context.detailId ||
    (context.scopeDetailId && context.scopeDetailId !== context.detailId) ||
    context.key.startsWith('sheet:')
  )
    throw new Error('Abra o desenho desta máscara antes de editá-la.');
  if (
    after.id !== before.id ||
    after.format !== before.format ||
    after.sourceUnit !== before.sourceUnit
  )
    throw new Error(
      'A identidade e a origem da referência devem ser preservadas.',
    );
  for (const [i, q] of before.primitives.entries()) {
    const next = q.id
      ? after.primitives.find((n) => n.id === q.id)
      : after.primitives[i];
    if (JSON.stringify(q) === JSON.stringify(next)) continue;
    if (!q.native)
      throw new Error(
        'Geometria importada é referência. Edite somente o desenho local nativo.',
      );
    if (next && !next.native)
      throw new Error('Preserve a geometria analítica do desenho local.');
    if (q.layerId && !layerState(p, context.key, q.layerId).editable)
      throw new Error('Layer da entidade protegido.');
  }
  if (after.primitives.length > 100000)
    throw new Error('Limite de entidades da máscara atingido.');
  for (const q of after.primitives)
    if (
      q.native &&
      q.layerId &&
      !layerState(p, context.key, q.layerId).editable &&
      JSON.stringify(q) !==
        JSON.stringify(before.primitives.find((o) => o.id === q.id))
    )
      throw new Error('Layer de destino da entidade protegido.');
  validateNativeMask(after);
}
