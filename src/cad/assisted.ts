import { maskPoint } from './import';
import { completeOwnership } from '../domain/hierarchy';
import { objectOrigin } from '../domain/detailTransfer';
import {
  applyRebarBatch,
  executeRebarBatch,
  rebarDefinition,
} from '../domain/rebarApi';
import { decodeProject, newBar } from '../domain/model';
import { distance, geometry, sub } from '../domain/geometry';
import { uid, type Bar, type Project } from '../domain/types';

export type CadAssignment = {
  maskId: string;
  contour: number;
  text?: number;
  scale: number;
  mark: string;
  diameter: number;
  mandrel: number;
  quantity: number;
  steel: Bar['steel'] | '';
  confirmed: boolean;
};
export type CadInterpretation = {
  base: Project;
  project?: Project;
  bar?: Bar;
  issues: string[];
  raInvalidated: boolean;
};
/** A CAD primitive is a reference until the user assigns every physical property explicitly. */
export function previewCadInterpretation(
  project: Project,
  detailId: string,
  input: CadAssignment,
): CadInterpretation {
  const plan: CadInterpretation = {
    base: project,
    issues: [],
    raInvalidated: false,
  };
  try {
    const mask = project.masks.find((m) => m.id === input.maskId);
    if (!mask || project.hierarchy.objectDetails[mask.id] !== detailId)
      throw new Error(
        'Escolha uma máscara pertencente ao detalhamento em edição.',
      );
    const contour = mask.primitives[input.contour];
    if (!contour || contour.text !== undefined || contour.points.length < 2)
      throw new Error('Selecione um contorno com pelo menos dois vértices.');
    if (
      !Number.isFinite(input.scale) ||
      input.scale <= 0 ||
      input.scale > 1000000
    )
      throw new Error(
        'Informe quantos milímetros correspondem a uma unidade CAD.',
      );
    if (
      !input.mark.trim() ||
      input.mark.trim().length > 40 ||
      project.bars.some((b) => b.mark === input.mark.trim())
    )
      throw new Error('Informe uma posição única de até 40 caracteres.');
    if (
      !Number.isFinite(input.diameter) ||
      input.diameter <= 0 ||
      input.diameter > 100
    )
      throw new Error('Atribua uma bitola em mm, maior que zero e até 100.');
    if (
      !Number.isFinite(input.mandrel) ||
      input.mandrel <= 0 ||
      input.mandrel > 2000
    )
      throw new Error('Atribua o diâmetro interno de dobra em mm, até 2000.');
    if (
      !Number.isInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > 100000
    )
      throw new Error('Atribua uma quantidade inteira entre 1 e 100000.');
    if (input.steel !== 'CA-50' && input.steel !== 'CA-60')
      throw new Error(
        'Atribua a categoria de aço. O texto CAD não define propriedades físicas.',
      );
    const referenceOrigin = objectOrigin(project, mask.id);
    const origin = {
      projectId: referenceOrigin.projectId,
      objectId: `${referenceOrigin.objectId}:contour:${input.contour}`,
    };
    if (
      Object.values(project.hierarchy.objectOrigins).some(
        (o) =>
          o.projectId === origin.projectId && o.objectId === origin.objectId,
      )
    )
      throw new Error(
        'Este contorno já originou uma posição física. Edite a posição existente para evitar aço duplicado.',
      );
    const transformed = { ...mask, scale: input.scale };
    const points = contour.points.map((p) => maskPoint(p, transformed));
    if (contour.closed && distance(points[0], points.at(-1)!) > 0.001)
      points.push(points[0]);
    if (points.length > 500)
      throw new Error(
        'O contorno excede 500 vértices. Simplifique a referência antes de atribuir aço.',
      );
    const element = project.hierarchy.elements.find(
      (e) =>
        e.id ===
        project.hierarchy.details.find((d) => d.id === detailId)?.elementId,
    );
    const bar: Bar = {
      ...newBar(input.mark.trim()),
      layerId: contour.layerId,
      style: contour.style,
      element: element?.name ?? '',
      origin: points[0],
      points: points.map((p) => sub(p, points[0])),
      quantity: input.quantity,
      diameter: input.diameter,
      mandrel: input.mandrel,
      steel: input.steel,
    };
    const errors = geometry(bar).errors;
    if (errors.length)
      throw new Error(
        `Contorno incompatível com as dobras atribuídas: ${errors.join(' ')}`,
      );
    const annotations = [...project.annotations];
    if (input.text !== undefined) {
      const text = mask.primitives[input.text];
      if (!text?.text || !text.points.length)
        throw new Error(
          'Selecione um texto CAD válido ou escolha Sem chamada.',
        );
      if (text.text.length > 200)
        throw new Error(
          'O texto excede 200 caracteres. Reduza-o antes de criar uma chamada.',
        );
      const label = maskPoint(text.points[0], transformed);
      annotations.push({
        id: uid(),
        kind: 'leader',
        layerId: text.layerId,
        style: text.style,
        barId: bar.id,
        label: text.text,
        points: [points[0], { x: label.x - 100, y: label.y }, label],
        textHeight: (text.textHeight ?? 2.5) * input.scale,
        color: '#8c9bb3',
      });
    }
    if (!input.confirmed)
      throw new Error(
        'Confirme a unidade, o contorno e as propriedades físicas antes de criar aço.',
      );
    const created = applyRebarBatch(
      project,
      executeRebarBatch(
        project,
        [
          {
            type: 'bar.create',
            id: bar.id,
            detailId,
            definition: rebarDefinition(bar),
            provenance: origin,
          },
        ],
        { units: 'mm', schedule: 'invalidate-lock' },
      ),
    );
    const next = completeOwnership(
      {
        ...created,
        annotations,
        // All normalized CAD entities stay as references, including the selected contour/text.
        masks: project.masks.map((m) =>
          m.id === mask.id ? { ...m, scale: input.scale } : m,
        ),
      },
      detailId,
    );
    decodeProject(JSON.stringify(next));
    // Validation must not reserialize unrelated objects while editing a detail in isolation.
    plan.project = next;
    plan.bar = bar;
    plan.raInvalidated = !!project.scheduleLock;
  } catch (e) {
    plan.issues.push(
      e instanceof Error
        ? e.message
        : 'Não foi possível interpretar o contorno.',
    );
  }
  return plan;
}
export function applyCadInterpretation(
  current: Project,
  plan: CadInterpretation,
) {
  if (current !== plan.base)
    throw new Error('O projeto mudou. Confira novamente a interpretação CAD.');
  if (!plan.project || plan.issues.length)
    throw new Error(plan.issues.join(' ') || 'Atribuição CAD incompleta.');
  return plan.project;
}
