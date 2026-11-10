import { useEffect, useRef } from 'react';
import type { Mask, Point, Project } from '../domain/types';
import type { MaskDrawingContext } from '../domain/maskDrawing';
import { detailPath } from '../domain/hierarchy';
import { format } from '../domain/geometry';
import { validateFreeTextDraft, type FreeTextDraft } from '../domain/freeText';
import { TEXT_FONT_FAMILIES, textFontNotice } from '../domain/textStyle';

/** Raw editor values; parsed and validated only on preview/confirmation. */
export type FreeTextFields = {
  text: string;
  height: string;
  size: 'model' | 'paper';
  paperScale: string;
  rotation: string;
  align: 'left' | 'center' | 'right';
  family: string;
  weight: 'normal' | 'bold';
  style: 'normal' | 'italic';
  x: string;
  y: string;
};
export type FreeTextSession = {
  /** Fixed for the whole insertion: a repeated confirmation never duplicates. */
  id: string;
  /** Present while editing an existing text; its ID is preserved. */
  editId?: string;
  project: Project;
  mask: Mask;
  context: MaskDrawingContext;
  /** Ribbon tab at the start; changing it invalidates the pending operation. */
  tab: string;
  stage: 'point' | 'content';
  repicking?: boolean;
  fields: FreeTextFields;
  cursor?: Point;
  issue?: string;
};
const known = new Set<string>(TEXT_FONT_FAMILIES.map((f) => f.id));
const num = (s: string) =>
  s.trim() === '' ? NaN : Number(s.replace(',', '.'));
export function fieldsOf(d: FreeTextDraft, at?: Point): FreeTextFields {
  return {
    text: d.text,
    height: String(d.height),
    size: d.size,
    paperScale: String(d.paperScale),
    rotation: String(d.rotation),
    align: d.align,
    family: d.font.family,
    weight: d.font.weight,
    style: d.font.style,
    x: at ? String(at.x) : '',
    y: at ? String(at.y) : '',
  };
}
export function draftOf(f: FreeTextFields): FreeTextDraft {
  return validateFreeTextDraft({
    text: f.text,
    height: num(f.height),
    size: f.size,
    paperScale: num(f.paperScale),
    rotation: num(f.rotation),
    align: f.align,
    font: { family: f.family.trim(), weight: f.weight, style: f.style },
  });
}
export function pointOf(f: FreeTextFields): Point {
  const p = { x: num(f.x), y: num(f.y) };
  if (![p.x, p.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9))
    throw new Error('Informe um ponto de inserção finito, em mm do modelo.');
  return p;
}
const fontAvailable = (family: string) => {
  try {
    return document.fonts.check(`12px "${family.replace(/"/g, '')}"`);
  } catch {
    return true;
  }
};
export default function FreeTextPanel({
  session: s,
  error,
  onFields,
  onConfirm,
  onRepick,
  onBack,
  onEnd,
}: {
  session: FreeTextSession;
  error?: string;
  onFields: (f: FreeTextFields) => void;
  onConfirm: () => void;
  onRepick: () => void;
  onBack: () => void;
  onEnd: () => void;
}) {
  const f = s.fields,
    set = (patch: Partial<FreeTextFields>) => onFields({ ...f, ...patch });
  const content = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (s.stage === 'content') content.current?.focus();
  }, [s.stage]);
  const h = num(f.height),
    n = num(f.paperScale),
    modelHeight = f.size === 'paper' ? h * n : h;
  const model =
    Number.isFinite(modelHeight) && modelHeight > 0
      ? format(modelHeight, 3)
      : '';
  const notice = textFontNotice(
    known.has(f.family)
      ? undefined
      : { family: f.family.trim(), weight: f.weight, style: f.style },
    fontAvailable,
  );
  const insert = (symbol: string) => {
    const el = content.current,
      a = el?.selectionStart ?? f.text.length,
      b = el?.selectionEnd ?? f.text.length;
    set({ text: f.text.slice(0, a) + symbol + f.text.slice(b) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(a + symbol.length, a + symbol.length);
    });
  };
  const editing = !!s.editId;
  return (
    <section
      className="mask-cad-panel free-text-panel"
      aria-label={editing ? 'Editar texto' : 'Inserir texto'}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onBack();
        }
        if (
          e.key === 'Enter' &&
          s.stage === 'content' &&
          (e.target as HTMLElement).tagName === 'INPUT'
        ) {
          e.preventDefault();
          e.stopPropagation();
          onConfirm();
        }
        if (
          (e.ctrlKey || e.metaKey) &&
          ['s', 'o', 'z', 'y'].includes(e.key.toLowerCase())
        ) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div className="transform-heading">
        <b>{editing ? 'Editar texto' : 'Texto'}</b>
        <span>
          {s.stage === 'point'
            ? editing
              ? 'Novo ponto de inserção'
              : '1/2 · Ponto de inserção'
            : editing
              ? 'Conteúdo e formatação'
              : '2/2 · Conteúdo e formatação'}
        </span>
      </div>
      <p>
        <strong>{s.mask.name}</strong> ·{' '}
        {detailPath(s.project, s.context.detailId)} · texto livre da máscara,
        sem vínculo com armaduras.
      </p>
      {s.stage === 'point' ? (
        <p>
          Clique no desenho o ponto de inserção (encaixes valem). Esc{' '}
          {editing ? 'volta à edição' : 'cancela o texto'}; nada é gravado antes
          de confirmar.
        </p>
      ) : (
        <>
          <label className="field">
            Conteúdo
            <input
              ref={content}
              aria-label="Conteúdo do texto"
              value={f.text}
              maxLength={500}
              onChange={(e) => set({ text: e.target.value })}
            />
          </label>
          <div className="free-text-symbols" aria-label="Símbolos">
            {['Ø', '±', '°', '²', 'µ'].map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Inserir ${c}`}
                onClick={() => insert(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="fields-2">
            <label className="field">
              Altura
              <select
                aria-label="Referência da altura"
                value={f.size}
                onChange={(e) =>
                  set({ size: e.target.value as FreeTextFields['size'] })
                }
              >
                <option value="model">no modelo (mm)</option>
                <option value="paper">na folha (mm de papel)</option>
              </select>
            </label>
            <label className="field">
              {f.size === 'paper' ? 'Altura na folha (mm)' : 'Altura (mm)'}
              <input
                aria-label="Altura do texto"
                inputMode="decimal"
                value={f.height}
                onChange={(e) => set({ height: e.target.value })}
              />
            </label>
          </div>
          {f.size === 'paper' && (
            <label className="field">
              Escala de referência 1:
              <input
                aria-label="Escala da folha"
                inputMode="decimal"
                value={f.paperScale}
                onChange={(e) => set({ paperScale: e.target.value })}
              />
            </label>
          )}
          <p className="field-help" data-testid="free-text-model-height">
            {model
              ? `${model} mm no modelo · acompanha o zoom como a geometria.`
              : 'Altura inválida.'}
          </p>
          <div className="fields-2">
            <label className="field">
              Família
              <select
                aria-label="Família da fonte"
                value={known.has(f.family) ? f.family : 'other'}
                onChange={(e) =>
                  set({
                    family:
                      e.target.value === 'other' ? 'ISOCPEUR' : e.target.value,
                  })
                }
              >
                {TEXT_FONT_FAMILIES.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
                <option value="other">Outra (nome)</option>
              </select>
            </label>
            {!known.has(f.family) && (
              <label className="field">
                Nome da fonte
                <input
                  aria-label="Nome da fonte"
                  value={f.family}
                  maxLength={64}
                  onChange={(e) => set({ family: e.target.value })}
                />
              </label>
            )}
          </div>
          <div className="fields-2">
            <label className="field">
              Peso
              <select
                aria-label="Peso da fonte"
                value={f.weight}
                onChange={(e) =>
                  set({ weight: e.target.value as FreeTextFields['weight'] })
                }
              >
                <option value="normal">Normal</option>
                <option value="bold">Negrito</option>
              </select>
            </label>
            <label className="field">
              Estilo
              <select
                aria-label="Estilo da fonte"
                value={f.style}
                onChange={(e) =>
                  set({ style: e.target.value as FreeTextFields['style'] })
                }
              >
                <option value="normal">Normal</option>
                <option value="italic">Itálico</option>
              </select>
            </label>
          </div>
          <div className="fields-2">
            <label className="field">
              Alinhamento
              <select
                aria-label="Alinhamento do texto"
                value={f.align}
                onChange={(e) =>
                  set({ align: e.target.value as FreeTextFields['align'] })
                }
              >
                <option value="left">Esquerda</option>
                <option value="center">Centro</option>
                <option value="right">Direita</option>
              </select>
            </label>
            <label className="field">
              Rotação (°)
              <input
                aria-label="Rotação do texto"
                inputMode="decimal"
                value={f.rotation}
                onChange={(e) => set({ rotation: e.target.value })}
              />
            </label>
          </div>
          <div className="fields-2">
            <label className="field">
              Inserção X (mm)
              <input
                aria-label="Inserção X"
                inputMode="decimal"
                value={f.x}
                onChange={(e) => set({ x: e.target.value })}
              />
            </label>
            <label className="field">
              Inserção Y (mm)
              <input
                aria-label="Inserção Y"
                inputMode="decimal"
                value={f.y}
                onChange={(e) => set({ y: e.target.value })}
              />
            </label>
          </div>
          <button type="button" onClick={onRepick}>
            Escolher ponto no desenho
          </button>
          {notice && (
            <p className="field-help" data-testid="free-text-font-notice">
              {notice}
            </p>
          )}
          <button className="primary" type="button" onClick={onConfirm}>
            {editing ? 'Aplicar edição · Enter' : 'Inserir texto · Enter'}
          </button>
        </>
      )}
      {(s.issue || error) && <p role="alert">{s.issue || error}</p>}
      <p className="field-help">
        A prévia não altera o projeto. Coordenadas e alturas em mm do modelo; Ø,
        ± e acentos são preservados. O texto não vira geometria.
      </p>
      <button type="button" onClick={onEnd}>
        {editing ? 'Cancelar edição' : 'Cancelar texto'}
      </button>
    </section>
  );
}
