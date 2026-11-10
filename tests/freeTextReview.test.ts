import { describe, expect, it } from 'vitest';
import { emptyProject } from '../src/domain/model';
import { completeOwnership } from '../src/domain/hierarchy';
import { newNativeMask } from '../src/domain/nativeMasks';
import {
  appendFreeText,
  editFreeText,
  freeTextDefaults,
  freeTextDraftOf,
  freeTextWorldPoint,
} from '../src/domain/freeText';
import { draftOf, fieldsOf, pointOf } from '../src/components/FreeTextPanel';
import { layerId } from '../src/domain/layers';
import { setLayerState } from '../src/domain/layerProfiles';
import type { Project } from '../src/domain/types';
import {
  bakeMaskPrimitives,
  validateSymbolPrimitives,
} from '../src/domain/symbols';

function fixture() {
  let p = emptyProject();
  const detailId = p.hierarchy.details[0].id;
  const context = { key: 'model', detailId };
  p = completeOwnership(
    {
      ...p,
      masks: [
        {
          ...newNativeMask('Texto'),
          scale: 3.7,
          rotation: 17.31,
          origin: { x: 81.123456789, y: -72.987654321 },
        },
      ],
    },
    detailId,
  );
  const m = p.masks[0];
  p = appendFreeText(
    p,
    m.id,
    { x: 123.123456789123, y: -456.987654321987 },
    {
      ...freeTextDefaults(p),
      text: 'Original',
      height: 48.123456789,
      rotation: 33.123456789,
    },
    context,
    m,
    'text',
  ).project;
  return { p, context, m: p.masks[0], text: p.masks[0].primitives[0] };
}

describe('regressões da revisão dos textos livres', () => {
  it('abrir e confirmar sem mudanças mantém toda a precisão e não cria alteração', () => {
    const { p, context, m, text } = fixture();
    const d = freeTextDraftOf(text, m),
      at = freeTextWorldPoint(text, m);
    const fields = fieldsOf(d, at);
    expect(pointOf(fields)).toEqual(at);
    expect(draftOf(fields)).toEqual(d);
    expect(
      editFreeText(
        p,
        m.id,
        text.id!,
        draftOf(fields),
        context,
        m,
        pointOf(fields),
      ),
    ).toEqual({ project: p, changed: false });
    expect(editFreeText(p, m.id, text.id!, d, context, m).project).toBe(p);
  });

  it('alterar somente o conteúdo preserva exatamente o ponto e a geometria local', () => {
    const { p, context, m, text } = fixture();
    const fields = fieldsOf(
      freeTextDraftOf(text, m),
      freeTextWorldPoint(text, m),
    );
    fields.text = 'Editado';
    const q = editFreeText(
      p,
      m.id,
      text.id!,
      draftOf(fields),
      context,
      m,
      pointOf(fields),
    ).project.masks[0].primitives[0];
    expect(q).toEqual({ ...text, text: 'Editado' });
  });

  it('recusa editar texto em camada local oculta ou layer efetivo protegido', () => {
    for (const hidden of [true, false]) {
      const { p, context, m, text } = fixture();
      const primitive = { ...text, layer: 'COTAS', layerId: undefined };
      const mask = {
        ...m,
        layers: { ...m.layers, COTAS: !hidden },
        primitives: [primitive],
      };
      let q: Project = { ...p, masks: [mask] };
      if (!hidden)
        q = setLayerState(q, context.key, layerId('COTAS'), {
          editable: false,
        });
      expect(() =>
        editFreeText(
          q,
          mask.id,
          text.id!,
          { ...freeTextDraftOf(primitive, mask), text: 'Alterado' },
          context,
          mask,
        ),
      ).toThrow();
      expect(q.masks[0].primitives[0].text).toBe('Original');
    }
  });

  it('símbolos validam conteúdo, altura e fonte dos textos nativos', () => {
    const { m, text } = fixture();
    const [q] = bakeMaskPrimitives(m, [text], { x: 0, y: 0 });
    expect(() => validateSymbolPrimitives([q])).not.toThrow();
    for (const patch of [
      { text: '' },
      { text: 'a ≥ b' },
      { textHeight: -1 },
      {
        textFont: {
          family: 'bad<font>',
          weight: 'normal' as const,
          style: 'normal' as const,
        },
      },
    ]) {
      expect(() => validateSymbolPrimitives([{ ...q, ...patch }])).toThrow();
    }
  });
});
