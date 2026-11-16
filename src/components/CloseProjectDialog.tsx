import { useEffect, useRef } from 'react';

export type CloseProjectGuard = {
  reasons: string[];
  downloadPending?: boolean;
  choose: (c: 'save' | 'discard' | 'cancel') => void;
};

/** Confirmação de Fechar projeto com alterações não salvas. */
export default function CloseProjectDialog({
  projectName,
  folderLabel,
  guard,
  mode = 'close',
}: {
  projectName: string;
  /** Pasta vinculada nesta sessão, quando houver autosave em pasta. */
  folderLabel?: string;
  guard: CloseProjectGuard;
  mode?: 'close' | 'recover';
}) {
  const recovering = mode === 'recover';
  const modal = useRef<HTMLDialogElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = modal.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, []);
  useEffect(() => {
    actions.current?.querySelector('button')?.focus();
  }, [guard]);
  return (
    <dialog
      ref={modal}
      className="modal close-project-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="close-project-title"
      aria-describedby="close-project-reasons"
      onCancel={(e) => {
        e.preventDefault();
        guard.choose('cancel');
      }}
      onPointerDown={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        if (
          e.target === e.currentTarget &&
          (e.clientX < box.left ||
            e.clientX > box.right ||
            e.clientY < box.top ||
            e.clientY > box.bottom)
        )
          guard.choose('cancel');
      }}
    >
      <span className="eyebrow">ARMADURASTRUCT</span>
      <h2 id="close-project-title">
        {recovering ? 'Recuperar cópia' : 'Fechar projeto'}
      </h2>
      <p id="close-project-reasons" className="close-project-reasons">
        <b>{projectName}</b>: {guard.reasons.join(' ')}
      </p>
      <p className="close-project-scope">
        {recovering
          ? guard.downloadPending
            ? 'Confira a cópia baixada antes de continuar. Cancelar mantém as alterações abertas.'
            : 'A cópia selecionada será aberta como outro documento da sessão, sem gravar no arquivo principal.'
          : guard.downloadPending
            ? 'Feche somente depois de conferir a cópia baixada. Cancelar mantém o projeto aberto com suas alterações.'
            : folderLabel
              ? `Fechar sem salvar descarta só as alterações ainda não gravadas. O que o autosave já gravou na pasta (${folderLabel}) permanece.`
              : 'Fechar sem salvar descarta as alterações. A cópia de recuperação local deixa de ser reaberta automaticamente.'}{' '}
        Nenhum arquivo, pasta, referência CAD ou backup é apagado.
      </p>
      <div ref={actions} className="modal-actions">
        <button type="button" onClick={() => guard.choose('cancel')}>
          Cancelar
        </button>
        <button type="button" onClick={() => guard.choose('discard')}>
          {guard.downloadPending
            ? recovering
              ? 'Confirmar download e recuperar'
              : 'Confirmar cópia e fechar'
            : recovering
              ? 'Recuperar sem salvar'
              : 'Fechar sem salvar'}
        </button>
        {!guard.downloadPending && (
          <button
            type="button"
            className="primary"
            onClick={() => guard.choose('save')}
          >
            {recovering ? 'Salvar e recuperar' : 'Salvar e fechar'}
          </button>
        )}
      </div>
    </dialog>
  );
}
