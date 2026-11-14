# Prévia de dados do selo

Em **Pranchas**, abra uma folha com um modelo de margem e selo aplicado e escolha **Prévia de dados do selo**. Use essa janela para conferir quais dados preenchem os campos antes de definir os vínculos do projeto.

1. Marque as folhas que deseja conferir. A folha ativa vem selecionada.
2. Informe os dados do projeto, como obra, código, endereço, cliente, responsável ou data documental. Use uma data civil, sem hora.
3. Em **Dados das folhas selecionadas**, escolha quais propriedades editar. **Manter como está** preserva o valor de cada folha. **Herdar do projeto** usa o valor global. **Valor local** usa a entrada do lote, e **Vazio explícito** deixa o campo em branco. A prévia indica quando as folhas selecionadas têm revisões diferentes.
4. Em **Vínculos do modelo aplicado**, escolha um campo do catálogo, como **Autor (@AUTOR)** ou **Endereço (@ENDERECO)**. Um texto que contém @ continua literal até você escolher um vínculo. Os vínculos do rascunho são aplicados na prévia das folhas com a mesma revisão e o mesmo modelo incorporado.
5. Clique em **Conferir prévia**. Cada folha mostra o selo, a origem dos campos e os avisos de composição. Use **Cancelar** ou Esc para descartar o rascunho.

## Como os valores são escolhidos

- **Texto manual** tem prioridade, inclusive quando vazio. Desmarque a opção para restaurar a origem automática.
- **Configuração da folha** usa o padrão do campo e respeita herança e valores locais. Uma origem direta, como **Projeto** ou **Desenho escolhido**, consulta somente a origem indicada. Para vincular um desenho, selecione-o na lista.
- **Agregado da folha** consulta os desenhos colocados na prancha. Por exemplo, autores diferentes aparecem juntos e a prévia sinaliza dados ausentes. Escalas repetidas aparecem uma vez.
- **Revisão** usa a revisão da folha por padrão. **Número da folha** e **Total de folhas** seguem a ordem e a quantidade de folhas do projeto.
- **Peso do aço (@PESO_ACO)** mostra o total de barras da folha em kg. Com quadro de aço, usa seu percentual de acréscimo. Sem quadro, mostra peso líquido com 0%. A prévia indica RA bloqueada e desatualizada, inclusive quando o peso do selo é manual.

## Exemplo

Para conferir o endereço em duas pranchas, marque as duas folhas, informe Rua da Estação em **Dados do projeto** e associe um campo do modelo a **Endereço (@ENDERECO)**. Use **Manter como está** nas propriedades das folhas para conferir a origem padrão do endereço. Se quiser simular uma folha com endereço em branco, deixe só essa folha marcada e escolha **Vazio explícito** para o endereço.

## Limites desta versão

A prévia mostra a margem e o selo. Os avisos também podem indicar problemas de vistas ou do quadro da folha. Textos longos usam a fonte e a altura do modelo, com diagnóstico quando excedem a caixa.

Os dados editados ficam na janela e são descartados ao fechar ou trocar de projeto. O arquivo nativo, o histórico e os comandos de exportação continuam usando os campos estáticos do modelo aplicado. A associação direta de textos CAD importados e a gravação dos vínculos estão em desenvolvimento. [Modelos de margem e selo](MARGENS-E-SELOS.md)
