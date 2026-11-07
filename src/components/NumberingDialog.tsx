import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../domain/types';
import { fabricationPositions } from '../domain/fabrication';
import { defaultNumbering } from '../domain/marks';
import { previewRenumber, type RenumberOptions } from '../domain/numbering';
import { executeRebarBatch, type RebarBatchResult } from '../domain/rebarApi';
export default function NumberingDialog({
  project: p,
  detailId,
  selected,
  onClose,
  onApply,
}: {
  project: Project;
  detailId: string;
  selected: string[];
  onClose: () => void;
  onApply: (r: RebarBatchResult) => boolean;
}) {
  const initial = p.numbering ?? defaultNumbering;
  const [prefix, setPrefix] = useState(initial.prefix),
    [start, setStart] = useState(initial.start),
    [reserved, setReserved] = useState(initial.reserved.join('\n')),
    [preserved, setPreserved] = useState(initial.preservedPositionIds),
    [order, setOrder] =
      useState<NonNullable<RenumberOptions['order']>>('top-right'),
    [scope, setScope] = useState('project');
  const positions = useMemo(() => fabricationPositions(p), [p]);
  const options: RenumberOptions = {
    policy: {
      prefix,
      start,
      reserved: reserved
        .split(/[\n,;]/)
        .map((s) => s.trim())
        .filter(Boolean),
      preservedPositionIds: preserved,
    },
    order,
    scope:
      scope === 'project'
        ? { kind: 'project' }
        : scope === 'selection'
          ? {
              kind: 'positions',
              positionIds: positions
                .filter((g) => g.barIds.every((id) => selected.includes(id)))
                .map((g) => g.id),
            }
          : scope === 'detail'
            ? { kind: 'detail', id: detailId }
            : scope === 'element'
              ? {
                  kind: 'element',
                  id: p.hierarchy.details.find((d) => d.id === detailId)!
                    .elementId,
                }
              : {
                  kind: 'floor',
                  id: p.hierarchy.elements.find(
                    (e) =>
                      e.id ===
                      p.hierarchy.details.find((d) => d.id === detailId)!
                        .elementId,
                  )!.floorId,
                },
  };
  const preview = useMemo(() => {
    try {
      return { plan: previewRenumber(p, options), error: '' };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [
    p,
    prefix,
    start,
    reserved,
    preserved,
    order,
    scope,
    selected,
    detailId,
    positions,
  ]);
  const dialog = useRef<HTMLDivElement>(null),
    close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => old?.focus();
  }, []);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal detail-transfer-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Renumerar posições"
        ref={dialog}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          if (e.key !== 'Tab') return;
          const nodes = [
            ...dialog.current!.querySelectorAll<HTMLElement>(
              'input,select,textarea,button:not(:disabled)',
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
          aria-label="Cancelar renumeração"
        >
          ×
        </button>
        <h2>Renumerar posições</h2>
        <div className="transfer-fields">
          <label className="field">
            <span>Prefixo</span>
            <input
              aria-label="Prefixo da numeração"
              value={prefix}
              maxLength={20}
              onChange={(e) => setPrefix(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Primeiro número</span>
            <input
              aria-label="Primeiro número"
              type="number"
              min={1}
              max={999999999}
              value={start || ''}
              onChange={(e) => setStart(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Escopo</span>
            <select
              aria-label="Escopo da renumeração"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="project">Projeto</option>
              <option value="floor">Pavimento ativo</option>
              <option value="element">Elemento ativo</option>
              <option value="detail">Detalhamento ativo</option>
              <option value="selection">
                Posições inteiramente selecionadas
              </option>
            </select>
          </label>
          <label className="field">
            <span>Ordem espacial</span>
            <select
              aria-label="Ordem espacial"
              value={order}
              onChange={(e) => setOrder(e.target.value as typeof order)}
            >
              <option value="top-right">
                Cima → baixo; direita → esquerda
              </option>
              <option value="top-left">Cima → baixo; esquerda → direita</option>
              <option value="right-top">
                Direita → esquerda; cima → baixo
              </option>
              <option value="left-top">Esquerda → direita; cima → baixo</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>
            Marcas reservadas · uma por linha ou separadas por vírgula
          </span>
          <textarea
            aria-label="Marcas reservadas"
            rows={2}
            value={reserved}
            onChange={(e) => setReserved(e.target.value)}
          />
        </label>
        <p className="field-help">
          Referência: origem física do primeiro membro (representante AS-54). X
          cresce para a direita; Y cresce para cima. Empate exato: ID da
          posição. Vistas e rebatimentos não participam. Posições compartilhadas
          fora do escopo ficam protegidas. Marque Preservar para manter o
          rótulo.
        </p>
        {preview.error && (
          <p role="alert" className="transfer-errors">
            {preview.error}
          </p>
        )}
        <div className="numbering-preview">
          <table className="schedule-table">
            <thead>
              <tr>
                <th>Preservar</th>
                <th>Antes</th>
                <th>Depois</th>
                <th>Inserção X / Y (mm)</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {preview.plan?.rows.map((r) => (
                <tr key={r.positionId}>
                  <td>
                    <input
                      aria-label={`Preservar posição ${r.before}`}
                      type="checkbox"
                      checked={preserved.includes(r.positionId)}
                      onChange={(e) =>
                        setPreserved((ids) =>
                          e.target.checked
                            ? [...ids, r.positionId]
                            : ids.filter((id) => id !== r.positionId),
                        )
                      }
                    />
                  </td>
                  <td>{r.before}</td>
                  <td>{r.after}</td>
                  <td>
                    {r.x} / {r.y}
                  </td>
                  <td>
                    {r.status === 'outside'
                      ? 'Fora do escopo'
                      : r.status === 'preserved'
                        ? 'Preservada'
                        : 'Renumerar'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="field-help">
          Prefixo, início, reservas e preservações serão salvos para a próxima
          marca livre. A RA bloqueada permanece congelada e será sinalizada se
          os rótulos mudarem.
        </p>
        <div className="modal-actions">
          <button onClick={onClose}>Cancelar</button>
          <button
            className="primary"
            disabled={!preview.plan}
            onClick={() =>
              onApply(
                executeRebarBatch(p, [{ type: 'bar.renumber', options }], {
                  units: 'mm',
                }),
              )
            }
          >
            Aplicar renumeração
          </button>
        </div>
      </div>
    </div>
  );
}
