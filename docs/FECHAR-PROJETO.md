# Fechar projeto

**Arquivo → Projeto → Fechar projeto** sai do projeto atual e deixa o ArmaduraStruct aberto numa tela inicial **Sem projeto aberto**, pronta para criar ou abrir outro projeto. Não fecha a janela, não apaga conteúdo e não cria um projeto substituto.

Fechar é diferente de:

- fechar uma aba de desenho ou prancha (a aba some, o projeto continua aberto);
- **Novo projeto** com um projeto aberto (o atual é substituído pelo novo);
- um projeto vazio ainda não salvo (é um documento ativo; a tela inicial não tem documento).

## Tela inicial

A tela inicial oferece **Novo projeto**, **Abrir projeto** e **Projetos recentes**. A faixa de comandos, o campo **Comando CAD**, a barra de status, Salvar, Desfazer e Refazer ficam indisponíveis, porque não há projeto sobre o qual agir. Atalhos de comandos de projeto mostram "Abra ou crie um projeto para usar este comando." e não fazem nada; **Ctrl/Cmd+O** e o **Guia de uso** da barra de título continuam disponíveis.

Cancelar o seletor de arquivo, o assistente de Novo projeto ou um recente mantém a tela inicial. Criar ou abrir um projeto começa um contexto independente: nada de desenhos, seleções, caminhos, vínculo de pasta ou histórico de desfazer do projeto anterior é herdado, e Desfazer não volta à tela inicial nem ao projeto fechado.

## Alterações não salvas

Um projeto aberto ou gravado com confirmação (arquivo no desktop, pasta vinculada) fecha direto. Caso contrário, o aplicativo pergunta:

| Opção                 | Resultado                                                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cancelar** (ou Esc) | Mantém o projeto aberto, com suas alterações e o desfazer.                                                                                                                                      |
| **Fechar sem salvar** | Descarta só o que ainda não foi gravado. Com pasta vinculada, o que o autosave **já gravou** na pasta permanece. Sem pasta, a cópia de recuperação local deixa de ser reaberta automaticamente. |
| **Salvar e fechar**   | Usa o mesmo **Salvar projeto**. Se a gravação falhar, faltar permissão ou o seletor for cancelado, o projeto continua aberto e íntegro.                                                         |

No navegador, pedir um download **não** comprova a gravação: o aplicativo continua aberto e mostra **Confirmar cópia e fechar** depois que você conferir o arquivo baixado, ou **Cancelar** para manter o projeto.

Projetos restaurados da recuperação local e projetos novos sem pasta são tratados como não salvos, como em [Projetos recentes](PROJETOS-RECENTES.md#alterações-não-salvas-e-gravações-pendentes).

## Quando o fechamento é recusado

Fechar não começa (e o aviso explica o motivo) enquanto houver:

- gravação na pasta, abertura, salvamento ou outra operação de arquivo em andamento;
- recuperação inicial ainda carregando ou atualização sendo instalada;
- comando CAD, prévia, critérios, transferência ou importação de máscaras em andamento;
- edição isolada de um detalhamento.

Conclua ou cancele e tente de novo. Cliques repetidos abrem uma única confirmação, e a confirmação é cancelada se o projeto mudar antes de concluir. A confirmação mantém o teclado dentro do diálogo; Tab não leva aos controles do editor. Enquanto o fechamento está sendo confirmado, salvo ou registrado, novas ações e alterações do documento ficam bloqueadas. Aguarde a conclusão; Cancelar ou uma falha libera o editor com o trabalho preservado.

## Recuperação e reinício

A recuperação automática do último trabalho continua igual quando você encerra o aplicativo **com** um projeto aberto: ao reabrir, ele volta.

Depois de **Fechar projeto**, o aplicativo grava na recuperação local (IndexedDB) a marca "nenhum projeto ativo". Reiniciar ou recarregar mostra a tela inicial, sem reabrir o projeto fechado sozinho. A marca é removida, na mesma transação, na primeira gravação de recuperação do próximo projeto aberto ou criado.

- O fechamento espera as gravações de recuperação já enfileiradas e só então grava a marca. Gravações atrasadas do projeto fechado (timer de autosave, retornos assíncronos) são descartadas e não reativam o projeto.
- Se a marca não puder ser gravada (armazenamento cheio ou bloqueado), o projeto **continua aberto**, a recuperação dele continua funcionando e um aviso pede para tentar de novo ou salvar uma cópia.
- A cópia de recuperação do projeto fechado não é apagada ao fechar; ela é substituída pela recuperação do próximo projeto. Nenhum dado do IndexedDB ou do `localStorage` é limpo em bloco, e os **recentes**, as preferências e as configurações são preservados.

## O que nunca é alterado

Fechar não apaga, esvazia nem sobrescreve arquivos de projeto, pastas, `save-v1/projeto.armstruct.json`, referências CAD, backups ou revisões, e não grava o estado vazio no arquivo anterior. O projeto fechado continua reabrível por **Abrir projeto** ou **Projetos recentes**.

## Implementação

- O fechamento explícito troca a montagem do editor por meio de `src/ProjectSession.tsx`. Fechar descarta a montagem inteira (seleções, comandos, prévias, diálogos, abas, desfazer/refazer e timers) e monta outra já no estado sem projeto.
- A marca e a fila de gravações estão em `src/lib/recoverySession.ts`, testadas em `tests/recoverySession.test.ts`; o fluxo completo está em `tests/e2e/closeProject.spec.ts`.
- O formato do arquivo de projeto não mudou.

## Validação

Os testes E2E rodam no navegador (Chromium). O fluxo no aplicativo desktop (Tauri, Windows/Linux), com diálogo nativo de salvamento e pasta real, usa as mesmas funções, mas não foi exercitado automaticamente nesta entrega.

As capturas da confirmação, do fechamento pendente e da tela inicial ficam no artefato `close-project-evidence` da CI. A integração também cobre projetos 38 com catálogo e revisões de prancha, sem mudar seu formato.
