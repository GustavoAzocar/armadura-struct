import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  pluginBridge,
  type PluginBridge,
  type Inspection,
  type InventoryItem,
  type CatalogView,
  type PluginView,
} from '../lib/plugins';
import type { PluginManifest } from '../../public/plugins/v1/types';
import { saveFile } from '../lib/files';
import guide from '../../docs/plugins/DEVELOPERS.md?raw';
import manifestSchema from '../../public/plugins/v1/manifest.schema.json?raw';
const labels: Record<PluginView, string> = {
  store: 'Loja online',
  offline: 'Instalar offline',
  installed: 'Meus plugins',
  develop: 'Desenvolver plugins',
};
const statusNames: Record<InventoryItem['status'], string> = {
  incompatible: 'Incompatível',
  'platform-unavailable': 'Indisponível nesta plataforma',
  'runtime-unsupported': 'Instalado · execução ainda não suportada',
  disabled: 'Desativado',
};
const readSource = () => {
  try {
    return localStorage.getItem('armadurastruct.plugins.catalog') || '';
  } catch {
    return '';
  }
};
function Identity({ manifest: m }: { manifest: PluginManifest }) {
  return (
    <>
      <h3>
        {m.name} <small>v{m.version}</small>
      </h3>
      <p>{m.description}</p>
      <dl className="plugin-facts">
        <dt>Identidade</dt>
        <dd>{m.id}</dd>
        <dt>Editor declarado</dt>
        <dd>
          {m.publisher.name} ({m.publisher.id})
        </dd>
        <dt>Licença</dt>
        <dd>{m.license}</dd>
        <dt>Runtime exigido</dt>
        <dd>{m.runtime.kind}</dd>
        <dt>Plataformas</dt>
        <dd>
          {m.platforms.join(', ')} · {m.architectures.join(', ')}
        </dd>
        <dt>API de plugins</dt>
        <dd>
          ≥ {m.compatibility.pluginApi.min} e &lt;{' '}
          {m.compatibility.pluginApi.maxExclusive}
        </dd>
        <dt>API de armaduras</dt>
        <dd>
          ≥ {m.compatibility.rebarApi.min} e &lt;{' '}
          {m.compatibility.rebarApi.maxExclusive}
        </dd>
        {m.compatibility.app && (
          <>
            <dt>ArmaduraStruct</dt>
            <dd>
              ≥ {m.compatibility.app.min} e &lt;{' '}
              {m.compatibility.app.maxExclusive}
            </dd>
          </>
        )}
        <dt>Capacidades obrigatórias</dt>
        <dd>{m.capabilities.required.join(', ') || 'Nenhuma'}</dd>
        <dt>Capacidades opcionais</dt>
        <dd>{m.capabilities.optional.join(', ') || 'Nenhuma'}</dd>
        <dt>Permissões solicitadas</dt>
        <dd>{m.permissions.join(', ') || 'Nenhuma'}</dd>
      </dl>
    </>
  );
}
export default function PluginsDialog({
  initial,
  onClose,
  bridge = pluginBridge,
}: {
  initial: PluginView;
  onClose: () => void;
  bridge?: PluginBridge;
}) {
  const [view, setView] = useState(initial),
    [source, setSource] = useState(readSource),
    [catalog, setCatalog] = useState<CatalogView>(),
    [inventory, setInventory] = useState<InventoryItem[]>([]),
    [inspection, setInspection] = useState<Inspection>(),
    [remove, setRemove] = useState<InventoryItem>(),
    [notice, setNotice] = useState(''),
    [issue, setIssue] = useState(''),
    [busy, setBusy] = useState('');
  const dialog = useRef<HTMLDialogElement>(null),
    mounted = useRef(false),
    operation = useRef<
      { id: string; cancelled: boolean; mutation: boolean } | undefined
    >(undefined),
    pending = useRef<Inspection | undefined>(undefined);
  pending.current = inspection;
  useEffect(() => {
    mounted.current = true;
    dialog.current?.showModal();
    return () => {
      mounted.current = false;
      const op = operation.current;
      if (op) {
        op.cancelled = true;
        void bridge.cancel(op.id).catch(() => {});
      }
      if (pending.current)
        void bridge.discard(pending.current.token).catch(() => {});
    };
  }, [bridge]);
  async function run<T>(
    label: string,
    task: (id: string) => Promise<T>,
    accept: (result: T) => void,
    mutation = false,
  ) {
    if (operation.current) return;
    const op = { id: crypto.randomUUID(), cancelled: false, mutation };
    operation.current = op;
    setBusy(label);
    setIssue('');
    setNotice('');
    try {
      const result = await task(op.id);
      if (mounted.current && !op.cancelled) accept(result);
      else if (result && typeof result === 'object' && 'token' in result)
        void bridge.discard(String(result.token)).catch(() => {});
    } catch (e) {
      if (mounted.current && !op.cancelled) setIssue(String(e));
    } finally {
      if (operation.current === op) operation.current = undefined;
      if (mounted.current) {
        setBusy('');
        if (op.cancelled) setNotice('Operação cancelada.');
      }
    }
  }
  const cancel = () => {
    const op = operation.current;
    if (op && !op.mutation) {
      op.cancelled = true;
      setNotice('Cancelando…');
      void bridge.cancel(op.id).catch((e) => setIssue(String(e)));
    }
  };
  const discard = () => {
    if (inspection)
      void bridge.discard(inspection.token).catch((e) => setIssue(String(e)));
    setInspection(undefined);
  };
  const close = () => {
    if (operation.current?.mutation) return;
    cancel();
    dialog.current?.close();
    onClose();
  };
  const loadInventory = () =>
    void run('Lendo plugins instalados…', () => bridge.list(), setInventory);
  useEffect(() => {
    if (view === 'installed' && bridge.native) loadInventory();
  }, [view, bridge]);
  const changeView = (next: PluginView) => {
    if (busy) return;
    discard();
    setRemove(undefined);
    setIssue('');
    setNotice('');
    setView(next);
  };
  const acceptInspection = (value: Inspection | null) => {
    setInspection(value || undefined);
    if (!value) setNotice('Seleção cancelada.');
  };
  const install = () => {
    if (!inspection) return;
    const token = inspection.token;
    void run(
      'Registrando plugin…',
      () => bridge.install(token),
      (result) => {
        setInspection(undefined);
        setView('installed');
        setInventory((old) => [
          ...old.filter(
            (p) =>
              p.manifest.id !== result.item.manifest.id ||
              p.manifest.version !== result.item.manifest.version,
          ),
          result.item,
        ]);
        setNotice(
          result.outcome === 'already-installed'
            ? 'Esta versão já está instalada com o mesmo conteúdo.'
            : 'Plugin instalado e desativado. A execução ainda não está disponível.',
        );
      },
      true,
    );
  };
  const querying = busy && !operation.current?.mutation;
  return (
    <dialog
      ref={dialog}
      className="plugins-dialog"
      aria-labelledby="plugins-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <header>
        <div>
          <h2 id="plugins-title">Plugins</h2>
          <p>Extensões para detalhamentos especializados</p>
        </div>
        <button
          type="button"
          aria-label="Fechar plugins"
          onClick={close}
          disabled={!!operation.current?.mutation}
        >
          <X size={18} />
        </button>
      </header>
      <nav role="tablist" aria-label="Gerenciar plugins">
        {(Object.keys(labels) as PluginView[]).map((key, index, keys) => (
          <button
            key={key}
            role="tab"
            id={`plugin-tab-${key}`}
            aria-controls="plugin-panel"
            aria-selected={view === key}
            tabIndex={view === key ? 0 : -1}
            disabled={!!busy}
            onClick={() => changeView(key)}
            onKeyDown={(e) => {
              const delta =
                e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (delta) {
                e.preventDefault();
                const next = keys[(index + delta + keys.length) % keys.length];
                changeView(next);
                document.getElementById(`plugin-tab-${next}`)?.focus();
              }
            }}
          >
            {labels[key]}
          </button>
        ))}
      </nav>
      <div
        id="plugin-panel"
        className="plugins-body"
        role="tabpanel"
        aria-labelledby={`plugin-tab-${view}`}
      >
        {!bridge.native && (
          <p className="plugin-note">
            No navegador, consulte o contrato e o guia. Catálogo, inspeção de
            pacotes e instalação persistente estão disponíveis no ArmaduraStruct
            desktop.
          </p>
        )}
        {view === 'store' && (
          <>
            <h3>Loja online</h3>
            <p>
              Informe uma fonte de catálogo de plugins. Consultar o catálogo não
              instala nem executa extensões.
            </p>
            <label className="plugin-source">
              URL do catálogo HTTPS
              <input
                type="url"
                maxLength={2000}
                value={source}
                disabled={!!busy}
                placeholder="https://seu-dominio/catalog.json"
                onChange={(e) => {
                  setSource(e.target.value);
                  setCatalog(undefined);
                }}
              />
            </label>
            <button
              className="primary"
              disabled={!bridge.native || !!busy || !source.trim()}
              onClick={() => {
                try {
                  localStorage.setItem(
                    'armadurastruct.plugins.catalog',
                    source.trim(),
                  );
                } catch {
                  /* Optional preference. */
                }
                setCatalog(undefined);
                void run(
                  'Consultando catálogo…',
                  (id) => bridge.catalog(source.trim(), id),
                  setCatalog,
                );
              }}
            >
              Consultar catálogo
            </button>
            {!source && (
              <p role="status">
                Nenhuma loja configurada. A instalação offline permanece
                disponível no desktop.
              </p>
            )}
            {catalog && (
              <>
                <p>
                  Fonte: {catalog.source} · {catalog.name} ·{' '}
                  {catalog.publisher.name}
                </p>
                {!catalog.entries.length && (
                  <p role="status">O catálogo está vazio.</p>
                )}
                {catalog.entries.map((entry) => (
                  <article
                    className="plugin-card"
                    key={`${entry.manifest.id}@${entry.manifest.version}`}
                  >
                    <Identity manifest={entry.manifest} />
                    {entry.compatibility.reasons.map((r) => (
                      <p key={r}>{r}</p>
                    ))}
                    {entry.artifacts.map((a) => (
                      <div className="plugin-artifact" key={a.artifact.url}>
                        <p>
                          {a.artifact.platform} / {a.artifact.architecture} ·{' '}
                          {(a.artifact.size / 1024).toFixed(1)} KiB
                          <br />
                          <span>{a.artifact.url}</span>
                        </p>
                        <button
                          className="primary"
                          disabled={!!busy || !a.offerId || !!inspection}
                          onClick={() =>
                            void run(
                              'Baixando e verificando pacote…',
                              (id) => bridge.download(a.offerId!, id),
                              acceptInspection,
                            )
                          }
                        >
                          Baixar e inspecionar
                        </button>
                        {a.reason && <p>{a.reason}</p>}
                      </div>
                    ))}
                  </article>
                ))}
              </>
            )}
          </>
        )}
        {view === 'offline' && (
          <>
            <h3>Instalar offline</h3>
            <p>
              Selecione um arquivo .osplugin para verificar identidade,
              compatibilidade, integridade e permissões antes de confirmar o
              registro.
            </p>
            <button
              className="primary"
              disabled={!bridge.native || !!busy || !!inspection}
              onClick={() =>
                void run(
                  'Inspecionando pacote…',
                  () => bridge.pick(),
                  acceptInspection,
                )
              }
            >
              Selecionar pacote .osplugin
            </button>
          </>
        )}
        {view === 'installed' && (
          <>
            <div className="plugin-row">
              <h3>Meus plugins</h3>
              <button
                disabled={!bridge.native || !!busy}
                onClick={loadInventory}
              >
                Atualizar lista
              </button>
            </div>
            {!busy && !inventory.length && <p>Nenhum plugin instalado.</p>}
            {inventory.map((p) => (
              <article
                className="plugin-card"
                key={`${p.manifest.id}@${p.manifest.version}`}
              >
                <Identity manifest={p.manifest} />
                <strong>{statusNames[p.status]}</strong>
                <p>Origem: {p.origin}</p>
                <p>
                  Integridade SHA-256 verificada. Autoria não verificada.
                  Permissões não concedidas.
                </p>
                {p.compatibility.reasons.map((r) => (
                  <p key={r}>{r}</p>
                ))}
                <details>
                  <summary>Integridade e registro</summary>
                  <p className="plugin-hash">SHA-256: {p.sha256}</p>
                  <p>
                    Instalado em{' '}
                    {new Date(p.installedAt * 1000).toLocaleString('pt-BR')}
                  </p>
                </details>
                {remove === p ? (
                  <div className="plugin-note">
                    <p>
                      Remover {p.manifest.name} v{p.manifest.version}? Os
                      detalhamentos existentes continuarão no projeto.
                    </p>
                    <button
                      className="danger"
                      disabled={!!busy}
                      onClick={() =>
                        void run(
                          'Removendo plugin…',
                          async () => {
                            await bridge.remove(
                              p.manifest.id,
                              p.manifest.version,
                            );
                            return bridge.list();
                          },
                          (items) => {
                            setInventory(items);
                            setRemove(undefined);
                            setNotice('Plugin removido.');
                          },
                          true,
                        )
                      }
                    >
                      Confirmar remoção
                    </button>
                    <button
                      disabled={!!busy}
                      onClick={() => setRemove(undefined)}
                    >
                      Manter plugin
                    </button>
                  </div>
                ) : (
                  <button disabled={!!busy} onClick={() => setRemove(p)}>
                    Remover plugin
                  </button>
                )}
              </article>
            ))}
          </>
        )}
        {view === 'develop' && (
          <>
            <h3>Desenvolver plugins</h3>
            <p>
              O contrato é aberto, versionado e independente de linguagem.
              Qualquer pessoa pode criar e submeter extensões para futura
              revisão do catálogo.
            </p>
            <div className="plugin-row">
              <button
                disabled={!!busy}
                className="primary"
                onClick={() =>
                  void run(
                    'Salvando guia…',
                    () =>
                      saveFile(
                        'ArmaduraStruct-plugins-guia.md',
                        guide,
                        'text/markdown',
                        'md',
                      ),
                    (saved) =>
                      setNotice(
                        saved ? 'Arquivo salvo.' : 'Salvamento cancelado.',
                      ),
                  )
                }
              >
                Salvar guia
              </button>
              <button
                disabled={!!busy}
                onClick={() =>
                  void run(
                    'Salvando schema…',
                    () =>
                      saveFile(
                        'manifest.schema.json',
                        manifestSchema,
                        'application/json',
                        'json',
                      ),
                    (saved) =>
                      setNotice(
                        saved ? 'Arquivo salvo.' : 'Salvamento cancelado.',
                      ),
                  )
                }
              >
                Salvar JSON Schema do manifesto
              </button>
            </div>
            <pre className="plugin-guide">{guide}</pre>
          </>
        )}
        {inspection && (
          <section
            className="plugin-inspection"
            aria-label="Confirmar instalação"
          >
            <h3>Inspeção do pacote</h3>
            <Identity manifest={inspection.manifest} />
            <p>Origem: {inspection.origin}</p>
            <p className="plugin-hash">SHA-256: {inspection.sha256}</p>
            <p>
              {(inspection.size / 1024).toFixed(1)} KiB · Integridade
              verificada; autoria não verificada.
            </p>
            {inspection.compatibility.reasons.map((r) => (
              <p className="error" key={r}>
                {r}
              </p>
            ))}
            {inspection.compatibility.ignoredOptional.length > 0 && (
              <p>
                Capacidades opcionais ignoradas:{' '}
                {inspection.compatibility.ignoredOptional.join(', ')}
              </p>
            )}
            <p>
              O plugin será registrado desativado. Nenhum código será executado
              e nenhuma permissão será concedida nesta versão.
            </p>
            <button
              className="primary"
              disabled={!!busy || !inspection.compatibility.compatible}
              onClick={install}
            >
              Confirmar instalação desativada
            </button>
            <button disabled={!!busy} onClick={discard}>
              Descartar pacote
            </button>
          </section>
        )}
      </div>
      <footer aria-live="polite">
        {busy && <p role="status">{busy}</p>}
        {notice && <p role="status">{notice}</p>}
        {issue && (
          <p role="alert" className="error">
            {issue}
          </p>
        )}
        {querying && <button onClick={cancel}>Cancelar operação</button>}
        <p>
          Instalar não executa plugins. Runtime de terceiros ainda não
          disponível.
        </p>
      </footer>
    </dialog>
  );
}
