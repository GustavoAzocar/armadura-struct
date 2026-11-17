# Barra livre por comprimento na direção do cursor

Entrega da [issue #211](https://github.com/ricardocorsini/armadura-struct/issues/211).

## Lançar uma barra

1. Em **Armaduras → Barra livre**, clique no ponto inicial.
2. Aponte na direção do trecho. Clique no próximo ponto ou digite o comprimento em **mm** e pressione Enter. Por exemplo, aponte para a direita e digite `1200` para acrescentar um vértice a 1.200 mm do anterior.
3. O último vértice confirmado passa a ser a origem do próximo trecho. Alterne comprimento, clique e coordenadas na mesma barra, quantas vezes precisar.
4. **Enter com valor acrescenta um vértice. Enter sem valor conclui a barra.** O botão direito conserva a conclusão existente. Esc cancela o rascunho; não há fechamento automático do contorno.

A instrução permanece visível durante o comando: **“Clique no próximo ponto ou aponte e digite o comprimento (mm). Enter sem valor conclui.”** A linha de comando recebe a digitação numérica iniciada com o mouse no desenho, sem precisar deslocá-lo para focar o campo. Campos de quantidade, bitola e demais parâmetros mantêm seu próprio teclado. Atalhos configurados continuam tendo precedência.

## Direção, precisão e unidades

A direção é a da prévia no plano do modelo, a partir do último vértice confirmado. A prévia já considera ORTO e os encaixes existentes. Alterar ORTO, os encaixes ou a origem do próximo trecho atualiza essa direção mesmo com o mouse parado. O comando lê também o último movimento pendente de apresentação, caso o Enter chegue antes do próximo frame.

A distância digitada prevalece: o novo vértice é calculado nessa direção e não sofre outro encaixe que mude o comprimento. A conta independe do zoom. Para origem `a`, ponto efetivo da prévia `c` e comprimento `L`, o novo vértice é `a + L(c − a)/‖c − a‖`.

Um número simples está sempre em **mm**; use ponto para decimais, como `1200.5`. A vírgula continua separando as coordenadas: `1200,500` é um ponto absoluto, `@1200,500` é um deslocamento relativo e `@1200<30` é uma entrada polar. Esses fluxos e os aliases da Barra livre permanecem disponíveis. A entrada de comprimento não se aplica a polilinhas, edição de máscaras ou outros comandos.

Sem ponto inicial, sem direção válida ou com número inválido, o aplicativo informa o problema e conserva o rascunho. Comprimentos nulos, negativos ou de até 0,01 mm são recusados; a sessão existente só acrescenta pontos separados por mais de 0,01 mm. Coordenadas que não consigam representar o comprimento com a precisão do modelo também são recusadas.

## Eixo, curvas e histórico

O valor é a **distância reta entre vértices do eixo**. O comprimento de corte da barra concluída continua vindo da geometria física existente, com seus recuos, curvas, mandril e ganchos. Quantidade, peso e critérios não recebem outro cálculo.

Os trechos ficam no rascunho da sessão. Somente a barra concluída entra no documento e no histórico; uma ação de Desfazer retira a barra inteira, e Refazer a restaura. O arquivo continua usando o formato que já tinha: esta entrada não acrescenta dados persistidos nem muda os contratos do projeto e dos pacotes.

## Verificação

`tests/barLengthInput.test.ts` confere direções ortogonais e oblíquas, o triângulo 3:4:5, valores inválidos e precisão, além de uma barra mista com comprimento físico analítico que inclui os arcos.

`tests/e2e/barLength.spec.ts` cobre comprimento → clique → comprimento, foco automático, prévia, conclusão única, desfazer/refazer, reabertura, ORTO e oblíqua em dois zooms, encaixe próximo que não altera a distância, valores inválidos, campos de parâmetros, cancelamento, coordenadas absolutas/relativas/polares, aliases e outro comando. Inclui movimento e Enter no mesmo ciclo, antes do frame. A captura `barra-comprimento-misto.png` é gerada pelo spec e publicada pelo CI no artefato `bar-length-evidence`.

Os resultados de navegador e de build desktop são registrados separadamente na PR. A operação visual do aplicativo Tauri não foi realizada neste ambiente. Esta entrega não encerra a avaliação de usabilidade da [issue #177](https://github.com/ricardocorsini/armadura-struct/issues/177).
