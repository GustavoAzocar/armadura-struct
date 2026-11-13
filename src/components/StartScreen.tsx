import { useEffect, useRef } from 'react';
import { FilePlus2, FolderOpen, History } from 'lucide-react';

/**
 * Estado "sem projeto aberto": o aplicativo continua em execução, mas nenhum
 * documento está ativo. Não é um projeto vazio; criar ou abrir é explícito.
 */
export default function StartScreen({
  recentCount,
  onNew,
  onOpen,
  onRecent,
}: {
  recentCount: number;
  onNew: () => void;
  onOpen: () => void;
  onRecent: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <main className="start-screen" aria-labelledby="start-screen-title">
      <section className="start-panel">
        <span className="eyebrow">ARMADURASTRUCT</span>
        <h1 id="start-screen-title" ref={heading} tabIndex={-1}>
          Sem projeto aberto
        </h1>
        <p>
          Crie um projeto novo ou abra um existente. Os comandos de desenho
          ficam disponíveis depois que um projeto estiver aberto.
        </p>
        <div className="start-actions">
          <button type="button" className="primary" onClick={onNew}>
            <FilePlus2 size={16} aria-hidden="true" />
            Novo projeto
          </button>
          <button type="button" onClick={onOpen}>
            <FolderOpen size={16} aria-hidden="true" />
            Abrir projeto
          </button>
          <button type="button" onClick={onRecent}>
            <History size={16} aria-hidden="true" />
            Projetos recentes
            {recentCount > 0 && (
              <span className="start-count" aria-label={`${recentCount} itens`}>
                {recentCount}
              </span>
            )}
          </button>
        </div>
      </section>
    </main>
  );
}
