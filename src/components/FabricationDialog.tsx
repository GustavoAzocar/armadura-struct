import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Project } from '../domain/types';
import {
  fabricationCandidates,
  fabricationPositions,
  FABRICATION_RULES,
} from '../domain/fabrication';
import {
  contributionOrigin,
  schedule,
  scheduleQuantityLabel,
} from '../domain/model';
import {
  executeRebarBatch,
  type RebarBatchResult,
  type RebarCommand,
} from '../domain/rebarApi';
import { barQuantities, barSearchText } from '../domain/detailQuantities';
import { format } from '../domain/geometry';

export default function FabricationDialog({
  project: p,
  onApply,
  onClose,
}: {
  project: Project;
  onApply: (result: RebarBatchResult) => boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'group' | 'ungroup'>('group'),
    [reverse, setReverse] = useState(true),
    [bucket, setBucket] = useState(0),
    [picked, setPicked] = useState<string[]>(),
    [representative, setRepresentative] = useState<string>(),
    [mark, setMark] = useState<string>(),
    [query, setQuery] = useState('');
  const groups = useMemo(() => fabricationCandidates(p, reverse), [p, reverse]);
  const shared = useMemo(
    () => fabricationPositions(p).filter((g) => g.barIds.length > 1),
    [p],
  );
  const members =
    mode === 'group'
      ? (groups[bucket] ?? [])
      : (shared[bucket]?.barIds ?? []).map(
          (id) => p.bars.find((b) => b.id === id)!,
        );
  const ids = picked ?? members.map((b) => b.id),
    rep =
      representative && ids.includes(representative) ? representative : ids[0];
  const label = mark ?? p.bars.find((b) => b.id === rep)?.mark ?? '';
  const preview = useMemo(() => {
    const command: RebarCommand =
      mode === 'group'
        ? {
            type: 'fabrication.group',
            ids,
            representativeId: rep ?? '',
            reverse,
            mark: label,
          }
        : { type: 'fabrication.ungroup', ids };
    return executeRebarBatch(p, [command], { units: 'mm' });
  }, [p, mode, picked, bucket, representative, mark, reverse]);
  const before = schedule({ ...p, scheduleLock: undefined }),
    after = preview.ok ? schedule(preview.project) : undefined;
  const total = (rows: typeof before) => rows.reduce((s, r) => s + r.weight, 0);
  const reset = () => {
    setPicked(undefined);
    setRepresentative(undefined);
    setMark(undefined);
  };
  const dialog = useRef<HTMLDivElement>(null),
    close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => focused?.focus();
  }, []);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal detail-transfer-modal fabrication-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Posições de fabricação"
        ref={dialog}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          const nodes = [
            ...dialog.current!.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled)',
            ),
          ].filter((n) => n.getClientRects().length);
          if (e.shiftKey && document.activeElement === nodes[0]) {
            e.preventDefault();
            nodes.at(-1)?.focus();
          } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
            e.preventDefault();
            nodes[0]?.focus();
          }
        }}
      >
        <button
          className="modal-close"
          ref={close}
          aria-label="Cancelar posições de fabricação"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <span className="eyebrow">
          PEÇAS EQUIVALENTES · OCORRÊNCIAS PRESERVADAS
        </span>
        <h2>Posições de fabricação</h2>
        <div className="transfer-fields">
          <label className="field">
            <span>Operação</span>
            <select
              aria-label="Operação de fabricação"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as typeof mode);
                setBucket(0);
                reset();
              }}
            >
              <option value="group">Agrupar equivalentes</option>
              <option value="ungroup">Desagrupar posição</option>
            </select>
          </label>
          <label className="field">
            <span>
              {mode === 'group'
                ? 'Conjunto equivalente'
                : 'Posição compartilhada'}
            </span>
            <select
              aria-label="Conjunto de fabricação"
              value={bucket}
              onChange={(e) => {
                setBucket(Number(e.target.value));
                reset();
              }}
            >
              {mode === 'group'
                ? groups.map((bars, i) => (
                    <option value={i} key={bars[0].id}>
                      {bars.map((b) => b.mark).join(', ')} · {bars.length}{' '}
                      ocorrências
                    </option>
                  ))
                : shared.map((g, i) => (
                    <option value={i} key={g.id}>
                      {g.mark} · {g.barIds.length} ocorrências
                    </option>
                  ))}
              {!(mode === 'group' ? groups : shared).length && (
                <option value={0}>Nenhum conjunto disponível</option>
              )}
            </select>
          </label>
          {mode === 'group' && (
            <label className="transfer-checkbox">
              <input
                type="checkbox"
                checked={reverse}
                onChange={(e) => {
                  setReverse(e.target.checked);
                  setBucket(0);
                  reset();
                }}
              />
              Aceitar percurso reverso
            </label>
          )}
        </div>
        <p className="field-help">
          Grade de comprimentos {FABRICATION_RULES.lengthGrid} mm e de ângulos{' '}
          {FABRICATION_RULES.angleGrid} rad. Translação e rotação são ignoradas.
          Reflexão não é normalizada; inverter o percurso troca também as
          terminações. Aço, bitola, mandril, dobras, ganchos, códigos de
          terminação/luva e variante devem coincidir.
        </p>
        <div className="repetition-grid">
          <div>
            <h3>Selecionar ocorrências</h3>
            <input
              className="fabrication-search"
              aria-label="Pesquisar ocorrências de fabricação"
              placeholder="Pesquisar nome, pavimento ou ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="repetition-candidates">
              {members
                .filter((b) =>
                  `${barSearchText(b)} ${contributionOrigin(p, b.id)}`
                    .toLocaleLowerCase()
                    .includes(query.toLocaleLowerCase()),
                )
                .map((b) => (
                  <label className="transfer-checkbox" key={b.id}>
                    <input
                      type="checkbox"
                      aria-label={`Incluir ocorrência ${b.id}`}
                      checked={ids.includes(b.id)}
                      onChange={(e) => {
                        setPicked(
                          e.target.checked
                            ? [...ids, b.id]
                            : ids.filter((id) => id !== b.id),
                        );
                        setMark(undefined);
                      }}
                    />
                    <span>
                      {b.mark} · {b.element} · {barQuantities(p, b).quantity}{' '}
                      peças<small>{contributionOrigin(p, b.id)}</small>
                    </span>
                  </label>
                ))}
              {!members.length && (
                <p className="field-help">
                  Nenhuma ocorrência elegível. Crie barras com a mesma definição
                  de fabricação ou selecione outra operação.
                </p>
              )}
            </div>
            {mode === 'group' && (
              <div className="fields-2">
                <label className="field">
                  <span>Representante gráfico</span>
                  <select
                    aria-label="Representante de fabricação"
                    value={rep ?? ''}
                    onChange={(e) => {
                      setRepresentative(e.target.value);
                      setMark(undefined);
                    }}
                  >
                    {members
                      .filter((b) => ids.includes(b.id))
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.mark} · {b.id}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span>Identificação da posição</span>
                  <input
                    aria-label="Identificação da posição de fabricação"
                    maxLength={40}
                    value={label}
                    onChange={(e) => setMark(e.target.value)}
                  />
                </label>
              </div>
            )}
          </div>
          <div>
            <h3>Antes / depois</h3>
            <div className="transfer-summary">
              <span>
                {before.length} → {after?.length ?? '—'} posições
              </span>
              <span>
                {format(total(before), 4)} →{' '}
                {after ? format(total(after), 4) : '—'} kg
              </span>
              <span>{p.bars.length} ocorrências físicas conservadas</span>
            </div>
            {preview.ok ? (
              <div
                className="fabrication-preview"
                data-testid="fabrication-preview"
              >
                {after!
                  .filter((r) =>
                    r.contributions.some((c) => ids.includes(c.barId)),
                  )
                  .map((r) => (
                    <p key={r.positionId}>
                      <b>{r.mark}</b> · {scheduleQuantityLabel(r)} peças
                      <br />
                      {r.contributions.length} contribuições ·{' '}
                      {format(r.totalLength, 6)} m
                    </p>
                  ))}
              </div>
            ) : (
              members.length > 0 &&
              preview.issues.map((e, i) => (
                <p key={i} role="status" className="transfer-errors">
                  {e.message}
                </p>
              ))
            )}
            <p className="field-help">
              As chamadas continuam ligadas aos IDs das ocorrências. Elementos,
              quantidades base, fatores de repetição, geometria e vistas são
              conservados. O quadro soma cada comprimento real, inclusive
              pequenas diferenças dentro da grade.
            </p>
            {p.scheduleLock && (
              <p className="inline-warning">
                Ao aplicar, a RA bloqueada será desbloqueada e recalculada.
              </p>
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Cancelar</button>
          <button
            className="primary"
            disabled={
              !preview.ok ||
              !members.length ||
              (mode === 'ungroup' && !ids.length)
            }
            onClick={() => onApply(preview)}
          >
            Aplicar posições
          </button>
        </div>
      </div>
    </div>
  );
}
