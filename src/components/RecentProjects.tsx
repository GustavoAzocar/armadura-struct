import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { recentLabels, type RecentEntry } from '../lib/recentProjects';

const when = (t: number) =>
  new Date(t).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

/** Lista do histórico local. Reabrir sempre pede nova seleção; nada é aberto automaticamente. */
export default function RecentProjects({
  entries,
  desktop,
  busy,
  notice,
  guard,
  onReopen,
  onRemove,
  onClear,
  onClose,
}: {
  entries: RecentEntry[];
  desktop: boolean;
  busy: boolean;
  notice: string;
  guard: {
    reasons: string[];
    choose: (c: 'save' | 'discard' | 'cancel') => void;
  } | null;
  onReopen: (entry: RecentEntry) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const labels = useMemo(() => recentLabels(entries), [entries]);
  const [confirmClear, setConfirmClear] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => closeButton.current?.focus(), []);
  useEffect(() => {
    if (!entries.length) setConfirmClear(false);
  }, [entries.length]);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="modal recent-projects"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recent-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <button
          ref={closeButton}
          type="button"
          className="modal-close"
          aria-label="Fechar Projetos recentes"
          onClick={onClose}
          disabled={busy}
        >
          <X size={19} />
        </button>
        <span className="eyebrow">ARMADURASTRUCT</span>
        <h2 id="recent-title">Projetos recentes</h2>
        <p className="recent-note">
          Histórico local de navegação, separado de autosave e backups. Um item
          não concede acesso ao arquivo:{' '}
          {desktop
            ? 'ao reabrir, o seletor nativo é aberto no último local para você escolher o arquivo ou a pasta novamente.'
            : 'neste navegador o caminho não fica disponível; ao reabrir, você escolhe o arquivo ou a pasta novamente.'}{' '}
          Remover itens ou limpar o histórico não apaga arquivos nem projetos.
        </p>
        {notice && (
          <p className="recent-notice" role="status">
            {notice}
          </p>
        )}
        {guard && (
          <div
            className="recent-guard"
            role="alertdialog"
            aria-label="Alterações não salvas"
          >
            <p>
              {guard.reasons.join(' ')} Abrir outro projeto substituirá o
              projeto atual.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => guard.choose('cancel')}>
                Cancelar
              </button>
              <button type="button" onClick={() => guard.choose('discard')}>
                Abrir sem salvar
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => guard.choose('save')}
              >
                Salvar e abrir
              </button>
            </div>
          </div>
        )}
        {entries.length === 0 ? (
          <p className="recent-empty">Nenhum projeto recente.</p>
        ) : (
          <ul className="recent-list" aria-label="Projetos recentes">
            {entries.map((e) => {
              const label = labels.get(e.key)!;
              return (
                <li key={e.key} className="recent-item">
                  <div className="recent-info">
                    <strong>{label.title}</strong>
                    <span className="recent-meta">
                      {e.kind === 'folder'
                        ? 'Projeto em pasta'
                        : 'Arquivo de projeto'}{' '}
                      · {when(e.openedAt)}
                    </span>
                    <span className="recent-where" title={label.detail}>
                      {label.detail}
                    </span>
                  </div>
                  <div className="recent-actions">
                    <button
                      type="button"
                      disabled={busy || !!guard}
                      aria-label={`Reabrir ${label.title}`}
                      onClick={() => onReopen(e)}
                    >
                      Reabrir…
                    </button>
                    <button
                      type="button"
                      disabled={busy || !!guard}
                      aria-label={`Remover ${label.title} do histórico`}
                      onClick={() => onRemove(e.key)}
                    >
                      Remover
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="modal-actions">
          {entries.length > 0 &&
            (confirmClear ? (
              <>
                <button type="button" onClick={() => setConfirmClear(false)}>
                  Manter histórico
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    onClear();
                    setConfirmClear(false);
                  }}
                >
                  Confirmar limpeza
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmClear(true)}
              >
                Limpar histórico
              </button>
            ))}
          <button type="button" onClick={onClose} disabled={busy}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
