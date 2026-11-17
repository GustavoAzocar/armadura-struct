import { useEffect, useRef } from 'react';
import type { Project } from '../domain/types';
import { detailPath } from '../domain/hierarchy';
export type MaskBatchReceipt = { ids: string[]; title: string };
export default function MaskBatchResults({
  project,
  receipt,
  onOpen,
  onClose,
  onOrigin,
}: {
  project: Project;
  receipt: MaskBatchReceipt;
  onOpen: (owner: string, id: string) => void;
  onClose: () => void;
  onOrigin?: (id: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement,
      el = ref.current!;
    el.showModal();
    return () => {
      el.close();
      if (old?.isConnected) old.focus();
      else
        document
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Controle de máscaras"]',
          )
          ?.focus();
    };
  }, []);
  const groups = new Map<string, string[]>();
  for (const id of receipt.ids) {
    const owner = project.masks.find((m) => m.id === id)?.independent
      ? 'project:masks'
      : project.hierarchy.objectDetails[id];
    if (owner) groups.set(owner, [...(groups.get(owner) ?? []), id]);
  }
  return (
    <dialog
      ref={ref}
      className="modal mask-batch-results"
      aria-label="Resultado das máscaras"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <h2>{receipt.title}</h2>
      <p>
        Aplicado em uma operação de desfazer/refazer. As armaduras e os
        quantitativos foram preservados. Ao abrir um desenho isolado, conclua
        sua edição e volte ao modelo geral antes de desfazer um lote que abrange
        outros destinos.
      </p>
      {[...groups].map(([owner, ids]) => (
        <div key={owner}>
          <p>
            {owner === 'project:masks'
              ? 'Máscaras independentes do projeto'
              : detailPath(project, owner)}{' '}
            · {ids.length} referência(s)
          </p>
          {onOrigin &&
            ids.map((id) => (
              <button key={id} onClick={() => onOrigin(id)}>
                Selecionar origem:{' '}
                {project.masks.find((m) => m.id === id)?.name}
              </button>
            ))}
          <button onClick={() => onOpen(owner, ids[0])}>
            Abrir resultado:{' '}
            {owner === 'project:masks'
              ? 'Máscaras independentes do projeto'
              : detailPath(project, owner)}
          </button>
        </div>
      ))}
      <div className="modal-actions">
        <button onClick={onClose}>Fechar</button>
      </div>
    </dialog>
  );
}
