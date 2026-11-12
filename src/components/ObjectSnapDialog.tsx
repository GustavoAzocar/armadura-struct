import { useEffect, useRef, useState } from 'react';
import {
  defaultSnapModes,
  snapModeLabels,
  type SnapMode,
  type SnapModes,
} from '../domain/objectSnaps';

const descriptions: Record<SnapMode, string> = {
  endpoint: 'Vértices e extremidades disponíveis no desenho.',
  midpoint: 'Meio de cada trecho disponível.',
  center: 'Centro de círculos e arcos analíticos.',
  geometricCenter: 'Centro de área de um contorno fechado válido.',
  quadrant: 'Pontos a 0°, 90°, 180° e 270° dentro da curva.',
  intersection: 'Cruzamento real entre trechos ou curvas finitos.',
  nearest: 'Projeção mais próxima na geometria disponível.',
  insertion: 'Âncora preservada de um texto.',
  node: 'Somente objetos de ponto identificáveis.',
  perpendicular: 'Pé perpendicular a partir do ponto-base do comando.',
  tangent: 'Tangência a círculo ou arco a partir de uma base exterior.',
};
export default function ObjectSnapDialog({
  modes,
  onApply,
  onClose,
}: {
  modes: Readonly<SnapModes>;
  onApply: (modes: SnapModes) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState({ ...modes });
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      if (old?.isConnected) old.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal snap-modes-dialog"
      aria-labelledby="snap-modes-title"
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
      <header>
        <h2 id="snap-modes-title">Modos de encaixe</h2>
        <button aria-label="Fechar modos de encaixe" onClick={onClose}>
          ×
        </button>
      </header>
      <p>
        Escolhas desta sessão. O comando Encaixes liga ou desliga todos os modos
        escolhidos e mantém seu atalho configurável.
      </p>
      <fieldset className="snap-mode-grid">
        <legend>Capturar no CAD 2D</legend>
        {(Object.keys(snapModeLabels) as SnapMode[]).map((mode) => (
          <label key={mode}>
            <input
              type="checkbox"
              aria-label={snapModeLabels[mode]}
              aria-describedby={`snap-mode-description-${mode}`}
              checked={draft[mode]}
              onChange={(e) =>
                setDraft((old) => ({ ...old, [mode]: e.target.checked }))
              }
            />
            <span>
              <strong>{snapModeLabels[mode]}</strong>
              <small id={`snap-mode-description-${mode}`}>
                {descriptions[mode]}
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="muted">
        Pontos discretos têm prioridade sobre Ponto mais próximo. Curvas
        importadas amostradas oferecem apenas a geometria retida. ORTO mantém
        sua precedência.
      </p>
      <footer>
        <button onClick={() => setDraft({ ...defaultSnapModes })}>
          Restaurar padrões
        </button>
        <button onClick={onClose}>Cancelar</button>
        <button
          className="primary"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          Aplicar modos
        </button>
      </footer>
    </dialog>
  );
}
