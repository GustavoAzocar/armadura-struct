import { useCallback, useState } from 'react';
import App from './App';

/**
 * Cada projeto aberto vive numa montagem própria do editor. Fechar o projeto
 * descarta essa montagem inteira (seleções, comandos, diálogos, abas, desfazer
 * e timers) e monta outra já no estado "sem projeto aberto".
 */
export default function ProjectSession() {
  const [session, setSession] = useState(0);
  const onProjectClosed = useCallback(() => setSession((n) => n + 1), []);
  return <App key={session} onProjectClosed={onProjectClosed} />;
}
