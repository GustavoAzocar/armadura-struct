import { useEffect, useRef } from 'react';
export type ContextAction =
  | 'properties'
  | 'move'
  | 'copy'
  | 'rotate'
  | 'mirror'
  | 'delete'
  | 'fit';
const names: Record<ContextAction, string> = {
  properties: 'Propriedades',
  move: 'Mover',
  copy: 'Copiar',
  rotate: 'Rotacionar…',
  mirror: 'Espelhar por eixo…',
  delete: 'Excluir',
  fit: 'Enquadrar desenho',
};
export default function CadContextMenu({
  x,
  y,
  actions,
  onAction,
  onClose,
}: {
  x: number;
  y: number;
  actions: ContextAction[];
  onAction: (action: ContextAction) => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      old?.focus();
    };
  }, [onClose]);
  return (
    <div
      ref={menu}
      className="cad-context-menu"
      role="menu"
      aria-label="Ações da seleção"
      style={{
        left: Math.max(4, Math.min(x, window.innerWidth - 230)),
        top: Math.max(
          4,
          Math.min(y, window.innerHeight - actions.length * 34 - 15),
        ),
      }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault();
          onClose();
          return;
        }
        const buttons = [...e.currentTarget.querySelectorAll('button')];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          buttons[
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? buttons.length - 1
                : (i + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) %
                  buttons.length
          ]?.focus();
        }
      }}
    >
      {actions.map((action) => (
        <button role="menuitem" key={action} onClick={() => onAction(action)}>
          {names[action]}
        </button>
      ))}
    </div>
  );
}
