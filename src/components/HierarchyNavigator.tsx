import { detailTitle, barSearchText } from '../domain/detailQuantities';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  Pencil,
  FilePenLine,
} from 'lucide-react';
import type { Project } from '../domain/types';
import {
  createHierarchyNode,
  deleteHierarchyNode,
  moveObjectsToDetail,
  updateHierarchyNode,
  type HierarchyKind,
} from '../domain/hierarchy';
import {
  nextGroupName,
  nextDetailName,
  elementGroups,
  drawingLabel,
} from '../domain/hierarchyPresentation';

const nouns = {
  floor: 'pavimento',
  element: 'grupo',
  detail: 'detalhamento',
};
function groupBy<T>(nodes: T[], parent: (node: T) => string) {
  const result = new Map<string, T[]>();
  for (const node of nodes) {
    const key = parent(node),
      group = result.get(key);
    if (group) group.push(node);
    else result.set(key, [node]);
  }
  return result;
}
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();

export default function HierarchyNavigator({
  project,
  activeDetailId,
  onActive,
  onChange,
  selected,
  search,
  onSearch,
  onEditDetail,
  onSelectDetail,
  onOpenDrawing,
  scopeDetailId,
  onOrganize,
}: {
  project: Project;
  activeDetailId: string;
  onActive: (id: string) => void;
  onChange: (project: Project) => void;
  selected: string[];
  search: string;
  onSearch: (text: string) => void;
  onEditDetail: (id: string) => void;
  onSelectDetail: (id: string) => void;
  onOpenDrawing: (id: string) => void;
  scopeDetailId?: string;
  onOrganize: () => void;
}) {
  const h = project.hierarchy;
  const index = useMemo(() => {
    const floors = new Map(h.floors.map((f) => [f.id, f.name]));
    const elements = new Map(
      h.elements.map((e) => [e.id, `${floors.get(e.floorId)} / ${e.name}`]),
    );
    const paths = new Map(
      h.details.map((d) => [
        d.id,
        `${elements.get(d.elementId)} / ${detailTitle(project, d.id)}`,
      ]),
    );
    const counts = new Map<string, number>();
    for (const id of Object.values(h.objectDetails))
      counts.set(id, (counts.get(id) || 0) + 1);
    return {
      paths,
      counts,
      elements: groupBy(h.elements, (e) => e.floorId),
      details: groupBy(h.details, (d) => d.elementId),
      drawings: groupBy(h.drawings, (d) => d.detailId),
    };
  }, [h]);
  const ids = [...h.floors, ...h.elements, ...h.details].map((n) => n.id);
  const key = `armadurastruct.tree.${project.id}`;
  const [open, setOpen] = useState<string[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) || 'null');
      return Array.isArray(stored) && stored.every((v) => typeof v === 'string')
        ? stored
        : ids;
    } catch {
      return ids;
    }
  });
  const seen = useRef(new Set(ids));
  useEffect(() => {
    const added = ids.filter((id) => !seen.current.has(id));
    if (added.length) {
      const parents = [
        ...h.elements.filter((e) => added.includes(e.id)).map((e) => e.floorId),
        ...h.details
          .filter((d) => added.includes(d.id))
          .map((d) => d.elementId),
      ];
      setOpen((current) => [...new Set([...current, ...added, ...parents])]);
      added.forEach((id) => seen.current.add(id));
    }
  }, [h.floors, h.elements, h.details]);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(open));
    } catch {
      /* Navigation still works without storage. */
    }
  }, [key, open]);
  const [editor, setEditor] = useState<{
    kind: HierarchyKind;
    id?: string;
  } | null>(null);
  const [name, setName] = useState(''),
    [parent, setParent] = useState(''),
    [error, setError] = useState('');
  const [target, setTarget] = useState('');
  useEffect(() => {
    setEditor(null);
    setError('');
  }, [scopeDetailId]);
  const active = h.details.find((d) => d.id === activeDetailId)!;
  const activeElement = h.elements.find((e) => e.id === active.elementId)!;
  const begin = (kind: HierarchyKind, id?: string, parentOverride?: string) => {
    setError('');
    const node =
      kind === 'floor'
        ? h.floors.find((f) => f.id === id)
        : kind === 'element'
          ? h.elements.find((e) => e.id === id)
          : h.details.find((d) => d.id === id);
    const existingParent =
      kind === 'element'
        ? h.elements.find((e) => e.id === id)?.floorId
        : kind === 'detail'
          ? h.details.find((d) => d.id === id)?.elementId
          : undefined;
    const destination =
      parentOverride ||
      existingParent ||
      (kind === 'element' && editor?.kind === 'floor' && editor.id
        ? editor.id
        : kind === 'detail' && editor?.kind === 'element' && editor.id
          ? editor.id
          : kind === 'element'
            ? activeElement.floorId
            : active.elementId);
    setParent(destination);
    setName(
      node?.name ??
        (kind === 'element'
          ? nextGroupName(project, destination)
          : kind === 'detail'
            ? nextDetailName(project, destination)
            : ''),
    );
    setEditor({ kind, id });
  };
  const apply = (change: () => Project) => {
    try {
      onChange(change());
      setError('');
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Não foi possível alterar a hierarquia.',
      );
      return false;
    }
  };
  const query = normalize(search.trim());
  const match = (text: string) => normalize(text).includes(query);
  const objects = [
    ...project.bars.map((b) => ({ id: b.id, text: barSearchText(b) })),
    ...project.masks.map((m) => ({ id: m.id, text: m.name })),
    ...project.annotations.map((a) => ({
      id: a.id,
      text: `${a.kind} ${a.label}`,
    })),
  ];
  const matchingDetails = new Set<string>();
  if (query) {
    for (const [id, path] of index.paths)
      if (match(path)) matchingDetails.add(id);
    for (const object of objects)
      if (match(object.text)) matchingDetails.add(h.objectDetails[object.id]);
  }
  const detailMatches = (id: string) => !query || matchingDetails.has(id);
  const row = (
    kind: HierarchyKind,
    id: string,
    title: string,
    children: React.ReactNode,
    count: number,
  ) => {
    const expanded = !!query || open.includes(id);
    return (
      <div className={`hierarchy-node hierarchy-${kind}`} key={id}>
        <div
          className={`hierarchy-row ${activeDetailId === id ? 'active' : ''}`}
        >
          {kind === 'detail' && (index.drawings.get(id)?.length ?? 0) <= 1 ? (
            <span className="hierarchy-leaf">
              <FilePenLine size={13} />
            </span>
          ) : (
            <button
              type="button"
              aria-label={`${expanded ? 'Recolher' : 'Expandir'} ${nouns[kind]} ${title}`}
              aria-expanded={expanded}
              onClick={() =>
                setOpen((current) =>
                  current.includes(id)
                    ? current.filter((v) => v !== id)
                    : [...current, id],
                )
              }
            >
              {expanded ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
            </button>
          )}
          <button
            type="button"
            className="hierarchy-name"
            title={
              kind === 'detail'
                ? `Abrir ${index.paths.get(id)}`
                : scopeDetailId
                  ? `Expandir ou recolher ${title}`
                  : `Editar ${nouns[kind]} ${title}`
            }
            aria-label={`${kind === 'detail' ? 'Abrir' : scopeDetailId ? 'Consultar' : 'Editar'} ${nouns[kind]} ${title}`}
            onDoubleClick={() => {
              if (kind === 'detail') onEditDetail(id);
            }}
            onClick={() => {
              if (kind === 'detail') {
                const drawing = index.drawings.get(id)?.[0];
                if (drawing) onOpenDrawing(drawing.id);
                else onActive(id);
              } else if (scopeDetailId)
                setOpen((current) =>
                  current.includes(id)
                    ? current.filter((v) => v !== id)
                    : [...current, id],
                );
              else begin(kind, id);
            }}
          >
            {title}
          </button>
          <small>{count}</small>
          {kind === 'detail' ? (
            <button
              type="button"
              className="hierarchy-row-action"
              title="Renomear ou mover detalhamento"
              aria-label={`Editar detalhamento ${title}`}
              disabled={!!scopeDetailId && scopeDetailId !== id}
              onClick={() => {
                begin(kind, id);
                onActive(id);
              }}
            >
              <Pencil size={12} />
            </button>
          ) : (
            <button
              type="button"
              className="hierarchy-row-action"
              title={
                kind === 'floor'
                  ? 'Adicionar grupo neste pavimento'
                  : 'Adicionar detalhamento neste grupo'
              }
              aria-label={`Adicionar ${kind === 'floor' ? 'grupo' : 'detalhamento'} em ${title}`}
              disabled={!!scopeDetailId}
              onClick={() =>
                begin(kind === 'floor' ? 'element' : 'detail', undefined, id)
              }
            >
              <Plus size={12} />
            </button>
          )}
          {kind === 'detail' && (
            <button
              type="button"
              className="detail-edit-button"
              aria-label={`Abrir edição isolada de ${title}`}
              disabled={!!scopeDetailId}
              onClick={() => onEditDetail(id)}
            >
              ↗
            </button>
          )}
        </div>
        {expanded &&
          (kind !== 'detail' || (index.drawings.get(id)?.length ?? 0) > 1) && (
            <div className="hierarchy-children">{children}</div>
          )}
      </div>
    );
  };
  return (
    <section className="hierarchy-navigator" aria-label="Hierarquia do projeto">
      <label className="field">
        <span>Pesquisar no projeto</span>
        <input
          aria-label="Pesquisar no projeto"
          placeholder="Pavimento, grupo, V1, N1…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </label>
      <p className="hierarchy-guide">
        Pavimento → grupo → detalhamento
        <br />
        <small>
          Ex.: Térreo → Vigas → V1. Clique no detalhamento para abrir.
        </small>
      </p>
      {!!scopeDetailId && (
        <p className="hierarchy-guide">
          Navegue entre detalhamentos pelos nomes. Para criar ou mover grupos e
          detalhamentos,{' '}
          <button type="button" onClick={onOrganize}>
            Organizar projeto
          </button>
          .
        </p>
      )}
      <div className="hierarchy-tools">
        {(['floor', 'element', 'detail'] as const).map((kind) => (
          <button
            type="button"
            key={kind}
            aria-label={`Adicionar ${nouns[kind]}`}
            disabled={!!scopeDetailId}
            onClick={() => begin(kind)}
          >
            <Plus size={12} />
            {nouns[kind]}
          </button>
        ))}
      </div>
      <div className="hierarchy-tree">
        {h.floors
          .filter(
            (f) =>
              !query ||
              match(f.name) ||
              (index.elements.get(f.id) || []).some(
                (e) =>
                  match(e.name) ||
                  (index.details.get(e.id) || []).some((d) =>
                    detailMatches(d.id),
                  ),
              ),
          )
          .map((f) =>
            row(
              'floor',
              f.id,
              f.name,
              (index.elements.get(f.id) || [])
                .filter(
                  (e) =>
                    !query ||
                    match(`${f.name} ${e.name}`) ||
                    (index.details.get(e.id) || []).some((d) =>
                      detailMatches(d.id),
                    ),
                )
                .map((e) =>
                  row(
                    'element',
                    e.id,
                    e.name,
                    (index.details.get(e.id) || [])
                      .filter((d) => !query || detailMatches(d.id))
                      .map((d) =>
                        row(
                          'detail',
                          d.id,
                          detailTitle(project, d.id),
                          (index.drawings.get(d.id) || []).map((v) => (
                            <button
                              onClick={() => onOpenDrawing(v.id)}
                              aria-label={`Abrir desenho ${drawingLabel(project, v)}`}
                              className="hierarchy-drawing"
                              key={v.id}
                              title={v.name}
                            >
                              ⌗ {drawingLabel(project, v)}
                            </button>
                          )),
                          index.counts.get(d.id) || 0,
                        ),
                      ),
                    index.details.get(e.id)?.length || 0,
                  ),
                ),
              index.elements.get(f.id)?.length || 0,
            ),
          )}
        {!!query &&
          !h.details.some((d) => detailMatches(d.id)) &&
          !h.floors.some((f) => match(f.name)) &&
          !h.elements.some((e) => match(e.name)) && (
            <p className="tree-empty">Nenhum resultado.</p>
          )}
      </div>
      {editor && (
        <form
          className="hierarchy-editor"
          aria-label={`${editor.id ? 'Editar' : 'Criar'} ${nouns[editor.kind]}`}
          onSubmit={(event) => {
            event.preventDefault();
            if (editor.id) {
              if (
                apply(() =>
                  updateHierarchyNode(
                    project,
                    editor.kind,
                    editor.id!,
                    name,
                    parent,
                  ),
                )
              )
                setEditor(null);
            } else {
              let createdId = '';
              if (
                apply(() => {
                  const created = createHierarchyNode(
                    project,
                    editor.kind,
                    name,
                    parent,
                  );
                  createdId = created.id;
                  return created.project;
                })
              ) {
                if (editor.kind === 'detail') onActive(createdId);
                // Keep the newly created parent selected for the next toolbar action.
                setEditor({ kind: editor.kind, id: createdId });
              }
            }
          }}
        >
          <div className="hierarchy-editor-heading">
            <b>
              {editor.id ? 'Editar' : 'Criar'} {nouns[editor.kind]}
            </b>
            <button
              type="button"
              aria-label="Fechar edição da hierarquia"
              onClick={() => {
                setEditor(null);
                setError('');
              }}
            >
              <X size={12} />
            </button>
          </div>
          <label className="field">
            <span>Nome</span>
            <input
              aria-label={`Nome do ${nouns[editor.kind]}`}
              autoFocus
              placeholder={
                editor.kind === 'floor'
                  ? 'Térreo, Cobertura…'
                  : editor.kind === 'element'
                    ? 'Vigas, Pilares, Lajes…'
                    : 'V1, V2, P1…'
              }
              list={
                editor.kind === 'element' ? 'hierarchy-group-names' : undefined
              }
              value={name}
              maxLength={100}
              required
              onChange={(e) => setName(e.target.value)}
            />
            {editor.kind === 'element' && (
              <datalist id="hierarchy-group-names">
                {elementGroups.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            )}
          </label>
          {editor.kind !== 'floor' && (
            <label className="field">
              <span>
                {editor.kind === 'element' ? 'Pavimento' : 'Grupo de elementos'}
              </span>
              <select
                aria-label={
                  editor.kind === 'element'
                    ? 'Pavimento do grupo'
                    : 'Grupo do detalhamento'
                }
                value={parent}
                disabled={!!scopeDetailId}
                onChange={(e) => setParent(e.target.value)}
              >
                {(editor.kind === 'element'
                  ? h.floors.map((f) => ({ id: f.id, label: f.name }))
                  : h.elements.map((e) => ({
                      id: e.id,
                      label: `${h.floors.find((f) => f.id === e.floorId)?.name} / ${e.name}`,
                    }))
                ).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="hierarchy-tools">
            {editor.id && editor.kind === 'detail' && (
              <button type="button" onClick={() => onSelectDetail(editor.id!)}>
                Selecionar conjunto
              </button>
            )}
            <button type="submit">
              {editor.id ? 'Salvar alterações' : `Criar ${nouns[editor.kind]}`}
            </button>
            {editor.id && (
              <button
                type="button"
                disabled={!!scopeDetailId}
                onClick={() => {
                  if (
                    apply(() =>
                      deleteHierarchyNode(project, editor.kind, editor.id!),
                    )
                  )
                    setEditor(null);
                }}
              >
                Excluir {nouns[editor.kind]}
              </button>
            )}
          </div>
        </form>
      )}
      {!!error && (
        <p className="hierarchy-error" role="alert">
          {error}
        </p>
      )}
      <label className="field context-detail">
        <span>Destino de novos objetos</span>
        <select
          aria-label="Detalhamento ativo"
          value={activeDetailId}
          onChange={(e) => {
            const drawing =
              scopeDetailId &&
              h.drawings.find((d) => d.detailId === e.target.value);
            if (drawing) onOpenDrawing(drawing.id);
            else onActive(e.target.value);
          }}
        >
          {h.details.map((d) => (
            <option key={d.id} value={d.id}>
              {index.paths.get(d.id)}
            </option>
          ))}
        </select>
      </label>
      {!scopeDetailId && !!selected.length && (
        <div className="hierarchy-assignment">
          <label className="field">
            <span>Mover seleção na hierarquia</span>
            <select
              aria-label="Detalhamento de destino"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Escolha o detalhamento</option>
              {h.details.map((d) => (
                <option key={d.id} value={d.id}>
                  {index.paths.get(d.id)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!h.details.some((d) => d.id === target)}
            onClick={() => {
              if (apply(() => moveObjectsToDetail(project, selected, target)))
                onActive(target);
            }}
          >
            Mover seleção
          </button>
        </div>
      )}
    </section>
  );
}
