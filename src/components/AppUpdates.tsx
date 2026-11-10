import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import {
  canInstallUpdate,
  productUpdateChecker,
  updateBridge,
  updateProgress,
  type UpdateBridge,
  type UpdateSnapshot,
} from '../lib/appUpdates';

const statusNames: Record<UpdateSnapshot['status'], string> = {
  idle: 'Atualizações',
  checking: 'Verificando atualizações…',
  available: 'Atualização disponível',
  current: 'Atualizado',
  error: 'Não foi possível verificar',
  offline: 'Sem conexão',
  unsupported: 'Atualização automática indisponível',
};
export default function AppUpdates({
  ready,
  manualRequest,
  needsSave,
  protect,
  onModal,
  onInstalling,
  bridge = updateBridge,
}: {
  ready: boolean;
  manualRequest: number;
  needsSave: boolean;
  protect: () => Promise<() => void>;
  onModal: (open: boolean) => void;
  onInstalling: (active: boolean) => void;
  bridge?: UpdateBridge;
}) {
  const [state, setState] = useState<UpdateSnapshot>();
  const [checking, setChecking] = useState(false);
  const [consent, setConsent] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  const [open, setOpen] = useState(false),
    [dismissed, setDismissed] = useState<string>(),
    [working, setWorking] = useState(false),
    [issue, setIssue] = useState('');
  const sequence = useRef(0),
    running = useRef(false),
    lastManual = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const accept = (s: UpdateSnapshot) =>
    setState((old) => (!old || s.revision >= old.revision ? s : old));
  const check = async (manual: boolean) => {
    const id = ++sequence.current;
    setIssue('');
    setChecking(true);
    try {
      const s = await productUpdateChecker.check(manual);
      if (id === sequence.current) accept(s);
    } catch (e) {
      if (id === sequence.current) {
        setIssue(String(e));
        setState((old) =>
          old
            ? { ...old, status: 'error', offer: null, message: String(e) }
            : old,
        );
      }
    } finally {
      if (id === sequence.current) setChecking(false);
    }
  };
  useEffect(() => {
    // A manual check supersedes the delayed startup check, including its UI state.
    if (!ready || !bridge.native || manualRequest) return;
    const timer = setTimeout(() => {
      void check(false);
    }, 1200);
    return () => {
      clearTimeout(timer);
      sequence.current++;
    };
  }, [ready, bridge.native, manualRequest]);
  useEffect(() => {
    if (!manualRequest || lastManual.current === manualRequest) return;
    lastManual.current = manualRequest;
    setOpen(true);
    if (bridge.native) void check(true);
    else void bridge.snapshot().then(accept);
  }, [manualRequest, bridge]);
  useEffect(() => {
    onModal(open);
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open, onModal]);
  useEffect(() => {
    if (!working) return;
    let alive = true;
    const timer = setInterval(() => {
      void bridge
        .snapshot()
        .then((s) => {
          if (alive) accept(s);
        })
        .catch(() => {});
    }, 350);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [working, bridge]);
  const close = () => {
    if (working) return;
    setDismissed(state?.offer?.version);
    setOpen(false);
    setConsent(false);
    setIssue('');
  };
  const download = async () => {
    if (running.current || !state?.offer) return;
    setConsent(false);
    running.current = true;
    setWorking(true);
    setIssue('');
    try {
      accept(await bridge.prepare(state.offer.version));
    } catch (e) {
      setIssue(String(e));
    } finally {
      running.current = false;
      setWorking(false);
    }
  };
  const install = async () => {
    if (running.current || !consent || handedOff || !state?.offer) return;
    running.current = true;
    setWorking(true);
    setIssue('');
    let armAttempted = false;
    onInstalling(true);
    try {
      const assertUnchanged = await protect();
      armAttempted = true;
      accept(await bridge.arm(state.offer.version));
      assertUnchanged();
      setHandedOff(true);
      await bridge.finish(state.offer.version);
    } catch (e) {
      setHandedOff(false);
      setConsent(false);
      setIssue(String(e));
      if (armAttempted)
        await bridge
          .cancel()
          .then(accept)
          .catch(() => {});
    } finally {
      running.current = false;
      setWorking(false);
      onInstalling(false);
    }
  };
  useEffect(() => {
    if (!bridge.native) return;
    let alive = true;
    let stop: (() => void) | undefined;
    void import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen('updates-close-blocked', () => {
          if (alive) {
            setOpen(true);
            setIssue(
              'Cancele o download ou conclua a confirmação antes de fechar o aplicativo.',
            );
          }
        }),
      )
      .then((unlisten) => {
        if (alive) stop = unlisten;
        else unlisten();
      });
    return () => {
      alive = false;
      stop?.();
    };
  }, [bridge.native]);
  const offer = state?.offer;
  return (
    <>
      {!open &&
        offer &&
        state.status === 'available' &&
        dismissed !== offer.version && (
          <aside className="update-banner" role="status" aria-live="polite">
            <span>ArmaduraStruct {offer.version} disponível</span>
            <button type="button" onClick={() => setOpen(true)}>
              {canInstallUpdate(state)
                ? 'Instalar atualização'
                : 'Ver atualização'}
            </button>
            <button type="button" onClick={() => setDismissed(offer.version)}>
              Agora não
            </button>
          </aside>
        )}
      <dialog
        ref={dialog}
        className="modal update-dialog"
        aria-labelledby="update-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClose={() => {
          if (!working) setOpen(false);
        }}
      >
        <button
          type="button"
          className="modal-close"
          aria-label="Fechar atualizações"
          disabled={working}
          onClick={close}
        >
          <X size={19} />
        </button>
        <h2 id="update-title">Atualizações do ArmaduraStruct</h2>
        <p role="status">
          {checking
            ? 'Verificando atualizações…'
            : issue && !state
              ? 'Não foi possível verificar'
              : state
                ? statusNames[state.status]
                : 'Atualizações'}
        </p>
        {state && (
          <>
            <p>
              Versão em execução: <strong>{state.currentVersion}</strong>
              {offer && (
                <>
                  {' '}
                  · Nova versão: <strong>{offer.version}</strong>
                </>
              )}
            </p>
            <p>{state.message}</p>
            {state.checkedAt && (
              <small>
                Última consulta concluída:{' '}
                {new Date(state.checkedAt).toLocaleString('pt-BR')}
              </small>
            )}
            {state.receipt && <p>{state.receipt}</p>}
            {offer && (
              <pre className="update-notes">
                {offer.notes || 'Sem notas adicionais nesta publicação.'}
              </pre>
            )}
            {working && (
              <div aria-live="polite">
                <p>
                  {state.phase === 'downloading'
                    ? 'Baixando…'
                    : state.phase === 'verifying'
                      ? 'Verificando pacote…'
                      : 'Preparando instalação…'}
                </p>
                <progress
                  aria-label="Progresso do download"
                  max={100}
                  value={updateProgress(state)}
                />
                <span>
                  {state.received.toLocaleString('pt-BR')} /{' '}
                  {state.total.toLocaleString('pt-BR')} bytes
                </span>
              </div>
            )}
            {['ready', 'armed'].includes(state.phase) && (
              <>
                <label className="update-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    disabled={working || handedOff}
                    onChange={(e) => setConsent(e.target.checked)}
                  />{' '}
                  Autorizo instalar a versão {offer?.version} e reiniciar o
                  aplicativo
                </label>
                <p>
                  Pacote verificado. O aplicativo será fechado e reiniciado.
                  Durante a instalação nativa não será possível cancelar. A
                  versão será confirmada após reiniciar.
                </p>
              </>
            )}
          </>
        )}
        {issue && (
          <p role="alert" className="update-error">
            {issue}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" disabled={working} onClick={close}>
            Agora não
          </button>
          {!working && (
            <button
              type="button"
              disabled={checking}
              onClick={() => void check(true)}
            >
              <RefreshCw size={15} /> Verificar novamente
            </button>
          )}
          {state &&
            canInstallUpdate(state) &&
            !['ready', 'armed'].includes(state.phase) && (
              <button
                type="button"
                className="primary"
                disabled={working}
                onClick={() => void download()}
              >
                <Download size={15} /> Baixar versão {offer!.version}
              </button>
            )}
          {state &&
            canInstallUpdate(state) &&
            ['ready', 'armed'].includes(state.phase) && (
              <button
                type="button"
                className="primary"
                disabled={working || !consent || handedOff}
                onClick={() => void install()}
              >
                {needsSave
                  ? 'Salvar, instalar e reiniciar'
                  : 'Instalar e reiniciar'}
              </button>
            )}
          {working && state?.phase === 'downloading' && (
            <button
              type="button"
              onClick={() => {
                void bridge
                  .cancel()
                  .then(accept)
                  .catch((e) => setIssue(String(e)));
              }}
            >
              Cancelar download
            </button>
          )}
        </div>
      </dialog>
    </>
  );
}
