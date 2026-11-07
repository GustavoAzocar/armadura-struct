import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, Point } from '../domain/types';
import { planArmatureClone } from '../domain/editing';
import { executeRebarBatch, type RebarBatchResult } from '../domain/rebarApi';
import { schedule } from '../domain/model';
import { detailPath } from '../domain/hierarchy';
import { format } from '../domain/geometry';
import { NumberField } from './Panels';
export type CloneRequest = {
  projectId: string;
  barIds: string[];
  objectIds: string[];
  delta: Point;
  detailId?: string;
};
export default function ArmatureCloneDialog({
  project,
  request,
  scopeDetailId,
  onApply,
  onClose,
}: {
  project: Project;
  request: CloneRequest;
  scopeDetailId?: string;
  onApply: (r: RebarBatchResult) => boolean;
  onClose: () => void;
}) {
  const [delta, setDelta] = useState(request.delta),
    [position, setPosition] = useState<'new' | 'equivalent'>('new');
  const [shared, setShared] = useState<'' | 'keep' | 'clone-set'>('');
  const [destination, setDestination] = useState(
    scopeDetailId ?? request.detailId ?? '',
  );
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => old?.focus();
  }, []);
  const initial = useMemo(() => {
    try {
      return planArmatureClone(project, request);
    } catch {
      return undefined;
    }
  }, [project, request]);
  const preview = useMemo(
    () =>
      executeRebarBatch(
        project,
        [
          {
            type: 'armature.clone',
            barIds: request.barIds,
            objectIds: request.objectIds,
            delta,
            position,
            shared: shared || undefined,
            detailId: destination || undefined,
          },
        ],
        { units: 'mm', scopeDetailId },
      ),
    [project, request, delta, position, shared, destination, scopeDetailId],
  );
  const added = preview.ok
    ? preview.project.bars.filter((b) =>
        preview.receipt.createdIds.includes(b.id),
      )
    : [];
  const total = (p: Project) =>
    schedule({ ...p, scheduleLock: undefined }).reduce(
      (s, r) => s + r.weight,
      0,
    );
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal armature-clone-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clone-title"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            onClose();
            return;
          }
          if (e.key !== 'Tab') return;
          const nodes = [
            ...e.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input,select',
            ),
          ];
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
          onClick={onClose}
          aria-label="Cancelar duplicação"
        >
          ×
        </button>
        <h2 id="clone-title">Duplicar armadura completa</h2>
        <p>
          Cria novas ocorrências físicas com inserções, chamadas e auxiliares
          vinculados. A cópia mantém vínculos independentes. Objetos sem vínculo
          só acompanham se estiverem selecionados.
        </p>
        <div className="fields-2">
          <NumberField
            label="Deslocamento X da cópia"
            value={delta.x}
            onChange={(x) => setDelta((d) => ({ ...d, x }))}
            suffix="mm"
          />
          <NumberField
            label="Deslocamento Y da cópia"
            value={delta.y}
            onChange={(y) => setDelta((d) => ({ ...d, y }))}
            suffix="mm"
          />
        </div>
        <label className="field">
          <span>Posição de fabricação da cópia</span>
          <select
            aria-label="Posição de fabricação da cópia"
            value={position}
            onChange={(e) => setPosition(e.target.value as typeof position)}
          >
            <option value="new">Nova posição livre</option>
            <option value="equivalent" disabled={!!scopeDetailId}>
              Reutilizar posição equivalente do original
            </option>
          </select>
        </label>
        <label className="field">
          <span>Destino dos objetos copiados</span>
          <select
            aria-label="Destino dos objetos copiados"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          >
            <option value="" disabled={!!scopeDetailId}>
              Conservar os desenhos de origem
            </option>
            {project.hierarchy.details
              .filter((d) => !scopeDetailId || d.id === scopeDetailId)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {detailPath(project, d.id)}
                </option>
              ))}
          </select>
        </label>
        {!!initial?.sharedObjectIds.length && (
          <fieldset>
            <legend>Dependências compartilhadas</legend>
            <p>
              {initial.sharedObjectIds.length} auxiliar(es) também referencia(m)
              outras armaduras. Escolha como copiar.
            </p>
            <label className="field">
              <span>Tratamento dos vínculos compartilhados</span>
              <select
                aria-label="Tratamento dos vínculos compartilhados"
                value={shared}
                onChange={(e) => setShared(e.target.value as typeof shared)}
              >
                <option value="">Escolha uma opção…</option>
                <option value="keep">
                  Manter vínculos com as outras armaduras originais
                </option>
                <option value="clone-set">
                  Duplicar todo o conjunto conectado
                </option>
              </select>
            </label>
          </fieldset>
        )}
        {preview.ok ? (
          <div className="clone-preview" aria-label="Prévia da duplicação">
            <strong>
              {added.length} nova(s) armadura(s) física(s) ·{' '}
              {preview.receipt.createdIds.length - added.length} objeto(s)
              gráfico(s)
            </strong>
            <p>
              {added
                .slice(0, 20)
                .map((b) => `${b.mark} · ${b.element}`)
                .join(' / ')}
              {added.length > 20 ? '…' : ''}
            </p>
            <p>
              Massa líquida: {format(total(project), 3)} →{' '}
              {format(total(preview.project), 3)} kg. As vistas não acrescentam
              aço.
            </p>
            {shared === 'clone-set' && added.length > request.barIds.length && (
              <p>
                O conjunto inclui {added.length - request.barIds.length}{' '}
                armadura(s) além da seleção inicial.
              </p>
            )}
          </div>
        ) : (
          <p className="warning-text" role="alert">
            {preview.issues.map((i) => i.message).join(' ')}
          </p>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Cancelar</button>
          <button
            className="primary"
            disabled={!preview.ok}
            onClick={() => onApply(preview)}
          >
            Duplicar conjunto
          </button>
        </div>
      </section>
    </div>
  );
}
