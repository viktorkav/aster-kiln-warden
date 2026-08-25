// level.js — fase, inimigos comuns e chefe (SPEC §7, §8).
// ES module, vanilla, sem dependências além de engine.js.
//
// NOTAS DE DESIGN (trade-offs decididos com a física real do motor):
//  - Gaps de 2 tiles (64px): o voo horizontal máximo de um pulo corrido é
//    ~100px (2.5px/f × ~40f no ar). Gaps de 4 tiles (128px) seriam
//    intransponíveis; 3 tiles (96px) ficam no limite de 4px de margem.
//    SPEC manda "MMX ganha": 2 tiles = pulo confortável, como fases iniciais.
//  - Plataforma elevada na linha 5 (topo 160px): altura de pulo = 90px
//    (v²/2g = 81/0.9). Da linha do chão (224px), a linha 4 (topo 128px)
//    exigiria 96px > 90px — impossível. Linha 5 (64px) é alcançável.
//  - Espinhos na linha 6 (corpo do player): o hitbox do player de pé cobre
//    as linhas 6-7; espinho na linha 7 (chão) só tocaria pés caindo.

import {
  TILE_SIZE,
  PLAYER_HITBOX_H,
  makeTilemapFromGrid,
  moveAndCollide,
  Projectile,
} from './engine.js';

export const LEVEL_W = 128;
export const LEVEL_H = 9;

// ----------------------------------------------------------------------------
// GRID DA FASE (128 × 9 tiles = 4096×288 px, SPEC §5)
// ----------------------------------------------------------------------------
function buildGrid() {
  const grid = [];
  for (let y = 0; y < LEVEL_H; y++) grid.push(new Array(LEVEL_W).fill(0));

  // Chão sólido (1) nas linhas 7-8, com gaps em 25-26 e 55-56.
  for (let x = 0; x < LEVEL_W; x++) {
    grid[7][x] = 1;
    grid[8][x] = 1;
  }
  for (let x = 25; x <= 26; x++) { grid[7][x] = 0; grid[8][x] = 0; }
  for (let x = 55; x <= 56; x++) { grid[7][x] = 0; grid[8][x] = 0; }

  // Plataforma elevada (2) na linha 5, cols 40-50 — walker em cima.
  for (let x = 40; x <= 50; x++) grid[5][x] = 2;

  // Espinhos (3) na linha 6, cols 78-79 (morte instantânea, SPEC §10.7).
  grid[6][78] = 3;
  grid[6][79] = 3;

  // Checkpoint (4) na col 60, linha 6 — visual, sem colisão.
  grid[6][60] = 4;

  // Porta do chefe (6) na col 115, linha 6 — visual, sem colisão.
  grid[6][115] = 6;

  // Sala do chefe: teto (linha 0) e parede de fundo (col 127).
  for (let x = 115; x < LEVEL_W; x++) grid[0][x] = 1;
  for (let y = 1; y <= 6; y++) grid[y][127] = 1;

  // Decoração de fundo (5, sem colisão): nuvens/estruturas ao longe.
  for (let x = 42; x <= 48; x++) grid[2][x] = 5;
  for (let x = 61; x <= 63; x++) grid[2][x] = 5;
  for (let x = 117; x <= 125; x++) grid[1][x] = 5;

  return grid;
}

export const LEVEL_GRID = buildGrid();

// Posição onde o player nasce / respawna após a morte.
export const PLAYER_SPAWN = { x: 2 * TILE_SIZE, y: 7 * TILE_SIZE - PLAYER_HITBOX_H };
export const CHECKPOINT   = { x: 60 * TILE_SIZE, y: 7 * TILE_SIZE - PLAYER_HITBOX_H };

const BOSS_DOOR_X   = 115 * TILE_SIZE; // cruzar isso spawna o chefe
const BOSS_MIN_X    = 116 * TILE_SIZE;
const BOSS_MAX_X    = 127 * TILE_SIZE - 64;
export const BOSS_HITBOX_W = 64;        // SPEC §2
export const BOSS_HITBOX_H = 80;        // SPEC §2
const BOSS_FLOOR_Y  = 7 * TILE_SIZE;    // topo da linha de chão da sala
// O Kiln Warden tem pernas: nasce apoiado, não pairando. O y era 88 fixo, 56 px
// acima do piso, e ele ficava flutuando parado no ar até morrer.
export const BOSS_SPAWN_Y = BOSS_FLOOR_Y - BOSS_HITBOX_H;
const BOSS_FIRE_INTERVAL_P1 = 50;   // SPEC §8.1
const BOSS_FIRE_INTERVAL_P3 = 70;   // SPEC §8.3
const BOSS_REST_FRAMES      = 90;   // SPEC §8
const BOSS_CHARGE_VEL       = 6;    // SPEC §8.2
const BOSS_CHARGE_FRAMES    = 20;   // SPEC §8.2
const BOSS_TELEGRAPH_FRAMES = 60;   // SPEC §8.2
const BOSS_CHARGE_IFRAMES   = 30;   // SPEC §8.2
const BOSS_PROJ_VEL         = 4;    // SPEC §8.1/§8.3

// ----------------------------------------------------------------------------
// INIMIGOS COMUNS (SPEC §7 — todos com HP 1, dropam energy 50%)
// ----------------------------------------------------------------------------

// Anda até a borda da plataforma, vira, segue.
export class EnemyWalker {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.w = 20; this.h = 16;
    this.hp = 1;
    this.alive = true;
    this.velX = -0.8; this.velY = 0;
    this.grounded = false; this.wallLeft = false; this.wallRight = false;
    this.hitFlash = 0;
    this.facing = -1;
    this.animFrame = 0; this.animTimer = 0;
  }

  update(tilemap) {
    if (!this.alive) return;
    if (this.hitFlash > 0) this.hitFlash--;
    this.animTimer++;
    if (this.animTimer > 8) { this.animTimer = 0; this.animFrame = (this.animFrame + 1) & 3; }

    // Walkers usam a mesma queda dos demais corpos com colisão por tile.
    this.velY = Math.min(this.velY + 0.45, 8);
    moveAndCollide(this, tilemap);

    // Vira na borda: sem chão à frente -> inverte.
    if (this.grounded) {
      const dir = this.velX === 0 ? this.facing : Math.sign(this.velX);
      const aheadX = dir > 0 ? this.x + this.w : this.x - 1;
      const tx = Math.floor(aheadX / tilemap.tileSize);
      const ty = Math.floor((this.y + this.h + 1) / tilemap.tileSize);
      if (!tilemap.isSolid(tx, ty)) this.velX = -this.velX;
    }
    // Bateu na parede -> inverte.
    if (this.wallLeft || this.wallRight) this.velX = -this.velX;
    this.facing = this.velX >= 0 ? 1 : -1;
  }
}

// Pairado, segue o player no X, atira reto a cada 90 frames.
export class EnemyFlyer {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.w = 20; this.h = 20;
    this.hp = 1;
    this.alive = true;
    this.baseY = y;
    this.velX = 0; this.velY = 0;
    this.hitFlash = 0;
    this.facing = -1;
    this.fireCooldown = 90;
    this.tick = 0;
    this.animFrame = 0; this.animTimer = 0;
  }

  update(tilemap, player, projectiles) {
    if (!this.alive) return;
    if (this.hitFlash > 0) this.hitFlash--;
    this.animTimer++;
    if (this.animTimer > 6) { this.animTimer = 0; this.animFrame = (this.animFrame + 1) & 3; }

    this.tick++;
    this.y = this.baseY + Math.sin(this.tick * 0.1) * 6;

    const dx = (player.x + player.w / 2) - (this.x + this.w / 2);
    this.facing = dx >= 0 ? 1 : -1;
    this.velX = Math.max(-1.2, Math.min(1.2, dx * 0.01));
    this.x += this.velX;
    this.x = Math.max(18 * TILE_SIZE, Math.min(112 * TILE_SIZE, this.x));

    this.fireCooldown--;
    if (this.fireCooldown <= 0 && player.alive) {
      this.fireCooldown = 90; // SPEC §7: tiro a cada 90 frames
      const dir = dx >= 0 ? 1 : -1;
      const p = new Projectile(this.x + this.w / 2 - 4, this.y + this.h / 2 - 4, dir, {
        fromPlayer: false, damage: 1, life: 240,
      });
      p.vx = 3.5 * dir;
      p.vy = 0;
      projectiles.push(p);
    }
  }
}

// Estático, dispara reto a cada 60 frames.
export class EnemyTurret {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.w = 16; this.h = 16;
    this.hp = 1;
    this.alive = true;
    this.hitFlash = 0;
    this.facing = -1;
    this.fireCooldown = 45; // primeiro tiro mais cedo para dar presença
    this.animFrame = 0; this.animTimer = 0;
  }

  update(tilemap, player, projectiles) {
    if (!this.alive) return;
    if (this.hitFlash > 0) this.hitFlash--;
    this.animTimer++;
    if (this.animTimer > 10) { this.animTimer = 0; this.animFrame = (this.animFrame + 1) & 3; }

    const dx = (player.x + player.w / 2) - (this.x + this.w / 2);
    this.facing = dx >= 0 ? 1 : -1;

    this.fireCooldown--;
    if (this.fireCooldown <= 0 && player.alive) {
      this.fireCooldown = 60; // SPEC §7: tiro a cada 60 frames
      const dir = dx >= 0 ? 1 : -1;
      const p = new Projectile(this.x + this.w / 2 - 4, this.y - 2, dir, {
        fromPlayer: false, damage: 1, life: 240,
      });
      p.vx = 4 * dir;
      p.vy = 0;
      projectiles.push(p);
    }
  }
}

export function enemyAnimationFrame(enemy) {
  const frame = enemy.animFrame & 3;
  if (enemy instanceof EnemyWalker) return frame;
  if (enemy instanceof EnemyFlyer) return 4 + frame;
  return 8 + frame;
}

// ----------------------------------------------------------------------------
// DROP DE ENERGY (SPEC §4: 50% nos inimigos +2HP; chefe garante big energy)
// ----------------------------------------------------------------------------
export class EnergyDrop {
  constructor(x, y, big = false) {
    this.x = x - 6; this.y = y;
    this.w = 12; this.h = 12;
    this.big = big;
    this.vy = -1.5; this.vx = (Math.random() * 2 - 1) * 1.5;
    this.life = 360;
    this.alive = true;
    this.taken = false;
    this.animFrame = 0; this.animTimer = 0;
  }

  update(tilemap) {
    if (!this.alive) return;
    this.animTimer++;
    if (this.animTimer > 8) { this.animTimer = 0; this.animFrame = (this.animFrame + 1) & 3; }

    this.vy = Math.min(4, this.vy + 0.3);
    this.x += this.vx;
    this.y += this.vy;

    // Pousa no chão.
    const tx = Math.floor((this.x + this.w / 2) / tilemap.tileSize);
    const ty = Math.floor((this.y + this.h) / tilemap.tileSize);
    if (tilemap.isSolid(tx, ty)) {
      this.y = ty * tilemap.tileSize - this.h;
      this.vy = 0; this.vx = 0;
    }

    this.life--;
    if (this.life <= 0) this.alive = false;
  }
}

// ----------------------------------------------------------------------------
// CHEFE — KILN WARDEN (SPEC §8)
// ----------------------------------------------------------------------------
export class Boss {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.w = BOSS_HITBOX_W; this.h = BOSS_HITBOX_H; // hitbox (sprite 96×96, SPEC §2)
    this.hp = 28; this.maxHp = 28;     // SPEC §8
    this.baseY = y;
    this.tick = 0;
    this.facing = -1;
    this.state = 'rest';               // rest | transition | shoot | telegraph | charge | dying | dead
    this.stateTimer = 60;
    this.shotsFired = 0;
    this.shotTimer = 0;
    this.invuln = 0;                   // i-frames do charge (SPEC §8.2)
    this.hitFlash = 0;
    this.teleFlash = 0;                // brilho vermelho do telegraph (SPEC §8.2)
    this.chargeDir = 1;
    this.dying = false;
    this.dead = false;
    this.deathTimer = 0;
    this.animFrame = 0; this.animTimer = 0;
    this.spawned = false;
    this.previousPhase = this.phase();
    this.knockbackFrames = 0;
    this.knockbackVelocity = 0;
  }

  phase() {
    if (this.hp >= 19) return 1;       // SPEC §8.1
    if (this.hp >= 10) return 2;       // SPEC §8.2
    return 3;                          // SPEC §8.3
  }

  updateFacing(player) {
    this.facing = (player.x + player.w / 2) < (this.x + this.w / 2) ? -1 : 1;
  }

  // Avança a morte (game congela o resto do mundo durante 30 frames).
  updateDeath() {
    if (this.dead) return;
    this.deathTimer++;
    if (this.deathTimer >= 30) this.dead = true; // SPEC §8: freeze 30f
  }

  update(tilemap, player, projectiles) {
    if (this.dying) { this.updateDeath(); return; }
    if (this.invuln > 0) this.invuln--;
    if (this.hitFlash > 0) this.hitFlash--;
    if (this.teleFlash > 0) this.teleFlash--;
    this.animTimer++;
    if (this.animTimer > 8) { this.animTimer = 0; this.animFrame = (this.animFrame + 1) & 3; }

    this.tick++;
    this.updateFacing(player);
    // Sem hover: um mecha de duas pernas que sobe e desce sozinho lê como
    // sprite solto no ar. Os pés ficam plantados na linha de chão da sala.
    this.y = this.baseY;
    this.x = Math.max(BOSS_MIN_X, Math.min(BOSS_MAX_X, this.x));

    const phase = this.phase();
    if (phase !== this.previousPhase) this.startPhaseTransition(phase);

    if (this.knockbackFrames > 0) {
      this.x += this.knockbackVelocity;
      this.knockbackVelocity *= 0.75;
      this.knockbackFrames--;
      this.x = Math.max(BOSS_MIN_X, Math.min(BOSS_MAX_X, this.x));
    }

    switch (this.state) {
      case 'transition': {
        this.stateTimer--;
        if (this.stateTimer <= 0) this.startPhasePattern(phase, player);
        break;
      }
      case 'rest': {
        this.stateTimer--;
        if (this.stateTimer <= 0) {
          if (phase === 2) {
            this.state = 'telegraph';
            this.stateTimer = BOSS_TELEGRAPH_FRAMES;
            this.teleFlash = BOSS_TELEGRAPH_FRAMES;
          } else {
            this.state = 'shoot';
            this.shotsFired = 0;
            this.shotTimer = 0;
            // 3 tiros espaçados; timer cobre o 1º até o 3º (t=0, 50, 100 / 0, 70, 140)
            const interval = phase === 1 ? BOSS_FIRE_INTERVAL_P1 : BOSS_FIRE_INTERVAL_P3;
            this.stateTimer = interval * 2 + 1;
          }
        }
        break;
      }
      case 'shoot': {
        this.stateTimer--;
        if (this.shotsFired < 3 && this.shotTimer <= 0) {
          this.fire(projectiles, player, phase);
          this.shotsFired++;
          this.shotTimer = phase === 1 ? BOSS_FIRE_INTERVAL_P1 : BOSS_FIRE_INTERVAL_P3;
        }
        this.shotTimer--;
        if (this.stateTimer <= 0) {
          this.state = 'rest';
          this.stateTimer = BOSS_REST_FRAMES; // SPEC §8: 90f de descanso
        }
        break;
      }
      case 'telegraph': {
        this.stateTimer--;
        if (this.stateTimer <= 0) {
          this.state = 'charge';
          this.stateTimer = BOSS_CHARGE_FRAMES;
          this.invuln = BOSS_CHARGE_IFRAMES;  // i-frames durante o charge
          this.chargeDir = (player.x + player.w / 2) < (this.x + this.w / 2) ? -1 : 1;
        }
        break;
      }
      case 'charge': {
        this.stateTimer--;
        this.x += this.chargeDir * BOSS_CHARGE_VEL; // SPEC §8.2: 6px/f por 20f
        this.x = Math.max(BOSS_MIN_X, Math.min(BOSS_MAX_X, this.x));
        if (this.stateTimer <= 0) {
          this.state = 'rest';
          this.stateTimer = BOSS_REST_FRAMES;
        }
        break;
      }
      default:
        break;
    }
  }

  startPhaseTransition(phase) {
    this.previousPhase = phase;
    this.state = 'transition';
    this.stateTimer = BOSS_TELEGRAPH_FRAMES;
    this.teleFlash = BOSS_TELEGRAPH_FRAMES;
    this.shotsFired = 0;
    this.shotTimer = 0;
  }

  startPhasePattern(phase, player) {
    if (phase === 2) {
      this.state = 'charge';
      this.stateTimer = BOSS_CHARGE_FRAMES;
      this.invuln = BOSS_CHARGE_IFRAMES;
      this.chargeDir = (player.x + player.w / 2) < (this.x + this.w / 2) ? -1 : 1;
      return;
    }

    this.state = 'shoot';
    this.shotsFired = 0;
    this.shotTimer = 0;
    const interval = phase === 1 ? BOSS_FIRE_INTERVAL_P1 : BOSS_FIRE_INTERVAL_P3;
    this.stateTimer = interval * 2 + 1;
  }

  fire(projectiles, player, phase) {
    const cx = this.x + this.w / 2 - 4;
    const cy = this.y + this.h / 2 - 4;
    const dir = this.facing;

    if (phase === 1) {
      // Tiro reto horizontal, vel 4 (SPEC §8.1).
      const p = new Projectile(cx, cy, dir, { fromPlayer: false, damage: 1, life: 240 });
      p.vx = BOSS_PROJ_VEL * dir;
      p.vy = 0;
      projectiles.push(p);
    } else {
      // Spread 3 projéteis: -15°, 0°, +15° (SPEC §8.3).
      for (const deg of [-15, 0, 15]) {
        const a = (deg * Math.PI) / 180;
        const p = new Projectile(cx, cy, dir, { fromPlayer: false, damage: 1, life: 240 });
        p.vx = Math.cos(a) * BOSS_PROJ_VEL * dir;
        p.vy = Math.sin(a) * BOSS_PROJ_VEL;
        projectiles.push(p);
      }
    }
  }

  takeDamage(amount, fromX, { charge = amount >= 3 } = {}) {
    if (this.invuln > 0 || this.dying || this.dead) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.hitFlash = 8;
    if (charge) {
      const direction = fromX < this.x + this.w / 2 ? 1 : -1;
      this.knockbackVelocity = direction * 3;
      this.knockbackFrames = 8;
    }
    if (this.hp <= 0) {
      this.dying = true;
      this.deathTimer = 0;
      return true;
    }
    const phase = this.phase();
    if (phase !== this.previousPhase) this.startPhaseTransition(phase);
    return true;
  }
}

// ----------------------------------------------------------------------------
// LEVEL — agrega tilemap, inimigos, drops e o chefe.
// ----------------------------------------------------------------------------
export class Level {
  constructor(grid) {
    this.tilemap = makeTilemapFromGrid(grid, TILE_SIZE);
    this.enemies = [];
    this.enemyProjectiles = [];
    this.drops = [];
    this.boss = null;
    this.bossSpawned = false;
    this.playerStart = { ...PLAYER_SPAWN };
    this.checkpoint = { ...CHECKPOINT };
    this.checkpointActive = false;
    this._initEnemies();
  }

  tryActivateCheckpoint(player) {
    if (this.checkpointActive || !player || player.alive === false) return false;
    const size = this.tilemap.tileSize;
    const tx0 = Math.floor(player.x / size);
    const tx1 = Math.floor((player.x + player.w - 1) / size);
    const ty0 = Math.floor(player.y / size);
    const ty1 = Math.floor((player.y + player.h - 1) / size);

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.tilemap.getTile(tx, ty) === 4) {
          this.checkpointActive = true;
          return true;
        }
      }
    }
    return false;
  }

  _initEnemies() {
    const T = TILE_SIZE;
    // Walkers: 3 (SPEC §7) — 2 no chão, 1 na plataforma elevada.
    this.enemies.push(new EnemyWalker(15 * T, 7 * T - 16));
    this.enemies.push(new EnemyWalker(35 * T, 7 * T - 16));
    this.enemies.push(new EnemyWalker(45 * T, 5 * T - 16));
    // Flyers: 2, pairados.
    this.enemies.push(new EnemyFlyer(30 * T, 150));
    this.enemies.push(new EnemyFlyer(70 * T, 150));
    // Turrets: 2, no chão.
    this.enemies.push(new EnemyTurret(22 * T, 7 * T - 16));
    this.enemies.push(new EnemyTurret(80 * T, 7 * T - 16));
  }

  maybeDrop(x, y) {
    if (Math.random() < 0.5) this.drops.push(new EnergyDrop(x, y)); // SPEC §4: 50%
  }

  update(player) {
    this.tryActivateCheckpoint(player);

    // Trigger do chefe: player cruzou a porta (SPEC §8).
    if (!this.bossSpawned && player.x > BOSS_DOOR_X) {
      this.bossSpawned = true;
      this.boss = new Boss(BOSS_MIN_X + 8, BOSS_SPAWN_Y);
      this.boss.spawned = true;
    }

    for (const e of this.enemies) {
      if (e.alive) e.update(this.tilemap, player, this.enemyProjectiles);
    }

    // Projéteis inimigos (move + colisão com sólidos + limpeza).
    for (const p of this.enemyProjectiles) p.update(this.tilemap);
    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      if (this.enemyProjectiles[i].dead) this.enemyProjectiles.splice(i, 1);
    }

    if (this.boss && !this.boss.dead && !this.boss.dying) {
      this.boss.update(this.tilemap, player, this.enemyProjectiles);
    }

    for (const d of this.drops) {
      if (d.alive) d.update(this.tilemap);
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      if (!this.drops[i].alive) this.drops.splice(i, 1);
    }
  }
}
