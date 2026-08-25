# Aster — Kiln Warden

Platformer de ação 2D que roda no navegador, feito para o canal
[ViktorKav](https://www.youtube.com/@ViktorKav). Uma fase completa, de ponta a
ponta, terminando num chefe.

A régua de sensação está escrita em [`SPEC.md`](SPEC.md): altura e altura mínima
de pulo, coyote time, jump buffer, i-frames do dash, hit-stop, câmera. A ficha
foi escrita **antes** da primeira linha de código, e é contra ela que o jogo é
auditado em [`REVIEW.md`](REVIEW.md).

## Jogar

Não tem build step. Qualquer servidor estático resolve:

```bash
python3 tools/servir.py
# ou
npx serve .
```

E abrir `index.html` pelo endereço que o servidor imprimir. Abrir o arquivo
direto pelo `file://` não funciona, porque o jogo usa módulos ES.

## Controles

| Ação | Tecla |
|---|---|
| Mover | `←` `→` ou `A` `D` |
| Pular | `Z` ou `Espaço` |
| Dash | `X` ou `Shift` |
| Tiro (segure para carregar) | `C` ou `Ctrl` |
| Pause | `P` |
| Reiniciar | `R` |

## Estrutura

```
index.html          canvas + bootstrap
src/game.js         loop principal, estados, glue
src/engine.js       motor e física (player, colisão, câmera)
src/level.js        fase, inimigos e chefe
src/input.js        teclado, jump buffer, coyote time
src/session.js      sessão e progresso
assets/             sprites, tiles, fundo e paleta
assets/source/      atlas de origem da arte
tools/              extração dos sprite-sheets e servidor local
tests/              testes do motor, da fase e dos assets
```

## Testes

```bash
node tests/engine.test.js
node tests/session.test.mjs
node tests/smoke.mjs
```

## Como isso foi feito

O **código** foi escrito por agentes de IA no MiniMax Code, com um agente por
frente (motor, fase, revisão) trabalhando ao mesmo tempo no mesmo projeto, e um
revisor cego auditando cada passe contra a `SPEC.md`.

A **arte** é minha: o personagem, os cenários, os inimigos e o chefe saíram do
mesmo material que eu já uso no canal. A máquina ficou com o código.

Mega Man X é a régua declarada de sensação do jogo — não a fonte de nada dentro
dele. Personagem, cenário, inimigos, chefe e trilha são originais.

## Licença

Sem licença aberta: todos os direitos reservados. O código está público como
prova do que foi construído, e a arte não é reutilizável.
