import { useEffect, useId, useRef, useState } from 'react';
import {
  RECOVERY_INTERVALS,
  type PeriodicRecoverySettings,
} from '../lib/periodicRecoverySettings';
import './PeriodicRecoveryDialog.css';

export type PeriodicRecoveryDialogCopy = {
  id: string;
  name: string;
  copiedAt: number;
  destination: 'folder' | 'local';
  valid: boolean;
};

export default function PeriodicRecoveryDialog({
  settings,
  warning,
  status,
  copies,
  loading,
  error,
  onSave,
  onRestore,
  onChooseFolder,
  onClose,
}: {
  settings: PeriodicRecoverySettings;
  warning?: string;
  status: string;
  copies: readonly PeriodicRecoveryDialogCopy[];
  loading: boolean;
  error?: string;
  onSave: (settings: PeriodicRecoverySettings) => void;
  onRestore: (id: string) => Promise<boolean>;
  onChooseFolder?: () => Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const enabledField = useRef<HTMLInputElement>(null);
  const restoring = useRef(false);
  const [draft, setDraft] = useState(() => ({ ...settings }));
  const [restoringId, setRestoringId] = useState<string>();
  const [saveError, setSaveError] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [selectingFolder, setSelectingFolder] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    enabledField.current?.focus();
    return () => {
      element?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, []);

  async function restore(copyId: string) {
    if (restoring.current || loading) return;
    restoring.current = true;
    setRestoringId(copyId);
    setRestoreError('');
    try {
      if ((await onRestore(copyId)) && dialog.current) onClose();
    } catch (cause) {
      const detail = cause instanceof Error ? ` ${cause.message}` : '';
      if (dialog.current)
        setRestoreError(`Não foi possível recuperar a cópia.${detail}`);
    } finally {
      restoring.current = false;
      if (dialog.current) setRestoringId(undefined);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="modal periodic-recovery-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        if (!restoring.current) onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          (event.ctrlKey || event.metaKey) &&
          ['s', 'o', 'z', 'y'].includes(event.key.toLowerCase())
        )
          event.preventDefault();
      }}
    >
      <h2 id={`${id}-title`}>Salvamento e recuperação</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (restoring.current) return;
          try {
            onSave(draft);
            onClose();
          } catch (cause) {
            const detail = cause instanceof Error ? ` ${cause.message}` : '';
            setSaveError(`A configuração anterior foi mantida.${detail}`);
          }
        }}
      >
        <fieldset disabled={!!restoringId}>
          <legend>Cópias periódicas</legend>
          <div className="periodic-recovery-fields">
            <label className="periodic-recovery-toggle">
              <input
                ref={enabledField}
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => {
                  const enabled = event.currentTarget.checked;
                  setDraft((current) => ({ ...current, enabled }));
                  setSaveError('');
                }}
              />
              Ativar cópias periódicas
            </label>
            <label className="periodic-recovery-interval">
              Intervalo
              <select
                disabled={!draft.enabled}
                value={draft.minutes}
                onChange={(event) => {
                  const minutes = RECOVERY_INTERVALS.find(
                    (value) => String(value) === event.currentTarget.value,
                  );
                  if (minutes === undefined) return;
                  setDraft((current) => ({ ...current, minutes }));
                  setSaveError('');
                }}
              >
                {RECOVERY_INTERVALS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} {minutes === 1 ? 'minuto' : 'minutos'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="periodic-recovery-note">
            Esta preferência vale para este dispositivo. O salvamento atual
            continua ativo.
          </p>
          <p role="status">{status}</p>
          {warning && <p role="alert">{warning}</p>}
          {saveError && <p role="alert">{saveError}</p>}
        </fieldset>
        <section aria-labelledby={`${id}-copies`}>
          <h3 id={`${id}-copies`}>Cópias disponíveis</h3>
          <p className="periodic-recovery-note">
            A recuperação abre uma cópia independente. Para gravá-la, use o
            salvamento do projeto.
          </p>
          {onChooseFolder && (
            <button
              type="button"
              disabled={selectingFolder || !!restoringId}
              onClick={async () => {
                setSelectingFolder(true);
                setRestoreError('');
                try {
                  await onChooseFolder();
                } catch {
                  setRestoreError(
                    'Não foi possível consultar a pasta escolhida.',
                  );
                } finally {
                  setSelectingFolder(false);
                }
              }}
            >
              Consultar pasta…
            </button>
          )}
          {loading && <p role="status">Consultando cópias…</p>}
          {error && <p role="alert">{error}</p>}
          {restoreError && <p role="alert">{restoreError}</p>}
          {!loading && !error && !copies.length && (
            <p>Nenhuma cópia periódica disponível.</p>
          )}
          {copies.length > 0 && (
            <ul className="periodic-recovery-copies" role="list">
              {copies.map((copy, index) => {
                const time = new Date(copy.copiedAt);
                const date = Number.isNaN(time.getTime())
                  ? undefined
                  : time.toISOString();
                const timeLabel = date
                  ? time.toLocaleString('pt-BR')
                  : 'Data indisponível';
                const detailsId = `${id}-copy-${index}`;
                return (
                  <li key={copy.id}>
                    <div id={detailsId}>
                      <strong>{copy.name}</strong>
                      <div className="periodic-recovery-note">
                        {date ? (
                          <time dateTime={date}>{timeLabel}</time>
                        ) : (
                          timeLabel
                        )}
                        {' · '}
                        {copy.destination === 'folder'
                          ? 'Pasta do projeto'
                          : 'Armazenamento local'}
                        {' · '}
                        {copy.valid ? 'Íntegra' : 'Inválida'}
                      </div>
                    </div>
                    {copy.valid && (
                      <button
                        type="button"
                        aria-describedby={detailsId}
                        aria-disabled={!!restoringId || loading}
                        onClick={() => void restore(copy.id)}
                      >
                        {restoringId === copy.id
                          ? 'Recuperando…'
                          : 'Recuperar cópia'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <div className="modal-actions">
          <button type="button" disabled={!!restoringId} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={!!restoringId}>
            Salvar preferências
          </button>
        </div>
      </form>
    </dialog>
  );
}
