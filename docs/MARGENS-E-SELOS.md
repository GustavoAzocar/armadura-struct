# Modelos de margem e selo

No gerenciador de folhas, abra **Modelos de margem e selo**. Use **Novo modelo da folha** para começar com o formato, a área útil e a reserva de selo da folha atual. Escolha o nome, o formato e a orientação, edite as regiões e salve o modelo. Uma folha A1 em paisagem mede 841 × 594 mm. A margem interna fica afastada da borda do papel.

## Editar e reutilizar

- Ajuste **Área útil** por coordenadas e dimensões em milímetros ou marque dois cantos na prévia. A origem do papel está no canto inferior esquerdo. Ajuste separadamente a reserva do selo e as caixas dos campos.
- Nos campos, defina o texto estático, a caixa, a origem, a fonte, a altura, o alinhamento e a rotação. Nos textos importados, ajuste também fonte, alinhamento e rotação em **Traços e contornos**. As medidas são de papel e independem da escala das vistas. O editor aponta texto fora da caixa para que você ajuste o conteúdo ou a região.
- O contorno automático da margem e do selo aparece quando o modelo está sem desenho próprio. Ao importar ou desenhar a geometria do escritório, essa geometria passa a definir os contornos impressos. A área útil e a reserva do selo continuam servindo para validar a composição.
- **Salvar modelo** grava a revisão na biblioteca do projeto. **Duplicar modelo** cria uma definição independente, começando na revisão 1. **Exportar modelo** grava um arquivo de modelo JSON, que pode ser aberto com **Importar modelo (.json)** em outro projeto. Sem conflito, a importação preserva ID e revisão do arquivo; edições seguintes incrementam a revisão local. Se já houver um modelo com o mesmo nome ou ID, confira o nome sugerido antes de salvar a cópia independente.
- Cada aplicação incorpora a revisão à prancha. Alterar ou remover um modelo na biblioteca preserva as revisões já aplicadas. Para atualizar uma folha, aplique a revisão desejada novamente.

## Importar um desenho

1. Selecione **Importar desenho DXF/DWG** e confira as entidades, as medidas, as unidades e os avisos do leitor. Use um desenho vetorial com a margem e o carimbo no espaço de desenho que o leitor suporta. Recursos externos e imagens vinculadas podem não aparecer.
2. Defina o formato e a orientação. Se precisar corrigir a escala, indique dois pontos no desenho, a distância conhecida e sua unidade. Informe onde o primeiro ponto deve ficar no papel. Quando a unidade do arquivo for desconhecida, confira a medida e calibre antes de confirmar.
3. Confira a distância atual, a desejada e o fator na **Prévia calibrada**. Use **Usar desenho calibrado** para levar a geometria para o modelo e ajustar suas regiões. A calibração escala uniformemente o desenho e seus textos. A largura da margem interna pode ser menor que a largura nominal do papel.

O leitor indica curvas aproximadas por segmentos, entidades omitidas do espaço de papel e formatação de texto removida. Textos de fonte desconhecida usam Sans. Confira o logotipo e os textos na prévia antes de salvar. O arquivo de origem permanece disponível no local escolhido.

## Aplicar e exportar

Em **Aplicar às pranchas**, marque as folhas desejadas e use **Conferir aplicação** para revisar o formato, a orientação, a área útil e o selo. **Aplicar modelo às folhas selecionadas** grava o conjunto de alterações em uma única etapa de Desfazer/Refazer. Vistas e quadro de aço mantêm suas origens, escalas e dimensões. Se o modelo não os acomodar, o gerenciador identifica o problema para correção antes de exportar.

O **PDF de folhas** usa a mesma composição da prévia e gera uma página vetorial por prancha. Imprima em tamanho real (100%) para manter as escalas. No gerenciador, **Exportar folha ativa em DXF** e **Exportar todas as folhas em DXF** gravam a composição em milímetros de papel no espaço de desenho. As folhas saem da esquerda para a direita na ordem do projeto, com 20 mm entre elas. Cada conjunto de layers usa o prefixo `PRANCHA_001_`, `PRANCHA_002_` e assim por diante. A layer `PAPEL` de cada prancha mostra o perímetro de referência e está marcada para não plotar. O comando global **DXF** continua exportando as coordenadas físicas do modelo.

O DXF de pranchas mantém os textos editáveis e referencia as fontes Arial, Times New Roman e Courier New. O programa CAD pode substituir uma fonte ausente e alterar o encaixe do texto. Confira a tipografia no programa de destino. Uma composição inválida, caracteres de controle de texto ou espessuras sem equivalente na tabela DXF recebem diagnóstico antes da gravação.

## Compatibilidade e limites

O formato `armadurastruct/38` guarda o catálogo e as revisões incorporadas junto com vínculos de arquivos, convenções de cotagem e faixas sem traços. Usar uma faixa ou vincular arquivos em um projeto 38 não reduz sua versão. Remover o modelo também não rebaixa o projeto. Guarde uma cópia antes de salvar em formato novo.

| Arquivo de entrada      | Leitura e salvamento                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1–33                    | Migração existente para 35; selo básico preservado                                                                |
| 34 e 35                 | Vínculos e cotagem preservados; salvo em 35                                                                       |
| 36 experimental da #191 | Modelos preservados e salvo em 38; dados de vínculos, cotagem ou faixa sem traços sob esse contrato são recusados |
| 37                      | Faixa sem traços preservada; salvo em 37 enquanto não houver modelo                                               |
| 38                      | Recursos combinados; salvo em 38                                                                                  |

Projetos sem modelos não recebem um catálogo arbitrário. Modelos em arquivos 35 ou 37 são recusados; a composição exige 38. O catálogo da biblioteca usa o contrato próprio `armadurastruct.sheet-template/1`. Pacotes de detalhamento continuam em `openstruct.detail/23` ou `/24`, conforme o conteúdo da armadura; não transportam modelos globais de prancha nem concedem acesso à pasta de origem.

Os campos desta entrega são estáticos. Preenchimento automático, precedência de valores e edição em lote pertencem à AS-13. A interface bloqueia edição de modelos durante a edição isolada de um detalhamento, e a guarda central protege o catálogo global.

Os E2E geram as capturas de aplicação, calibração e folha e os arquivos reais `sheet-template-output.pdf` e `sheet-template-output.dxf`, disponíveis no artefato `sheet-template-evidence` da CI. Os testes verificam milímetros de papel e preservação das escalas. O build e os testes automatizados desktop não substituem o ensaio manual no Linux/Windows nem a abertura do DXF em outro CAD.
