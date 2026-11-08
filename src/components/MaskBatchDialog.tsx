import { useEffect, useRef, useState } from 'react';
import type { Mask, Project } from '../domain/types';
import { uid } from '../domain/types';
import {
  createHierarchyNode,
  detailPath,
  type HierarchyKind,
} from '../domain/hierarchy';
import {
  MASK_LIMIT,
  PROJECT_BYTE_LIMIT,
  maskProjectBytes,
  type MaskBatchContext,
  type MaskAssignment,
} from '../domain/maskBatch';
import {
  importMask,
  maskFileSources,
  pickNativeMaskFiles,
  type MaskSource,
} from '../lib/files';

type Row = {
  id: string;
  source: MaskSource;
  detailId: string;
  status: 'queued' | 'reading' | 'ready' | 'error';
  mask?: Mask;
  error?: string;
  include: boolean;
  unitConfirmed: boolean;
};
export type MaskBatchRequest = {
  token: string;
  base: Project;
  context: MaskBatchContext;
  owner: string;
  fromSheet: boolean;
  sources?: MaskSource[];
  mode: 'import' | 'associate';
};
export default function MaskBatchDialog({
  request: r,
  onClose,
  onContext,
  onGeneral,
  onImport,
  onAssociate,
}: {
  request: MaskBatchRequest;
  onClose: () => void;
  onContext: (owner: string) => void;
  onGeneral: () => void;
  onImport: (draft: Project, items: MaskAssignment[]) => boolean;
  onAssociate: (ids: string[], owner: string, mode: 'move' | 'copy') => boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(r.base),
    [owner, setOwner] = useState(r.owner);
  const [rows, setRows] = useState<Row[]>(() =>
    (r.sources ?? []).map((source) => ({
      id: uid(),
      source,
      detailId: r.owner,
      status: 'queued',
      include: true,
      unitConfirmed: false,
    })),
  );
  const liveRows = useRef(rows);
  liveRows.current = rows;
  const [reading, setReading] = useState(false),
    [picking, setPicking] = useState(false),
    [error, setError] = useState(''),
    [partial, setPartial] = useState(false);
  const [ids, setIds] = useState<string[]>([]),
    [mode, setMode] = useState<'move' | 'copy'>('move');
  const [kind, setKind] = useState<HierarchyKind>('detail'),
    [parent, setParent] = useState(
      r.base.hierarchy.details.find((d) => d.id === r.owner)?.elementId ??
        r.base.hierarchy.elements[0].id,
    ),
    [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const alive = useRef(true),
    controller = useRef<AbortController | null>(null),
    submitting = useRef(false),
    pickerGuard = useRef(false);
  const slots = MASK_LIMIT - r.base.masks.length;
  const patch = (id: string, value: Partial<Row>) =>
    setRows((old) => old.map((q) => (q.id === id ? { ...q, ...value } : q)));
  const options = draft.hierarchy.details.map((d) => (
    <option key={d.id} value={d.id}>
      {detailPath(draft, d.id)} [{d.id.slice(0, 8)}]
    </option>
  ));
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement,
      el = dialog.current!;
    el.showModal();
    return () => {
      alive.current = false;
      controller.current?.abort();
      el.close();
      if (previous?.isConnected) previous.focus();
      else
        document
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Controle de máscaras"]',
          )
          ?.focus();
    };
  }, []);
  const add = (sources: MaskSource[]) => {
    setPartial(false);
    setRows((old) => [
      ...old,
      ...sources.map(
        (source): Row => ({
          id: uid(),
          source,
          detailId: owner,
          status: 'queued',
          include: true,
          unitConfirmed: false,
        }),
      ),
    ]);
  };
  const pick = async () => {
    if (pickerGuard.current) return;
    pickerGuard.current = true;
    setPicking(true);
    try {
      const sources = await pickNativeMaskFiles();
      if (!alive.current) return;
      if (sources === undefined) input.current?.click();
      else if (sources) add(sources);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      pickerGuard.current = false;
      if (alive.current) setPicking(false);
    }
  };
  const read = async () => {
    if (controller.current || r.fromSheet || rows.length > slots) return;
    const abort = new AbortController();
    controller.current = abort;
    setReading(true);
    setError('');
    // One source buffer and worker at a time. Normalized staged content shares the document size budget.
    const baseBytes = maskProjectBytes(r.base);
    let stagedBytes = rows.reduce(
      (sum, row) => sum + (row.mask ? maskProjectBytes(row.mask) : 0),
      0,
    );
    try {
      for (const row of rows.filter((q) => q.status === 'queued')) {
        if (abort.signal.aborted || !alive.current) break;
        if (!liveRows.current.some((q) => q.id === row.id)) continue;
        patch(row.id, { status: 'reading' });
        try {
          const file = await row.source.load(abort.signal);
          abort.signal.throwIfAborted();
          const mask = await importMask(file, abort.signal);
          abort.signal.throwIfAborted();
          if (!liveRows.current.some((q) => q.id === row.id)) continue;
          const bytes = maskProjectBytes(mask);
          if (baseBytes + stagedBytes + bytes > PROJECT_BYTE_LIMIT)
            throw new Error(
              'O conteúdo normalizado excederia 100 MB. Retire/simplifique arquivos e prepare outro lote.',
            );
          stagedBytes += bytes;
          patch(row.id, {
            status: 'ready',
            mask,
            unitConfirmed: mask.sourceUnit !== 'não declarada',
          });
        } catch (e) {
          if (abort.signal.aborted) break;
          patch(row.id, {
            status: 'error',
            include: false,
            error: (e as Error).message,
          });
        }
      }
    } finally {
      controller.current = null;
      if (alive.current) {
        setReading(false);
        setRows((old) =>
          old.map((q) =>
            q.status === 'reading' ? { ...q, status: 'queued' } : q,
          ),
        );
      }
    }
  };
  const create = () => {
    try {
      if (r.context.scopeDetailId)
        throw new Error('Abra o modelo geral para preparar novos destinos.');
      const result = createHierarchyNode(
        draft,
        kind,
        name,
        kind === 'floor' ? undefined : parent,
      );
      setDraft(result.project);
      setName('');
      setError('');
      if (kind === 'floor') {
        setKind('element');
        setParent(result.id);
      } else if (kind === 'element') {
        setKind('detail');
        setParent(result.id);
      } else setOwner(result.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const chosen = rows.filter((q) => q.include),
    failures = rows.filter((q) => q.status === 'error');
  const apply = () => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      if (reading || picking || r.fromSheet)
        throw new Error('Conclua a leitura e abra o desenho antes de aplicar.');
      if (r.mode === 'associate') {
        if (!onAssociate(ids, owner, mode))
          throw new Error(
            'Associação bloqueada; confira a mensagem e o contexto.',
          );
      } else {
        if (rows.some((q) => q.status === 'queued' || q.status === 'reading'))
          throw new Error(
            'Leia ou retire os arquivos pendentes antes de aplicar.',
          );
        if (failures.length && !partial)
          throw new Error(
            'Confirme explicitamente a importação somente dos válidos ou retire as falhas.',
          );
        if (
          !chosen.length ||
          chosen.some(
            (q) => q.status !== 'ready' || !q.mask || !q.unitConfirmed,
          )
        )
          throw new Error(
            'Escolha arquivos válidos e confirme a unidade de cada um.',
          );
        if (
          !onImport(
            draft,
            chosen.map((q) => ({ mask: q.mask!, detailId: q.detailId })),
          )
        )
          throw new Error('Lote bloqueado; confira a mensagem e os destinos.');
      }
    } catch (e) {
      setError((e as Error).message);
      submitting.current = false;
    }
  };
  return (
    <dialog
      ref={dialog}
      className="modal mask-batch"
      aria-label={
        r.mode === 'import' ? 'Importar máscaras em lote' : 'Associar máscaras'
      }
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (
          (e.ctrlKey || e.metaKey) &&
          ['s', 'o', 'z', 'y'].includes(e.key.toLowerCase())
        )
          e.preventDefault();
      }}
    >
      <h2>
        {r.mode === 'import'
          ? 'Importar máscaras em lote'
          : 'Associar máscaras'}
      </h2>
      <p>
        Referências pertencem ao detalhamento. O desenho pode aparecer em várias
        pranchas, sem copiar a máscara ou o aço. Tudo abaixo permanece em
        preparação até aplicar.
      </p>
      <div className="fields-2">
        <label className="field">
          Destino completo
          <select
            aria-label="Destino do lote"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="">Escolha um detalhamento</option>
            {options}
          </select>
        </label>
        <div>
          <p className="field-help">
            {owner ? detailPath(draft, owner) : 'Nenhum destino escolhido'}
          </p>
          {r.mode === 'import' && (
            <button
              disabled={!owner || reading}
              onClick={() =>
                setRows((old) => old.map((q) => ({ ...q, detailId: owner })))
              }
            >
              Aplicar destino a todos
            </button>
          )}
        </div>
      </div>
      {r.fromSheet && (
        <div className="notice">
          <p>
            Você está na prancha. Escolha explicitamente o desenho da vista ou
            outro detalhamento antes da leitura; coordenadas de papel não serão
            usadas.
          </p>
          <button
            disabled={
              !owner || !r.base.hierarchy.details.some((d) => d.id === owner)
            }
            onClick={() => onContext(owner)}
          >
            Abrir desenho da vista / destino
          </button>
        </div>
      )}
      {r.context.scopeDetailId && (
        <div className="notice">
          <p>
            Edição isolada: {detailPath(r.base, r.context.scopeDetailId)}. Para
            distribuir entre detalhamentos, deixe esse contexto explicitamente.
          </p>
          <button disabled={reading} onClick={onGeneral}>
            Trabalhar no modelo geral
          </button>
        </div>
      )}
      {r.mode === 'import' ? (
        <>
          <input
            ref={input}
            type="file"
            accept=".dxf,.dwg"
            multiple
            hidden
            data-testid="batch-mask-input"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              add(maskFileSources(files));
            }}
          />
          <div className="batch-actions">
            <button onClick={pick} disabled={reading || picking || r.fromSheet}>
              Escolher DXF/DWG
            </button>
            <button
              disabled={
                reading ||
                picking ||
                r.fromSheet ||
                !rows.some((q) => q.status === 'queued') ||
                rows.length > slots
              }
              onClick={read}
            >
              Ler arquivos
            </button>
            {reading && (
              <button onClick={() => controller.current?.abort()}>
                Interromper leitura
              </button>
            )}
            <span role="status">
              {rows.filter((q) => q.status === 'ready').length} prontos ·{' '}
              {failures.length} falhas · {r.base.masks.length}/20 já no projeto
              {reading ? ' · Lendo um arquivo por vez…' : ''}
            </span>
          </div>
          {rows.length > slots && (
            <p role="alert">
              O lote tem {rows.length} arquivos e restam {slots} vagas. Retire
              itens antes da leitura; nenhum será ignorado.
            </p>
          )}
          <div className="batch-rows">
            {rows.map((row, index) => (
              <fieldset key={row.id} data-testid="mask-batch-row">
                <legend>
                  {index + 1}. {row.source.name} ·{' '}
                  {row.source.name.split('.').at(-1)?.toUpperCase()}
                </legend>
                <div className="batch-actions">
                  <label>
                    <input
                      aria-label={`Incluir ${row.source.name}`}
                      type="checkbox"
                      checked={row.include}
                      disabled={row.status === 'error'}
                      onChange={(e) =>
                        patch(row.id, { include: e.target.checked })
                      }
                    />{' '}
                    Incluir
                  </label>
                  <span>
                    {
                      {
                        queued: 'Aguardando leitura',
                        reading: 'Lendo…',
                        ready: 'Pronto',
                        error: 'Falha',
                      }[row.status]
                    }
                  </span>
                  <button
                    disabled={row.status === 'reading'}
                    onClick={() => {
                      setRows((old) => old.filter((q) => q.id !== row.id));
                      setPartial(false);
                    }}
                  >
                    Retirar arquivo {index + 1}
                  </button>
                </div>
                <label className="field">
                  Detalhamento do arquivo
                  <select
                    aria-label={`Destino do arquivo ${index + 1}`}
                    value={row.detailId}
                    onChange={(e) =>
                      patch(row.id, { detailId: e.target.value })
                    }
                  >
                    <option value="">Escolha um destino</option>
                    {options}
                  </select>
                </label>
                {row.mask && (
                  <>
                    <div className="fields-2">
                      <label className="field">
                        Nome da referência
                        <input
                          aria-label={`Nome da máscara ${index + 1}`}
                          maxLength={200}
                          value={row.mask.name}
                          onChange={(e) =>
                            patch(row.id, {
                              mask: { ...row.mask!, name: e.target.value },
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        Fator para mm do modelo
                        <input
                          aria-label={`Escala do arquivo ${index + 1}`}
                          type="number"
                          min="0.000001"
                          step="any"
                          value={row.mask.scale}
                          onChange={(e) =>
                            patch(row.id, {
                              mask: {
                                ...row.mask!,
                                scale: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                    <p>
                      Unidade declarada: {row.mask.sourceUnit} ·{' '}
                      {row.mask.primitives.length} entidades · ID{' '}
                      {row.mask.id.slice(0, 8)}. mm: 1; cm: 10; m: 1000. O fator
                      é aplicado uma única vez; confirme uma distância conhecida
                      no desenho.
                    </p>
                    {row.mask.sourceUnit === 'não declarada' && (
                      <label>
                        <input
                          aria-label={`Confirmar unidade do arquivo ${index + 1}`}
                          type="checkbox"
                          checked={row.unitConfirmed}
                          onChange={(e) =>
                            patch(row.id, { unitConfirmed: e.target.checked })
                          }
                        />{' '}
                        Conferi a unidade não declarada e o fator para mm
                      </label>
                    )}
                    {row.mask.warnings.map((w, i) => (
                      <p className="field-help" key={i}>
                        {w}
                      </p>
                    ))}
                    {[
                      ...r.base.masks,
                      ...rows
                        .filter((q) => q.id !== row.id && q.mask)
                        .map((q) => q.mask!),
                    ].some(
                      (m) =>
                        m.name.toLocaleLowerCase() ===
                        row.mask!.name.toLocaleLowerCase(),
                    ) && (
                      <p className="field-help">
                        Nome repetido: será outra referência com ID próprio.
                        Nada será sobrescrito.
                      </p>
                    )}
                  </>
                )}
                {row.error && <p role="alert">{row.error}</p>}
              </fieldset>
            ))}
          </div>
          {failures.length > 0 && (
            <label>
              <input
                aria-label="Confirmar somente arquivos válidos"
                type="checkbox"
                checked={partial}
                onChange={(e) => setPartial(e.target.checked)}
              />{' '}
              Confirmo importar somente os {chosen.length} válidos selecionados;
              as {failures.length} falhas não serão aplicadas.
            </label>
          )}
          <details>
            <summary>Criar destino em preparação</summary>
            <p>
              Os novos pavimentos, grupos e detalhamentos só entram no projeto
              com o lote. Cada detalhamento recebe seu desenho, sem gerar
              armadura.
            </p>
            <div className="fields-2">
              <label className="field">
                Criar
                <select
                  aria-label="Tipo do novo destino"
                  value={kind}
                  onChange={(e) => {
                    const k = e.target.value as HierarchyKind;
                    setKind(k);
                    setParent(
                      k === 'element'
                        ? draft.hierarchy.floors[0].id
                        : draft.hierarchy.elements[0].id,
                    );
                  }}
                >
                  <option value="floor">Pavimento</option>
                  <option value="element">Grupo de elementos</option>
                  <option value="detail">Detalhamento</option>
                </select>
              </label>
              {kind !== 'floor' && (
                <label className="field">
                  Dentro de
                  <select
                    aria-label="Pai do novo destino"
                    value={parent}
                    onChange={(e) => setParent(e.target.value)}
                  >
                    {(kind === 'element'
                      ? draft.hierarchy.floors
                      : draft.hierarchy.elements
                    ).map((n) => (
                      <option key={n.id} value={n.id}>
                        {'floorId' in n
                          ? `${draft.hierarchy.floors.find((f) => f.id === n.floorId)?.name} / `
                          : ''}
                        {n.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field">
                Nome
                <input
                  aria-label="Nome do novo destino"
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button
                onClick={create}
                disabled={reading || !!r.context.scopeDetailId}
              >
                Preparar destino
              </button>
            </div>
          </details>
          <p className="field-help">
            Cada arquivo inteiro será uma referência; não há divisão automática
            por layer/bloco. Leitura local, até 30 MB e 100 mil entidades por
            arquivo, 20 máscaras no projeto e 100 MB de conteúdo normalizado. Os
            originais não são alterados.
          </p>
        </>
      ) : (
        <>
          <label className="field">
            Pesquisar máscaras
            <input
              aria-label="Pesquisar máscaras para associar"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="batch-rows">
            {r.base.masks
              .filter((m) =>
                `${m.name} ${m.id} ${detailPath(r.base, r.base.hierarchy.objectDetails[m.id])}`
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase()),
              )
              .map((m) => (
                <label className="batch-mask-choice" key={m.id}>
                  <input
                    type="checkbox"
                    aria-label={`Associar ${m.name}`}
                    checked={ids.includes(m.id)}
                    onChange={(e) =>
                      setIds((old) =>
                        e.target.checked
                          ? [...old, m.id]
                          : old.filter((id) => id !== m.id),
                      )
                    }
                  />
                  <span>
                    {m.name} · {m.format} ·{' '}
                    {detailPath(r.base, r.base.hierarchy.objectDetails[m.id])} [
                    {m.id.slice(0, 8)}]
                  </span>
                </label>
              ))}
          </div>
          <label className="field">
            Operação
            <select
              aria-label="Modo de associação"
              value={mode}
              onChange={(e) => setMode(e.target.value as 'move' | 'copy')}
            >
              <option value="move">
                Mover na hierarquia — preservar ID e coordenadas CAD
              </option>
              <option value="copy">
                Copiar referência — novo ID e transformação independente
              </option>
            </select>
          </label>
          <p>
            {ids.length} máscara(s). As vistas dos destinos passam a usar a
            associação escolhida. Mover não é deslocar no CAD. Visibilidade
            local fica no desenho/vista; a opção global da máscara permanece.
            Vínculos de ocultação do contexto anterior são retirados ao mover e
            restaurados com Desfazer. Armaduras existentes não serão alteradas.
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancelar</button>
        <button
          className="primary"
          disabled={reading || picking || r.fromSheet}
          onClick={apply}
        >
          {r.mode === 'import' ? 'Aplicar lote' : 'Aplicar associação'}
        </button>
      </div>
    </dialog>
  );
}
