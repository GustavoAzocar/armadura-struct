# Guia de uso · ArmaduraStruct 0.2

## Espaço de trabalho

Use a faixa **Armaduras** para criar e detalhar posições. Quantidade, bitola e espaçamento no topo valem para os próximos comandos; para alterar uma posição existente, selecione-a e use **Propriedades**. O único painel lateral alterna entre a árvore em **Projeto** e a edição em **Propriedades**.

**F4** recolhe/abre o painel. **Ctrl+F1** recolhe/expande a faixa. **Ctrl+0** alterna o modo Foco no CAD. Os botões no canto da área de desenho também permitem recuperar os painéis. A preferência de recolhimento é preservada neste dispositivo.

## Organização do projeto

Na aba **Projeto**, use **+ pavimento**, **+ elemento** e **+ detalhamento**. Ao criar um pavimento ou elemento, ele fica selecionado como pai do próximo cadastro. O seletor de pai no formulário permite escolher outro destino.

Clique no nome de um nó para editar seu nome; em elementos e detalhamentos, altere também o pai para movê-los. Os vínculos usam IDs, portanto elementos com o mesmo nome em pavimentos distintos continuam independentes. A exclusão só aceita nós vazios; mova os filhos ou objetos antes. O projeto conserva ao menos um pavimento, elemento e detalhamento.

**Destino de novos objetos** define o detalhamento ativo. Barras, polilinhas e máscaras novas entram nele; chamadas vinculadas e rebatimentos herdam o dono da barra. Selecione objetos e volte à aba Projeto para usar **Detalhamento de destino → Mover seleção**. Ao mover uma barra na hierarquia, suas chamadas e rebatimentos acompanham o vínculo, mantendo coordenadas e quantidades. O comando Mover no CAD continua sendo uma transformação geométrica diferente.

A pesquisa localiza pavimentos, elementos, detalhamentos, posições, máscaras e textos de anotações. Clique no detalhamento encontrado para ativá-lo e consultar seus objetos nas listas abaixo. A pesquisa abre temporariamente os ancestrais; limpar a busca recupera a expansão anterior. O estado da árvore e o detalhamento ativo são lembrados por projeto neste dispositivo, inclusive ao alternar as abas laterais.

Na visão geral, **CAD, quadro e exportações abrangem o projeto inteiro**. Escolher o detalhamento ativo organiza a edição e as listas; entrar na edição isolada restringe apenas a visualização/edição do CAD. O quadro e as exportações continuam globais. Pavimento é uma entidade de organização, independente dos layers CAD das máscaras.

### Agrupar e editar isoladamente

Selecione as barras, cotas, polilinhas e chamadas pelo CAD ou por **Shift + clique** nas listas da árvore. Em **Elementos → Agrupar em detalhamento** (comando `AGRUPAR`), informe o nome e o elemento estrutural. O conjunto recebe um detalhamento da hierarquia; os objetos conservam seus IDs, geometria e dados físicos. Rebatimentos e chamadas vinculados às barras selecionadas acompanham a associação.

Na visão geral, clicar num membro seleciona o conjunto; **Shift + clique** alterna sua seleção inteira. A caixa tracejada identifica o grupo. **Mover** desloca suas geometrias juntas. Para alterar, copiar, girar ou espelhar peças individualmente, abra a edição isolada.

Use **duplo clique no conjunto no CAD**, duplo clique no nome do detalhamento na árvore ou o botão de abrir edição ao lado do nome. Também há **Elementos → Editar detalhamento** e o comando `EDITARDETALHE`. O CAD enquadra o detalhe e exibe somente seus objetos. O caminho no topo identifica o contexto; os outros detalhes ficam protegidos contra seleção e alteração. Novos objetos entram no detalhe em edição.

Altere bitola, quantidade ou geometria em **Propriedades**. As representações usam a mesma definição física e são atualizadas sem criar cópias de aço. O quadro permanece global; linhas de outros detalhes são apenas consultáveis durante a edição isolada. Se a RA estiver bloqueada, conclua a edição e use **Atualizar RA** para conferir o levantamento. Renumeração e mudanças globais também exigem concluir a edição.

**Concluir edição** (comando `CONCLUIR`) retorna à visão geral e recupera a câmera anterior. As alterações já integram o modelo, o salvamento e o histórico; não dependem desse botão para serem gravadas. Durante a edição isolada, desfazer/refazer aceita apenas operações que preservem os demais detalhes. Depois de concluir, o histórico geral volta a ficar acessível. O modo isolado é temporário: reabrir o JSON retorna à visão geral, preservando grupos e vínculos.

**Desagrupar seleção** (`DESAGRUPAR`) devolve a seleção individual aos membros e mantém o detalhamento na hierarquia. Não converte barras em linhas, não apaga seus dados e não altera o peso. Excluir objetos físicos é uma operação diferente. O agrupamento visual usa o campo opcional `hierarchy.details[].grouped` no formato 3; arquivos anteriores sem esse campo continuam com seleção individual.

![Edição isolada de um detalhamento](detail-editing.png)

### Formato 3 e compatibilidade

Ao abrir formatos 1/2, o aplicativo cria um pavimento (usa o texto antigo, quando disponível), um elemento Geral e um Detalhamento 1. Os dados das barras, anotações, máscaras, polilinhas, rebatimentos e RA bloqueada são preservados. A antiga descrição textual `Bar.element` continua como **Descrição da posição**, sem funcionar como identidade do elemento estrutural.

No modelo, `hierarchy.details` contém os detalhamentos compostos e `hierarchy.objectDetails` associa os objetos por ID. `details` mantém exclusivamente os rebatimentos gráficos das barras. `hierarchy.drawings` identifica desenhos lógicos dos detalhamentos; `hierarchy.placements` reserva seus posicionamentos na folha, separados das origens físicas e dos rebatimentos. A composição/transformação visual dessas posições na prancha será feita nas tarefas de pranchas; o CAD atual conserva as coordenadas anteriores.

Salvar, abrir, recuperação automática e desfazer/refazer incluem toda a hierarquia. Arquivos v3 com vínculos inválidos são recusados, em vez de descartar objetos silenciosamente. Mantenha uma cópia do JSON antigo se precisar abri-lo em uma versão anterior do aplicativo.

## Mouse e seleção

- Roda: zoom no cursor. Botão do meio ou Espaço + arraste: pan. H ativa a ferramenta Pan.
- Clique numa barra ou numa posição na árvore para editar. Shift + clique acrescenta ou remove da seleção.
- Arraste uma janela para selecionar barras inteiramente contidas nela. Alças quadradas editam vértices de barras livres.
- A máscara fica protegida; suas propriedades são alteradas selecionando o arquivo na árvore.
- F enquadra o projeto. F3 alterna encaixes; F8 alterna ortogonal. Botão direito ou Enter conclui a barra; Esc cancela o comando.

## Comandos

| Entrada           | Ação                                                             |
| ----------------- | ---------------------------------------------------------------- |
| B, BARRA, L       | Barra por vértices                                               |
| PL, POLILINHA     | Polilinha de desenho, sem quantidade de aço                      |
| CONVERTER         | Clique numa polilinha própria ou na máscara para criar uma barra |
| REPETIR           | Repetir o estribo selecionado até o ponto final                  |
| FAIXA             | Dois pontos definem uma faixa horizontal ou vertical             |
| COTA / ALINHADA   | Cota ortogonal / alinhada por três pontos                        |
| CHAMADA           | Seta, cotovelo e chegada do texto                                |
| CORTE             | Dois pontos do corte e chegada da chamada                        |
| ARCO              | Primeiro ponto, ponto intermediário e último ponto do arco       |
| DIVIDIR / EMENDAR | Dividir barra / unir duas poligonais compatíveis                 |
| RA / BLOQUEARRA   | Atualizar / alternar bloqueio da relação de aço                  |
| E, ESTRIBO        | Estribo por dois cantos opostos                                  |
| V / H             | Seleção / pan                                                    |
| M / C             | Mover / copiar a seleção; indicar base e destino                 |
| R, REBAT          | Criar rebatimento da posição selecionada                         |
| D                 | Distribuir a posição até o ponto informado                       |
| DIST, MEDIR       | Medir dois pontos                                                |
| FORMA             | Criar barra seguindo uma linha/polilinha da máscara              |
| F, ZOOM           | Enquadrar                                                        |
| U / REDO / DEL    | Desfazer / refazer / excluir                                     |
| Q                 | Quadro de aço                                                    |
| IMPORTAR          | Abrir DXF/DWG                                                    |
| Ctrl+S / Ctrl+O   | Salvar / abrir projeto                                           |
| Ctrl+Z / Ctrl+Y   | Desfazer / refazer                                               |
| :                 | Focar a linha de comando                                         |

Os comandos longos são digitados no campo **Comando**. Atalhos de uma letra funcionam fora dos campos de edição.

Coordenadas em mm: `1000,500` é absoluto; `@500,0` desloca a partir do último ponto; `@1000<30` usa distância e ângulo em graus, no sentido anti-horário. Use ponto decimal: `1250.5,300`. Uma entrada numérica atua sobre o comando que estiver ativo.

## Posições, distribuição e rebatimentos

Cada posição tem uma identificação única, forma, aço, bitola e quantidade. Copiar cria outra posição. Rebatimentos são representações vinculadas: alterar a posição atualiza o detalhe e o quadro. Selecionar um rebatimento seleciona sua posição; para removê-los use **Remover rebatimentos** nas propriedades. A origem de cada rebatimento pode ser ajustada em **Propriedades → Rebatimentos**.

A distribuição parte da origem da barra e inclui o ponto final. Para uma distância L e quantidade n, o espaçamento é L/(n−1). Ao informar um espaçamento máximo s, a quantidade passa a ceil(L/s)+1. Ela representa a quantidade da posição, não um multiplicador adicional. Eixos e marcas de distribuição são simbólicos. **Faixa ortogonal** define início e fim independentes da posição da barra; a direção é horizontal ou vertical, conforme o deslocamento predominante. **Repetir estribo** distribui a geometria completa da posição selecionada, usando o espaçamento máximo do topo. A representação pode ser alternada entre traços e estribos nas propriedades.

O CAD exibe até 200 posições reais por faixa e identifica a vista abreviada quando há mais peças. O DXF/PDF exporta todos os estribos até 2.000 peças por faixa; acima disso, selecione a representação por traços. O quadro sempre usa a quantidade completa uma única vez.

## Polilinhas, cotas e chamadas

Uma polilinha CAD não entra no quantitativo. Use **Converter polilinha** e clique no contorno para transformá-la em uma posição. A conversão usa a bitola e a quantidade do topo. Ao converter um desenho próprio, o contorno é substituído pela barra em uma única operação de desfazer; uma máscara importada permanece protegida.

Cotas usam dois pontos de referência e um terceiro para posicionar a linha. Na cota ortogonal, o terceiro ponto escolhe a projeção horizontal ou vertical; a alinhada mede a distância real. As cotas são exibidas em cm. Se houver uma armadura selecionada, a identificação dela é acrescentada à cota.

Chamadas e cortes podem ser vinculados à posição selecionada. Nas propriedades, escolha outra armadura ou **Sem vínculo**; deixe o texto vazio para a identificação automática ou escreva um texto próprio. Renumerar ou editar a posição atualiza as identificações automáticas. O vínculo é com os dados da barra: os pontos da anotação permanecem onde foram desenhados.

As anotações e polilinhas podem ser selecionadas, movidas, copiadas, giradas, espelhadas ou excluídas. Os três pontos e a altura do texto também são editáveis nas propriedades. Não são peças adicionais de aço nem geram seções estruturais automaticamente.

## Dividir e emendar poligonais

Selecione uma barra livre e use **Dividir barra**. Informe em cm a distância percorrida pelo eixo físico até o corte e o comprimento total do traspasse. A sobreposição é centrada no ponto de corte: metade em cada direção. Ambas as novas posições herdam a quantidade da original; a soma dos comprimentos unitários é o comprimento original mais o traspasse.

O ponto de corte e toda a sobreposição devem caber em um trecho reto, fora das dobras. Remova a distribuição antes de dividir. O sistema **não calcula comprimento normativo de emenda** a partir de resistência do concreto, aderência ou outros parâmetros; esse valor é definido pelo projetista.

Para **Emendar poligonais**, selecione exatamente duas barras com Shift + clique. Elas devem ser livres, ter a mesma bitola, aço, mandril e quantidade, não possuir distribuição e ter extremidades coincidentes. A ferramenta une as geometrias em uma única posição; não cria solda nem traspasse. Para sobreposição física, utilize a divisão com traspasse. Os vínculos das duas posições passam a apontar para a posição resultante.

## Relação de aço e conferência

A relação de aço é automática por padrão. **Bloquear RA** guarda os valores atuais para conferência; edições posteriores permanecem visíveis no desenho e sinalizam a relação desatualizada. Nesse estado as exportações são impedidas para não entregar um desenho com quantitativo anterior. **Atualizar RA** refaz o quadro mantendo o bloqueio; **Desbloquear RA** retorna à atualização automática. O bloqueio é salvo no projeto.

**Renumerar** aplica N1, N2, … na ordem das posições. Rebatimentos e chamadas preservam seus vínculos.

## Comprimento, cotas e peso

O raio no eixo é R=(Dm+φ)/2. Para uma mudança de direção θ, cada reta é reduzida por R·tan(|θ|/2) e o arco acrescenta R·|θ|. O software avisa se as retas não comportarem a dobra e bloqueia as exportações até a correção.

As dimensões informadas são entre vértices teóricos do eixo. O comprimento C é o desenvolvido incluindo as curvas. Peso = comprimento total × πφ²/4 × 7850, com comprimento e diâmetro em metros. Esse peso é teórico; não inclui perdas, tolerâncias ou otimização de corte.

O mandril inicial é apenas um parâmetro geométrico sugerido da ferramenta, não uma determinação normativa. A alteração da bitola não altera automaticamente o mandril. Confira os dois valores para cada posição.

## Importação e entrega

Confira o tamanho da máscara por uma distância conhecida antes de desenhar. `$INSUNITS`/`INSUNITS` é interpretado quando disponível; arquivos sem unidade assumem 1 unidade = 1 mm e geram aviso. O fator de escala pode ser corrigido no painel.

Linhas, polilinhas com bulge, arcos, círculos, elipses, textos básicos, contornos de faces e blocos são convertidos para representação 2D. Objetos incompatíveis são informados no relatório. A fidelidade de fontes, cotas, sólidos, objetos de terceiros e referências externas não é garantida.

O `.armstruct.json` preserva o modelo editável e as máscaras normalizadas; os bytes originais do CAD não são armazenados. DXF e PDF são saídas para documentação. Em **Propriedades** sem seleção, informe a revisão e escolha a escala do PDF: ajuste à folha ou 1:10, 1:20, 1:25, 1:50, 1:75, 1:100 ou 1:200. A exportação avisa se o desenho não couber na escala escolhida. Imprima em tamanho real (100%). Guarde o projeto JSON junto dos arquivos de entrega. Arquivos nos formatos 1/2 são migrados ao abrir, e os novos salvamentos usam o formato `armadurastruct/3`.

## Nota de implementação desktop

O runtime Emscripten/Embind do LibreDWG Web 0.8.4 usa geração de funções JavaScript durante sua inicialização. A CSP permite `unsafe-eval` e `wasm-unsafe-eval` para esse leitor empacotado. Scripts e workers continuam restritos à origem local; não há execução de scripts contidos no desenho nem carregamento de bibliotecas de um CDN. A configuração equivalente é exercitada nos testes do build de produção.
