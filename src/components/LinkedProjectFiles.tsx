import { useEffect, useRef, useState } from 'react';
import { isLinkedProjectDocument } from '../domain/linkedProjectFiles';
import type { Project } from '../domain/types';
import { projectFolderFiles } from '../lib/projectFolder';

type Props = {
  project: Project;
  editingBlocked?: boolean;
  captureContext: () => () => void;
  onLink: (path: string) => void;
  onUnlink: (path: string) => void;
  onOpen: (file: File, assertCurrent: () => void) => Promise<void>;
};

export default function LinkedProjectFiles({
  project,
  editingBlocked = false,
  captureContext,
  onLink,
  onUnlink,
  onOpen,
}: Props) {
  const files = projectFolderFiles(project);
  const [access, setAccess] = useState<'checking' | 'ready' | 'lost'>(
    'checking',
  );
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);
  const refreshAccess = useRef<() => void>(() => {});

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!files) return;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      setAccess('checking');
      try {
        await files.checkAccess();
        if (current === request) setAccess('ready');
      } catch {
        if (current === request) setAccess('lost');
      }
    };
    refreshAccess.current = refresh;
    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      request++;
      refreshAccess.current = () => {};
      window.removeEventListener('focus', refresh);
    };
  }, [files]);

  const run = async (action: (assertCurrent: () => void) => Promise<void>) => {
    if (running.current || access !== 'ready') return;
    const assertCurrent = captureContext();
    const check = () => {
      if (!mounted.current) throw Error('Painel fechado.');
      assertCurrent();
    };
    running.current = true;
    setBusy(true);
    setNotice('');
    try {
      check();
      await action(check);
    } catch (e) {
      try {
        check();
        setNotice(e instanceof Error ? e.message : String(e));
        refreshAccess.current();
      } catch {
        // The result belongs to a project or panel that has been left.
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const paths = project.linkedFiles ?? [];
  const enabled = !!files && access === 'ready' && !busy;
  return (
    <section className="linked-project-files" aria-label="Arquivos vinculados">
      <strong>Arquivos vinculados</strong>
      {editingBlocked && (
        <span>Conclua a edição isolada antes de alterar os vínculos.</span>
      )}
      {!files && (
        <span>
          O acesso aos vínculos exige uma pasta autorizada e um seletor
          compatível.
        </span>
      )}
      {files && access === 'checking' && (
        <span>Verificando acesso à pasta…</span>
      )}
      {files && access === 'lost' && (
        <span role="status">Acesso perdido. Use Localizar/associar pasta.</span>
      )}
      {paths.length === 0 ? (
        <span>Nenhum arquivo vinculado.</span>
      ) : (
        <ul className="linked-project-file-list">
          {paths.map((path) => {
            const separator = path.lastIndexOf('/');
            const name = path.slice(separator + 1);
            const location = separator < 0 ? '.' : path.slice(0, separator);
            const type = name.match(/\.(?<ext>[^.]+)$/)?.groups?.ext;
            const supported = isLinkedProjectDocument(path);
            return (
              <li key={path}>
                <strong>{name}</strong>
                <span>
                  {supported
                    ? 'Projeto ArmaduraStruct'
                    : type?.toUpperCase() || 'Sem extensão'}{' '}
                  · {location}
                </span>
                <div className="linked-project-file-buttons">
                  {files && supported && (
                    <button
                      disabled={!enabled}
                      aria-label={`Abrir ${name}`}
                      onClick={() =>
                        void run(async (check) => {
                          const file = await files.open(path);
                          check();
                          if (file) await onOpen(file, check);
                        })
                      }
                    >
                      Abrir
                    </button>
                  )}
                  {files?.reveal && (
                    <button
                      disabled={!enabled}
                      aria-label={`Localizar ${name}`}
                      onClick={() => void run(async () => files.reveal!(path))}
                    >
                      Localizar no sistema
                    </button>
                  )}
                  <button
                    disabled={busy || editingBlocked}
                    aria-label={`Desvincular ${name}`}
                    onClick={() => {
                      setNotice('');
                      onUnlink(path);
                    }}
                  >
                    Desvincular
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {files && (
        <button
          disabled={!enabled || editingBlocked}
          onClick={() =>
            void run(async (check) => {
              const path = await files.choose();
              check();
              if (path) onLink(path);
            })
          }
        >
          Vincular arquivo
        </button>
      )}
      {files && !files.reveal && paths.some(isLinkedProjectDocument) && (
        <span>
          Para abrir no navegador, selecione o arquivo indicado na lista.
        </span>
      )}
      {notice && <span role="status">{notice}</span>}
    </section>
  );
}
