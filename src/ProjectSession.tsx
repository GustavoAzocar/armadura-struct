import { useCallback, useState } from 'react';
import App from './App';

/**
 * Fechar explicitamente o projeto troca a montagem do editor e
 * descarta a sessão inteira (seleções, comandos, diálogos, abas, desfazer
 * e timers) e monta outra já no estado "sem projeto aberto".
 */
export default function ProjectSession() {
  const [session, setSession] = useState(0);
  const onProjectClosed = useCallback(() => setSession((n) => n + 1), []);
  return <App key={session} onProjectClosed={onProjectClosed} />;
}
