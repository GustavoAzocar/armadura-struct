import { useEffect, useMemo, useRef, useState } from 'react';
import { maskPoint } from '../cad/import';
import { maskCadEntities, type MaskEntityRef } from '../domain/maskCadEditing';
import type { MaskDrawingContext } from '../domain/maskDrawing';
import {
  applyCatalogImport,
  applySymbolCreation,
  applySymbolEdit,
  applySymbolInsertion,
  applySymbolRemoval,
  defaultInstanceLayer,
  detachSymbolInstance,
  exportSymbolCatalog,
  instancesOf,
  parseSymbolCatalog,
  previewCatalogImport,
  previewSymbolCreation,
  previewSymbolEdit,
  previewSymbolInsertion,
  previewSymbolRemoval,
  removeSymbolInstance,
  searchSymbols,
  symbolDefinitions,
  transformSymbolInstance,
  transformSymbolPrimitive,
  uniqueSymbolName,
  type CatalogDuplicates,
  type SymbolInsertMode,
} from '../domain/symbols';
import type {
  Point,
  Primitive,
  Project,
  SymbolDefinition,
} from '../domain/types';

type Stage = 'library' | 'form' | 'insert' | 'remove';
const num = (s: string) =>
  s.trim() === '' ? NaN : Number(s.replace(',', '.'));

/** Thumbnail in symbol space; read-only, never touches the project. */
export function SymbolPreview({
  primitives,
  label,
  size = 96,
}: {
  primitives: Primitive[];
  label: string;
  size?: number;
}) {
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const q of primitives)
    for (const p of q.points) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
  if (x0 === Infinity) return null;
  const span = Math.max(x1 - x0, y1 - y0, 1),
    pad = span * 0.06;
  return (
    <svg
      className="symbol-preview"
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`${x0 - pad} ${-(y1 + pad)} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {primitives.map((q, i) =>
        q.text !== undefined ? (
          <circle
            key={i}
            cx={q.points[0]?.x}
            cy={-(q.points[0]?.y ?? 0)}
            r={span * 0.01}
            fill="currentColor"
          />
        ) : (
          <path
            key={i}
            fill="none"
            stroke="currentColor"
            strokeWidth={span / 120}
            vectorEffect="non-scaling-stroke"
            d={
              q.points
                .map((p, j) => `${j ? 'L' : 'M'}${p.x},${-p.y}`)
                .join(' ') + (q.closed ? ' Z' : '')
            }
          />
        ),
      )}
      <circle cx={0} cy={0} r={span * 0.02} fill="var(--accent, #c33)" />
    </svg>
  );
}

export default function SymbolLibraryDialog({
  project,
  context,
  maskId,
  producer,
  onCommit,
  onClose,
  onSaveFile,
  notify,
  hidden = false,
  pickedPoint,
  onPick,
}: {
  project: Project;
  context: MaskDrawingContext;
  /** Active mask: the only source of entities and the target of independent copies. */
  maskId?: string;
  producer: { app: string; version: string };
  /** Runs inside the app history. The callback receives the live present project. */
  onCommit: (build: (current: Project) => Project) => boolean;
  onClose: () => void;
  onSaveFile: (name: string, text: string) => Promise<boolean | void>;
  notify: (message: string) => void;
  /** True while the user picks a point on the drawing; the dialog keeps its state. */
  hidden?: boolean;
  pickedPoint?: { kind: 'base' | 'place'; point: Point; n: number } | null;
  onPick: (request: {
    kind: 'base' | 'place';
    definition?: SymbolDefinition;
    layerId?: string;
    rotation: number;
    scale: number;
  }) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    busy = useRef(false);
  const [stage, setStage] = useState<Stage>('library'),
    [query, setQuery] = useState(''),
    [selectedId, setSelectedId] = useState<string>(),
    [instanceId, setInstanceId] = useState<string>(),
    [error, setError] = useState(''),
    [info, setInfo] = useState('');
  // form (create/edit)
  const [editing, setEditing] = useState<string>(),
    [name, setName] = useState(''),
    [category, setCategory] = useState(''),
    [picked, setPicked] = useState<MaskEntityRef[]>([]),
    [entityQuery, setEntityQuery] = useState(''),
    [baseX, setBaseX] = useState('0'),
    [baseY, setBaseY] = useState('0'),
    [replaceGeometry, setReplaceGeometry] = useState(false);
  // insert
  const [mode, setMode] = useState<SymbolInsertMode>('instance'),
    [x, setX] = useState('0'),
    [y, setY] = useState('0'),
    [rotation, setRotation] = useState('0'),
    [scale, setScale] = useState('1'),
    [layerId, setLayerId] = useState(() => defaultInstanceLayer(project));
  // remove
  const [alsoInstances, setAlsoInstances] = useState(false);
  const [duplicates, setDuplicates] = useState<CatalogDuplicates>('rename');

  const definitions = symbolDefinitions(project);
  const shown = useMemo(() => searchSymbols(project, query), [project, query]);
  const selected = definitions.find((d) => d.id === selectedId);
  const instances = selected ? instancesOf(project, selected.id) : [];
  const instance = instances.find((i) => i.id === instanceId);
  const entities = useMemo(
    () => maskCadEntities(project, context).filter((e) => e.mask.id === maskId),
    [project, context, maskId],
  );
  const activeMask = project.masks.find((m) => m.id === maskId);

  useEffect(() => {
    const el = dialog.current!;
    const old = document.activeElement as HTMLElement | null;
    el.showModal();
    return () => {
      el.close();
      if (old?.isConnected) old.focus();
    };
  }, []);
  useEffect(() => {
    const el = dialog.current!;
    if (hidden) {
      if (el.open) el.close();
      return;
    }
    if (el.open) return;
    // The Esc that cancelled the pick must not reach the dialog it re-opens.
    const frame = requestAnimationFrame(() => {
      if (!el.open && el.isConnected) el.showModal();
    });
    return () => cancelAnimationFrame(frame);
  }, [hidden]);
  const lastPicked = useRef(pickedPoint?.n ?? 0);
  useEffect(() => {
    if (!pickedPoint || pickedPoint.n === lastPicked.current) return;
    lastPicked.current = pickedPoint.n;
    const round = (n: number) => String(Math.round(n * 1000) / 1000);
    if (pickedPoint.kind === 'base') {
      setBaseX(round(pickedPoint.point.x));
      setBaseY(round(pickedPoint.point.y));
    } else {
      setX(round(pickedPoint.point.x));
      setY(round(pickedPoint.point.y));
    }
  }, [pickedPoint]);
  // A confirmed change gives a new project snapshot: the next confirmation is fresh.
  useEffect(() => {
    busy.current = false;
  }, [project]);
  useEffect(() => {
    if (selectedId && !selected) {
      setSelectedId(undefined);
      setInstanceId(undefined);
    }
    if (instanceId && !instance) setInstanceId(undefined);
  }, [selectedId, selected, instanceId, instance]);

  const back = () => {
    setStage('library');
    setError('');
  };
  const run = (work: () => void) => {
    if (busy.current) return;
    setError('');
    setInfo('');
    try {
      work();
    } catch (e) {
      busy.current = false;
      setError(e instanceof Error ? e.message : 'Operação não aplicada.');
    }
  };
  /** Applies one atomic, undoable change; the lock holds until the project changes. */
  const commit = (
    build: (current: Project) => Project,
    message: string,
    after?: () => void,
  ) => {
    busy.current = true;
    const ok = onCommit((current) => {
      if (current !== project)
        throw new Error('O projeto mudou. Reabra a biblioteca de símbolos.');
      return build(current);
    });
    if (!ok) {
      busy.current = false;
      return;
    }
    setInfo(message);
    notify(message);
    after?.();
  };

  const pickedPrimitives = picked.map((r) => r.primitive);
  const selectionBase = (): Point | undefined => {
    if (!activeMask || !picked.length) return undefined;
    let x = Infinity,
      y = Infinity;
    for (const r of picked)
      for (const local of r.primitive.points) {
        const p = maskPoint(local, activeMask);
        x = Math.min(x, p.x);
        y = Math.min(y, p.y);
      }
    return x === Infinity ? undefined : { x, y };
  };
  const base = (): Point => {
    const b = { x: num(baseX), y: num(baseY) };
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y))
      throw new Error('Informe X e Y do ponto base como números.');
    return b;
  };
  const openForm = (d?: SymbolDefinition) => {
    setEditing(d?.id);
    setName(d?.name ?? uniqueSymbolName(project, 'Símbolo'));
    setCategory(d?.category ?? '');
    setPicked([]);
    setEntityQuery('');
    setReplaceGeometry(false);
    setBaseX('0');
    setBaseY('0');
    setError('');
    setStage('form');
  };
  const useSelectionBase = () => {
    const b = selectionBase();
    if (!b) return setError('Selecione ao menos uma entidade.');
    setBaseX(String(Math.round(b.x * 1e6) / 1e6));
    setBaseY(String(Math.round(b.y * 1e6) / 1e6));
  };
  const geometryPatch = () =>
    maskId
      ? { geometry: { maskId, refs: picked, base: base() } }
      : (() => {
          throw new Error('Ative uma máscara para escolher as entidades.');
        })();

  const editPlan = () => {
    if (!editing) return undefined;
    try {
      return previewSymbolEdit(
        project,
        editing,
        {
          name,
          category,
          ...(replaceGeometry && picked.length ? geometryPatch() : {}),
        },
        context,
      );
    } catch {
      return undefined;
    }
  };
  const impact = stage === 'form' && editing ? editPlan() : undefined;

  const transform = () => ({
    origin: { x: num(x), y: num(y) },
    rotation: num(rotation),
    scale: num(scale),
  });
  const insertPreview = (() => {
    if (stage !== 'insert' || !selected) return undefined;
    const t = transform();
    if (![t.origin.x, t.origin.y, t.rotation, t.scale].every(Number.isFinite))
      return undefined;
    try {
      return selected.primitives.map((q) => transformSymbolPrimitive(q, t));
    } catch {
      return undefined;
    }
  })();

  const entityRows = entities
    .filter((e) =>
      e.label.toLocaleLowerCase().includes(entityQuery.toLocaleLowerCase()),
    )
    .slice(0, 200);
  const toggle = (ref: MaskEntityRef) =>
    setPicked((old) =>
      old.some((r) => r.primitive === ref.primitive)
        ? old.filter((r) => r.primitive !== ref.primitive)
        : [...old, ref],
    );

  const submitForm = () =>
    run(() => {
      if (!editing) {
        const plan = previewSymbolCreation(
          project,
          {
            maskId: maskId ?? '',
            refs: picked,
            name,
            category,
            base: base(),
          },
          context,
        );
        commit(
          (cur) => applySymbolCreation(cur, plan, context),
          `Símbolo “${plan.definition.name}” salvo na biblioteca.`,
          () => {
            setSelectedId(plan.definition.id);
            back();
          },
        );
        return;
      }
      const plan = previewSymbolEdit(
        project,
        editing,
        {
          name,
          category,
          ...(replaceGeometry ? geometryPatch() : {}),
        },
        context,
      );
      commit(
        (cur) => applySymbolEdit(cur, plan, context),
        plan.affected.length
          ? `Símbolo atualizado; ${plan.affected.length} instância(s) refletem a nova geometria.`
          : 'Símbolo atualizado.',
        back,
      );
    });
  const submitInsert = () =>
    run(() => {
      if (!selected) return;
      const plan = previewSymbolInsertion(
        project,
        selected.id,
        transform(),
        mode,
        context,
        { maskId, layerId },
      );
      commit(
        (cur) => applySymbolInsertion(cur, plan, context),
        mode === 'instance'
          ? `Instância de “${selected.name}” inserida; o aço não foi alterado.`
          : `Cópia independente de “${selected.name}” anexada à máscara ativa.`,
        back,
      );
    });
  const submitRemove = () =>
    run(() => {
      if (!selected) return;
      const plan = previewSymbolRemoval(project, selected.id, context);
      commit(
        (cur) => applySymbolRemoval(cur, plan, context, alsoInstances),
        `Símbolo “${selected.name}” removido${plan.instances.length ? ` com ${plan.instances.length} instância(s)` : ''}.`,
        () => {
          setSelectedId(undefined);
          back();
        },
      );
    });
  const exportCatalog = (ids?: string[]) =>
    run(() => {
      const text = exportSymbolCatalog(project, ids, producer);
      void Promise.resolve(
        onSaveFile(
          ids?.length === 1
            ? `${definitions.find((d) => d.id === ids[0])!.name}.simbolos.json`
            : 'biblioteca.simbolos.json',
          text,
        ),
      ).then((saved) => {
        if (saved) setInfo('Catálogo exportado.');
      });
    });
  const importCatalog = async (file: File) => {
    if (busy.current) return;
    setError('');
    setInfo('');
    try {
      if (file.size > 64_000_000) throw new Error('Catálogo grande demais.');
      const catalog = parseSymbolCatalog(await file.text());
      const plan = previewCatalogImport(project, catalog, duplicates);
      if (!plan.added.length)
        throw new Error(
          `Nada importado: ${plan.skipped.length} nome(s) já existem na biblioteca.`,
        );
      const note = [
        `${plan.added.length} símbolo(s) importado(s)`,
        plan.renamed.length
          ? `${plan.renamed.length} renomeado(s) (${plan.renamed.map((r) => `${r.from} → ${r.to}`).join(', ')})`
          : '',
        plan.skipped.length ? `${plan.skipped.length} ignorado(s)` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      commit((cur) => applyCatalogImport(cur, plan), `${note}.`);
    } catch (e) {
      busy.current = false;
      setError(
        e instanceof Error
          ? e.message
          : 'Catálogo de símbolos inválido; nada foi importado.',
      );
    }
  };

  return (
    <dialog
      ref={dialog}
      className="cad-settings symbol-library"
      aria-label="Biblioteca de símbolos"
      onCancel={(e) => {
        // Esc steps back one stage; only the library stage closes the dialog.
        e.preventDefault();
        if (stage === 'library') onClose();
        else back();
      }}
    >
      <header>
        <h2>Biblioteca de símbolos</h2>
        <span>
          {definitions.length} símbolo(s) · apenas definições criadas ou
          importadas por você
        </span>
      </header>
      {stage === 'library' && (
        <div className="symbol-layout">
          <section aria-label="Símbolos">
            <label className="field">
              Pesquisar por nome ou categoria
              <input
                aria-label="Pesquisar símbolos"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <ul className="symbol-list" aria-label="Lista de símbolos">
              {shown.map((d) => (
                <li key={d.id}>
                  <button
                    aria-pressed={d.id === selectedId}
                    onClick={() => {
                      setSelectedId(d.id);
                      setInstanceId(undefined);
                    }}
                  >
                    <SymbolPreview
                      primitives={d.primitives}
                      label={`Prévia de ${d.name}`}
                      size={44}
                    />
                    <span>
                      <b>{d.name}</b>
                      <small>
                        {d.category || 'Sem categoria'} ·{' '}
                        {instancesOf(project, d.id).length} instância(s)
                      </small>
                    </span>
                  </button>
                </li>
              ))}
              {!shown.length && (
                <li className="symbol-empty">
                  {definitions.length
                    ? 'Nenhum símbolo corresponde à pesquisa.'
                    : 'A biblioteca está vazia. Crie um símbolo a partir das entidades da máscara ativa ou importe um catálogo.'}
                </li>
              )}
            </ul>
            <div className="symbol-actions">
              <button
                className="primary"
                disabled={!activeMask}
                title={
                  activeMask
                    ? undefined
                    : 'Ative uma máscara para escolher entidades.'
                }
                onClick={() => openForm()}
              >
                Novo símbolo…
              </button>
              <label className="field inline">
                Nomes repetidos na importação
                <select
                  aria-label="Nomes repetidos na importação"
                  value={duplicates}
                  onChange={(e) =>
                    setDuplicates(e.target.value as CatalogDuplicates)
                  }
                >
                  <option value="rename">Renomear (Nome (2))</option>
                  <option value="skip">Ignorar</option>
                </select>
              </label>
              <button onClick={() => fileInput.current?.click()}>
                Importar catálogo…
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                hidden
                aria-label="Arquivo do catálogo de símbolos"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void importCatalog(file);
                }}
              />
              <button
                disabled={!definitions.length}
                onClick={() => exportCatalog()}
              >
                Exportar catálogo
              </button>
            </div>
          </section>
          <section aria-label="Detalhes do símbolo">
            {selected ? (
              <>
                <SymbolPreview
                  primitives={selected.primitives}
                  label={`Prévia ampliada de ${selected.name}`}
                  size={180}
                />
                <h3>{selected.name}</h3>
                <p>
                  {selected.category || 'Sem categoria'} ·{' '}
                  {selected.primitives.length} entidade(s) · revisão{' '}
                  {selected.revision}
                </p>
                <div className="symbol-actions">
                  <button
                    className="primary"
                    onClick={() => {
                      setMode('instance');
                      setLayerId(defaultInstanceLayer(project));
                      setError('');
                      setStage('insert');
                    }}
                  >
                    Inserir…
                  </button>
                  <button onClick={() => openForm(selected)}>Editar…</button>
                  <button
                    onClick={() => {
                      setAlsoInstances(false);
                      setError('');
                      setStage('remove');
                    }}
                  >
                    Remover…
                  </button>
                  <button onClick={() => exportCatalog([selected.id])}>
                    Exportar este
                  </button>
                </div>
                <h4>Instâncias ({instances.length})</h4>
                {instances.length ? (
                  <ul className="symbol-instances" aria-label="Instâncias">
                    {instances.map((i, n) => (
                      <li key={i.id}>
                        <button
                          aria-pressed={i.id === instanceId}
                          onClick={() => {
                            setInstanceId(i.id);
                            setX(String(i.origin.x));
                            setY(String(i.origin.y));
                            setRotation(String(i.rotation));
                            setScale(String(i.scale));
                          }}
                        >
                          #{n + 1} · ({Math.round(i.origin.x)},{' '}
                          {Math.round(i.origin.y)}) · {i.rotation}° · ×{i.scale}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Nenhuma instância no projeto.</p>
                )}
                {instance && (
                  <fieldset className="symbol-transform">
                    <legend>Transformar somente esta instância</legend>
                    <TransformFields
                      x={x}
                      y={y}
                      rotation={rotation}
                      scale={scale}
                      set={{ setX, setY, setRotation, setScale }}
                    />
                    <div className="symbol-actions">
                      <button
                        onClick={() =>
                          run(() => {
                            const t = transform();
                            const next = transformSymbolInstance(
                              project,
                              instance.id,
                              t,
                            );
                            if (next === project)
                              throw new Error('Nenhuma alteração a aplicar.');
                            commit(
                              (cur) =>
                                transformSymbolInstance(cur, instance.id, t),
                              'Instância transformada; as demais não mudaram.',
                            );
                          })
                        }
                      >
                        Aplicar transformação
                      </button>
                      <button
                        disabled={!activeMask}
                        title="Troca a instância por entidades independentes na máscara ativa"
                        onClick={() =>
                          run(() =>
                            commit(
                              (cur) =>
                                detachSymbolInstance(
                                  cur,
                                  instance.id,
                                  maskId,
                                  context,
                                ),
                              'Instância desvinculada em cópia independente.',
                            ),
                          )
                        }
                      >
                        Desvincular em cópia
                      </button>
                      <button
                        onClick={() =>
                          run(() =>
                            commit(
                              (cur) => removeSymbolInstance(cur, instance.id),
                              'Instância removida; a definição permanece.',
                            ),
                          )
                        }
                      >
                        Excluir instância
                      </button>
                    </div>
                  </fieldset>
                )}
              </>
            ) : (
              <p>Escolha um símbolo para ver prévia, inserir ou editar.</p>
            )}
          </section>
        </div>
      )}
      {stage === 'form' && (
        <section
          className="symbol-form"
          aria-label={editing ? 'Editar símbolo' : 'Novo símbolo'}
        >
          <h3>{editing ? 'Editar definição' : 'Novo símbolo'}</h3>
          <label className="field">
            Nome
            <input
              aria-label="Nome do símbolo"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            Categoria
            <input
              aria-label="Categoria do símbolo"
              value={category}
              maxLength={60}
              onChange={(e) => setCategory(e.target.value)}
            />
          </label>
          {editing && (
            <label className="symbol-check">
              <span>
                <input
                  type="checkbox"
                  checked={replaceGeometry}
                  onChange={(e) => setReplaceGeometry(e.target.checked)}
                />{' '}
                Substituir a geometria pela seleção abaixo
              </span>
            </label>
          )}
          {(!editing || replaceGeometry) && (
            <>
              <p>
                Entidades da máscara ativa{' '}
                <strong>{activeMask?.name ?? '— nenhuma —'}</strong> ·{' '}
                {picked.length} selecionada(s). Aço e outras máscaras não
                participam.
              </p>
              <label className="field">
                Pesquisar entidades
                <input
                  aria-label="Pesquisar entidades do símbolo"
                  value={entityQuery}
                  onChange={(e) => setEntityQuery(e.target.value)}
                />
              </label>
              <div
                className="mask-manip-list"
                role="group"
                aria-label="Entidades da máscara ativa"
              >
                {entityRows.map((e) => (
                  <label key={e.ref.key}>
                    <input
                      type="checkbox"
                      checked={picked.some(
                        (r) => r.primitive === e.ref.primitive,
                      )}
                      onChange={() => toggle(e.ref)}
                    />
                    {e.label}
                    {!e.editable ? ' · protegido' : ''}
                  </label>
                ))}
              </div>
              <div className="symbol-actions">
                <button
                  onClick={() =>
                    setPicked(
                      entityRows.filter((e) => e.editable).map((e) => e.ref),
                    )
                  }
                >
                  Selecionar listadas
                </button>
                <button onClick={() => setPicked([])}>Limpar seleção</button>
              </div>
              <fieldset className="symbol-transform">
                <legend>Ponto base (mm, no modelo)</legend>
                <label className="field">
                  X
                  <input
                    aria-label="Ponto base X"
                    value={baseX}
                    onChange={(e) => setBaseX(e.target.value)}
                  />
                </label>
                <label className="field">
                  Y
                  <input
                    aria-label="Ponto base Y"
                    value={baseY}
                    onChange={(e) => setBaseY(e.target.value)}
                  />
                </label>
                <button
                  onClick={() =>
                    onPick({ kind: 'base', rotation: 0, scale: 1 })
                  }
                >
                  Escolher no desenho
                </button>
                <button onClick={useSelectionBase}>
                  Canto inferior esquerdo da seleção
                </button>
              </fieldset>
              {pickedPrimitives.length > 0 && (
                <small>
                  O símbolo é guardado com a posição, a rotação e a escala
                  atuais da máscara aplicadas, relativo ao ponto base.
                </small>
              )}
            </>
          )}
          {impact?.geometryChanged && (
            <p role="status" className="symbol-impact">
              {impact.affected.length
                ? `Esta edição atualiza ${impact.affected.length} instância(s) ao confirmar.`
                : 'Nenhuma instância usa este símbolo ainda.'}
            </p>
          )}
        </section>
      )}
      {stage === 'insert' && selected && (
        <section className="symbol-form" aria-label="Inserir símbolo">
          <h3>Inserir “{selected.name}”</h3>
          <label className="field">
            Tipo de inserção
            <select
              aria-label="Tipo de inserção"
              value={mode}
              onChange={(e) => setMode(e.target.value as SymbolInsertMode)}
            >
              <option value="instance">
                Instância vinculada à definição (padrão)
              </option>
              <option value="copy">Cópia independente na máscara ativa</option>
            </select>
          </label>
          <p className="field-help">
            {mode === 'instance'
              ? 'A instância reutiliza a definição: editar o símbolo atualiza todas. Posição, rotação e escala são só dela.'
              : 'Entidades novas, sem vínculo: editar a definição não as altera.'}
          </p>
          <TransformFields
            x={x}
            y={y}
            rotation={rotation}
            scale={scale}
            set={{ setX, setY, setRotation, setScale }}
          />
          {mode === 'instance' && (
            <label className="field">
              Layer
              <select
                aria-label="Layer da instância"
                value={layerId}
                onChange={(e) => setLayerId(e.target.value)}
              >
                {project.layers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="symbol-actions">
            <button
              onClick={() => {
                const rot = num(rotation),
                  sc = num(scale);
                onPick({
                  kind: 'place',
                  definition: selected,
                  layerId,
                  rotation: Number.isFinite(rot) ? rot : 0,
                  scale: Number.isFinite(sc) && sc > 0 ? sc : 1,
                });
              }}
            >
              Escolher posição no desenho
            </button>
          </div>
          {insertPreview ? (
            <SymbolPreview
              primitives={insertPreview}
              label="Prévia da inserção"
              size={160}
            />
          ) : (
            <p role="status">Informe valores numéricos válidos.</p>
          )}
        </section>
      )}
      {stage === 'remove' && selected && (
        <section className="symbol-form" aria-label="Remover símbolo">
          <h3>Remover “{selected.name}”</h3>
          {instances.length ? (
            <>
              <p role="status">
                {instances.length} instância(s) usam este símbolo no projeto.
                Remover a definição remove também todas elas, em uma só operação
                desfazível. Cópias independentes e o aço não são afetados.
              </p>
              <label className="symbol-check">
                <span>
                  <input
                    type="checkbox"
                    checked={alsoInstances}
                    onChange={(e) => setAlsoInstances(e.target.checked)}
                  />{' '}
                  Remover também as {instances.length} instância(s)
                </span>
              </label>
            </>
          ) : (
            <p>Nenhuma instância usa este símbolo.</p>
          )}
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      {info && <p role="status">{info}</p>}
      <footer>
        {stage === 'library' ? (
          <button onClick={onClose}>Fechar</button>
        ) : (
          <>
            <button onClick={back}>Cancelar</button>
            {stage === 'form' && (
              <button
                className="primary"
                onClick={submitForm}
                disabled={!editing && !picked.length}
              >
                {editing ? 'Aplicar edição' : 'Salvar símbolo'}
              </button>
            )}
            {stage === 'insert' && (
              <button
                className="primary"
                onClick={submitInsert}
                disabled={!insertPreview}
              >
                Inserir
              </button>
            )}
            {stage === 'remove' && (
              <button
                className="primary"
                onClick={submitRemove}
                disabled={!!instances.length && !alsoInstances}
              >
                Remover símbolo
              </button>
            )}
          </>
        )}
      </footer>
    </dialog>
  );
}

function TransformFields({
  x,
  y,
  rotation,
  scale,
  set,
}: {
  x: string;
  y: string;
  rotation: string;
  scale: string;
  set: {
    setX: (v: string) => void;
    setY: (v: string) => void;
    setRotation: (v: string) => void;
    setScale: (v: string) => void;
  };
}) {
  return (
    <div className="symbol-fields">
      <label className="field">
        X (mm)
        <input
          aria-label="Posição X"
          value={x}
          onChange={(e) => set.setX(e.target.value)}
        />
      </label>
      <label className="field">
        Y (mm)
        <input
          aria-label="Posição Y"
          value={y}
          onChange={(e) => set.setY(e.target.value)}
        />
      </label>
      <label className="field">
        Rotação (°)
        <input
          aria-label="Rotação"
          value={rotation}
          onChange={(e) => set.setRotation(e.target.value)}
        />
      </label>
      <label className="field">
        Escala
        <input
          aria-label="Escala"
          value={scale}
          onChange={(e) => set.setScale(e.target.value)}
        />
      </label>
    </div>
  );
}
