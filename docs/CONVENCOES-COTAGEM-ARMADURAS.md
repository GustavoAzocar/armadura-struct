# Convenções de cotagem de armaduras

Os esquemas usam milímetros e mostram a poligonal teórica. As dobras
físicas substituem os cantos por arcos tangentes.

- **Pelo eixo:** distância entre os vértices teóricos de referência.
- **Reto entre tangências:** comprimento da parte retilínea do eixo físico.
- **Externa:** distância projetada entre as faces indicadas no esquema, em
  direções locais da peça. Na ponta livre, a face de corte é plana e normal
  ao eixo. A espessura não prolonga a ponta na direção longitudinal.
- **Desenvolvimento:** soma das retas e dos arcos do eixo físico.
  Na política atual, o comprimento de corte coincide com esse total.

## Reta

```text
face A                    face B
   |-------------------------|
   <-------- 1.000 ---------->
```

A cota externa longitudinal vai de uma face de corte à outra. Eixo, reta
efetiva, externa longitudinal e corte valem 1.000 mm neste exemplo.

## L

```text
                       C (1000,500)
                       |
                       |
A (0,0) ---------------B (1000,0)
```

Com bitola 10 mm e mandril interno de 50 mm, medir em X da face de corte A
até a superfície externa do ramo BC (1.005 mm). Em Y, medir da superfície
inferior do ramo AB à face de corte C (505 mm). Pelo eixo, AB e BC medem
1.000 e 500 mm. As retas físicas medem 970 e 470 mm.

## U

```text
A (0,600)       D (300,600)
   |                |
   |                |
B (0,0) -------- C (300,0)
```

Com a mesma bitola e mandril, a largura externa vai da superfície à
esquerda de AB à superfície à direita de CD (310 mm). A altura de cada
ramo vai da superfície inferior de BC à face de corte da respectiva
ponta (605 mm em cada lado). Pelo eixo são 300 mm de largura e 600 mm
por ramo. As retas físicas medem 570, 240 e 570 mm.

## Estribo retangular

```text
   +--------+
   |        | 500 no eixo
   +--------+
   250 no eixo
```

As duas cotas externas do corpo medem entre as superfícies externas dos
lados retos opostos. Para o corpo de 250 × 500 mm no eixo e bitola de
10 mm, medem 260 × 510 mm. A extensão dos ganchos e o envelope da peça
inteira são referências distintas das cotas do corpo.

## Formas cobertas

A convenção externa cobre reta, L e U ortogonais simples com pontas
planas, além do corpo fechado de estribos retangulares paramétricos com
quatro faces retas identificáveis. O perfil retangular aberto tem três
lados e mantém as dimensões de referência do corpo pelo eixo. Estribos
retangulares legados também mantêm a referência existente pelo eixo.
Nas demais formas, o domínio sinaliza a indisponibilidade da cotagem
externa e conserva as referências existentes para a apresentação.
Geometria inválida recebe diagnóstico. Zoom, rotação da vista e
arredondamento são tratados na apresentação.

## Memória do desenvolvimento

O comprimento geométrico é a soma das parcelas ao longo do eixo físico.
Em uma poligonal válida, pode-se somar as retas efetivas e os arcos ou
partir dos trechos teóricos, subtrair os recuos nas tangências e somar os
arcos. Quando os ganchos são construídos à parte do corpo, suas parcelas
completam o total. No estribo legado, os ganchos já fazem parte da cadeia
de trechos teóricos e entram uma única vez.

O cálculo usa o raio no eixo `R = (mandril interno + bitola) / 2` nas
dobras circulares. A hélice usa uma parcela espacial calculada com seu
diâmetro no eixo, altura útil e passo. Recuos de tangência descrevem
somente a substituição geométrica dos cantos. Na política atual, o
comprimento de corte é o próprio desenvolvimento geométrico. A soma
usa os valores internos antes da formatação.

## Consulta no CAD

Selecione a armadura ou um rebatimento e abra **Cotagem e corte** nas
propriedades. Em **Convenção de cotagem**, escolha **Pelo eixo** ou
**Externa**. O desenho identifica cada convenção como `(eixo)` ou
`(ext.)`. Cada inserção tem sua própria escolha. **Padrão do desenho**
recupera a apresentação original daquela armadura ou inserção.

Abra **Memória de corte** para consultar o esquema, comparar medidas e
conferir as parcelas. As cotas externas são marcadas no esquema quando
há referências de superfície definidas. Se a forma não tiver uma
convenção externa, o inspetor informa o motivo e o desenho conserva a
referência disponível.

## Arquivo e exportação

O projeto nativo `armadurastruct/35` e o pacote
[`openstruct.detail/23`](openstruct-detail-v23.schema.json) guardam a
convenção por armadura ou rebatimento. A ausência do campo conserva a
apresentação original em arquivos legados. No intercâmbio em mm, cm ou
m, a conversão se aplica às medidas do modelo. A convenção é uma escolha
de apresentação e viaja junto com o objeto.

Canvas, prancha, PDF e DXF usam os mesmos rótulos automáticos de cotagem.
As cotas automáticas explícitas usam cm com uma casa decimal. A unidade,
a precisão e o arredondamento da cota manual continuam definidos em
cada anotação. A relação do aço e o CSV usam o comprimento físico de
corte, incluindo quando uma anotação exibe texto manual.
