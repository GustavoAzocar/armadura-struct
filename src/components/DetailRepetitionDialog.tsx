import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { DetailRepetition, Project } from '../domain/types';
import { detailPath } from '../domain/hierarchy';
import { detailTitle, repetitionNames } from '../domain/detailQuantities';
import {
  mergeElements,
  previewMergeRepetitions,
  repetitionCandidates,
  setDetailRepetition,
} from '../domain/detailRepetition';
import { schedule } from '../domain/model';
import { format } from '../domain/geometry';

export default function DetailRepetitionDialog({
  project: p,
  detailId,
  onApply,
  onClose,
}: {
  project: Project;
  detailId: string;
  onApply: (next: Project, detailId: string, base: Project) => boolean;
  onClose: () => void;
}) {
  const [id, setId] = useState(detailId),
    [mode, setMode] = useState<'factor' | 'merge'>('factor');
  const [factor, setFactor] = useState(
    p.hierarchy.details.find((d) => d.id === detailId)?.repetition?.factor ?? 1,
  );
  const [picked, setPicked] = useState<string[]>([]),
    [namesText, setNamesText] = useState<string>();
  const dialog = useRef<HTMLDivElement>(null),
    close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => focused?.focus();
  }, []);
  const detail = p.hierarchy.details.find((d) => d.id === id)!;
  const candidates = useMemo(() => repetitionCandidates(p, id), [p, id]);
  const members = useMemo(
    () =>
      mode === 'merge'
        ? mergeElements(p, [id, ...picked])
        : (detail.repetition?.elements ?? []),
    [p, id, picked, mode, detail],
  );
  const defaults = repetitionNames(p, { factor, elements: members });
  const text = namesText ?? defaults.join('\n');
  const names = text.trim()
    ? text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const preview = useMemo(() => {
    if (mode === 'merge') {
      const plan = previewMergeRepetitions(
        p,
        id,
        picked,
        namesText === undefined ? undefined : names,
      );
      return {
        project: plan.project,
        issues: plan.issues,
        warnings: plan.warnings,
        factor: plan.factor,
        removed: plan.removedDetailIds.length,
      };
    }
    try {
      if (!Number.isInteger(factor) || factor < 1 || factor > 10000)
        throw new Error('Use um fator inteiro entre 1 e 10000.');
      if (names.length && names.length !== factor)
        throw new Error(
          `Informe ${factor} nomes, um por ocorrência, ou deixe a lista vazia.`,
        );
      const elements: DetailRepetition['elements'] = names.map((name, i) =>
        name === defaults[i] && members[i]?.elementId ? members[i] : { name },
      );
      const repetition = {
        factor,
        elements,
        absorbedOrigins: detail.repetition?.absorbedOrigins,
      };
      return {
        project: setDetailRepetition(p, id, repetition),
        issues: [],
        warnings: [],
        factor,
        removed: 0,
      };
    } catch (e) {
      const error = e as { message?: string; issues?: { message: string }[] };
      return {
        project: undefined,
        issues: [
          error.issues?.[0]?.message ?? error.message ?? 'Repetição inválida.',
        ],
        warnings: [],
        factor,
        removed: 0,
      };
    }
  }, [p, id, mode, factor, picked, namesText, text]);
  const totals = (project: Project) =>
    schedule({ ...project, scheduleLock: undefined }).reduce(
      (sum, row) => ({
        quantity: sum.quantity + row.quantity,
        weight: sum.weight + row.weight,
      }),
      { quantity: 0, weight: 0 },
    );
  const before = totals(p),
    after = preview.project ? totals(preview.project) : undefined;
  const choose = (value: string) => {
    setId(value);
    setFactor(
      p.hierarchy.details.find((d) => d.id === value)?.repetition?.factor ?? 1,
    );
    setPicked([]);
    setNamesText(undefined);
  };
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal detail-transfer-modal repetition-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Repetições do detalhamento"
        ref={dialog}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          const nodes = [
            ...dialog.current!.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)',
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
          aria-label="Cancelar repetição"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <span className="eyebrow">
          REPETIÇÃO DE ELEMENTOS · QUANTIDADE FÍSICA
        </span>
        <h2>Repetições do detalhamento</h2>
        <div className="transfer-fields">
          <label className="field">
            <span>Operação</span>
            <select
              aria-label="Operação da repetição"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as 'factor' | 'merge');
                setNamesText(undefined);
              }}
            >
              <option value="factor">Configurar repetição</option>
              <option value="merge">
                Reunir detalhes idênticos existentes
              </option>
            </select>
          </label>
          <label className="field">
            <span>
              {mode === 'merge'
                ? 'Representante que será conservado'
                : 'Detalhamento'}
            </span>
            <select
              aria-label="Representante da repetição"
              value={id}
              onChange={(e) => choose(e.target.value)}
            >
              {p.hierarchy.details.map((d) => (
                <option key={d.id} value={d.id}>
                  {detailPath(p, d.id)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Fator inteiro</span>
            <input
              aria-label="Fator de repetição"
              type="number"
              min={1}
              max={10000}
              step={1}
              disabled={mode === 'merge'}
              value={(mode === 'merge' ? preview.factor : factor) || ''}
              onChange={(e) => setFactor(Number(e.target.value))}
            />
          </label>
        </div>
        <p className="field-help">
          A quantidade da posição continua sendo por elemento. Quantidade
          efetiva = base × repetições. Abrir ou duplicar vistas do mesmo detalhe
          conserva esse total.
        </p>
        <div className="repetition-grid">
          <div>
            {mode === 'merge' && (
              <>
                <h3>Detalhes com armaduras idênticas</h3>
                <div className="repetition-candidates">
                  {candidates.length ? (
                    candidates.map((d) => (
                      <label className="transfer-checkbox" key={d.id}>
                        <input
                          type="checkbox"
                          aria-label={`Reunir ${d.path}`}
                          checked={picked.includes(d.id)}
                          onChange={(e) => {
                            setPicked((ids) =>
                              e.target.checked
                                ? [...ids, d.id]
                                : ids.filter((id) => id !== d.id),
                            );
                            setNamesText(undefined);
                          }}
                        />
                        <span>
                          {d.path}
                          <small>
                            {d.positions} posições · repetição atual {d.factor}×
                          </small>
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="field-help">
                      Nenhum outro detalhe com as mesmas definições físicas e
                      quantidades base.
                    </p>
                  )}
                </div>
              </>
            )}
            <label className="field">
              <span>Nomes dos elementos · um por linha</span>
              <textarea
                aria-label="Nomes dos elementos repetidos"
                value={text}
                onChange={(e) => setNamesText(e.target.value)}
                placeholder="V1&#10;V2&#10;V3"
              />
            </label>
            <p className="field-help">
              Na configuração manual, a lista vazia usa o título do detalhe e o
              fator. Na reunião, identifique todas as ocorrências. Elementos
              vinculados conservam seus IDs ao renomear/mover na árvore.
            </p>
          </div>
          <div>
            <h3>Antes / depois no projeto</h3>
            <div className="transfer-summary">
              <span>
                {before.quantity} → {after?.quantity ?? '—'} peças
              </span>
              <span>
                {format(before.weight, 3)} →{' '}
                {after ? format(after.weight, 3) : '—'} kg
              </span>
              <span>
                {mode === 'merge'
                  ? `${preview.removed} definições duplicadas a retirar`
                  : `${preview.factor} ocorrências do elemento`}
              </span>
            </div>
            {preview.project && (
              <p className="transfer-origin" data-testid="repetition-title">
                {detailTitle(preview.project, id)}
              </p>
            )}
            {!!p.scheduleLock && (
              <p className="field-help">
                A RA bloqueada será desbloqueada e recalculada ao aplicar.
              </p>
            )}
            {preview.warnings.map((w) => (
              <p className="field-help" key={w}>
                {w}
              </p>
            ))}
            {preview.issues.map((s) => (
              <p className="transfer-errors" role="status" key={s}>
                {s}
              </p>
            ))}
            <p className="field-help">
              A posição e a escala das vistas são preservadas. Títulos maiores
              podem exigir reenquadramento antes da impressão. Desfazer recupera
              as definições e os vínculos anteriores.
            </p>
          </div>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Cancelar</button>
          {mode === 'factor' && detail.repetition && (
            <button onClick={() => onApply(setDetailRepetition(p, id), id, p)}>
              Remover repetição
            </button>
          )}
          <button
            className="primary"
            disabled={!preview.project || !!preview.issues.length}
            onClick={() => preview.project && onApply(preview.project, id, p)}
          >
            Aplicar repetição
          </button>
        </div>
      </div>
    </div>
  );
}
