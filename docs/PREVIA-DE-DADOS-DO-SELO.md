# Dados e vínculos do selo

Em **Pranchas**, abra uma folha com um modelo aplicado e escolha **Dados do selo**. Os dados podem ser conferidos antes de gravar; **Aplicar dados do selo** confirma tudo em uma única etapa de Desfazer/Refazer. **Cancelar** ou Esc descarta as alterações.

## Preencher uma ou várias folhas

1. Selecione as folhas. A folha ativa vem marcada.
2. Informe nome, autor e os dados documentais do projeto: obra, código, endereço, cliente, responsável e data civil, sem horário.
3. Nas propriedades das folhas, **Manter como está** preserva cada valor. **Herdar do projeto** acompanha o cadastro global; **Valor local** fixa um valor na folha; **Vazio explícito** mantém o campo vazio. Revisões locais não alteram as outras folhas. Valores mistos são indicados e não são gravados como texto.
4. Associe explicitamente os campos do modelo ao catálogo, como **Autor (@AUTOR)** ou **Endereço (@ENDERECO)**. Textos com @ continuam literais até essa associação. Alterações de definição criam uma revisão na biblioteca e aplicam essa revisão apenas às folhas selecionadas com o mesmo modelo incorporado. Uma revisão mais recente na biblioteca precisa ser aplicada antes de editar os vínculos de uma revisão antiga.
5. Use **Conferir prévia** para ver os textos, suas origens e os diagnósticos. Confirme com **Aplicar dados do selo**. Só as propriedades e as opções de vínculo editadas são alteradas; origens e textos manuais diferentes nas demais folhas são preservados.

A tela da prancha e os exportadores PDF/DXF leem automaticamente os vínculos salvos, usando a mesma composição. Não é preciso reabrir a janela para atualizar o selo.

## Origens e precedência

- Texto manual da instância prevalece, inclusive vazio. Desmarque **Texto manual** para restaurar a origem automática. Reaplicar o modelo preserva esses valores; eles ficam identificados como manuais na conferência.
- **Configuração da folha** respeita valor local e herança. Uma origem direta **Projeto** ou **Desenho escolhido** consulta somente essa origem. Desenhos são identificados por ID; renomeá-los ou reordená-los não troca o vínculo. Uma origem removida gera diagnóstico e não reutiliza texto antigo.
- **Agregado da folha** considera seus desenhos sem repetir valores por vista. Autores, datas e pavimentos divergentes são listados; dados parcialmente ausentes geram aviso. Escalas são únicas e ordenadas, como `1:25 / 1:50`.
- Revisão usa a folha por padrão. Número e total seguem a ordem de `project.sheets`, mesmo na exportação de um subconjunto.
- Datas documentais ficam vazias quando não informadas. Data atual, horário de exportação e fuso não são fontes automáticas.
- **Peso do aço (@PESO_ACO)** identifica o total físico de **barras da folha**, em kg, líquido (0%) ou com o acréscimo do quadro. Telas soldadas continuam no resumo próprio, com sua perda específica. Vistas repetidas não duplicam o peso e nenhuma edição documental altera geometria ou quantitativos. RA bloqueada e desatualizada continua impedindo a exportação, inclusive com peso manual.

## Modelos e textos CAD

No editor **Modelos de margem e selo**, cada caixa pode receber um **Campo automático do selo**. As definições acompanham o modelo exportado; IDs de desenhos e textos manuais pertencem à instância da folha e não são enviados no arquivo de modelo.

Um texto CAD importado continua literal. Selecione-o em **Elemento gráfico** e use **Converter texto selecionado em campo do selo** para criar sua caixa, preservando origem, fonte, altura, alinhamento e rotação. Depois escolha o campo automático. Os outros textos importados continuam intactos. A caixa pode precisar ser ampliada para acomodar o valor resolvido.

Textos longos são quebrados com a fonte efetiva, sem reduzir a altura. Falta de espaço, variável desconhecida, origem quebrada ou caracteres sem reprodução literal produzem diagnósticos; erros de composição bloqueiam PDF/DXF. A saída exportada é estática; os vínculos permanecem no projeto nativo.

## Arquivos e compatibilidade

Dados documentais e vínculos são salvos em **armadurastruct/39**. Arquivos antigos continuam abrindo, preservando textos estáticos e sem inventar valores. Dados novos em um arquivo marcado como formato antigo são recusados. Ao salvar em 39, mantenha uma cópia caso precise abrir o projeto em um aplicativo anterior.

Modelos vinculados usam **armadurastruct.sheet-template/2**; modelos estáticos de versão 1 continuam aceitos. O pacote de detalhamento permanece em **openstruct.detail/23** ou **/24**: propriedades de folha e modelos globais não são incluídos. Duplicar folhas copia suas configurações sem compartilhar objetos mutáveis e mantém os desenhos de origem; transferir detalhamentos preserva o cadastro e os vínculos locais do destino.

Salvar/reabrir, recuperação automática e histórico conservam os dados. Uma janela aberta sobre um projeto substituído ou alterado não pode gravar o rascunho no novo contexto.
