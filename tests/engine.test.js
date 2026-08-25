// tests/engine.test.js — valida engine.js + input.js conforme SPEC §3, §4, §5.
//
// Rode com:   node tests/engine.test.js
//
// Não usa libs externas; só Node + ES modules.

import {
  PLAYER_SPEED, PLAYER_ACCEL, PLAYER_DECEL,
  DASH_VEL, DASH_DURATION, DASH_COOLDOWN, DASH_IFRAMES,
  JUMP_VEL, GRAVITY, FALL_MAX,
  COYOTE_FRAMES, JUMP_BUFFER,
  WALL_SLIDE_MAX, WALL_JUMP, WALL_LOCK,
  HITSTOP_GIVE, HITSTOP_TAKE,
  KNOCKBACK_VEL, KNOCKBACK_FRAMES, INVULN_POST_HIT,
  HP_MAX,
  CAM_DEADZONE_X, CAM_DEADZONE_Y, CAM_LERP, CAM_SHAKE, CAM_SHAKE_FRAMES,
  TILE_SIZE, PROJ_VEL, PROJ_COOLDOWN,
  CHARGE_TIME, CHARGE_COOLDOWN, CHARGE_DAMAGE,
  Player, Camera, Projectile, updatePlayer,
  makeTilemapFromGrid, moveAndCollide, aabbCollision,
  isSolidTileIndex, isHazardTileIndex,
  spawnProjectile, updateProjectiles,
  loadSpriteSheet, isHitstop, setHitstop, consumeHitstop, advanceHitstop,
  applyShake, damagePlayer,
} from '../src/engine.js';
import { Input } from '../src/input.js';

// =====================================================================
// Test runner minimalista.
// =====================================================================
let pass = 0, fail = 0;
const failures = [];

function check(name, ok, details = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push({ name, details });
    console.log(`  FAIL  ${name}  ${details}`);
  }
}

function approx(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// Floor a 32 pixels abaixo do topo da área útil: chão em y=128..160.
// Player (hitbox 16x32) "em pé no chão" tem y = 128 - 32 = 96.
const GROUND_Y = 96;

function buildFloorTilemap(width = 20) {
  // Linha de chão em y=4 (y em pixels 128..160). Acima, vazio.
  const grid = [];
  for (let y = 0; y < 5; y++) {
    const row = [];
    for (let x = 0; x < width; x++) row.push(y === 4 ? 1 : 0);
    grid.push(row);
  }
  return makeTilemapFromGrid(grid);
}

function buildLedgeTilemap() {
  // Chão apenas na coluna 0; o player cai se sair do tile 0.
  const grid = [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  ];
  return makeTilemapFromGrid(grid);
}

// Helper: cria Player já em pé no chão (y=96), roda 1 update para garantir grounded.
function standingPlayer(x = 0, tilemap) {
  const p = new Player(x, GROUND_Y);
  const input = new Input();
  updatePlayer(p, input, tilemap);
  return { p, input };
}

// =====================================================================
// 1) CONSTANTES — todas devem bater com a SPEC §3, §4, §5.
// =====================================================================
console.log('\n[1] Constants (SPEC §3, §4, §5)');
const spec = {
  PLAYER_SPEED: 2.5, PLAYER_ACCEL: 0.5, PLAYER_DECEL: 0.5,
  DASH_VEL: 6, DASH_DURATION: 8, DASH_COOLDOWN: 30, DASH_IFRAMES: 12,
  JUMP_VEL: -9, GRAVITY: 0.45, FALL_MAX: 8,
  COYOTE_FRAMES: 6, JUMP_BUFFER: 6,
  WALL_SLIDE_MAX: 1.5,
  WALL_JUMP: { vx: 5, vy: -9 },
  WALL_LOCK: 6,
  HITSTOP_GIVE: 4, HITSTOP_TAKE: 6,
  KNOCKBACK_VEL: 3, KNOCKBACK_FRAMES: 8, INVULN_POST_HIT: 60,
  HP_MAX: 28,
  CAM_DEADZONE_X: 80, CAM_DEADZONE_Y: 40, CAM_LERP: 0.12,
  CAM_SHAKE: 4, CAM_SHAKE_FRAMES: 10,
  TILE_SIZE: 32, PROJ_VEL: 8, PROJ_COOLDOWN: 12,
  CHARGE_TIME: 90, CHARGE_COOLDOWN: 60, CHARGE_DAMAGE: 3,
};
const got = {
  PLAYER_SPEED, PLAYER_ACCEL, PLAYER_DECEL,
  DASH_VEL, DASH_DURATION, DASH_COOLDOWN, DASH_IFRAMES,
  JUMP_VEL, GRAVITY, FALL_MAX,
  COYOTE_FRAMES, JUMP_BUFFER,
  WALL_SLIDE_MAX,
  WALL_JUMP,
  WALL_LOCK,
  HITSTOP_GIVE, HITSTOP_TAKE,
  KNOCKBACK_VEL, KNOCKBACK_FRAMES, INVULN_POST_HIT,
  HP_MAX,
  CAM_DEADZONE_X, CAM_DEADZONE_Y, CAM_LERP,
  CAM_SHAKE, CAM_SHAKE_FRAMES,
  TILE_SIZE, PROJ_VEL, PROJ_COOLDOWN,
  CHARGE_TIME, CHARGE_COOLDOWN, CHARGE_DAMAGE,
};
let constantsOK = true;
for (const k of Object.keys(spec)) {
  const exp = spec[k];
  const v   = got[k];
  const ok  = JSON.stringify(exp) === JSON.stringify(v);
  if (!ok) constantsOK = false;
  console.log(`  ${ok ? '  ' : '!!'} ${k.padEnd(18)} esperado=${JSON.stringify(exp).padEnd(20)} obtido=${JSON.stringify(v)}`);
}
check('Todas constantes batem com a SPEC', constantsOK);

// =====================================================================
// 2) MOVIMENTO HORIZONTAL — 60 frames de 'right' → x = 150, sem drift.
// =====================================================================
console.log('\n[2] Movimento horizontal (60 frames de input "right")');
{
  const tm = buildFloorTilemap(20);
  const { p, input } = standingPlayer(0, tm);
  check('Player settled no chão', p.grounded, `grounded=${p.grounded}, y=${p.y}`);

  // Pula a fase de aceleração (5 frames para velX = 2.5): seta direto em max.
  p.velX = PLAYER_SPEED;
  p.x = 0;

  // 60 frames de "right" a velocidade máxima.
  for (let i = 0; i < 60; i++) {
    input.press('KeyD'); // KeyD = direita
    updatePlayer(p, input, tm);
  }
  check('pos.x == 150 após 60 frames', p.x === 150, `x=${p.x}, esperado=150`);

  // Solta o botão. 10 frames sem input → deve parar em ~5 frames.
  input.release('KeyD');
  for (let i = 0; i < 10; i++) updatePlayer(p, input, tm);
  check('velX == 0 após soltar (sem drift)', approx(p.velX, 0),
        `velX=${p.velX}, esperado 0`);
check('Player continua no chão (y estável)', p.grounded, `grounded=${p.grounded}, y=${p.y}`);
}

// =====================================================================
// 2b) SIMETRIA HORIZONTAL — esquerda e reversão devem espelhar direita.
// =====================================================================
console.log('\n[2b] Movimento à esquerda e reversão');
{
  const tm = buildFloorTilemap(40);
  const { p, input } = standingPlayer(120, tm);

  input.press('KeyA');
  for (let i = 0; i < 5; i++) updatePlayer(p, input, tm);
  check('Esquerda acelera até -PLAYER_SPEED', approx(p.velX, -PLAYER_SPEED), `velX=${p.velX}`);
  check('Esquerda desloca o player para trás', p.x < 120, `x=${p.x}`);

  input.release('KeyA');
  input.press('KeyD');
  for (let i = 0; i < 10; i++) updatePlayer(p, input, tm);
  check('Reverter de esquerda para direita chega a PLAYER_SPEED',
        approx(p.velX, PLAYER_SPEED), `velX=${p.velX}`);

  input.release('KeyD');
  input.press('KeyA');
  for (let i = 0; i < 10; i++) updatePlayer(p, input, tm);
  check('Reverter de direita para esquerda chega a -PLAYER_SPEED',
        approx(p.velX, -PLAYER_SPEED), `velX=${p.velX}`);
}

// =====================================================================
// 2c) BUFFER — um pulo aceito não pode disparar novamente no frame seguinte.
// =====================================================================
console.log('\n[2c] Consumo do jump buffer');
{
  const tm = buildFloorTilemap(20);
  const { p, input } = standingPlayer(50, tm);
  input.press('KeyZ');
  updatePlayer(p, input, tm);
  const firstFrameVelY = p.velY;
  check('Pulo aceito consome o buffer imediatamente', input.jumpBufferFrames() === 0,
        `buffer=${input.jumpBufferFrames()}`);
  updatePlayer(p, input, tm);
  check('Segundo frame do pulo só aplica gravidade',
        approx(p.velY, firstFrameVelY + GRAVITY), `velY=${p.velY}, primeiro=${firstFrameVelY}`);
}

// =====================================================================
// 2d) INPUT — KeyJ é exclusivamente pulo; C/Ctrl ficam com o tiro.
// =====================================================================
console.log('\n[2d] Mapeamento KeyJ');
{
  const input = new Input();
  input.press('KeyJ');
  check('KeyJ aciona pulo', input.isDown('jump'));
  check('KeyJ não aciona tiro', !input.isDown('shoot'));
}

// =====================================================================
// 2e) HIT-STOP — avanço explícito consome no máximo um frame por tick.
// =====================================================================
console.log('\n[2e] Avanço seguro do hit-stop');
{
  consumeHitstop();
  setHitstop(2);
  check('advanceHitstop mantém ativo após consumir o primeiro frame', advanceHitstop() === true && isHitstop());
  check('advanceHitstop informa o último frame consumido', advanceHitstop() === true && !isHitstop());
  check('advanceHitstop é seguro quando já está inativo', advanceHitstop() === false && !isHitstop());
}


// =====================================================================
// 3) COYOTE TIME — pula 6 frames após sair do chão, ainda funciona.
// =====================================================================
console.log('\n[3] Coyote time (6 frames no ar → pulo ainda funciona)');
{
  const tm = buildLedgeTilemap();  // chão só na coluna 0
  const { p, input } = standingPlayer(0, tm);
  check('Player settled no chão da ledge', p.grounded, `grounded=${p.grounded}, y=${p.y}`);

  // Anda para a direita em vel max. Hitbox (x, x+16). Está sobre tx=0 enquanto
  // x < 32. Em x=32, hitbox vai até 48, ainda sobre tx=1 (que NÃO é sólido).
  // Concretamente: walk off no 13º frame (i=12, x=32.5).
  // 13 iters de caminhada → 1 frame no ar (o último). Coyote=1 ao fim.
  p.velX = PLAYER_SPEED;
  for (let i = 0; i < 13; i++) {
    input.press('KeyD');
    updatePlayer(p, input, tm);
  }
  check('Player caiu da ledge (in air)', !p.grounded,
        `grounded=${p.grounded}, y=${p.y}, x=${p.x}`);

  // 4 frames adicionais no ar (total = 5 frames no ar). Coyote deve estar válido.
  for (let i = 0; i < 4; i++) {
    updatePlayer(p, input, tm);
  }
  check('5 frames no ar: coyote ainda válido', input.canCoyoteJump(),
        `coyoteFrames=${input.coyoteFrames()}`);

  // 6º frame: pressionamos jump. Coyote deve permitir.
  input.press('KeyZ');
  updatePlayer(p, input, tm);
  check('6 frames no ar: pulou via coyote (velY < 0)', p.velY < 0,
        `velY=${p.velY}, coyoteFrames=${input.coyoteFrames()}`);

  // Segundo cenário: 7 frames no ar SEM pular → coyote deve expirar.
  const p2 = new Player(0, GROUND_Y);
  const input2 = new Input();
  updatePlayer(p2, input2, tm);  // settle
  p2.velX = PLAYER_SPEED;
  for (let i = 0; i < 13; i++) { input2.press('KeyD'); updatePlayer(p2, input2, tm); }
  // 6 frames adicionais no ar, sem pular (total = 7 frames no ar).
  for (let i = 0; i < 6; i++) updatePlayer(p2, input2, tm);
  check('7 frames no ar: coyote EXPIROU', !input2.canCoyoteJump(),
        `coyoteFrames=${input2.coyoteFrames()}`);
}

// =====================================================================
// 4) DASH — durante 12 frames iniciais, isInvuln() == true.
// =====================================================================
console.log('\n[4] Dash: 12 i-frames no INÍCIO');
{
  const tm = buildFloorTilemap(30);
  const { p, input } = standingPlayer(0, tm);

  // Aperta dash.
  input.press('KeyX');
  const iframeSamples = [];
  for (let i = 0; i < 15; i++) {
    updatePlayer(p, input, tm);
    iframeSamples.push({ frame: i, iframes: p.iframeFrames, invuln: p.isInvuln(), dashing: p.isDashing() });
  }
  // Nos primeiros 12 frames (i=0..11), isInvuln() deve ser true.
  for (let i = 0; i < DASH_IFRAMES; i++) {
    check(`frame ${i}: isInvuln() == true`, iframeSamples[i].invuln,
          `iframes=${iframeSamples[i].iframes}, dashing=${iframeSamples[i].dashing}`);
  }
  // No 13º frame (i=12), iframes deve estar em 0 e isInvuln() false.
  check('frame 12: isInvuln() == false', !iframeSamples[12].invuln,
        `iframes=${iframeSamples[12].iframes}`);

  // DASH_COOLDOWN deve estar em efeito após o dash.
  check(`dashCooldown >= DASH_DURATION`, p.dashCooldown >= DASH_DURATION,
        `dashCooldown=${p.dashCooldown}, DASH_DURATION=${DASH_DURATION}`);
}

// =====================================================================
// 5) BÔNUS — câmera, colisão AABB, cut-jump, hit-stop, etc.
// =====================================================================
console.log('\n[5] Bônus — câmera, colisão, cut-jump, jump buffer');
{
  // 5a) Câmera com deadzone e shake.
  const cam = new Camera(480, 270, 4096, 288);
  const fakePlayer = { x: 100, y: 100, w: 16, h: 32 };
  cam.snapTo(fakePlayer);
  check('Câmera inicializada (sanity)', cam.viewW === 480 && cam.viewH === 270,
        `view=${cam.viewW}x${cam.viewH}`);

  cam.applyShake(CAM_SHAKE, CAM_SHAKE_FRAMES);
  check('applyShake: shakeFrames setado', cam.shakeFrames === CAM_SHAKE_FRAMES,
        `shakeFrames=${cam.shakeFrames}`);

  // 5b) Colisão AABB.
  const a = { x: 0, y: 0, w: 10, h: 10 };
  const b = { x: 5, y: 5, w: 10, h: 10 };
  const c = { x: 100, y: 100, w: 10, h: 10 };
  check('aabb overlap', aabbCollision(a, b) === true);
  check('aabb não-overlap', aabbCollision(a, c) === false);

  // 5c) Pulo: velY impulsionado para JUMP_VEL e gravidade aplicada no MESMO frame.
  // Verificamos que velY é próximo de JUMP_VEL+GRAVITY (após 1 step de gravidade).
  {
    const tm = buildFloorTilemap(20);
    const { p, input } = standingPlayer(50, tm);
    check('Settled antes do pulo', p.grounded);
    input.press('KeyZ');
    updatePlayer(p, input, tm);
    // Após o frame: velY = JUMP_VEL + GRAVITY = -9 + 0.45 = -8.55
    const expectedAfterGravity = JUMP_VEL + GRAVITY;
    check('Pulo: velY próximo de JUMP_VEL+GRAVITY após 1 frame',
          approx(p.velY, expectedAfterGravity, 0.01),
          `velY=${p.velY}, esperado≈${expectedAfterGravity}`);
  }

  // 5d) Cut-jump: ao soltar jump com velY muito negativo, capa em -3 (depois +gravidade).
  {
    const tm = buildFloorTilemap(20);
    const { p, input } = standingPlayer(50, tm);
    // Pula.
    input.press('KeyZ');
    updatePlayer(p, input, tm);
    // Mantém pressionado por mais um frame (pulo sobe).
    updatePlayer(p, input, tm);
    // Agora solta: velY deve ser capado em -3 (cut-jump).
    input.release('KeyZ');
    updatePlayer(p, input, tm);
    // Após cut-jump: velY = -3, depois gravity → -3 + 0.45 = -2.55
    const expectedAfterCut = -3 + GRAVITY;
    check('Cut-jump: velY capado em -3 (após gravidade)',
          approx(p.velY, expectedAfterCut, 0.01),
          `velY=${p.velY}, esperado≈${expectedAfterCut}`);
    check('Cut-jump: velY >= -3 (não sobe mais rápido que o cap)',
          p.velY >= -3, `velY=${p.velY}`);
  }

  // 5e) Jump buffer: input antes do chão vale.
  {
    const tm = buildFloorTilemap(20);
    // Player caindo, longe do chão.
    const p = new Player(0, 0);
    const input = new Input();
    // Pressiona jump no ar.
    input.press('KeyZ');
    updatePlayer(p, input, tm);  // player ainda caindo, não ground, não coyote
    // O buffer deve estar ativo (JUMP_BUFFER=6 frames).
    check('Jump buffer setado após pressionar no ar',
          input.jumpBufferFrames() > 0,
          `buffer=${input.jumpBufferFrames()}`);
    // Verifica que JUMP_BUFFER frames totais (lê em frames subsequentes).
    for (let i = 0; i < JUMP_BUFFER; i++) {
      check(`buffer ainda > 0 no frame ${i+1}`, input.jumpBufferFrames() > 0,
            `buffer=${input.jumpBufferFrames()}`);
      updatePlayer(p, input, tm);
    }
    check(`buffer == 0 após ${JUMP_BUFFER} frames`, input.jumpBufferFrames() === 0,
          `buffer=${input.jumpBufferFrames()}`);
  }

  // 5f) Hit-stop global.
  setHitstop(4);
  check('isHitstop() == true após setHitstop', isHitstop() === true);
  consumeHitstop();
  check('consumeHitstop zera hit-stop', isHitstop() === false);

  // 5g) HP_MAX exporta 28.
  const p3 = new Player(0, 0);
  check('Player.hp inicial == HP_MAX', p3.hp === HP_MAX, `hp=${p3.hp}`);

  // 5h) TILE_SIZE == 32.
  check('TILE_SIZE == 32', TILE_SIZE === 32, `TILE_SIZE=${TILE_SIZE}`);

  // 5i) Load sprite sheet (com mock).
  const mockImg = { width: 32 * 12, height: 48 };
  const ss = loadSpriteSheet(mockImg, 32, 48);
  check('loadSpriteSheet conta 12 frames', ss.count === 12, `count=${ss.count}`);

  // 5j) Projectile spawn e update.
  const p4 = new Player(50, 50);
  p4.facing = 1;
  const proj = spawnProjectile(p4, 'normal');
  check('Projétil normal: damage=1', proj.damage === 1, `damage=${proj.damage}`);
  check('Projétil normal: vx positivo (direita)', proj.vx > 0, `vx=${proj.vx}`);

  const charge = spawnProjectile(p4, 'charge');
  check('Projétil charge: damage=3', charge.damage === CHARGE_DAMAGE,
        `damage=${charge.damage}, esperado=${CHARGE_DAMAGE}`);

  // 5k) Tile sólido / hazard.
  check('isSolidTileIndex(1) true', isSolidTileIndex(1) === true);
  check('isSolidTileIndex(3) true', isSolidTileIndex(3) === true);
  check('isSolidTileIndex(0) false', isSolidTileIndex(0) === false);
  check('isHazardTileIndex(3) true', isHazardTileIndex(3) === true);
  check('isHazardTileIndex(1) false', isHazardTileIndex(1) === false);

  // 5l) Damage: toma hit, hp reduz, knockback + invuln ativam.
  {
    const tm = buildFloorTilemap(20);
    const { p, input } = standingPlayer(50, tm);
    const took = damagePlayer(p, 4, 200);  // hit vindo da direita
    check('damagePlayer retorna true em hit válido', took === true);
    check('hp reduzido em 4', p.hp === HP_MAX - 4, `hp=${p.hp}`);
    check('knockbackFrames > 0', p.knockbackFrames > 0, `knockbackFrames=${p.knockbackFrames}`);
    check('invulnFrames > 0', p.invulnFrames > 0, `invulnFrames=${p.invulnFrames}`);
    check('isInvuln() == true após dano', p.isInvuln() === true);
    check('isHitstop() == true após dano (HITSTOP_TAKE)', isHitstop() === true);
    // Segundo hit não aplica (invuln).
    consumeHitstop();
    const took2 = damagePlayer(p, 4, 200);
    check('Segundo hit durante invuln: damagePlayer retorna false', took2 === false);
    check('hp não mudou durante invuln', p.hp === HP_MAX - 4, `hp=${p.hp}`);

    const doomed = new Player(50, GROUND_Y);
    doomed.hp = 1;
    consumeHitstop();
    const lethal = damagePlayer(doomed, 1, 200);
    check('Dano letal mata o player', lethal && !doomed.alive && doomed.hp === 0);
    check('Dano letal também aplica HITSTOP_TAKE', isHitstop() === true);
    consumeHitstop();
  }
}

// =====================================================================
// Relatório.
// =====================================================================
console.log('\n========================================');
console.log(`Total: ${pass} pass / ${fail} fail`);
if (fail > 0) {
  console.log('\nFalhas:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.details}`);
  process.exit(1);
}
process.exit(0);
