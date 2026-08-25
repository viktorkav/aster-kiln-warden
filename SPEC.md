# SPEC — Mega Man X Feel Sheet (fonte de verdade)

> Esta ficha dita **toda decisão de sensação** do jogo. Qualquer trade-off entre
> "parecer Mega Man X" e "ser mais fácil de implementar" → **MMX ganha**.
> O time deve seguir números à risca. Onde houver divergência entre código e spec,
> a spec vence.

## 1. Identidade do jogo

- Gênero: platformer de ação 2D, rolagem lateral
- Uma fase completa, terminando em um chefe
- Roda no navegador (HTML5 Canvas2D + JS vanilla, sem build step)
- Resolução lógica: **480×270**, escalada 2× para **960×540**
- Frame rate fixo: **60 FPS** (delta fixo de 1/60 s, lógica desacoplada de render)

## 2. Paleta e dimensões (imutáveis — todos os assets e código devem respeitar)

| Item              | Tamanho        | Origem                |
|-------------------|----------------|-----------------------|
| Tileset           | 32×32 cada     | `assets/tiles-v2.png` |
| Sprite do player  | 76×56          | `assets/player-v2.png`|
| Hitbox do player  | 16×32 (centrado)| convenção            |
| Sprite do chefe   | 128×96         | `assets/boss-v2.png`  |
| Hitbox do chefe   | 64×80 (centrado)| convenção            |
| Projétil          | 8×8            | `assets/effects-v2.png`|
| Paleta total      | ≤ 16 cores     | combinar todas as PNGs |

> Sprites entregues como **sprite-sheets horizontais** (frames lado a lado,
> fundo transparente). A arte v2 usa uma paleta original compartilhada de
> 16 cores e substitui os placeholders geométricos da primeira versão.
>
> **Fundo transparente é alpha 0, não alpha baixo.** Os sheets v2 saíram uma vez
> com o índice da cor-chave em alpha 23, e todo sprite passou a desenhar um
> retângulo cinza a 9% de opacidade em volta de si.
>
> **Uma escala por sheet.** Todo frame de um mesmo sheet é reamostrado com o
> mesmo fator e apoiado na mesma linha de base. Escalar cada frame até preencher
> a célula faz o personagem mudar de tamanho de um frame para o outro — foi o que
> deixou o ciclo de andar aos trancos e o chefe encolhendo ao atirar. Os sheets
> são gerados por `tools/extrair-player.py` e `tools/extrair-boss.py` a partir
> dos atlas em `assets/source/`; não se edita o PNG final à mão.
>
> **A célula não é quadrada, e a linha de base não é a última linha dela.** A
> largura precisa caber o personagem de braço esticado (o dash do player pede 62
> px; o braço-canhão do chefe, 104) — antes o desenho saía fatiado numa borda
> reta. E abaixo da linha de base ficam linhas reservadas para o que se derrama
> no chão: a poça de escória do chefe derrotado escorre 12 px abaixo do corpo,
> e apoiar a poça no piso deixava o chefe boiando.
>
> **Ciclo é ciclo.** As quatro poses de uma volta têm de ser distintas entre si
> de forma parelha, e o corpo sobe alguns pixels nos quadros de passagem. Duas
> poses quase iguais numa volta de quatro leem como tranco de dois frames, por
> mais correta que esteja a escala.

## 3. Movimento do jogador (números MMX canônicos)

Todos os valores em **pixels por frame** a 60 FPS, salvo indicação.

| Parâmetro                | Valor                              |
|--------------------------|------------------------------------|
| Velocidade de andar      | 2.5 px/frame (150 px/s)            |
| Aceleração horizontal    | 0.5 px/frame² até vel. máx          |
| Desaceleração (sem input)| 0.5 px/frame² (para em ~5 frames)  |
| Dash velocidade          | 6 px/frame (360 px/s)              |
| Dash duração             | 8 frames                           |
| Dash cooldown            | 30 frames                          |
| Dash i-frames            | 12 frames (a partir do início)     |
| Pulo (impulso inicial)   | -9 px/frame (vel. vertical)        |
| Gravidade                | 0.45 px/frame²                     |
| Queda máxima             | 8 px/frame (480 px/s)              |
| Coyote time              | 6 frames (pula após sair do chão)  |
| Jump buffer              | 6 frames (input antes do chão vale)|
| Cut-jump (soltar botão)  | se vel.y < -3, vira -3 (pulo curto)|
| Wall slide vel. terminal  | 1.5 px/frame (subindo só cai)      |
| Wall jump vel.           | (-9, 5) px/frame, longe da parede  |
| Wall jump lock input     | 6 frames (não gruda de novo)       |
| Hit-stop em hit          | 4 frames (player bate em inimigo)  |
| Knockback                | 3 px/frame, 8 frames, sem input    |
| Invuln pós-hit           | 60 frames (sprite pisca 2/3)       |

**Sensação chave:** o jogador para IMEDIATAMENTE ao soltar o direcional
(andar, não deslizar). Dash é uma explosão curta, não uma corrida longa.
Pulo tem peso — sobe rápido, cai devagar no começo, depois acelera.

## 4. Combate

| Parâmetro                | Valor                              |
|--------------------------|------------------------------------|
| HP máximo                | 28                                 |
| Tiro normal dano         | 1                                  |
| Tiro normal vel.         | 8 px/frame (480 px/s)              |
| Tiro normal cooldown     | 12 frames                          |
| Charge shot (segurar 90f)| ativa, dano 3, vel 6, 16×16 sprite |
| Charge shot cooldown     | 60 frames                          |
| Hit-stop (player acerta) | 4 frames                           |
| Hit-stop (player é atingido)| 6 frames                        |
| Inimigo morre em         | 1 tiro normal OU 1 charge          |
| Drop de energy (inimigo) | 50% chance, +2 HP, item cai        |
| Drop de big energy (chefe)| garantido, enche HP                |

## 5. Câmera e mundo

| Parâmetro                | Valor                              |
|--------------------------|------------------------------------|
| Mundo tamanho (fase)     | 128 tiles × 9 tiles = 4096×288 px  |
| Câmera deadzone X        | ±80 px em torno do player          |
| Câmera deadzone Y        | ±40 px                            |
| Câmera lerp              | 0.12 (suavização, sem atraso duro) |
| Câmera clamp             | não sai dos limites do mundo       |
| Screen shake intensidade | 4 px                               |
| Screen shake duração     | 10 frames                          |
| Cor de fundo do céu      | time do dia = dia (azul claro)     |

## 6. Assets

Todos em PNG com fundo **transparente**, paleta ≤ 16 cores consistente
com `tiles-v2.png`.

### 6.1 `assets/player-v2.png` — Aster, sprite-sheet do herói

- Largura: 48 × N px, Altura: 48 px
- Frames (em ordem, da esquerda para a direita):
  1. Idle (0)
  2. Idle (1)
  3. Idle (2)
  4. Idle (3)
  5. Andar (0)
  6. Andar (1)
  7. Andar (2)
  8. Andar (3)
  9. Pulo (subindo)
  10. Pulo (caindo)
  11. Dash
  12. Tiro (parado)
  13. Hit
  14. Andar atirando (0)
  15. Andar atirando (1)
  16. Andar atirando (2)
  17. Andar atirando (3)
  18. Charge cheio (parado, esfera na garra)
- Total: **18 frames** → `player-v2.png` 1368×56
- Os frames 5-8 e 14-17 são a mesma corrida, uma sem e uma com o braço esticado,
  e vêm do mesmo atlas (`assets/source/aster-atlas-corrida.png`). Os 14-17 são
  ancorados pelas PERNAS nos 5-8: é o que faz a troca entre andar e
  andar-atirando não escorregar de lado no meio da passada.
- Os quadros 6 e 8 da corrida tiram os dois pés do chão e pousam 1 px acima da
  linha de base. É o salto da passada, não desalinho.
- Estilo: salvage-runner original com visor triangular, energy fin assimétrica,
  scarf-tail e ferramenta mecânica que não é um arm cannon.
- Paleta: âmbar, marfim, teal profundo, coral, navy e cyan claro.

### 6.2 `assets/tiles-v2.png` — tileset da fundição orbital

- Largura: 32 × N, Altura: 32 px
- Tiles (ordem importa — indexados por número):
  - 0: vazio/transparente
  - 1: chão/parede sólida (metal/sci-fi)
  - 2: plataforma (com detalhe de parafuso nas bordas)
  - 3: espinho (mata instantaneamente)
  - 4: checkpoint (bandeira/pulso)
  - 5: tile de fundo (skybox leve, sem colisão)
  - 6: portal para a sala do chefe (porta grande)
- Total: **7 tiles** → `tiles-v2.png` 224×32

### 6.3 `assets/boss-v2.png` — Kiln Warden

- Largura: 96 × N, Altura: 96 px
- Frames:
  1. Idle (0)
  2. Idle (1)
  3. Idle (2)
  4. Idle (3)
  5. Ataque 1 — disparar (0)
  6. Ataque 1 — disparar (1)
  7. Ataque 2 — charge (0)
  8. Ataque 2 — charge (1)
  9. Ataque 2 — charge (2)
  10. Ataque 3 — spread (0)
  11. Ataque 3 — spread (1)
  12. Hit (pisca branco)
  13. Death (frame único de derrota)
- Total: **13 frames** → `boss-v2.png` 1248×96
- Estilo: guardião industrial não humano, placas cerâmicas, núcleo-fornalha
  e silhueta própria sem referência direta a personagens existentes.

### 6.4 Assets v2 adicionais

- `assets/enemies-v2.png`: 12 frames 32×32 — crawler, drone e turret.
- `assets/effects-v2.png`: 4 frames 32×32 — bolt, charge, energy e big energy.
- `assets/background-v2.png`: fundo parallax 960×270 da fundição orbital.
- `assets/palette-v2.png`: paleta compartilhada de 16 cores.
- Os PNGs sem sufixo `-v2` permanecem como legado reversível e não são
  carregados pelo jogo.

## 7. Inimigos comuns (3 tipos)

| Tipo        | HP | Comportamento                                                |
|-------------|----|--------------------------------------------------------------|
| Walker      | 1  | Anda até a borda da plataforma, vira, segue                |
| Flyer       | 1  | Pairado, dispara tiro a cada 90 frames, segue player no X   |
| Turret      | 1  | Estático, dispara reto a cada 60 frames, à distância         |

Todos dropam energy (50%). Nenhum drop obrigatório — jogo não trava sem.

## 8. Chefe — Kiln Warden (3 fases por HP)

- HP total: **28**
- Transição de fase: telegrafada (som + cor da aura muda por 60 frames)
- Padrões:
  1. **Phase 1 (HP 28→19) — Tiro reto:** dispara 1 projétil a cada 50 frames, vel 4 px/frame, horizontal
  2. **Phase 2 (HP 18→10) — Charge telegraph:** brilha vermelho por 60 frames, depois avança 6 px/frame por 20 frames na direção do player, com 30 frames de i-frames no chefe durante o charge
  3. **Phase 3 (HP 9→0) — Spread shot:** dispara 3 projéteis em leque (-15°, 0°, +15°), vel 4 px/frame, a cada 70 frames
- Após cada pattern concluído: 90 frames de descanso (chefe parado, vulnerável)
- Hit-stop quando o player acerta o chefe: 4 frames
- Ao morrer: freeze 30 frames, fade out 60 frames, vitória

## 9. UI / HUD

- HP como barra inferior (mesma posição MMX: topo-esquerda, 80×8 px)
- Nome do chefe aparece no topo ao entrar na sala (fonte pixel, 16px, branco com outline preto)
- "READY" no início, "GO!" 30 frames depois
- Sem menus — o jogo abre direto na fase

## 10. Game feel (não-negociável)

1. **Coyote time + jump buffer** são obrigatórios. Sem eles, não é MMX.
2. **Hit-stop visível** em todo impacto. Sem ele, os hits parecem fracos.
3. **Dash com i-frames** é o botão de "salvação". Deve ser generoso.
4. **Charge shot deve parecer poderoso** — sprite maior, mais lento, knockback.
5. **Screen shake** em todos os hits (player recebe OU dá).
6. **Câmera segue suave, mas não preguiçosa** — lerp 0.12, deadzone 80×40.
7. **Tile de espinho = morte instantânea**, sem hit-stop, sem knockback. Just MMX.
8. **Boss i-frames durante charge** — recompensa o esquiva, não o spam.

## 11. Estrutura de arquivos esperada

```
mmx-platformer/
├── index.html              # canvas + bootstrap
├── SPEC.md                 # este arquivo
├── src/
│   ├── game.js             # loop principal, estado, glue
│   ├── engine.js           # motor/física (player, colisão, câmera)
│   ├── level.js            # fase/inimigos (layout, inimigos, chefe)
│   └── input.js            # teclado, buffer, coyote
├── assets/
│   ├── player-v2.png       # Aster, 13 frames
│   ├── tiles-v2.png        # fundição orbital, 7 tiles
│   ├── boss-v2.png         # Kiln Warden, 13 frames
│   ├── enemies-v2.png      # 3 famílias, 4 frames cada
│   ├── effects-v2.png      # projéteis e energy drops
│   ├── background-v2.png   # fundo parallax
│   └── palette-v2.png      # paleta compartilhada
└── REVIEW.md               # relatório do revisor
```

## 12. Critérios de aceitação (o revisor deve auditar)

- [ ] Frame rate trava em 60 FPS (lógica com delta fixo)
- [ ] Coyote time e jump buffer funcionam (pular 6 frames após sair do chão)
- [ ] Dash com 12 i-frames atravessando 1 inimigo
- [ ] Hit-stop visível em todo dano trocado
- [ ] Chefe tem 3 fases distintas com telegraphs claros
- [ ] Sprites alinhados aos tamanhos da seção 2
- [ ] Câmera não treme, segue suave, não sai do mundo
- [ ] Jogo carrega em `index.html` sem build step, sem erros no console
- [ ] Derrota do chefe dispara vitória (sem tela de score — sem menu)
- [ ] Nenhum personagem, inimigo, projétil ou pickup usa placeholder geométrico
