# Projetos e documentos recentes

**Arquivo → Projeto → Projetos recentes** lista até 10 projetos abertos ou gravados com sucesso, com nome, tipo, data e hora da última abertura e localização legível quando a plataforma a informou.

É um **histórico local de navegação**. Não é autosave, backup nem revisão do projeto, e não entra no arquivo exportado.

## O que é registrado

| Evento concluído com sucesso                                                        | Registro                                              |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Abrir projeto (`.armstruct.json`)                                                   | Arquivo de projeto, com caminho no desktop            |
| Salvar projeto no desktop (diálogo nativo)                                          | Arquivo de projeto, com caminho                       |
| Salvar no navegador (download)                                                      | **Não registra**: o navegador não confirma a gravação |
| Criar, abrir ou salvar projeto em pasta (`save-v1/projeto.armstruct.json`)          | Projeto em pasta, com a pasta                         |
| Cancelar, falha, arquivo inválido ou inacessível                                    | Nada é registrado                                     |
| Exemplo inicial, recuperação automática, máscaras DXF/DWG e pacotes de detalhamento | Nada é registrado                                     |

## Reabrir

Reabrir é sempre uma ação explícita e **pede nova seleção**; o histórico não concede acesso a arquivos.

- **Desktop:** o seletor nativo abre no último local. Pastas de projeto usam o seletor de pasta existente, com a mesma restrição ao diretório escolhido. Nenhuma permissão de leitura é ampliada.
- **Navegador:** o caminho não está disponível; o seletor de arquivo (ou de pasta, quando suportado) é aberto sem promessa de abertura automática.

A leitura e a validação são as do **Abrir projeto** existente (`readProjectFile`/`decodeProject`) e as do projeto em pasta. Arquivo movido, excluído, sem permissão ou inválido mostra uma mensagem na própria lista, mantém o projeto atual intacto e permite escolher outro arquivo ou remover o item.

## Alterações não salvas e gravações pendentes

Ao reabrir um recente, o aplicativo:

1. recusa enquanto houver gravação em pasta em andamento, comando em andamento ou edição isolada;
2. se o projeto tiver alterações desde a última abertura ou gravação, pergunta **Cancelar**, **Abrir sem salvar** ou **Salvar e abrir**. Se salvar falhar ou for cancelado, nada é substituído.

O estado "salvo" é o último projeto aberto, gravado ou confirmado na pasta vinculada. Um projeto restaurado da recuperação local é tratado como não salvo. O botão **Abrir projeto** existente não mudou.

## Identidade, remoção e privacidade

- Duplicatas são resolvidas por tipo, ID do projeto e localização (caminho/pasta), ou nome do arquivo no navegador. Arquivos diferentes com o mesmo nome continuam distinguíveis pelo local ou por um identificador curto do projeto.
- **Remover** e **Limpar histórico** (com confirmação) apagam só as entradas. Arquivos e projetos não são tocados, e o menu não altera armaduras, quantitativos, desfazer/refazer ou estado de salvo.
- Os dados ficam no `localStorage` (`armadurastruct.recent.v1`) e nunca são enviados à rede. O conteúdo é validado na leitura: dado inválido é descartado e nunca impede o editor.

## Limites conhecidos

- Não há reabertura com um clique: depende de nova seleção, por segurança.
- Entradas de arquivos salvos por download no navegador não existem.
- A comparação de caminhos diferencia maiúsculas e minúsculas; no Windows, o mesmo arquivo com caixa diferente pode gerar dois itens.
- Projetos restaurados da recuperação local pedem confirmação mesmo que idênticos ao arquivo em disco.
