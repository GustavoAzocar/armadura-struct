import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../domain/types';
import {
  visibilityObjects,
  visibilityState,
  visibilityReasons,
  hideObjects,
  isolateObjects,
  restoreObjects,
  showAllObjects,
  endObjectIsolation,
  setVisibility,
} from '../domain/visibility';
export default function VisibilityDialog({
  project,
  contextKey,
  detailId,
  onChange,
  onClose,
}: {
  project: Project;
  contextKey: string;
  detailId?: string;
  onChange: (p: Project) => boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(''),
    [onlyHidden, setOnlyHidden] = useState(true),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState('');
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => old?.focus();
  }, []);
  const objects = useMemo(
    () =>
      visibilityObjects(project, contextKey).filter(
        (o) => !detailId || project.hierarchy.objectDetails[o.id] === detailId,
      ),
    [project, contextKey, detailId],
  );
  const label = (o: (typeof objects)[number]) =>
    'mark' in o
      ? `${o.mark} · armadura`
      : 'barId' in o && !('kind' in o)
        ? `Inserção de ${project.bars.find((b) => b.id === o.barId)?.mark ?? o.barId}`
        : 'name' in o
          ? o.name
          : 'kind' in o
            ? `${o.kind} · ${o.id}`
            : `Polilinha · ${o.id}`;
  const rows = objects
    .map((o) => ({
      o,
      name: label(o),
      reasons: visibilityReasons(project, contextKey, o.id),
    }))
    .filter(
      (r) =>
        (!onlyHidden || r.reasons.length) &&
        `${r.name} ${r.o.id} ${r.reasons.join(' ')}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
    );
  const placement = project.hierarchy.placements.find(
    (v) => contextKey === `view:${v.id}`,
  );
  const drawing = project.hierarchy.drawings.find(
    (d) => d.id === (placement?.drawingId ?? contextKey.slice(8)),
  );
  const contextName =
    contextKey === 'model'
      ? 'Modelo'
      : placement
        ? `${drawing?.name} · ${project.sheets.find((s) => s.id === placement.sheetId)?.name} · vista ${project.hierarchy.placements.filter((v) => v.sheetId === placement.sheetId).findIndex((v) => v.id === placement.id) + 1}`
        : drawing?.name;
  const state = visibilityState(project, contextKey);
  const apply = (f: () => Project) => {
    try {
      if (onChange(f())) {
        setError('');
        setSelected([]);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="modal-backdrop">
      <section
        className="modal visibility-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="visibility-title"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
          if (e.key !== 'Tab') return;
          const nodes = [
            ...e.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled)',
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
          aria-label="Fechar objetos ocultos"
          onClick={onClose}
        >
          ×
        </button>
        <h2 id="visibility-title">Visibilidade desta vista</h2>
        <p>
          <strong>{contextName}</strong>
        </p>
        <p>
          Ocultação e isolamento preservam o aço. Recuperar objetos não liga
          layers nem máscaras desligados. O realce laranja no desenho não é
          impresso.
        </p>
        <label className="field">
          <span>Pesquisar objeto ou motivo</span>
          <input
            aria-label="Pesquisar visibilidade"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={onlyHidden}
            onChange={(e) => setOnlyHidden(e.target.checked)}
          />
          Somente objetos com ocultação
        </label>
        <div className="visibility-list">
          <table>
            <thead>
              <tr>
                <th>Escolher</th>
                <th>Objeto</th>
                <th>Por que não aparece</th>
                <th>Recuperação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ o, name, reasons }) => (
                <tr key={o.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Selecionar visibilidade ${name}`}
                      checked={selected.includes(o.id)}
                      onChange={(e) =>
                        setSelected((v) =>
                          e.target.checked
                            ? [...v, o.id]
                            : v.filter((id) => id !== o.id),
                        )
                      }
                    />
                  </td>
                  <td title={o.id}>{name}</td>
                  <td>{reasons.join(' · ') || 'Visível neste contexto'}</td>
                  <td>
                    <button
                      disabled={
                        !state.hiddenIds.includes(o.id) &&
                        !(
                          state.isolation && !state.isolation.ids.includes(o.id)
                        )
                      }
                      onClick={() =>
                        apply(() => restoreObjects(project, contextKey, [o.id]))
                      }
                      aria-label={`Recuperar ${name}`}
                    >
                      Recuperar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p>Nenhum objeto neste filtro.</p>}
        </div>
        <div className="visibility-actions">
          <button
            disabled={!selected.length}
            onClick={() =>
              apply(() => hideObjects(project, contextKey, selected))
            }
          >
            Ocultar escolhidos
          </button>
          <button
            disabled={!selected.length}
            onClick={() =>
              apply(() => isolateObjects(project, contextKey, selected))
            }
          >
            Isolar escolhidos
          </button>
          <button
            disabled={!selected.length}
            onClick={() =>
              apply(() => restoreObjects(project, contextKey, selected))
            }
          >
            Recuperar escolhidos
          </button>
          <button
            disabled={!state.isolation}
            onClick={() => apply(() => endObjectIsolation(project, contextKey))}
          >
            Sair do isolamento
          </button>
          <button
            onClick={() => apply(() => showAllObjects(project, contextKey))}
          >
            Exibir todos os objetos
          </button>
        </div>
        <fieldset>
          <legend>Impressão desta vista</legend>
          <label>
            <input
              type="checkbox"
              aria-label="Imprimir objetos ocultos desta vista"
              checked={state.printHidden}
              onChange={(e) =>
                apply(() =>
                  setVisibility(project, contextKey, {
                    printHidden: e.target.checked,
                  }),
                )
              }
            />
            Incluir objetos ocultos e fora do isolamento no PDF da vista
          </label>
          <p className="field-help">
            Layers desligados e estilos não imprimíveis continuam respeitados.
            DXF/CSV do modelo preservam o modelo completo.
          </p>
          <button
            onClick={() =>
              apply(() =>
                setVisibility(project, contextKey, { printHidden: false }),
              )
            }
          >
            Restaurar impressão da vista
          </button>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <div className="visibility-actions">
          <button
            onClick={() =>
              apply(() =>
                setVisibility(project, contextKey, {
                  showHidden: !state.showHidden,
                }),
              )
            }
          >
            {state.showHidden
              ? 'Encerrar realce dos ocultos'
              : 'Realçar ocultos no desenho'}
          </button>
          <button onClick={onClose}>Concluir</button>
        </div>
      </section>
    </div>
  );
}
