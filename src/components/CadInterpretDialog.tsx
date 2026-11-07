import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { nextMark } from '../domain/model';
import { detailPath } from '../domain/hierarchy';
import { bounds, format, geometry } from '../domain/geometry';
import { maskPoint } from '../cad/import';
import {
  previewCadInterpretation,
  type CadAssignment,
  type CadInterpretation,
} from '../cad/assisted';
import type { Project } from '../domain/types';

export default function CadInterpretDialog({
  project,
  detailId,
  maskId,
  onApply,
  onClose,
}: {
  project: Project;
  detailId: string;
  maskId?: string;
  onApply: (plan: CadInterpretation) => boolean;
  onClose: () => void;
}) {
  const masks = project.masks.filter(
    (m) => project.hierarchy.objectDetails[m.id] === detailId,
  );
  const [input, setInput] = useState<CadAssignment>(() => ({
    maskId: masks.find((m) => m.id === maskId)?.id ?? masks[0]?.id ?? '',
    contour: -1,
    scale: (masks.find((m) => m.id === maskId) ?? masks[0])?.scale ?? 1,
    mark: nextMark(project),
    diameter: 0,
    mandrel: 0,
    quantity: 0,
    steel: '',
    confirmed: false,
  }));
  const [filter, setFilter] = useState('');
  const dialog = useRef<HTMLDivElement>(null),
    close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => focused?.focus();
  }, []);
  const patch = (change: Partial<CadAssignment>) =>
    setInput((old) => ({
      ...old,
      ...change,
      confirmed: change.confirmed ?? false,
    }));
  const plan = useMemo(
    () => previewCadInterpretation(project, detailId, input),
    [project, detailId, input],
  );
  const mask = masks.find((m) => m.id === input.maskId);
  const data = useMemo(() => {
    if (!mask) return [];
    const scale =
      Number.isFinite(input.scale) && input.scale > 0
        ? input.scale
        : mask.scale;
    return mask.primitives.map((p, index) => ({
      ...p,
      index,
      points: p.points.map((p) => maskPoint(p, { ...mask, scale })),
      textHeight: (p.textHeight ?? 2.5) * scale,
    }));
  }, [mask, input.scale]);
  const box = useMemo(() => bounds(data.flatMap((p) => p.points)), [data]);
  const s = Math.min(
    560 / Math.max(1, box.width),
    300 / Math.max(1, box.height),
  );
  const query = filter.trim().toLocaleLowerCase();
  const contours = data.filter(
    (p) => p.text === undefined && p.points.length >= 2,
  );
  const texts = data.filter((p) => !!p.text);
  const filtered = contours.filter((p) =>
    `${p.index + 1} ${p.layer}`.toLocaleLowerCase().includes(query),
  );
  const shown = filtered.slice(0, 300);
  const selected = contours.find((p) => p.index === input.contour);
  if (selected && !shown.includes(selected)) shown.unshift(selected);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal cad-interpret-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Interpretar referência CAD"
        ref={dialog}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          const nodes = [
            ...dialog.current!.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled)',
            ),
          ].filter((n) => n.getClientRects().length);
          const first = nodes[0],
            last = nodes.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        <button
          ref={close}
          className="modal-close"
          aria-label="Cancelar interpretação CAD"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <span className="eyebrow">INTERCÂMBIO OPENSTRUCT · CAD ASSISTIDO</span>
        <h2>Interpretar referência CAD</h2>
        <p className="field-help">
          {detailPath(project, detailId)}. Linhas e textos continuam como
          referência até você atribuir e confirmar as propriedades físicas.
        </p>
        <div className="transfer-fields">
          <label className="field">
            <span>Máscara do detalhamento</span>
            <select
              aria-label="Máscara para interpretação"
              value={input.maskId}
              onChange={(e) => {
                const m = masks.find((m) => m.id === e.target.value)!;
                patch({
                  maskId: m.id,
                  contour: -1,
                  text: undefined,
                  scale: m.scale,
                });
              }}
            >
              {masks.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.format}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>mm por unidade CAD · origem: {mask?.sourceUnit}</span>
            <input
              type="number"
              aria-label="Milímetros por unidade CAD"
              min="0.000001"
              step="any"
              value={input.scale || ''}
              onChange={(e) => patch({ scale: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="cad-interpret-grid">
          <div>
            <svg
              className="cad-interpret-preview"
              viewBox="0 0 600 340"
              role="img"
              aria-label="Prévia dos contornos e textos CAD"
            >
              <g
                transform={`translate(${300 - (box.x + box.width / 2) * s} ${170 + (box.y + box.height / 2) * s}) scale(${s} ${-s})`}
              >
                {data.slice(0, 5000).map((p) =>
                  p.text ? (
                    <text
                      key={p.index}
                      transform={`translate(${p.points[0]?.x ?? 0} ${p.points[0]?.y ?? 0}) rotate(${(p.textRotation ?? 0) + (mask?.rotation ?? 0)}) scale(1 -1)`}
                      fontSize={Math.max(p.textHeight, 10 / s)}
                      fill={input.text === p.index ? '#3448d1' : '#60708a'}
                      onClick={() => patch({ text: p.index })}
                    >
                      {p.text}
                    </text>
                  ) : (
                    <path
                      key={p.index}
                      d={
                        p.points
                          .map((v, i) => `${i ? 'L' : 'M'}${v.x},${v.y}`)
                          .join(' ') + (p.closed ? ' Z' : '')
                      }
                      fill="none"
                      stroke={input.contour === p.index ? '#3448d1' : '#9ba7bb'}
                      strokeWidth={(input.contour === p.index ? 3 : 1) / s}
                      pointerEvents="stroke"
                      onClick={() => patch({ contour: p.index })}
                    />
                  ),
                )}
              </g>
            </svg>
            <p className="field-help">
              Clique no contorno/texto ou use as listas.{' '}
              {data.length > 5000
                ? 'Prévia limitada às primeiras 5000 entidades; as demais continuam acessíveis nas listas.'
                : ''}
            </p>
            <label className="field">
              <span>Pesquisar contorno por camada ou número</span>
              <input
                aria-label="Pesquisar contorno CAD"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                Contorno · {filtered.length} resultado(s), até 300 por pesquisa
              </span>
              <select
                aria-label="Contorno CAD"
                size={5}
                value={input.contour}
                onChange={(e) => patch({ contour: Number(e.target.value) })}
              >
                <option value={-1}>
                  Selecione explicitamente um contorno…
                </option>
                {shown.map((p) => (
                  <option key={p.index} value={p.index}>
                    {p.index + 1} · {p.layer} · {p.points.length} vértices
                    {p.closed ? ' · fechado' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Texto para chamada vinculada · leitura literal</span>
              <select
                aria-label="Texto CAD para chamada"
                value={input.text ?? ''}
                onChange={(e) =>
                  patch({
                    text:
                      e.target.value === ''
                        ? undefined
                        : Number(e.target.value),
                  })
                }
              >
                <option value="">Sem chamada</option>
                {texts.map((p) => (
                  <option key={p.index} value={p.index}>
                    {p.index + 1} · {p.layer} · {p.text}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <h3>Atribuir aço à linha de eixo</h3>
            <p className="field-help">
              Selecione uma poligonal que represente o eixo da barra. O contorno
              de concreto não define cobrimento, ganchos ou armaduras
              automaticamente.
            </p>
            <div className="transfer-fields">
              <label className="field">
                <span>Posição</span>
                <input
                  aria-label="Posição CAD"
                  value={input.mark}
                  onChange={(e) => patch({ mark: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Bitola (mm)</span>
                <input
                  aria-label="Bitola CAD"
                  type="number"
                  step="any"
                  value={input.diameter || ''}
                  onChange={(e) => patch({ diameter: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Quantidade</span>
                <input
                  aria-label="Quantidade CAD"
                  type="number"
                  step="1"
                  value={input.quantity || ''}
                  onChange={(e) => patch({ quantity: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Aço</span>
                <select
                  aria-label="Categoria de aço CAD"
                  value={input.steel}
                  onChange={(e) =>
                    patch({ steel: e.target.value as CadAssignment['steel'] })
                  }
                >
                  <option value="">Atribua a categoria…</option>
                  <option>CA-50</option>
                  <option>CA-60</option>
                </select>
              </label>
              <label className="field">
                <span>Diâmetro interno de dobra (mm)</span>
                <input
                  aria-label="Diâmetro de dobra CAD"
                  type="number"
                  step="any"
                  value={input.mandrel || ''}
                  onChange={(e) => patch({ mandrel: Number(e.target.value) })}
                />
              </label>
            </div>
            {selected && (
              <p className="field-help">
                Dimensões do contorno: {format(bounds(selected.points).width)} ×{' '}
                {format(bounds(selected.points).height)} mm.{' '}
                {selected.closed
                  ? 'Contorno fechado: confira a fabricação; não são acrescentados ganchos.'
                  : ''}
              </p>
            )}
            <label className="transfer-checkbox">
              <input
                type="checkbox"
                aria-label="Confirmar interpretação física CAD"
                checked={input.confirmed}
                onChange={(e) => patch({ confirmed: e.target.checked })}
              />
              Conferi a unidade, o eixo selecionado e todas as propriedades
              físicas.
            </label>
            {plan.bar && (
              <p className="transfer-summary">
                {plan.bar.quantity} peça(s) · Ø{format(plan.bar.diameter)} ·
                comprimento unitário{' '}
                {format(geometry(plan.bar).length / 1000, 3)} m
                {plan.raInvalidated
                  ? ' · RA será desbloqueada e recalculada.'
                  : ''}
              </p>
            )}
            {!!plan.issues.length && (
              <div className="transfer-errors" role="status">
                {plan.issues.map((s) => (
                  <p key={s}>{s}</p>
                ))}
              </div>
            )}
            <p className="field-help">
              Todas as entidades normalizadas permanecem na máscara de
              referência. A escala informada será aplicada à máscara; posições
              físicas já existentes conservam suas dimensões.
            </p>
            {!!mask?.warnings.length && (
              <details>
                <summary>Avisos do leitor CAD ({mask.warnings.length})</summary>
                {mask.warnings.map((w, i) => (
                  <p className="field-help" key={i}>
                    {w}
                  </p>
                ))}
              </details>
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Cancelar</button>
          <button
            className="primary"
            disabled={!plan.project || !!plan.issues.length}
            onClick={() => onApply(plan)}
          >
            Criar posição física
          </button>
        </div>
      </div>
    </div>
  );
}
