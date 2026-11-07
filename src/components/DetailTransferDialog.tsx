import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Bar, Project, Primitive } from '../domain/types';
import { detailPath } from '../domain/hierarchy';
import { detailEditorView } from '../domain/detailEditing';
import {
  detailOrigin,
  matchingDetails,
  previewDetailTransfer,
  sameDetailOrigin,
  type TransferOptions,
  type TransferPlan,
} from '../domain/detailTransfer';
import { drawingPrimitives } from '../domain/drawingPrimitives';
import { primitiveBounds } from '../domain/drafting';
import { bounds, format, geometry } from '../domain/geometry';

type Props = {
  project: Project;
  source: Project;
  fileName: string;
  mode: 'insert' | 'replace';
  elementId: string;
  sheetId?: string;
  activeDetailId: string;
  onApply: (plan: TransferPlan) => boolean;
  onClose: () => void;
};
const barInfo = (b?: Bar) =>
  b
    ? `${b.quantity} × Ø${format(b.diameter, 1)} ${b.steel} · C=${format(geometry(b).length / 1000, 3)} m · ${b.kind === 'stirrup' ? 'estribo' : 'barra livre'}`
    : '—';

export default function DetailTransferDialog({
  project: p,
  source,
  fileName,
  mode: initialMode,
  elementId,
  sheetId,
  activeDetailId,
  onApply,
  onClose,
}: Props) {
  const initial =
    source.hierarchy.details.find((d) =>
      sameDetailOrigin(
        detailOrigin(source, d.id),
        detailOrigin(p, activeDetailId),
      ),
    ) ??
    source.hierarchy.details.find((d) =>
      source.bars.some((b) => source.hierarchy.objectDetails[b.id] === d.id),
    ) ??
    source.hierarchy.details[0];
  const firstMatches = matchingDetails(p, source, initial.id);
  const [options, setOptions] = useState<TransferOptions>({
    mode: initialMode,
    sourceDetailId: initial.id,
    targetDetailId: firstMatches.length === 1 ? firstMatches[0].id : '',
    targetElementId: elementId,
    sheetId,
    name:
      initialMode === 'replace' && firstMatches.length === 1
        ? firstMatches[0].name
        : initial.name,
  });
  const dialog = useRef<HTMLDivElement>(null),
    closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => focused?.focus();
  }, []);
  const plan = useMemo(
    () => previewDetailTransfer(p, source, options),
    [p, source, options],
  );
  const incoming = source.hierarchy.details.find(
    (d) => d.id === options.sourceDetailId,
  )!;
  const target =
    options.mode === 'replace'
      ? p.hierarchy.details.find((d) => d.id === options.targetDetailId)
      : undefined;
  const sourceBars = source.bars.filter(
    (b) => source.hierarchy.objectDetails[b.id] === incoming.id,
  );
  const localBars = p.bars.filter(
    (b) => p.hierarchy.objectDetails[b.id] === target?.id,
  );
  const different =
    target &&
    !sameDetailOrigin(
      detailOrigin(p, target.id),
      detailOrigin(source, incoming.id),
    );
  const patch = (change: Partial<TransferOptions>) =>
    setOptions((o) => ({ ...o, ...change }));
  const chooseSource = (id: string) => {
    const matches = matchingDetails(p, source, id),
      d = source.hierarchy.details.find((d) => d.id === id)!;
    patch({
      sourceDetailId: id,
      targetDetailId: matches.length === 1 ? matches[0].id : '',
      name:
        options.mode === 'replace' && matches.length === 1
          ? matches[0].name
          : d.name,
      allowOriginChange: false,
      barMap: {},
      references: {},
      keepBars: [],
    });
  };
  const removedIds = new Set(
    plan.bars.filter((r) => r.status === 'removed').map((r) => r.localId),
  );
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal detail-transfer-modal"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Comparar detalhamentos"
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            const nodes = [
              ...dialog.current!.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled),summary',
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
          }
        }}
      >
        <button
          ref={closeButton}
          className="modal-close"
          aria-label="Cancelar comparação"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <span className="eyebrow">ATUALIZAÇÃO CONTROLADA · {fileName}</span>
        <h2>
          {options.mode === 'insert'
            ? 'Inserir detalhamento'
            : 'Atualizar / substituir detalhamento'}
        </h2>
        <p className="field-help">
          Revise as posições e os vínculos antes de aplicar. O restante do
          projeto permanece no mesmo modelo.
        </p>
        <div className="transfer-fields">
          <label className="field">
            <span>Operação</span>
            <select
              aria-label="Operação do detalhamento"
              value={options.mode}
              onChange={(e) =>
                patch({
                  mode: e.target.value as 'insert' | 'replace',
                  name:
                    e.target.value === 'replace'
                      ? (p.hierarchy.details.find(
                          (d) => d.id === options.targetDetailId,
                        )?.name ?? incoming.name)
                      : incoming.name,
                  allowOriginChange: false,
                  barMap: {},
                  references: {},
                  keepBars: [],
                })
              }
            >
              <option value="insert">Inserir novo detalhamento</option>
              <option value="replace">Atualizar / substituir existente</option>
            </select>
          </label>
          <label className="field">
            <span>Detalhamento recebido</span>
            <select
              aria-label="Detalhamento de origem"
              value={incoming.id}
              onChange={(e) => chooseSource(e.target.value)}
            >
              {source.hierarchy.details.map((d) => (
                <option key={d.id} value={d.id}>
                  {detailPath(source, d.id)}
                </option>
              ))}
            </select>
          </label>
          {options.mode === 'replace' ? (
            <label className="field">
              <span>Detalhamento local</span>
              <select
                aria-label="Detalhamento de destino"
                value={options.targetDetailId ?? ''}
                onChange={(e) =>
                  patch({
                    targetDetailId: e.target.value,
                    name:
                      p.hierarchy.details.find((d) => d.id === e.target.value)
                        ?.name ?? incoming.name,
                    allowOriginChange: false,
                    barMap: {},
                    references: {},
                    keepBars: [],
                  })
                }
              >
                <option value="">
                  Escolha o destino pelos IDs e pelo caminho…
                </option>
                {p.hierarchy.details.map((d) => (
                  <option key={d.id} value={d.id}>
                    {detailPath(p, d.id)} · {d.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="field">
                <span>Elemento local de destino</span>
                <select
                  aria-label="Elemento de destino da inserção"
                  value={options.targetElementId}
                  onChange={(e) => patch({ targetElementId: e.target.value })}
                >
                  {p.hierarchy.elements.map((e) => (
                    <option key={e.id} value={e.id}>
                      {p.hierarchy.floors.find((f) => f.id === e.floorId)?.name}{' '}
                      / {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Colocar na folha</span>
                <select
                  aria-label="Folha de destino da inserção"
                  value={options.sheetId ?? ''}
                  onChange={(e) =>
                    patch({ sheetId: e.target.value || undefined })
                  }
                >
                  <option value="">Não colocar agora</option>
                  {p.sheets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="field">
            <span>Nome após aplicar</span>
            <input
              aria-label="Nome do detalhamento importado"
              maxLength={100}
              value={options.name ?? incoming.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>
        </div>
        <div className="transfer-origin" aria-label="Identidade da origem">
          <b>
            {source.name} · {detailPath(source, incoming.id)} · revisão{' '}
            {source.drawing.revision}
          </b>
          <code>{JSON.stringify(detailOrigin(source, incoming.id))}</code>
          {target && (
            <>
              <span>Destino: {detailPath(p, target.id)}</span>
              <code>{JSON.stringify(detailOrigin(p, target.id))}</code>
            </>
          )}
        </div>
        {different && (
          <label className="transfer-checkbox origin-consent">
            <input
              type="checkbox"
              aria-label="Confirmar troca de origem"
              checked={!!options.allowOriginChange}
              onChange={(e) => patch({ allowOriginChange: e.target.checked })}
            />
            Confirmei os IDs e desejo substituir este destino por outra origem.
            Homônimos de pavimentos distintos não são equivalentes.
          </label>
        )}
        <h3>Posições recebidas e mapeamento de identidades</h3>
        <div className="transfer-table-scroll">
          <table className="transfer-table">
            <thead>
              <tr>
                <th>Recebida</th>
                <th>Posição local preservada</th>
                <th>Antes</th>
                <th>Depois</th>
              </tr>
            </thead>
            <tbody>
              {sourceBars.map((b) => {
                const row = plan.bars.find((r) => r.sourceId === b.id);
                return (
                  <tr key={b.id}>
                    <td title={b.id}>
                      <b>{b.mark}</b>
                      <small>{b.id.slice(0, 8)}</small>
                    </td>
                    <td>
                      <select
                        aria-label={`Preservar posição para ${b.mark}`}
                        value={
                          plan.ambiguousBars.includes(b.id)
                            ? '__choose__'
                            : (plan.mapping[b.id] ?? '')
                        }
                        onChange={(e) =>
                          patch({
                            barMap: {
                              ...options.barMap,
                              [b.id]: e.target.value,
                            },
                          })
                        }
                      >
                        {plan.ambiguousBars.includes(b.id) && (
                          <option value="__choose__" disabled>
                            Escolha uma identidade…
                          </option>
                        )}
                        <option value="">Nova posição (novo ID)</option>
                        {localBars.map((local) => (
                          <option key={local.id} value={local.id}>
                            {local.mark} · {local.id.slice(0, 8)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{barInfo(row?.before)}</td>
                    <td>
                      <b>{row?.after?.mark ?? b.mark}</b> ·{' '}
                      {barInfo(row?.after ?? b)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!sourceBars.length && (
          <p className="field-help">
            Não há posições físicas próprias neste detalhamento recebido.
          </p>
        )}
        {plan.bars.some(
          (r) => r.status === 'removed' || r.status === 'kept',
        ) && (
          <div className="transfer-retained">
            <h3>Posições locais ausentes na revisão</h3>
            {plan.bars
              .filter((r) => r.status === 'removed' || r.status === 'kept')
              .map((r) => {
                const automatic =
                  r.status === 'kept' && !options.keepBars?.includes(r.localId);
                return (
                  <label className="transfer-checkbox" key={r.localId}>
                    <input
                      type="checkbox"
                      aria-label={`Manter posição local ${r.before!.mark}`}
                      checked={r.status === 'kept'}
                      disabled={automatic}
                      onChange={(e) =>
                        patch({
                          keepBars: e.target.checked
                            ? [...(options.keepBars ?? []), r.localId]
                            : (options.keepBars ?? []).filter(
                                (id) => id !== r.localId,
                              ),
                        })
                      }
                    />
                    <b>{r.before!.mark}</b> {barInfo(r.before)} ·{' '}
                    {automatic
                      ? 'mantida por um vínculo recebido'
                      : r.status === 'kept'
                        ? 'manter com seus gráficos vinculados'
                        : 'será removida do modelo'}
                  </label>
                );
              })}
          </div>
        )}
        {plan.references.length > 0 && (
          <section
            className="transfer-references"
            aria-label="Vínculos a reassociar"
          >
            <h3>
              Vínculos a reassociar (
              {plan.references.filter((r) => !r.resolved).length} pendentes)
            </h3>
            {plan.references.map((ref) => (
              <div
                className={`transfer-reference ${ref.resolved ? 'resolved' : 'pending'}`}
                key={ref.key}
              >
                <div>
                  <b>
                    {ref.kind === 'representation' ? 'Rebatimento' : 'Anotação'}{' '}
                    · {ref.bar?.mark ?? 'Posição ausente'}
                  </b>
                  <small>
                    {ref.side === 'incoming' ? 'Recebido' : 'Já existente'} ·{' '}
                    {ref.path} · {ref.objectId}
                  </small>
                  <small>
                    Referência: {ref.barId}
                    {ref.side === 'incoming'
                      ? ' · Vincular a uma posição local não altera seus dados físicos.'
                      : ''}
                  </small>
                </div>
                <select
                  aria-label={`Resolver vínculo ${ref.key}`}
                  value={ref.resolution}
                  onChange={(e) =>
                    patch({
                      references: {
                        ...options.references,
                        [ref.key]: e.target.value,
                      },
                    })
                  }
                >
                  <option value="">Selecione uma resolução…</option>
                  {ref.resolution.startsWith('source:') &&
                    !sourceBars.some(
                      (b) => `source:${b.id}` === ref.resolution,
                    ) && (
                      <option value={ref.resolution}>
                        Dependência recebida (importada uma única vez)
                      </option>
                    )}
                  <optgroup label="Posições recebidas">
                    {sourceBars.map((b) => (
                      <option key={b.id} value={`source:${b.id}`}>
                        {b.mark} · recebida
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Posições locais">
                    {p.bars
                      .filter(
                        (b) => ref.side === 'incoming' || !removedIds.has(b.id),
                      )
                      .map((b) => (
                        <option key={b.id} value={`target:${b.id}`}>
                          {b.mark} ·{' '}
                          {detailPath(p, p.hierarchy.objectDetails[b.id])}
                        </option>
                      ))}
                  </optgroup>
                  {ref.side === 'incoming' && ref.sourceAvailable && (
                    <option value={`import:${ref.barId}`}>
                      Importar/atualizar posição externa neste detalhe (afeta o
                      aço)
                    </option>
                  )}
                  {ref.kind === 'annotation' && (
                    <option value="detach">
                      Desvincular anotação e conservar seu desenho/texto
                    </option>
                  )}
                  <option value="remove">Remover este objeto gráfico</option>
                </select>
              </div>
            ))}
          </section>
        )}
        {plan.bars.some((row) => row.dependency) && (
          <div className="transfer-dependencies">
            <h3>Posições externas importadas / atualizadas</h3>
            {plan.bars
              .filter((row) => row.dependency)
              .map((row) => (
                <p key={row.localId}>
                  <b>{row.after?.mark}</b> · {barInfo(row.before)} →{' '}
                  {barInfo(row.after)}
                </p>
              ))}
          </div>
        )}
        <div className="transfer-summary" aria-label="Resumo da comparação">
          <span>
            Posições:{' '}
            <b>{plan.bars.filter((r) => r.status === 'preserved').length}</b>{' '}
            preservadas ·{' '}
            <b>{plan.bars.filter((r) => r.status === 'added').length}</b>{' '}
            adicionadas ·{' '}
            <b>{plan.bars.filter((r) => r.status === 'removed').length}</b>{' '}
            removidas
          </span>
          <span>
            Peso global do modelo:{' '}
            <b>
              {format(plan.beforeWeight, 3)} → {format(plan.afterWeight, 3)} kg
            </b>
          </span>
          <span>
            Vistas vinculadas: <b>{plan.affectedViews.length}</b> · origem no
            papel, escala e rotação preservadas
          </span>
          {plan.raInvalidated && (
            <strong>
              RA bloqueada será desbloqueada e recalculada com os dados atuais.
            </strong>
          )}
          <small>
            Objetos do detalhe (antes → depois):{' '}
            {Object.entries(plan.counts.after)
              .map(
                ([key, n]) =>
                  `${({ bars: 'barras', details: 'rebatimentos', annotations: 'anotações', masks: 'máscaras', polylines: 'polilinhas' } as Record<string, string>)[key]} ${plan.counts.before[key] ?? 0} → ${n}`,
              )
              .join(' · ')}
          </small>
        </div>
        {options.mode === 'replace' && (
          <p className="field-help">
            A revisão define os objetos gráficos do destino. Gráficos vinculados
            a posições locais mantidas permanecem. Confira contagens e prévias
            antes de aplicar.
          </p>
        )}
        {target && (
          <label className="transfer-checkbox">
            <input
              type="checkbox"
              aria-label="Centralizar conteúdo nas vistas ao atualizar"
              checked={!!options.recenterViews}
              onChange={(e) => patch({ recenterViews: e.target.checked })}
            />
            Centralizar o conteúdo nas vistas ao atualizar (mantém posição no
            papel, escala e rotação).
          </label>
        )}
        <Comparison
          before={p}
          beforeId={target?.id}
          after={plan.project}
          afterId={plan.targetDetailId}
        />
        {plan.warnings.length > 0 && (
          <details className="transfer-warnings">
            <summary>
              Conferir enquadramentos após a alteração ({plan.warnings.length})
            </summary>
            {plan.warnings.map((s, i) => (
              <p key={i}>{s}</p>
            ))}
          </details>
        )}
        {plan.issues.length > 0 && (
          <div className="transfer-errors" role="alert">
            {plan.issues.map((s, i) => (
              <p key={i}>{s}</p>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Cancelar</button>
          <button
            className="primary"
            disabled={plan.issues.length > 0 || !plan.project}
            onClick={() => onApply(plan)}
          >
            Aplicar detalhamento
          </button>
        </div>
      </div>
    </div>
  );
}

function Comparison({
  before,
  beforeId,
  after,
  afterId,
}: {
  before: Project;
  beforeId?: string;
  after?: Project;
  afterId?: string;
}) {
  const data = useMemo(() => {
    const lines = (p?: Project, id?: string) => {
      if (!p || !id) return [];
      try {
        return drawingPrimitives(detailEditorView(p, id), p);
      } catch {
        return [];
      }
    };
    const old = lines(before, beforeId),
      next = lines(after, afterId);
    return {
      old,
      next,
      box: bounds([...old, ...next].flatMap(primitiveBounds)),
    };
  }, [before, beforeId, after, afterId]);
  return (
    <div className="transfer-previews">
      <Thumbnail label="Antes da alteração" lines={data.old} box={data.box} />
      <Thumbnail
        label={
          after
            ? 'Após a alteração'
            : 'Resultado disponível após resolver os vínculos'
        }
        lines={data.next}
        box={data.box}
      />
    </div>
  );
}
function Thumbnail({
  label,
  lines,
  box,
}: {
  label: string;
  lines: Primitive[];
  box: ReturnType<typeof bounds>;
}) {
  const s = Math.min(
    340 / Math.max(1, box.width),
    130 / Math.max(1, box.height),
  );
  return (
    <figure>
      <figcaption>{label}</figcaption>
      <svg viewBox="0 0 360 155" role="img" aria-label={label}>
        <g
          transform={`translate(${180 - (box.x + box.width / 2) * s} ${77 + (box.y + box.height / 2) * s}) scale(${s} ${-s})`}
        >
          {lines.map((p, i) =>
            p.text ? (
              <text
                key={i}
                transform={`translate(${p.points[0]?.x ?? 0} ${p.points[0]?.y ?? 0}) rotate(${p.textRotation ?? 0}) scale(1 -1)`}
                fontSize={Math.max(p.textHeight ?? 40, 4 / s)}
                fill="#31405e"
              >
                {p.text.replace(/%%c/g, 'Ø')}
              </text>
            ) : (
              <path
                key={i}
                d={
                  p.points
                    .map((p, j) => `${j ? 'L' : 'M'}${p.x},${p.y}`)
                    .join(' ') + (p.closed ? ' Z' : '')
                }
                fill="none"
                stroke={p.layer === 'MASCARA' ? '#b1b8c8' : '#3448a1'}
                strokeWidth={0.7 / s}
              />
            ),
          )}
        </g>
      </svg>
    </figure>
  );
}
