import { weldedMeshLabel } from './weldedMesh';
import { layoutWires } from './weldedMeshLayout';
import { weldedMeshPlan, type WeldedMeshLaunch } from './weldedMeshLaunch';
import type { Point, Primitive } from './types';

/**
 * Desenho de um lançamento de tela no modelo (mm), sem estilo resolvido:
 * - peças: contorno real do material (recortes e furos), não o painel inteiro;
 * - fios: malha nominal centrada no painel (não representa fios de borda
 *   comerciais); acima do limite, a malha é omitida e só as peças ficam;
 * - identificação: posição, tela e número de painéis-base.
 * Camada: ARMADURAS (geometria) e IDENTIFICACAO (texto), pelo papel; o vínculo
 * do lançamento (`layerId`), se houver, vale para o desenho inteiro.
 */
export function weldedMeshPrimitives(
  l: WeldedMeshLaunch,
  textHeight = 40,
): Primitive[] {
  const plan = weldedMeshPlan(l);
  if (!plan.ok) return [];
  const { layout } = plan,
    display = l.criteria.display;
  const out: Primitive[] = [];
  const shape = (points: Point[], closed: boolean): Primitive => ({
    layer: 'ARMADURAS',
    points,
    closed,
  });
  if (display.panels)
    for (const panel of layout.panels)
      for (const piece of panel.pieces) {
        out.push(shape(piece.outline, true));
        for (const hole of piece.holes) out.push(shape(hole, true));
      }
  if (display.wires)
    for (const w of layoutWires(layout).wires)
      out.push(shape([w.a, w.b], false));
  if (display.identification) {
    const largest = layout.panels
      .flatMap((p) => p.pieces)
      .reduce((a, b) => (b.area > a.area ? b : a));
    const xs = largest.outline.map((q) => q.x),
      ys = largest.outline.map((q) => q.y);
    const at = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
    // Texto legível: ao longo da tela, sem ficar de cabeça para baixo.
    let angle = ((l.criteria.orientation % 180) + 180) % 180;
    if (angle > 90) angle -= 180;
    const n = layout.basePanels;
    out.push({
      layer: 'IDENTIFICACAO',
      points: [at],
      text: `${l.criteria.mark} · ${weldedMeshLabel(layout.mesh)} · ${n} ${n === 1 ? 'painel' : 'painéis'}`,
      textHeight,
      textAlign: 'center',
      textRotation: angle,
    });
  }
  return out;
}
