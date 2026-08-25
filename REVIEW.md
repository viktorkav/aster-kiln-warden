# REVIEW — mmx-platformer (auditoria contra SPEC.md)

> **Aviso de 2026-08-19:** este PASS histórico foi invalidado por uma auditoria
> posterior, que reproduziu falhas de movimento à esquerda, pausa, jump buffer,
> checkpoint, hit-stop global e reinício. A atualização visual v2 não altera
> essas regras de gameplay. Consulte os testes novos e a revisão mais recente
> antes de usar este documento como sinal de aprovação.

**Auditor:** subagente de revisão (verifier) — 1ª auditoria FAIL (estado intermediário, 14:34 BRT); re-auditoria final PASS (15:15 BRT)
**Alvo:** `/Users/viktorkav/.minimax-agent/projects/mmx-platformer/`
**Spec consultada:** `SPEC.md` (todas as 12 seções; checklist §12 integral)

---

## Resumo executivo

**Veredito final: PASS** — integração entregue, testes verdes, física/combate
batem com a SPEC. O jogo roda no navegador (validado em runtime: 60 FPS, FSM,
combate, chefe spawnando em x>3680; usuário jogou até o chefe, HP 28→10).

Histórico: a 1ª auditoria (14:34) deu FAIL porque auditou um estado
intermediário — faltavam `index.html`, `game.js`, `level.js` e a arte tinha
defeitos (player dash/shoot cortados, tiles checkpoint/boss_door com clipping,
boss hit/death encolhidos). Desde então: fix de arte direcionado (deepseek,
onda 2) refez 10 frames do player + 2 tiles + 2 frames do boss; a integração
(level.js + game.js + index.html) foi escrita pelo orquestrador com a API real
do motor. Re-auditoria: **PASS** com 2 achados acionáveis, ambos corrigidos
pelo orquestrador (shake ao player receber dano; frame de tiro agora
renderizado).

---

## Checklist SPEC §12 (re-auditoria final)

- ✅ **60 FPS delta fixo** — `game.js` `FIXED_DT=1/60`, accumulator com clamp.
- ✅ **Coyote 6f + jump buffer 6f** — `input.js`; testes dedicados no engine.test.js.
- ✅ **Dash 12 i-frames atravessa inimigo** — `engine.js:525`; `damagePlayer` recusa hit durante invuln.
- ✅ **Hit-stop em todo dano trocado** — give 4, take 6, freeze global.
- ✅ **Chefe 3 fases + telegraphs** — thresholds 19/10 (`level.js`), telegraph 60f com glow vermelho; smoke valida P1/P2/P3.
- ✅ **Sprites alinhados §2** — PIL: player 384×48 RGBA, tiles 224×32 RGBA, boss 1248×96 RGBA, todos 16 cores opacas + transparência.
- ✅ **Câmera suave, não sai do mundo** — deadzone 80/40, lerp 0.12, clamp.
- ✅ **Carrega sem build** — módulo vanilla, ids/URLs batem, runtime validado.
- ✅ **Derrota do chefe → vitória** — freeze 30f + fade 60f, "MISSION COMPLETE", sem menu.
- ✅ **Sem placeholder** — 3 PNGs do subagente de arte (dimensões/modo/paleta verificados).

## Testes executados

| Checagem | Resultado |
|---|---|
| `node tests/engine.test.js` | 61 pass / 0 fail |
| `node tests/smoke.mjs` | 34 passed / 0 failed |
| `node --check` ×4 (engine, input, level, game) | OK |
| PIL (3 PNGs) | 384×48 / 224×32 / 1248×96, RGBA, 16 opacas + transparência |
| API engine ↔ level/game (imports cruzados) | nenhum missing |

## Achados da re-auditoria (todos corrigidos)

1. **Menor — corrigido:** player recebia dano sem screen shake (`game.js`
   agora chama `applyShake(camera)` em todo dano recebido — SPEC §10.5).
2. **Cosmética — corrigido:** frame 10 (shoot) nunca era selecionado
   (`pickPlayerFrame` agora usa o frame de tiro ao carregar/tirar).

## Trade-offs aprovados (justificados pela física real)

- **Gap de 2 tiles** (não 4): voo máximo ~100px (40f × 2.5px/f); 4 tiles (128px) seria intransponível.
- **Plataforma na linha 5**: altura de pulo 90px; linha 4 exigiria 96px.
- **Espinhos na linha 6** (corpo do player): na linha 7 só acertariam pés caindo.
- **Boss `stateTimer = intervalo×2+1`**: 3 tiros por padrão (t=0/50/100 e 0/70/140).
- **Inimigos in-code**: SPEC §6 exige sheets só de player/tiles/boss.
- **Frame mapping (12/13 frames)**: resolve a inconsistência interna da §6.1.

## Observações carry-over (engine/input, sem bloqueio)

`WALL_JUMP {vx:5, vy:-9}` semanticamente correto (spec escreve "(-9,5)" com
eixos trocados); cooldown extra pós-charge (`PROJ_COOLDOWN*2`) não documentado;
`_dashBuffer=7` hardcoded. Nenhum afeta jogabilidade.

---
**Status final: PASS — jogo entregue e jogável em http://localhost:8000**
