import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Project } from '../domain/types';
import {
  addSeriesVariants,
  createBarSeries,
  CUT_POLICY_LABEL,
  deleteBarSeries,
  moveSeriesVariant,
  removeSeriesVariant,
  seriesOfBar,
  seriesTableData,
  splitSeriesRows,
  updateBarSeries,
  type BarSeries,
  type SeriesTable,
  type SeriesTableRow,
} from '../domain/barSeries';
import { defaultSeriesTableColumns } from '../domain/barSeriesSchema';
import { geometry, sampled } from '../domain/geometry';

export type SeriesTableOptions = Pick<
  SeriesTable,
  'grouping' | 'columns' | 'rowsPerBlock' | 'textHeight'
>;
const number = (n: number, digits: number) =>
  Number.isFinite(n)
    ? n.toLocaleString('pt-BR', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        useGrouping: false,
      })
    : 'REVISAR';

/**
 * Consulta e edição das séries variáveis. Nada aqui altera o projeto sem uma
 * ação explícita (`onCommit`); abrir, navegar e cancelar não mudam dados.
 */
export default function BarSeriesDialog({
  project: p,
  selectedBarIds,
  initialSeriesId,
  canInsert,
  onCommit,
  onLocate,
  onInsert,
  onClose,
}: {
  project: Project;
  selectedBarIds: string[];
  initialSeriesId?: string;
  canInsert: boolean;
  onCommit: (change: (current: Project) => Project, message: string) => boolean;
  onLocate: (barId: string) => void;
  onInsert: (seriesId: string, options: SeriesTableOptions) => void;
  onClose: () => void;
}) {
  const series = p.barSeries ?? [];
  const [activeId, setActiveId] = useState<string | undefined>(
    initialSeriesId ??
      selectedBarIds.map((id) => seriesOfBar(p, id)?.id).find(Boolean) ??
      series[0]?.id,
  );
  const active: BarSeries | undefined = series.find((s) => s.id === activeId);
  const [options, setOptions] = useState<SeriesTableOptions>({
    grouping: 'variant',
    columns: defaultSeriesTableColumns(),
    textHeight: 2.5,
  });
  const [picked, setPicked] = useState<string>();
  const [draft, setDraft] = useState({
    name: '',
    status: 'exact' as BarSeries['status'],
    expected: '',
  });
  const [error, setError] = useState('');
  const free = selectedBarIds.filter(
    (id) => p.bars.some((b) => b.id === id) && !seriesOfBar(p, id),
  );
  const query = useMemo(() => {
    if (!active) return {};
    try {
      return {
        data: seriesTableData(p, active.id, { grouping: options.grouping }),
      };
    } catch (e) {
      return { failure: (e as Error).message };
    }
  }, [p, active, options.grouping]);
  const data = query.data;
  const blocks = data
    ? splitSeriesRows(data.rows, options.rowsPerBlock)
    : undefined;
  const pickedRow = data?.rows.find((r) => r.key === picked);
  const dims =
    data && options.columns.dimensions
      ? data.dimensions.filter((d) => d.variable)
      : [];
  const mixedReference = dims.some((d) => d.reference === 'por variante');
  const mixedSteel = !!data && data.steels.length > 1;
  const constants = data?.dimensions.filter(
    (d) => !d.variable || !options.columns.dimensions,
  );
  const run = (change: (current: Project) => Project, message: string) => {
    try {
      // Valida antes, para mostrar o erro no próprio diálogo.
      change(p);
      setError('');
      return onCommit(change, message);
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const dialog = useRef<HTMLDivElement>(null),
    close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => focused?.focus();
  }, []);
  useEffect(() => {
    if (activeId && !series.some((s) => s.id === activeId))
      setActiveId(series[0]?.id);
  }, [series, activeId]);
  const create = () => {
    let createdId: string | undefined;
    const ok = run((current) => {
      const made = createBarSeries(current, {
        barIds: free,
        status: draft.status,
        ...(draft.name.trim() ? { name: draft.name } : {}),
        ...(draft.expected ? { expectedVariants: Number(draft.expected) } : {}),
      });
      createdId = made.id;
      return made.project;
    }, 'Série variável criada com as armaduras selecionadas.');
    if (ok && createdId) {
      setActiveId(createdId);
      setDraft({ name: '', status: 'exact', expected: '' });
    }
  };
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal detail-transfer-modal bar-series-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Séries variáveis"
        ref={dialog}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <button
          className="modal-close"
          ref={close}
          aria-label="Fechar séries variáveis"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <span className="eyebrow">
          PEÇAS REAIS · IDS ESTÁVEIS · A TABELA NÃO ACRESCENTA AÇO
        </span>
        <h2>Séries variáveis</h2>
        {(error || query.failure) && (
          <p className="series-error" role="alert">
            {error || query.failure}
          </p>
        )}
        <div className="transfer-fields">
          <label className="field">
            <span>Série</span>
            <select
              aria-label="Série variável"
              value={activeId ?? ''}
              onChange={(e) => {
                setActiveId(e.target.value || undefined);
                setPicked(undefined);
              }}
            >
              {!series.length && <option value="">Nenhuma série</option>}
              {series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.variants.length} variante(s)
                  {s.status === 'estimated' ? ' · estimada' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <details className="series-create" open={!series.length}>
          <summary>
            Criar série com a seleção ({free.length} armadura(s) livre(s))
          </summary>
          <p className="field-help">
            Selecione no desenho as armaduras na ordem da série. Cada armadura é
            uma variante física; a ordem da seleção define a sequência. Uma
            série estimada usa uma única armadura como representante médio.
          </p>
          <div className="transfer-fields">
            <label className="field">
              <span>Identificação</span>
              <input
                aria-label="Identificação da nova série"
                value={draft.name}
                maxLength={40}
                placeholder={p.bars.find((b) => b.id === free[0])?.mark ?? 'N1'}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Estado</span>
              <select
                aria-label="Estado da nova série"
                value={draft.status}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    status: e.target.value as BarSeries['status'],
                  })
                }
              >
                <option value="exact">Exata (lista de corte)</option>
                <option value="estimated">Estimada (representante)</option>
              </select>
            </label>
            <label className="field">
              <span>Total declarado (opcional)</span>
              <input
                aria-label="Total de variantes declarado"
                inputMode="numeric"
                value={draft.expected}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    expected: e.target.value.replace(/\D/g, ''),
                  })
                }
              />
            </label>
          </div>
          <button
            className="primary"
            disabled={
              !free.length || (draft.status === 'estimated' && free.length > 1)
            }
            onClick={create}
          >
            Criar série
          </button>
        </details>
        {active && data && (
          <>
            <div className="transfer-fields">
              <label className="field">
                <span>Identificação principal</span>
                <input
                  key={active.id + active.name}
                  aria-label="Identificação da série"
                  defaultValue={active.name}
                  maxLength={40}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== active.name)
                      run(
                        (c) => updateBarSeries(c, active.id, { name }),
                        'Identificação da série atualizada.',
                      );
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
              </label>
              <label className="field">
                <span>Estado</span>
                <select
                  aria-label="Estado da série"
                  value={active.status}
                  onChange={(e) =>
                    run(
                      (c) =>
                        updateBarSeries(c, active.id, {
                          status: e.target.value as BarSeries['status'],
                        }),
                      'Estado da série atualizado.',
                    )
                  }
                >
                  <option value="exact">Exata (lista de corte)</option>
                  <option
                    value="estimated"
                    disabled={!active.representativeBarId}
                  >
                    Estimada (representante)
                  </option>
                </select>
              </label>
              <label className="field">
                <span>Origem</span>
                <input
                  aria-label="Origem da série"
                  readOnly
                  value={
                    active.provenance.kind === 'manual'
                      ? 'Manual'
                      : `Gerador: ${active.provenance.source}`
                  }
                />
              </label>
            </div>
            {data.notes.length > 0 && (
              <ul className="series-notes" role="status">
                {data.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <div className="transfer-fields">
              <label className="field">
                <span>Linhas</span>
                <select
                  aria-label="Agrupamento da tabela"
                  value={options.grouping}
                  onChange={(e) =>
                    setOptions({
                      ...options,
                      grouping: e.target.value as SeriesTable['grouping'],
                    })
                  }
                >
                  <option value="variant">Uma linha por variante</option>
                  <option value="fabrication">
                    Agrupar equivalentes (fabricação)
                  </option>
                </select>
              </label>
              <label className="field">
                <span>Linhas por bloco (0 = bloco único)</span>
                <input
                  aria-label="Linhas por bloco"
                  inputMode="numeric"
                  value={options.rowsPerBlock ?? 0}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/\D/g, ''));
                    setOptions({
                      ...options,
                      rowsPerBlock: n > 0 ? Math.min(1000, n) : undefined,
                    });
                  }}
                />
              </label>
              <fieldset className="series-columns">
                <legend>Colunas opcionais</legend>
                {(
                  [
                    ['dimensions', 'Cotas'],
                    ['formula', 'Fórmula'],
                    ['developed', 'C. desenvolvido'],
                    ['mass', 'Peso'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={options.columns[key]}
                      onChange={(e) =>
                        setOptions({
                          ...options,
                          columns: {
                            ...options.columns,
                            [key]: e.target.checked,
                          },
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            </div>
            <p className="field-help">
              {data.steels.join(' / ')} · {data.totals.variants} variante(s) ·{' '}
              {data.totals.rows} linha(s)
              {blocks && blocks.length > 1
                ? ` em ${blocks.length} blocos`
                : ''}{' '}
              · {CUT_POLICY_LABEL}.
              {options.columns.dimensions && data.dimensions.length > 0
                ? ` Referência das cotas: ${data.dimensions[0].reference}.`
                : ''}
              {constants?.length
                ? ` Cotas constantes (${constants[0].reference}): ${constants
                    .map((d) =>
                      d.constant === undefined
                        ? `${d.label} variável`
                        : `${d.label} = ${number(d.constant / 10, 1)} cm`,
                    )
                    .join('; ')}.`
                : ''}
            </p>
            <div className="transfer-table-scroll">
              <table
                className="transfer-table series-table"
                aria-label="Tabela de comprimentos da série"
              >
                <thead>
                  <tr>
                    <th>Var.</th>
                    <th>Pos.</th>
                    {mixedSteel && <th>Aço / Ø (mm)</th>}
                    {mixedReference && <th>Referência das cotas</th>}
                    {dims.map((d) => (
                      <th key={d.label}>{d.label} (cm)</th>
                    ))}
                    <th>Quant.</th>
                    {options.columns.formula && <th>Base×M×R</th>}
                    {options.columns.developed && <th>C. desenv. (cm)</th>}
                    <th>C. corte (cm)</th>
                    <th>Subtotal (m)</th>
                    {options.columns.mass && <th>Peso (kg)</th>}
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <SeriesRow
                      key={r.key}
                      row={r}
                      index={i}
                      count={data.rows.length}
                      dims={dims.map((d) => data.dimensions.indexOf(d))}
                      columns={options.columns}
                      mixedReference={mixedReference}
                      mixedSteel={mixedSteel}
                      picked={picked === r.key}
                      blockStart={
                        !!blocks &&
                        blocks.length > 1 &&
                        blocks.some((b) => b.index > 0 && b.rows[0] === r)
                      }
                      canReorder={options.grouping === 'variant'}
                      onPick={() => setPicked(r.key)}
                      onLocate={() => onLocate(r.barIds[0])}
                      onMove={(step) =>
                        run(
                          (c) =>
                            moveSeriesVariant(
                              c,
                              active.id,
                              r.variantIds[0],
                              step,
                            ),
                          'Sequência da série atualizada.',
                        )
                      }
                      onRemove={() =>
                        run(
                          (c) =>
                            removeSeriesVariant(c, active.id, r.variantIds[0]),
                          'Variante retirada da série; a armadura permanece.',
                        )
                      }
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={2}>Total da série</th>
                    {mixedSteel && <td />}
                    {mixedReference && <td />}
                    {dims.map((d) => (
                      <td key={d.label} />
                    ))}
                    <td>{data.totals.pieces}</td>
                    {options.columns.formula && <td />}
                    {options.columns.developed && <td />}
                    <td />
                    <td>{number(data.totals.length, 2)}</td>
                    {options.columns.mass && (
                      <td>{number(data.totals.weight, 2)}</td>
                    )}
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            {pickedRow && <VariantPreview project={p} row={pickedRow} />}
            <div className="modal-actions">
              <button
                disabled={!free.length || active.status === 'estimated'}
                onClick={() =>
                  run(
                    (c) => addSeriesVariants(c, active.id, free),
                    'Armaduras acrescentadas ao fim da série.',
                  )
                }
              >
                Acrescentar seleção ({free.length})
              </button>
              <button
                onClick={() =>
                  run(
                    (c) => deleteBarSeries(c, active.id),
                    'Série desfeita; as armaduras e o aço permanecem.',
                  )
                }
              >
                Desfazer série (mantém armaduras)
              </button>
              <button
                className="primary"
                disabled={!canInsert || !data.rows.length}
                title={
                  canInsert
                    ? undefined
                    : 'Crie uma prancha no gerenciador para inserir a tabela.'
                }
                onClick={() => onInsert(active.id, options)}
              >
                Inserir tabela na prancha
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SeriesRow({
  row: r,
  index,
  count,
  dims,
  columns,
  mixedReference,
  mixedSteel,
  picked,
  blockStart,
  canReorder,
  onPick,
  onLocate,
  onMove,
  onRemove,
}: {
  row: SeriesTableRow;
  index: number;
  count: number;
  dims: number[];
  columns: SeriesTable['columns'];
  mixedReference: boolean;
  mixedSteel: boolean;
  picked: boolean;
  blockStart: boolean;
  canReorder: boolean;
  onPick: () => void;
  onLocate: () => void;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <tr
      className={`${picked ? 'selected' : ''} ${blockStart ? 'series-block-start' : ''}`}
      aria-selected={picked}
      data-variant-ids={r.variantIds.join(' ')}
      onClick={onPick}
    >
      <td>
        <b>{r.subId}</b>
        {r.representative && <small> variável/representativo</small>}
        {r.errors.length > 0 && <small> · REVISAR</small>}
      </td>
      <td>{r.marks.join('/')}</td>
      {mixedSteel && (
        <td>
          {r.steel} / {number(r.diameter, 1)}
        </td>
      )}
      {mixedReference && <td>{r.dimensionReference}</td>}
      {dims.map((k) => (
        <td key={k}>
          {r.dimensions[k] === undefined
            ? '-'
            : number(r.dimensions[k]! / 10, 1)}
        </td>
      ))}
      <td>{r.quantity}</td>
      {columns.formula && <td>{r.formula}</td>}
      {columns.developed && <td>{number(r.developedLength / 10, 1)}</td>}
      <td>
        {r.representative ? 'méd. ' : ''}
        {number(r.cutLength / 10, 1)}
      </td>
      <td>{number(r.subtotalLength, 2)}</td>
      {columns.mass && <td>{number(r.weight, 2)}</td>}
      <td className="series-row-actions">
        <button
          aria-label={`Localizar ${r.subId}`}
          title="Localizar e editar a armadura (a edição é da própria peça)"
          onClick={(e) => {
            e.stopPropagation();
            onLocate();
          }}
        >
          Localizar
        </button>
        {canReorder && !r.representative && (
          <>
            <button
              aria-label={`Subir ${r.subId}`}
              disabled={index === 0}
              onClick={(e) => {
                e.stopPropagation();
                onMove(-1);
              }}
            >
              ↑
            </button>
            <button
              aria-label={`Descer ${r.subId}`}
              disabled={index === count - 1}
              onClick={(e) => {
                e.stopPropagation();
                onMove(1);
              }}
            >
              ↓
            </button>
            <button
              aria-label={`Retirar ${r.subId} da série`}
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              Retirar
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

/** Prévia da geometria real da peça; não cria aço nem vista. */
function VariantPreview({
  project,
  row,
}: {
  project: Project;
  row: SeriesTableRow;
}) {
  const bar = project.bars.find((b) => b.id === row.barIds[0]);
  if (!bar) return null;
  const g = geometry(bar);
  const points = sampled(g.segments);
  if (!points.length) return null;
  const xs = points.map((v) => v.x),
    ys = points.map((v) => v.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const pad = Math.max(maxX - minX, maxY - minY, 1) * 0.08;
  return (
    <figure className="series-preview" aria-label="Prévia da variante">
      <svg
        viewBox={`${minX - pad} ${-maxY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <polyline
          points={points.map((v) => `${v.x},${-v.y}`).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth={Math.max(bar.diameter, (maxX - minX) / 150)}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption>
        {row.subId} · {row.marks.join('/')} · corte{' '}
        {number(row.cutLength / 10, 1)} cm · {row.quantity} peça(s) · IDs:{' '}
        {row.variantIds.join(', ') || '-'}
      </figcaption>
    </figure>
  );
}
