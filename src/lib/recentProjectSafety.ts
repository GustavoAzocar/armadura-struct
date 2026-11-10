/** Uma leitura assíncrona só pode substituir o documento/contexto que a iniciou. */
export function captureRecentContext<T>(
  readProject: () => T,
  readContext: () => string,
): () => void {
  const project = readProject();
  const context = readContext();
  return () => {
    if (readProject() !== project || readContext() !== context)
      throw new Error(
        'O projeto ou contexto mudou. Reinicie a abertura do recente',
      );
  };
}
