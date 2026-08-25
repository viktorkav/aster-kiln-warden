// game.js — glue: loop principal (delta fixo 1/60), FSM, combate, render, HUD.
// ES module, vanilla, sem build step. Ver SPEC.md §9, §10, §11.
//
// FSM: READY (30f) -> PLAY -> (vitória: freeze 30f + fade 60f) -> WIN
//      morte: player.alive=false -> cai -> respawn no checkpoint (HP cheio, 60f invuln)

import {
  TILE_SIZE,
  HP_MAX,
  HITSTOP_GIVE,
  aabb,
  advanceHitstop,
  applyShake,
  consumeHitstop,
  consumePendingShot,
  damagePlayer,
  loadSpriteSheet,
  playerAnimationFrame,
  resetPlayer,
  setHitstop,
  spawnProjectile,
  updatePlayer,
  updateProjectiles,
} from './engine.js';
import { Input } from './input.js';
import { LEVEL_GRID, enemyAnimationFrame } from './level.js';
import {
  applyBossReward,
  createRunState,
  nextPauseState,
  respawnPoint,
} from './session.js';

export const VIEW_W = 480;
export const VIEW_H = 270;
export const FIXED_DT = 1 / 60;

// ----------------------------------------------------------------------------
// CARREGAMENTO DE ASSETS V2 (SPEC §6)
// ----------------------------------------------------------------------------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('falha ao carregar ' + src));
    img.src = src;
  });
}

const ASSET_BASE = new URL('../assets/', import.meta.url);
const [backgroundImg, playerImg, tilesImg, bossImg, enemiesImg, effectsImg] = await Promise.all([
  loadImage(new URL('background-v2.png', ASSET_BASE).href),
  loadImage(new URL('player-v2.png', ASSET_BASE).href),
  loadImage(new URL('tiles-v2.png', ASSET_BASE).href),
  loadImage(new URL('boss-v2.png', ASSET_BASE).href),
  loadImage(new URL('enemies-v2.png', ASSET_BASE).href),
  loadImage(new URL('effects-v2.png', ASSET_BASE).href),
]);
// Geometria dos sheets (SPEC §2). As células do player e do chefe não são
// quadradas: com 48×48 o Aster de braço esticado saía fatiado na borda, e com
// 96×96 o braço-canhão do chefe também.
const PLAYER_CELL_W = 76;
const PLAYER_CELL_H = 56;
const PLAYER_MARGEM = 0;  // linhas reservadas abaixo da linha de base
const BOSS_CELL_W = 128;
const BOSS_CELL_H = 96;
const BOSS_MARGEM = 5;    // a poça de escória do chefe derrotado escorre no chão

const playerSheet = loadSpriteSheet(playerImg, PLAYER_CELL_W, PLAYER_CELL_H); // 18 frames
const tileSheet   = loadSpriteSheet(tilesImg, 32, 32);  // 7 tiles
const bossSheet   = loadSpriteSheet(bossImg, BOSS_CELL_W, BOSS_CELL_H); // 13 frames
const enemySheet  = loadSpriteSheet(enemiesImg, 32, 32); // 12 frames
const effectSheet = loadSpriteSheet(effectsImg, 32, 32); // 4 frames

// Confere se cada PNG bate com a célula que o código recorta. Sem isto, uma
// sheet desatualizada (o navegador guardando a versão anterior, por exemplo)
// não dá erro nenhum: o jogo simplesmente recorta janelas no lugar errado e
// desenha meio personagem colado num pedaço do frame vizinho. Melhor gritar.
const CONTRATOS_DE_SHEET = [
  ['player-v2.png', playerImg, PLAYER_CELL_W, PLAYER_CELL_H, 18],
  ['boss-v2.png', bossImg, BOSS_CELL_W, BOSS_CELL_H, 13],
  ['tiles-v2.png', tilesImg, TILE_SIZE, TILE_SIZE, 7],
  ['enemies-v2.png', enemiesImg, 32, 32, 12],
  ['effects-v2.png', effectsImg, 32, 32, 4],
];

const sheetsQuebradas = CONTRATOS_DE_SHEET.filter(
  ([, img, w, h, frames]) => img.width !== w * frames || img.height !== h,
).map(([nome, img, w, h, frames]) =>
  `${nome}: esperado ${w * frames}×${h} (${frames} células de ${w}×${h}), veio ${img.width}×${img.height}`,
);

if (sheetsQuebradas.length) {
  const recado = ['SPRITE-SHEET FORA DO CONTRATO', ...sheetsQuebradas,
    'Provável cache do navegador com a versão anterior: recarregue com Cmd+Shift+R.'].join('\n');
  console.error(recado);
  const g = document.getElementById('game').getContext('2d');
  g.fillStyle = '#1a0d0d';
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.fillStyle = '#ff8a8a';
  g.font = 'bold 10px monospace';
  g.textAlign = 'center';
  recado.split('\n').forEach((linha, i) => g.fillText(linha, VIEW_W / 2, 40 + i * 16));
  throw new Error(recado);
}

// ----------------------------------------------------------------------------
// ESTADO DO JOGO
// ----------------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const input = new Input();
input.attach();

let level;
let tm;
let player;
let camera;
let playerProjectiles;
let state;
let stateTimer;
let goTimer;
let paused;
let deathTimer;
let winTimer;
let fadeAlpha;
let frame;

function installRun(run) {
  level = run.level;
  tm = run.tilemap;
  player = run.player;
  camera = run.camera;
  playerProjectiles = run.playerProjectiles;
  state = run.state;
  stateTimer = run.stateTimer;
  goTimer = run.goTimer;
  paused = run.paused;
  deathTimer = run.deathTimer;
  winTimer = run.winTimer;
  fadeAlpha = run.fadeAlpha;
  frame = run.frame;
}

function restartRun() {
  consumeHitstop();
  input.resetForRun();
  installRun(createRunState(LEVEL_GRID, VIEW_W, VIEW_H));
}

installRun(createRunState(LEVEL_GRID, VIEW_W, VIEW_H));

// ----------------------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------------------
function respawnAtCheckpoint() {
  const point = respawnPoint(level);
  resetPlayer(player, point.x, point.y);
  player.invulnFrames = 60; // respawn seguro
  deathTimer = 0;
  camera.snapTo(player);
}

function onPlayerDeath() {
  deathTimer = 0;
}

// ----------------------------------------------------------------------------
// COMBATE (SPEC §4, §10)
// ----------------------------------------------------------------------------
function combat() {
  // Player -> inimigos
  for (const proj of playerProjectiles) {
    if (proj.dead || !player.alive) continue;
    for (const e of level.enemies) {
      if (!e.alive) continue;
      if (aabb(proj, e)) {
        proj.dead = true;
        e.hp -= proj.damage;
        e.hitFlash = 6;
        setHitstop(HITSTOP_GIVE);      // hit-stop 4f ao acertar (SPEC §4)
        applyShake(camera);            // screen shake em todo hit (SPEC §10.5)
        if (e.hp <= 0) {
          e.alive = false;
          level.maybeDrop(e.x + e.w / 2, e.y + e.h / 2); // 50% energy (SPEC §4)
        }
        break;
      }
    }
    if (proj.dead) continue;
    const b = level.boss;
    if (b && !b.dead && !b.dying && aabb(proj, b)) {
      proj.dead = true;
      const hit = b.takeDamage(proj.damage, proj.x, { charge: proj.fromCharge });
      if (hit) {
        setHitstop(HITSTOP_GIVE);
        applyShake(camera);
      }
    }
  }

  // Inimigos -> player
  if (player.alive) {
    for (const proj of level.enemyProjectiles) {
      if (proj.dead) continue;
      if (aabb(proj, player)) {
        proj.dead = true;
        if (damagePlayer(player, proj.damage ?? 1, proj.x)) {
          applyShake(camera); // SPEC §10.5: shake em todo hit (recebe OU dá)
          if (!player.alive) onPlayerDeath();
        }
      }
    }
    // Corpo a corpo: inimigos comuns
    for (const e of level.enemies) {
      if (!e.alive) continue;
      if (aabb(e, player)) {
        if (damagePlayer(player, 1, e.x + e.w / 2)) {
          applyShake(camera);
          if (!player.alive) onPlayerDeath();
        }
      }
    }
    // Corpo a corpo: chefe
    const b = level.boss;
    if (b && !b.dead && !b.dying && aabb(player, b)) {
      if (damagePlayer(player, 1, b.x + b.w / 2)) {
        applyShake(camera);
        if (!player.alive) onPlayerDeath();
      }
    }
  }

  // Drops de energy (+2 HP; big = enche tudo, SPEC §4)
  for (const d of level.drops) {
    if (!d.alive || d.taken) continue;
    if (aabb(d, player)) {
      d.taken = true;
      d.alive = false;
      player.hp = d.big ? HP_MAX : Math.min(HP_MAX, player.hp + 2);
    }
  }
}

// ----------------------------------------------------------------------------
// UPDATE (delta fixo 1/60 — SPEC §1)
// ----------------------------------------------------------------------------
function update() {
  if (input.restartJustPressed()) {
    restartRun();
    return;
  }

  const pausePressed = input.pauseJustPressed();
  paused = nextPauseState(paused, pausePressed);
  if (pausePressed || paused) {
    input.clearTransient();
    return;
  }

  frame++;

  switch (state) {
    case 'READY': {
      // Player congela; apenas mantemos o input limpo.
      input.endFrame(player.grounded);
      stateTimer--;
      if (stateTimer <= 0) { state = 'PLAY'; goTimer = 30; }
      break;
    }
    case 'PLAY': {
      // Hit-stop pertence ao loop principal para congelar o mundo inteiro.
      if (advanceHitstop()) {
        input.clearTransient({ preserveJumpRelease: true });
        break;
      }

      // Vitória: chefe morreu -> freeze 30f (contado no boss) + fade 60f.
      if (level.boss && level.boss.dying) {
        level.boss.updateDeath();
        if (level.boss.dead) {
          if (winTimer === 0) {
            consumeHitstop();
            applyBossReward(player);
            state = 'WIN';
            winTimer = 60; // fade out (SPEC §8)
          }
        }
        input.clearTransient();
        break;
      }

      updatePlayer(player, input, tm);

      // Tiro do player (disparo/charge é sinalizado pelo engine).
      const shot = consumePendingShot(player);
      if (shot) playerProjectiles.push(spawnProjectile(player, shot.type));

      level.update(player);
      updateProjectiles(playerProjectiles, tm);

      // Limpa projéteis do player fora da tela (sem GC infinita).
      for (let i = playerProjectiles.length - 1; i >= 0; i--) {
        if (playerProjectiles[i].isOffscreen(VIEW_W, VIEW_H, camera.x, camera.y)) {
          playerProjectiles.splice(i, 1);
        }
      }

      combat();

      // Morte por queda no abismo (gaps) — tratada como spike: morte instantânea.
      if (player.alive && player.y > tm.pixelHeight + 40) {
        player.hp = 0;
        player.alive = false;
        onPlayerDeath();
      }

      // Morte: animação de queda + respawn no checkpoint.
      if (!player.alive) {
        deathTimer++;
        if (deathTimer > 75) respawnAtCheckpoint();
      }

      if (goTimer > 0) goTimer--;
      camera.follow(player);
      break;
    }
    case 'WIN': {
      input.clearTransient();
      winTimer--;
      fadeAlpha = Math.min(1, 1 - winTimer / 60);
      if (winTimer <= 0) fadeAlpha = 1;
      break;
    }
    default:
      break;
  }
}

// ----------------------------------------------------------------------------
// RENDER
// ----------------------------------------------------------------------------
function drawTiles() {
  const x0 = Math.floor(camera.x / TILE_SIZE);
  const x1 = Math.ceil((camera.x + VIEW_W) / TILE_SIZE);
  const y0 = Math.floor(camera.y / TILE_SIZE);
  const y1 = Math.ceil((camera.y + VIEW_H) / TILE_SIZE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const idx = tm.getTile(tx, ty);
      if (idx <= 0 || idx >= tileSheet.count) continue;
      ctx.drawImage(tilesImg, idx * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE,
        tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
}

function drawFrame(image, frame, cellW, cellH, x, y, flip = false) {
  ctx.save();
  if (flip) {
    ctx.translate(x + cellW, y);
    ctx.scale(-1, 1);
    ctx.drawImage(image, frame * cellW, 0, cellW, cellH, 0, 0, cellW, cellH);
  } else {
    ctx.drawImage(image, frame * cellW, 0, cellW, cellH, x, y, cellW, cellH);
  }
  ctx.restore();
}

// Posiciona a célula de um sprite sobre um hitbox: centrada na horizontal e
// apoiada na linha de base, que fica `margem` linhas acima da última linha da
// célula para o que o desenho derrama no chão.
function encaixar(alvo, cellW, cellH, margem) {
  return {
    x: alvo.x + (alvo.w - cellW) / 2,
    y: alvo.y + alvo.h - (cellH - margem),
  };
}

function drawPlayer() {
  // Invuln pós-hit: pisca (SPEC §3: sprite pisca 2/3).
  if (player.invulnFrames > 0 && (player.invulnFrames & 3) === 0) return;
  const frame = playerAnimationFrame(player);
  if (frame >= playerSheet.count) return;
  const { x, y } = encaixar(player, PLAYER_CELL_W, PLAYER_CELL_H, PLAYER_MARGEM);
  drawFrame(playerImg, frame, PLAYER_CELL_W, PLAYER_CELL_H, x, y, player.facing < 0);
}

function drawEnemy(e) {
  const frame = enemyAnimationFrame(e);
  if (frame >= enemySheet.count) return;
  const { x, y } = encaixar(e, 32, 32, 0);
  ctx.save();
  if (e.hitFlash > 0) ctx.globalAlpha = 0.45;
  drawFrame(enemiesImg, frame, 32, 32, x, y, e.facing > 0);
  ctx.restore();
}

function drawBoss() {
  const b = level.boss;
  if (!b) return;
  // Brilho vermelho do telegraph (SPEC §8.2).
  if (b.teleFlash > 0) {
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.2 * Math.sin(b.tick * 0.4);
    ctx.fillStyle = '#ff3030';
    ctx.beginPath();
    ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // i-frames do charge: pisca.
  if (b.invuln > 0 && (b.invuln & 3) === 0) return;

  let f;
  if (b.dying || b.dead) f = 12;
  else if (b.hitFlash > 0) f = 11;
  else if (b.state === 'shoot') f = (b.phase() === 3 ? 9 : 4) + (b.animFrame & 1);
  else if (b.state === 'telegraph' || b.state === 'charge') f = 6 + (b.animFrame % 3);
  else f = b.animFrame & 3;

  // Mesma convenção do player: célula centrada no hitbox e apoiada na linha de
  // base. Com `b.y - 8` os pés do chefe caíam 8 px abaixo do próprio hitbox.
  const { x, y } = encaixar(b, BOSS_CELL_W, BOSS_CELL_H, BOSS_MARGEM);
  if (f < bossSheet.count) drawFrame(bossImg, f, BOSS_CELL_W, BOSS_CELL_H, x, y, b.facing > 0);
}

// Efeitos são desenhados no tamanho do próprio hitbox, não no da célula.
function drawEfeito(frame, x, y, w, h, flip = false) {
  ctx.save();
  if (flip) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(effectsImg, frame * 32, 0, 32, 32, 0, 0, w, h);
  } else {
    ctx.drawImage(effectsImg, frame * 32, 0, 32, 32, x, y, w, h);
  }
  ctx.restore();
}

function drawProjectiles() {
  for (const p of playerProjectiles) {
    const frame = p.fromCharge ? 1 : 0;
    if (frame < effectSheet.count) drawEfeito(frame, p.x, p.y, p.w, p.h, p.dir > 0);
  }
  for (const p of level.enemyProjectiles) {
    if (effectSheet.count > 0) drawEfeito(0, p.x, p.y, p.w, p.h, p.vx > 0);
  }
}

function drawDrops() {
  for (const d of level.drops) {
    if (!d.alive || d.taken) continue;
    const frame = d.big ? 3 : 2;
    if (frame < effectSheet.count) drawEfeito(frame, d.x, d.y, d.w, d.h);
  }
}

function drawHUD() {
  // HP bar do player (SPEC §9: topo-esquerda, 80×8).
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(6, 6, 84, 12);
  ctx.fillStyle = '#333';
  ctx.fillRect(8, 8, 80, 8);
  const ratio = player.hpRatio();
  ctx.fillStyle = ratio > 0.5 ? '#ffd84d' : ratio > 0.25 ? '#ff9a3d' : '#ff5252';
  ctx.fillRect(8, 8, Math.max(0, Math.round(80 * ratio)), 8);
  ctx.strokeStyle = '#000';
  ctx.strokeRect(7.5, 7.5, 81, 9);

  // Nome do chefe no topo ao entrar na sala (SPEC §9).
  if (level.boss && level.boss.spawned) {
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000';
    ctx.strokeText('KILN WARDEN', VIEW_W / 2, 18);
    ctx.fillStyle = '#fff';
    ctx.fillText('KILN WARDEN', VIEW_W / 2, 18);
    // Mini barra do chefe (HP 28).
    ctx.fillStyle = '#333';
    ctx.fillRect(VIEW_W / 2 - 60, 24, 120, 6);
    ctx.fillStyle = '#ff5252';
    ctx.fillRect(VIEW_W / 2 - 60, 24, Math.max(0, Math.round(120 * (level.boss.hp / level.boss.maxHp))), 6);
    ctx.strokeStyle = '#000';
    ctx.strokeRect(VIEW_W / 2 - 60.5, 23.5, 121, 7);
    ctx.textAlign = 'left';
  }
}

function drawOverlays() {
  ctx.textAlign = 'center';
  ctx.font = 'bold 24px monospace';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#000';

  if (state === 'READY') {
    ctx.strokeText('READY', VIEW_W / 2, VIEW_H / 2 - 20);
    ctx.fillStyle = '#fff';
    ctx.fillText('READY', VIEW_W / 2, VIEW_H / 2 - 20);
  } else if (state === 'PLAY' && goTimer > 0) {
    ctx.strokeText('GO!', VIEW_W / 2, VIEW_H / 2 - 20);
    ctx.fillStyle = '#ffe94d';
    ctx.fillText('GO!', VIEW_W / 2, VIEW_H / 2 - 20);
  }

  if (paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.strokeText('PAUSE', VIEW_W / 2, VIEW_H / 2);
    ctx.fillStyle = '#fff';
    ctx.fillText('PAUSE', VIEW_W / 2, VIEW_H / 2);
  }

  if (state === 'WIN') {
    ctx.fillStyle = `rgba(0,0,0,${fadeAlpha})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (fadeAlpha >= 1) {
      ctx.strokeText('MISSION COMPLETE', VIEW_W / 2, VIEW_H / 2 - 8);
      ctx.fillStyle = '#ffe94d';
      ctx.fillText('MISSION COMPLETE', VIEW_W / 2, VIEW_H / 2 - 8);
      ctx.font = 'bold 12px monospace';
      ctx.strokeText('[R] restart', VIEW_W / 2, VIEW_H / 2 + 18);
      ctx.fillStyle = '#fff';
      ctx.fillText('[R] restart', VIEW_W / 2, VIEW_H / 2 + 18);
    }
  }

  ctx.textAlign = 'left';
}

function render() {
  // Céu do dia (SPEC §5: azul claro).
  ctx.fillStyle = '#9ad8ff';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const maxBackgroundX = Math.max(0, backgroundImg.width - VIEW_W);
  const backgroundX = Math.min(maxBackgroundX, Math.max(0, Math.round(camera.x * 0.12)));
  ctx.drawImage(backgroundImg, backgroundX, 0, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);

  ctx.save();
  const off = camera.getShakeOffset();
  ctx.translate(-Math.round(camera.x) + off.x, -Math.round(camera.y) + off.y);

  drawTiles();
  drawDrops();
  for (const e of level.enemies) {
    if (e.alive) drawEnemy(e);
  }
  if (level.boss) drawBoss();
  if (player.alive || deathTimer < 40) drawPlayer();
  drawProjectiles();
  ctx.restore();

  drawHUD();
  drawOverlays();
}

// ----------------------------------------------------------------------------
// LOOP PRINCIPAL — delta fixo 1/60 (SPEC §1)
// ----------------------------------------------------------------------------
let last = performance.now();
let acc = 0;

function loop(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25; // evita espiral da morte ao perder o tab

  acc += dt;
  while (acc >= FIXED_DT) {
    update();
    acc -= FIXED_DT;
  }
  render();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// Exposição para debug no console (sem afetar o jogo).
window.__mmx = { state: () => ({ state, player, level, camera, paused }) };
