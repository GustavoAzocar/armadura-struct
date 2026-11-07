import PlotStyleFields from './PlotStyleFields';
import {
  ensureProfiles,
  profileLabel,
  layerState,
  setLayerState,
  saveLayerProfile,
  applyLayerProfile,
} from '../domain/layerProfiles';
import { useMemo, useRef, useEffect, useState } from 'react';
import type { DrawingLayer, PlotStyle, Project } from '../domain/types';
import {
  assignLayer,
  createLayer,
  editLayers,
  editLayerPlotStyles,
  mergePlotStyle,
  layerUsage,
  removeLayer,
  LINE_TYPES,
} from '../domain/layers';
import { NumberField } from './Panels';
export default function LayerManager({
  project,
  contextKey = 'model',
  objectIds,
  onChange,
  onSelect,
  onClose,
}: {
  contextKey?: string;
  project: Project;
  objectIds: string[];
  onChange: (next: Project) => boolean;
  onSelect: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [ids, setIds] = useState<string[]>([project.layers[0].id]),
    [filter, setFilter] = useState('all'),
    [query, setQuery] = useState(''),
    [patch, setPatch] = useState<Partial<DrawingLayer>>({}),
    [name, setName] = useState('Novo layer'),
    [target, setTarget] = useState(''),
    [error, setError] = useState('');
  const [plotPatch, setPlotPatch] = useState<PlotStyle>({});
  const [resetPlot, setResetPlot] = useState(false);
  const [profileName, setProfileName] = useState('Meu perfil');
  const environment = ensureProfiles(project).layerEnvironment!;
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => old?.focus();
  }, []);
  const usage = useMemo(() => layerUsage(project), [project]);
  const rows = project.layers.filter(
    (l) =>
      l.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
      (filter === 'all' ||
        (filter === 'used' && !!usage.get(l.id)?.size) ||
        (filter === 'unused' && !usage.get(l.id)?.size)),
  );
  const first = project.layers.find((l) => l.id === ids[0]),
    value = first ? { ...first, ...patch } : undefined;
  const select = (ids: string[]) => {
    setIds(ids);
    setPatch({});
    setPlotPatch({});
    setResetPlot(false);
    setError('');
  };
  const apply = (f: () => Project) => {
    try {
      const next = f();
      if (onChange(next)) {
        setPatch({});
        setPlotPatch({});
        setResetPlot(false);
        setError('');
        return true;
      }
    } catch (e) {
      setError((e as Error).message);
    }
    return false;
  };
  return (
    <div className="modal-backdrop">
      <section
        className="modal layer-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="layers-title"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            onClose();
            return;
          }
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
          aria-label="Fechar gerenciador de layers"
          onClick={onClose}
          ref={close}
        >
          ×
        </button>
        <h2 id="layers-title">Layers do projeto</h2>
        <p>
          Estilos por herança; alterações não modificam geometria ou
          quantitativos. Os pavimentos continuam na árvore do projeto.
        </p>
        <fieldset>
          <legend>Perfil deste desenho / vista</legend>
          <label className="field">
            <span>Perfil · {profileLabel(project, contextKey)}</span>
            <select
              aria-label="Perfil de layers"
              value={
                project.layerEnvironment?.contexts[contextKey]?.profileId ?? ''
              }
              onChange={(e) =>
                apply(() =>
                  applyLayerProfile(project, contextKey, e.target.value),
                )
              }
            >
              <option value="" disabled>
                Escolha um perfil
              </option>
              {environment.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <input
            aria-label="Nome do perfil"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
          />
          <button
            onClick={() =>
              apply(() => saveLayerProfile(project, contextKey, profileName))
            }
          >
            Salvar perfil atual
          </button>
          <button
            disabled={
              !project.layerEnvironment?.contexts[contextKey]?.profileId
            }
            onClick={() =>
              apply(() =>
                applyLayerProfile(
                  project,
                  contextKey,
                  project.layerEnvironment!.contexts[contextKey].profileId!,
                ),
              )
            }
          >
            Restaurar perfil
          </button>
        </fieldset>
        <div className="layer-manager-grid">
          <div>
            <div className="fields-2">
              <label className="field">
                <span>Pesquisar</span>
                <input
                  aria-label="Pesquisar layers"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Exibir</span>
                <select
                  aria-label="Filtrar layers"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">Todos</option>
                  <option value="used">Em uso</option>
                  <option value="unused">Sem uso</option>
                </select>
              </label>
            </div>
            <div className="layer-list">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Selecionar layers listados"
                        checked={
                          !!rows.length && rows.every((l) => ids.includes(l.id))
                        }
                        onChange={(e) =>
                          select(e.target.checked ? rows.map((l) => l.id) : [])
                        }
                      />
                    </th>
                    <th>Layer</th>
                    <th>Objetos</th>
                    <th>Exibir / Capturar / Editar</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr
                      key={l.id}
                      className={ids.includes(l.id) ? 'selected' : ''}
                    >
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Selecionar layer ${l.name}`}
                          checked={ids.includes(l.id)}
                          onChange={(e) =>
                            select(
                              e.target.checked
                                ? [...ids, l.id]
                                : ids.filter((id) => id !== l.id),
                            )
                          }
                        />
                      </td>
                      <td>
                        <button
                          onClick={() => select([l.id])}
                          aria-label={`Editar layer ${l.name}`}
                        >
                          <i style={{ background: l.color }} />
                          {l.name}
                        </button>
                      </td>
                      <td>{usage.get(l.id)?.size ?? 0}</td>
                      <td>
                        {(['visible', 'capture', 'editable'] as const).map(
                          (key, i) => (
                            <input
                              key={key}
                              type="checkbox"
                              aria-label={`${['Exibir', 'Capturar', 'Editar'][i]} ${l.name}`}
                              checked={
                                layerState(project, contextKey, l.id)[key]
                              }
                              onChange={(e) =>
                                apply(() =>
                                  setLayerState(project, contextKey, l.id, {
                                    [key]: e.target.checked,
                                  }),
                                )
                              }
                            />
                          ),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="layer-new">
              <label className="field">
                <span>Novo layer</span>
                <input
                  aria-label="Nome do novo layer"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button
                onClick={() => {
                  try {
                    const made = createLayer(project, name);
                    if (onChange(made.project)) {
                      select([made.id]);
                      setFilter('all');
                      setQuery('');
                    }
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Criar layer
              </button>
            </div>
            <button
              disabled={ids.length !== 1 || !objectIds.length}
              onClick={() =>
                apply(() => assignLayer(project, objectIds, ids[0]))
              }
            >
              Atribuir layer à seleção ({objectIds.length})
            </button>
            <button
              disabled={!ids.length}
              onClick={() => {
                onSelect([
                  ...new Set(ids.flatMap((id) => [...(usage.get(id) ?? [])])),
                ]);
                onClose();
              }}
            >
              Selecionar objetos dos layers
            </button>
          </div>
          <div className="layer-properties">
            <h3>{ids.length} layer(s) selecionado(s)</h3>
            {first && (
              <PlotStyleFields
                value={mergePlotStyle(
                  resetPlot ? undefined : first.plot,
                  plotPatch,
                )}
                base={value ?? first}
                onChange={(patch) =>
                  setPlotPatch((old) => ({ ...old, ...patch }))
                }
                onReset={() => {
                  setResetPlot(true);
                  setPlotPatch({});
                }}
              />
            )}
            {value && (
              <>
                <label className="field">
                  <span>Nome</span>
                  <input
                    aria-label="Nome do layer"
                    disabled={ids.length !== 1}
                    value={patch.name ?? value.name}
                    onChange={(e) =>
                      setPatch((p) => ({ ...p, name: e.target.value }))
                    }
                  />
                </label>
                <div className="fields-2">
                  <label className="field">
                    <span>Cor</span>
                    <input
                      type="color"
                      aria-label="Cor do layer"
                      value={value.color}
                      onChange={(e) =>
                        setPatch((p) => ({ ...p, color: e.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Tipo de linha</span>
                    <select
                      aria-label="Tipo de linha do layer"
                      value={JSON.stringify(value.lineType)}
                      onChange={(e) =>
                        setPatch((p) => ({
                          ...p,
                          lineType: JSON.parse(e.target.value),
                        }))
                      }
                    >
                      {!LINE_TYPES.some(
                        (l) =>
                          JSON.stringify(l) === JSON.stringify(value.lineType),
                      ) && (
                        <option value={JSON.stringify(value.lineType)}>
                          {value.lineType.name} (importado)
                        </option>
                      )}
                      {LINE_TYPES.map((l) => (
                        <option key={l.name} value={JSON.stringify(l)}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="fields-2">
                  <NumberField
                    label="Escala de linha do layer"
                    value={value.lineScale}
                    min={0.000001}
                    max={10000}
                    onChange={(lineScale) =>
                      setPatch((p) => ({ ...p, lineScale }))
                    }
                  />
                  <NumberField
                    label="Espessura do layer"
                    value={value.lineWidth}
                    min={0}
                    max={2.11}
                    suffix="mm"
                    onChange={(lineWidth) =>
                      setPatch((p) => ({ ...p, lineWidth }))
                    }
                  />
                </div>
                <div className="fields-2">
                  <label className="field">
                    <span>Preenchimento de contornos fechados</span>
                    <select
                      aria-label="Preenchimento do layer"
                      value={value.fill}
                      onChange={(e) =>
                        setPatch((p) => ({
                          ...p,
                          fill: e.target.value as DrawingLayer['fill'],
                        }))
                      }
                    >
                      <option value="none">Sem preenchimento</option>
                      <option value="solid">Sólido</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Cor do preenchimento</span>
                    <input
                      type="color"
                      aria-label="Cor de preenchimento do layer"
                      value={value.fillColor}
                      onChange={(e) =>
                        setPatch((p) => ({ ...p, fillColor: e.target.value }))
                      }
                    />
                  </label>
                </div>
                <p className="field-help">
                  Somente os campos alterados serão aplicados aos layers
                  selecionados. Overrides dos objetos são preservados.
                </p>
                <button
                  className="primary"
                  disabled={
                    !Object.keys(patch).length &&
                    !Object.keys(plotPatch).length &&
                    !resetPlot
                  }
                  onClick={() =>
                    apply(() => {
                      let next = editLayers(project, ids, patch);
                      if (resetPlot)
                        next = editLayerPlotStyles(next, ids, {}, true);
                      return Object.keys(plotPatch).length
                        ? editLayerPlotStyles(next, ids, plotPatch)
                        : next;
                    })
                  }
                >
                  Aplicar aos layers selecionados
                </button>
                <fieldset>
                  <legend>Remover layer</legend>
                  <label className="field">
                    <span>Reassociar objetos para</span>
                    <select
                      aria-label="Layer de reassociação"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">
                        Escolha o destino se estiver em uso
                      </option>
                      {project.layers
                        .filter((l) => !ids.includes(l.id))
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    disabled={ids.length !== 1}
                    onClick={() => {
                      if (
                        apply(() =>
                          removeLayer(project, ids[0], target || undefined),
                        )
                      )
                        select([]);
                    }}
                  >
                    Excluir layer selecionado
                  </button>
                </fieldset>
              </>
            )}
          </div>
        </div>
        {error && (
          <p role="alert" className="warning-text">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Concluir</button>
        </div>
      </section>
    </div>
  );
}
