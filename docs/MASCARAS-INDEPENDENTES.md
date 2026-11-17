# Máscaras independentes e referências por detalhamento

Entrega da [issue #213](https://github.com/ricardocorsini/armadura-struct/issues/213).

## Criar, importar e editar

Em **Máscaras → Nova máscara**, mantenha **Sem vínculo — máscara independente**, informe o nome e confirme. O projeto não recebe elemento nem detalhamento fictício. A nova máscara fica ativa para desenhar na mesma área CAD, com Linha, Retângulo, Círculo, Polilinha, textos e os comandos de edição existentes. O aviso sobre a área de desenho identifica o destino dos traços.

Em **Importar máscaras em lote**, escolha **Sem vínculo — máscaras do projeto** no destino do arquivo ou aplique esse destino a todos. Os mesmos leitores DXF/DWG, confirmação de unidade, limites, preparação, relatório e confirmação atômica atendem aos arquivos independentes e aos destinados a detalhamentos. A geometria normalizada e os traços locais ficam no projeto; o DXF/DWG de origem nunca é gravado.

Cotas, chamadas e indicações de seção continuam sendo anotações de detalhamento: exiba a máscara como referência na aba Armaduras para lançá-las. A edição independente informa essa orientação e impede gravá-las silenciosamente em outro contexto. Medir/Medir contorno e os textos nativos continuam disponíveis.

O destino explícito continua disponível. Na edição isolada, a criação/importação mantém o destino daquele detalhamento. Para editar uma máscara independente, volte ao modelo geral e use **Ativar esta máscara e desenhar**. A ativação é uma escolha de edição explícita. Mostrar uma máscara em Armaduras não altera essa escolha.

Uma máscara independente não possui entrada em `hierarchy.objectDetails`. Sua geometria é única, identificada pelo ID. Ao editar essa geometria, todos os detalhamentos que a exibem recebem a atualização. O Controle de máscaras informa esse efeito. As proteções dos layers, da geometria importada e do desenho local permanecem.

## Trocar a referência sem encerrar o lançamento

Na aba **Armaduras**, na barra de documentos junto da área de desenho, **Máscaras do detalhamento** aparece quando o projeto possui máscaras e oferece:

- **Trocar referência atual**: escolha B para substituir A imediatamente; escolha A no mesmo campo para voltar. Há pesquisa por nome, origem e contexto, usando o seletor existente.
- **Visíveis**: marque/desmarque cada máscara. A atual é identificada; referências adicionais permanecem ligadas quando a atual é substituída.
- **Origem…**: abre a operação separada de alinhamento daquela referência.

A configuração pertence ao detalhamento ativo. A mesma máscara pode aparecer em A e B, com posições e estados diferentes. Ocultar uma referência não apaga a máscara, a armadura ou a configuração de outro detalhamento. O arquivo do projeto e a recuperação automática conservam esses estados.

Trocar/ligar/desligar referências passa pelo histórico, mas preserva os pontos confirmados e os critérios dos lançamentos: Barra livre, estribo, grampo, hélice, tela e Seguir fôrma. Apenas essa transação de apresentação atualiza a base imutável dos comandos em curso. As demais alterações do documento continuam sujeitas às guardas anteriores de cancelamento.

A captura das referências de cotagem acompanha as máscaras visíveis, sem trocar o destino de edição CAD; ocultar uma referência não invalida uma cota estática cuja geometria permanece igual.

O canvas reconstrói o índice de encaixes e limpa encaixes, guias, seleções transitórias e realces da cena anterior. Os candidatos de Seguir fôrma, contorno e modo Clique da tela consultam as referências visíveis e suas posições locais. Trechos e contornos já confirmados permanecem dados estáticos da prévia; candidatos da referência oculta deixam de ser oferecidos. Mostrar uma referência não libera sua geometria para edição na aba Armaduras.

## Selecionar origem e alinhar

Depois de importar, use **Selecionar origem: nome** no resultado. A mesma ação está no Controle de máscaras e no seletor de referências do detalhamento. A importação pode ser concluída sem selecionar origem.

1. Clique no ponto da máscara, com os encaixes existentes, ou informe sua coordenada mundial na linha de comando.
2. O círculo verde identifica o ponto escolhido; o marcador vermelho mostra o destino, inicialmente `(0,0)` do desenho de armaduras. **Selecionar destino** permite escolher outro ponto no mesmo canvas. **Destino (0,0)** restaura o padrão.
3. Use **Pré-visualizar alinhamento** para conferir a posição resultante.
4. **Aplicar alinhamento** confirma uma operação de histórico. **Cancelar alinhamento** ou Esc descarta toda a preparação, sem alterar o documento.

O ponto de referência fica em coordenadas locais (`anchor`), separado da translação (`origin`) daquela referência. Para escala `s`, rotação `R`, ponto local `q` e alvo `t`, a nova origem é `o = t − s R q`. A conversão de unidade já adotada pelo importador participa da escala existente; não há segunda conversão. A geometria local, os IDs, os critérios físicos e as armaduras permanecem intactos. Desfazer/refazer restaura a referência inteira, inclusive seu ponto de alinhamento. O alinhamento em A não modifica B.

## Formato e exportação

- O formato **`armadurastruct/41`** guarda máscaras independentes e `Project.maskReferences[detailId]`, com a referência atual e uma lista de IDs, visibilidade, origem e ponto local opcional. O `/40` guarda as séries variáveis da PR #215. A composição dos dois recursos usa `/43`, preservando a leitura dos projetos individuais `/40` e `/41` e recusando a composição sob um cabeçalho antigo. O `/42` permanece reservado à PR #218; a variante `/41` da PR #217 ainda exige integração própria.
- Projetos anteriores continuam abrindo sem novos vínculos e com a aparência anterior. O formato 41 reúne também os recursos anteriores da master, incluindo o selo `/39`. Dados novos sob cabeçalho anterior são recusados com a indicação de que exigem o formato 41. Modelos de prancha, selos e faixas não rebaixam esse formato.
- Mantenha uma cópia antes de salvar para alternar entre versões do aplicativo: leitores anteriores recusam o formato 41.
- As novas referências são de tela. Elas não são acrescentadas automaticamente a prancha/PDF/DXF. Máscaras vinculadas antigas mantêm a política anterior e a posição de exportação anterior. CSV, comprimento, quantidade e peso não recebem contribuições de máscaras.
- O pacote `openstruct.detail` conserva sua versão publicada. Ele ainda não transporta referências por detalhamento; a exportação de um detalhamento com essas referências é recusada com orientação para usar o arquivo de projeto, evitando perda silenciosa. JSON Schemas publicados não foram modificados.

## Verificações e limites de execução

`tests/maskReferences.test.ts` cobre criação/edição independente, importação DXF/DWG pelo domínio, leitura de legado, recusa de formato antigo, vínculos inconsistentes, A → B → A com referência adicional, candidatos geométricos, isolamento, atualização compartilhada, alinhamento analítico com escala 10 e rotação 37°, histórico e invariância da composição de prancha/PDF, DXF e CSV. A suíte principal local passou com **1.318 testes**.

`tests/e2e/maskReferences.spec.ts` cobre cinco cenários de navegador: seletor compacto em 1600, 1366 e 1024 px sem reduzir a área útil do CAD, criação/edição/reabertura, troca durante Barra livre e tela por pontos com limpeza de encaixes, alinhamento com prévia/cancelamento/histórico e importação dos arquivos DXF/DWG reais de referência. O CI executa esses cenários, as regressões de CAD/telas e a suíte completa de interface. As capturas são produzidas pelo próprio spec e publicadas no artefato `mask-reference-evidence`; os resultados da revisão final ficam registrados na PR.

**Nenhum cenário E2E passou neste ambiente local:** o Chromium instalado encerrou antes de abrir a aplicação (`socket() failed: Operation not permitted`), e a instalação alternativa do Headless Shell recebeu um arquivo de download inválido. A validação no navegador usa a execução do CI e suas capturas. Os jobs desktop do CI verificam Rust, os adaptadores nativos e a geração dos instaladores para Linux e Windows; a operação visual do aplicativo Tauri e dos diálogos nativos de arquivos não foi realizada. CSP, capabilities, pontes nativas e infraestrutura de arquivos vinculados não foram alteradas.
