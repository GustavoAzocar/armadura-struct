# Cópias periódicas de recuperação

## Configurar

Abra **Configurações → Salvamento e recuperação**. As cópias começam ativadas com intervalo de cinco minutos. É possível escolher 1, 2, 5 ou 10 minutos ou desativar a função. Use **Salvar preferências** para aplicar a mudança. **Cancelar** mantém a configuração anterior. A preferência vale para este dispositivo e o salvamento automático existente continua ativo.

O prazo começa com a primeira alteração confirmada. Edições durante o intervalo entram na cópia da revisão mais recente quando o prazo vence. O aplicativo evita gravar o mesmo conteúdo sucessivamente. Se o sistema suspender a execução, a cópia vencida pode ser processada quando a janela voltar. A barra de estado indica o início da gravação e mostra o horário e o destino de uma cópia confirmada.

## Recuperar uma versão

1. Abra **Salvamento e recuperação** pela aba Configurações ou pela tela **Sem projeto aberto**.
2. Confira o nome, o horário, o destino e a integridade das cópias. Para consultar uma pasta que ainda não está autorizada nesta sessão, use **Consultar pasta…** e escolha a raiz do projeto.
3. Selecione **Recuperar cópia** na linha da versão desejada. Se houver alterações em aberto, confirme o que fazer com elas antes de trocar de documento.
4. Use **Salvar projeto** para escolher onde gravar o resultado. A sessão recuperada abre desvinculada da pasta original para preservar seu arquivo principal.

Uma cópia inválida aparece para diagnóstico. Somente as versões que passam pelo leitor do projeto podem ser restauradas.

## Onde as cópias são armazenadas

Na pasta autorizada, a aplicação usa o inventário `recovery-v1/copies.json`, separado do arquivo principal em `save-v1`. Os ambientes e documentos sem pasta vinculada usam o IndexedDB local. O inventário mantém as três versões válidas mais recentes do projeto no destino. A gravação nova e a rotação são publicadas juntas. Cópias inválidas são preservadas para inspeção.

Limpar os dados do site ou remover o perfil do aplicativo pode apagar o histórico local. Excluir a pasta de um projeto pode apagar as cópias que ficam nela. Preserve arquivos importantes em um meio independente. As cópias recuperam gravações confirmadas durante a execução. A proteção contra falha física ou perda de energia depende do armazenamento e do sistema operacional.

O histórico carrega o mesmo documento nativo usado pelo salvamento e não muda o número do formato. O arquivo principal e a recuperação automática da sessão têm ciclos próprios. Depois de fechar explicitamente, a tela inicial permanece disponível, inclusive para consultar uma cópia por escolha.
