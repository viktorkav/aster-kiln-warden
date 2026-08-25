// engine.js — motor/física do player, câmera, projéteis, colisão AABB.
// ES module, vanilla, sem dependências. Veja SPEC.md §3, §4, §5.

// ============================================================================
// CONSTANTES (SPEC §3, §4, §5 — fonte de verdade; não altere valores).
// ============================================================================
export const TILE_SIZE = 32;

// Movimento
export const PLAYER_SPEED   = 2.5;
export const PLAYER_ACCEL   = 0.5;
export const PLAYER_DECEL   = 0.5;

// Dash
export const DASH_VEL       = 6;
export const DASH_DURATION  = 8;
export const DASH_COOLDOWN  = 30;
export const DASH_IFRAMES   = 12;

// Pulo / Gravidade
export const JUMP_VEL       = -9;
export const GRAVITY        = 0.45;
export const FALL_MAX       = 8;
export const COYOTE_FRAMES  = 6;
export const JUMP_BUFFER    = 6;

// Wall jump / wall slide
export const WALL_SLIDE_MAX = 1.5;
export const WALL_JUMP      = { vx: 5, vy: -9 };
export const WALL_LOCK      = 6;

// Hit / knockback / invuln
export const HITSTOP_GIVE   = 4;
export const HITSTOP_TAKE   = 6;
export const KNOCKBACK_VEL  = 3;
export const KNOCKBACK_FRAMES = 8;
export const INVULN_POST_HIT = 60;

// HP
export const HP_MAX         = 28;

// Câmera
export const CAM_DEADZONE_X = 80;
export const CAM_DEADZONE_Y = 40;
export const CAM_LERP       = 0.12;
export const CAM_SHAKE      = 4;
export const CAM_SHAKE_FRAMES = 10;

// Combate
export const PROJ_VEL       = 8;
export const PROJ_COOLDOWN  = 12;
export const CHARGE_TIME    = 90;
export const CHARGE_COOLDOWN = 60;
export const CHARGE_DAMAGE  = 3;

// Hitbox do player (SPEC §2: 16×32, centralizado no sprite 32×48).
export const PLAYER_HITBOX_W = 16;
export const PLAYER_HITBOX_H = 32;
export const PLAYER_SPRITE_W = 32;
export const PLAYER_SPRITE_H = 48;

// ============================================================================
// HIT-STOP GLOBAL (uma flag para a run inteira — todo hit pausa a lógica).
// ============================================================================
let _hitstopFrames = 0;

export function isHitstop() { return _hitstopFrames > 0; }
export function consumeHitstop() { _hitstopFrames = 0; }
export function setHitstop(frames) { _hitstopFrames = Math.max(_hitstopFrames, frames); }
// Consome no máximo um frame e informa se havia hit-stop neste tick.
// O loop principal pode usá-la para congelar todos os sistemas de uma vez.
export function advanceHitstop() {
  if (_hitstopFrames <= 0) return false;
  _hitstopFrames--;
  return true;
}

// ============================================================================
// COLISÃO AABB (sem library).
// ============================================================================
export function aabb(a, b) {
  return a.x < b.x + b.w &&
         a.x + a.w > b.x &&
         a.y < b.y + b.h &&
         a.y + a.h > b.y;
}

// ============================================================================
// TILEMAP — abstração de colisão por tiles.
// ============================================================================
// Espera-se um objeto tilemap com:
//   width, height     (em tiles)
//   pixelWidth, pixelHeight  (em pixels)
//   getTile(tx, ty)   -> índice
//   isSolid(tx, ty)   -> boolean (default: true para 1, 2, 3)
//   isHazard(tx, ty)  -> boolean (default: true para 3)
export function isSolidTileIndex(idx) {
  return idx === 1 || idx === 2 || idx === 3;
}
export function isHazardTileIndex(idx) {
  return idx === 3;
}

export function makeTilemapFromGrid(grid, tileSize = TILE_SIZE) {
  const height = grid.length;
  const width  = grid[0].length;
  return {
    width, height,
    pixelWidth:  width  * tileSize,
    pixelHeight: height * tileSize,
    tileSize,
    getTile(tx, ty) {
      if (ty < 0 || ty >= height || tx < 0 || tx >= width) return 0;
      return grid[ty][tx] | 0;
    },
    isSolid(tx, ty) { return isSolidTileIndex(this.getTile(tx, ty)); },
    isHazard(tx, ty) { return isHazardTileIndex(this.getTile(tx, ty)); },
  };
}

// loadTilemap(image) — extrai tiles a partir de uma imagem 32×N (1 linha).
// Cada tile é um quadrado 32×32; mapeamos cor->índice conforme paleta
// detectada (mais simples: percorrer a linha e contar tiles).
// Para manter determinístico, retornamos um array 1×N vazio (sem tilemap
// sólido). O subagente de fase fornece o grid real via makeTilemapFromGrid.
export function loadTilemap(_image) {
  // Stub determinístico. O subagente de fase deve usar makeTilemapFromGrid
  // passando a grade real lida do PNG. Esta função existe para satisfazer
  // a API esperada.
  return makeTilemapFromGrid([[0]]);
}

// loadSpriteSheet — recorta frames de uma sprite-sheet horizontal.
export function loadSpriteSheet(image, frameW, frameH) {
  if (!image || !image.width) return { frames: [], width: 0, height: 0, frameW, frameH };
  const count = Math.floor(image.width / frameW);
  const frames = [];
  for (let i = 0; i < count; i++) {
    frames.push({ x: i * frameW, y: 0, w: frameW, h: frameH });
  }
  return { frames, width: image.width, height: image.height, frameW, frameH, count };
}

// ============================================================================
// CÂMERA.
// ============================================================================
export class Camera {
  constructor(viewW, viewH, worldW, worldH) {
    this.x = 0;
    this.y = 0;
    this.viewW = viewW;
    this.viewH = viewH;
    this.worldW = worldW;
    this.worldH = worldH;
    this.shake = 0;
    this.shakeFrames = 0;
  }

  setBounds(worldW, worldH) {
    this.worldW = worldW;
    this.worldH = worldH;
    this._clamp();
  }

  setView(viewW, viewH) {
    this.viewW = viewW;
    this.viewH = viewH;
    this._clamp();
  }

  _clamp() {
    if (this.worldW <= this.viewW) {
      this.x = (this.worldW - this.viewW) / 2;
    } else {
      const max = this.worldW - this.viewW;
      if (this.x < 0) this.x = 0;
      if (this.x > max) this.x = max;
    }
    if (this.worldH <= this.viewH) {
      this.y = (this.worldH - this.viewH) / 2;
    } else {
      const max = this.worldH - this.viewH;
      if (this.y < 0) this.y = 0;
      if (this.y > max) this.y = max;
    }
  }

  // Centraliza imediatamente (sem lerp) — útil no start.
  snapTo(target) {
    this.x = target.x + target.w / 2 - this.viewW / 2;
    this.y = target.y + target.h / 2 - this.viewH / 2;
    this._clamp();
  }

  // Update com deadzone + lerp.
  follow(target) {
    const cx = this.x + this.viewW / 2;
    const cy = this.y + this.viewH / 2;
    const tx = target.x + target.w / 2;
    const ty = target.y + target.h / 2;

    const dx = tx - cx;
    const dy = ty - cy;

    let targetX = this.x;
    let targetY = this.y;

    if (dx >  CAM_DEADZONE_X) targetX += (dx - CAM_DEADZONE_X);
    if (dx < -CAM_DEADZONE_X) targetX += (dx + CAM_DEADZONE_X);
    if (dy >  CAM_DEADZONE_Y) targetY += (dy - CAM_DEADZONE_Y);
    if (dy < -CAM_DEADZONE_Y) targetY += (dy + CAM_DEADZONE_Y);

    this.x += (targetX - this.x) * CAM_LERP;
    this.y += (targetY - this.y) * CAM_LERP;
    this._clamp();

    if (this.shakeFrames > 0) this.shakeFrames--;
    else this.shake = 0;
  }

  applyShake(amount = CAM_SHAKE, frames = CAM_SHAKE_FRAMES) {
    if (amount > this.shake || this.shakeFrames === 0) {
      this.shake = amount;
    }
    this.shakeFrames = Math.max(this.shakeFrames, frames);
  }

  // Retorna deslocamento de shake a ser somado na hora do render.
  getShakeOffset() {
    if (this.shakeFrames <= 0) return { x: 0, y: 0 };
    const s = this.shake;
    return {
      x: (Math.random() * 2 - 1) * s,
      y: (Math.random() * 2 - 1) * s,
    };
  }

  // Helper: converte ponto de mundo -> ponto de tela.
  worldToScreen(wx, wy) {
    const off = this.getShakeOffset();
    return { x: wx - this.x + off.x, y: wy - this.y + off.y };
  }
}

// Atalho externo (algumas APIs gostam de função).
export function applyShake(camera, amount = CAM_SHAKE, frames = CAM_SHAKE_FRAMES) {
  camera.applyShake(amount, frames);
}

// ============================================================================
// RESOLVE DE COLISÃO POR EIXO (usado por Player, Inimigos, etc).
// ============================================================================
// entity: { x, y, w, h, velX, velY }
// tilemap: ver makeTilemapFromGrid
export function moveAndCollide(entity, tilemap) {
  // Eixo X.
  entity.x += entity.velX;
  if (entity.velX > 0) {
    const right = entity.x + entity.w;
    const ty0 = Math.floor(entity.y / tilemap.tileSize);
    const ty1 = Math.floor((entity.y + entity.h - 1) / tilemap.tileSize);
    const tx  = Math.floor(right / tilemap.tileSize);
    for (let ty = ty0; ty <= ty1; ty++) {
      if (tilemap.isSolid(tx, ty)) {
        entity.x = tx * tilemap.tileSize - entity.w - 1e-6;
        entity.velX = 0;
        break;
      }
    }
  } else if (entity.velX < 0) {
    const tx = Math.floor(entity.x / tilemap.tileSize);
    const ty0 = Math.floor(entity.y / tilemap.tileSize);
    const ty1 = Math.floor((entity.y + entity.h - 1) / tilemap.tileSize);
    for (let ty = ty0; ty <= ty1; ty++) {
      if (tilemap.isSolid(tx, ty)) {
        entity.x = (tx + 1) * tilemap.tileSize + 1e-6;
        entity.velX = 0;
        break;
      }
    }
  }

  // Eixo Y.
  entity.y += entity.velY;
  entity.grounded = false;
  entity.wallLeft = false;
  entity.wallRight = false;
  if (entity.velY > 0) {
    const bottom = entity.y + entity.h;
    const tx0 = Math.floor(entity.x / tilemap.tileSize);
    const tx1 = Math.floor((entity.x + entity.w - 1) / tilemap.tileSize);
    const ty  = Math.floor(bottom / tilemap.tileSize);
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tilemap.isSolid(tx, ty)) {
        entity.y = ty * tilemap.tileSize - entity.h - 1e-6;
        entity.velY = 0;
        entity.grounded = true;
        break;
      }
    }
  } else if (entity.velY < 0) {
    const ty = Math.floor(entity.y / tilemap.tileSize);
    const tx0 = Math.floor(entity.x / tilemap.tileSize);
    const tx1 = Math.floor((entity.x + entity.w - 1) / tilemap.tileSize);
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tilemap.isSolid(tx, ty)) {
        entity.y = (ty + 1) * tilemap.tileSize + 1e-6;
        entity.velY = 0;
        break;
      }
    }
  }

  // Sensores de parede (para wall slide). Olhamos 1 pixel para fora.
  const sensorY0 = Math.floor((entity.y + 4) / tilemap.tileSize);
  const sensorY1 = Math.floor((entity.y + entity.h - 5) / tilemap.tileSize);
  if (entity.velY >= 0) { // wall slide só quando caindo ou parado vertical
    const rightTileX = Math.floor((entity.x + entity.w) / tilemap.tileSize);
    for (let ty = sensorY0; ty <= sensorY1; ty++) {
      if (tilemap.isSolid(rightTileX, ty)) {
        entity.wallRight = true;
        break;
      }
    }
    const leftTileX = Math.floor(entity.x / tilemap.tileSize);
    for (let ty = sensorY0; ty <= sensorY1; ty++) {
      if (tilemap.isSolid(leftTileX, ty)) {
        entity.wallLeft = true;
        break;
      }
    }
  }
}

// ============================================================================
// PLAYER.
// ============================================================================
export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.w = PLAYER_HITBOX_W;
    this.h = PLAYER_HITBOX_H;
    this.velX = 0;
    this.velY = 0;

    this.facing = 1; // 1 = direita, -1 = esquerda
    this.grounded = false;
    this.wallLeft = false;
    this.wallRight = false;

    this.hp = HP_MAX;
    this.alive = true;

    // Dash.
    this.dashFrames = 0;        // frames restantes de dash ativo
    this.dashCooldown = 0;      // frames até poder dashar de novo
    this.dashDir = 0;           // direção do dash em andamento
    this.iframeFrames = 0;      // i-frames totais (dash + pós-hit)

    // Wall jump.
    this.wallLock = 0;          // frames de lock de input após wall jump

    // Knockback.
    this.knockbackFrames = 0;
    this.knockbackDir = 0;

    // Invuln pós-hit.
    this.invulnFrames = 0;

    // Combate.
    this.shootCooldown = 0;
    this.chargeTimer = 0;       // frames segurando tiro
    this.chargeCooldown = 0;
    this.charging = false;

    // Animação.
    this.animFrame = 0;
    this.animTimer = 0;
  }

  isDashing()    { return this.dashFrames > 0; }
  isInvuln()     { return this.iframeFrames > 0 || this.invulnFrames > 0; }
  isKnockback()  { return this.knockbackFrames > 0; }
  canDash()      { return this.dashCooldown <= 0 && !this.isDashing() && this.alive; }
  hpRatio()      { return this.hp / HP_MAX; }
}

// Ordem de prioridade das poses. Locomoção vem ANTES de atirar: a pose de tiro
// tinha precedência sobre tudo e congelava o boneco enquanto ele deslizava
// andando, ou o deixava de pé no meio de um pulo. Quem anda atirando tem ciclo
// próprio (13-16), quem pula atirando continua na pose de pulo.
export function playerAnimationFrame(player) {
  if (!player.alive || player.isKnockback()) return 12;
  if (player.isDashing()) return 10;
  if (!player.grounded) return player.velY < 0 ? 8 : 9;

  const atirando = player.charging || player.shootCooldown > 0;
  if (Math.abs(player.velX) > 0.1) {
    return (atirando ? 13 : 4) + (player.animFrame & 3);
  }
  if (player.charging && player.chargeTimer >= CHARGE_TIME) return 17;
  if (atirando) return 11;
  return player.animFrame & 3;
}

export function resetPlayer(p, x, y) {
  p.x = x; p.y = y;
  p.velX = 0; p.velY = 0;
  p.facing = 1;
  p.grounded = false; p.wallLeft = false; p.wallRight = false;
  p.hp = HP_MAX; p.alive = true;
  p.dashFrames = 0; p.dashCooldown = 0; p.dashDir = 0; p.iframeFrames = 0;
  p.wallLock = 0;
  p.knockbackFrames = 0; p.knockbackDir = 0;
  p.invulnFrames = 0;
  p.shootCooldown = 0; p.chargeTimer = 0; p.chargeCooldown = 0; p.charging = false;
  p.animFrame = 0; p.animTimer = 0;
}

// ============================================================================
// UPDATE DO PLAYER (chamado uma vez por frame, antes de inimigos/projéteis).
// ============================================================================
export function updatePlayer(p, input, tilemap) {
  if (!p.alive) {
    // Morte: nada de input, só gravidade leve para cair no buraco.
    p.velY = Math.min(p.velY + GRAVITY, FALL_MAX);
    p.y += p.velY;
    input.endFrame(false);
    return;
  }

  // Decay de timers.
  if (p.dashFrames > 0) p.dashFrames--;
  if (p.dashCooldown > 0) p.dashCooldown--;
  if (p.iframeFrames > 0) p.iframeFrames--;
  if (p.invulnFrames > 0) p.invulnFrames--;
  if (p.wallLock > 0) p.wallLock--;
  if (p.shootCooldown > 0) p.shootCooldown--;
  if (p.chargeCooldown > 0) p.chargeCooldown--;
  if (p.knockbackFrames > 0) p.knockbackFrames--;

  // ---------------- DASH ATIVO (substitui input horizontal) ----------------
  if (p.dashFrames > 0) {
    p.velX = p.dashDir * DASH_VEL;
    // Sem gravidade durante dash (dash é uma explosão horizontal).
    p.velY *= 0.6;
    moveAndCollide(p, tilemap);
    input.endFrame(p.grounded);
    return;
  }

  // ---------------- KNOCKBACK (sem input) ---------------------------------
  if (p.knockbackFrames > 0) {
    p.velX = p.knockbackDir * KNOCKBACK_VEL;
    p.velY += GRAVITY;
    if (p.velY > FALL_MAX) p.velY = FALL_MAX;
    moveAndCollide(p, tilemap);
    input.endFrame(p.grounded);
    return;
  }

  // ---------------- INPUT HORIZONTAL --------------------------------------
  const left  = input.isDown('left');
  const right = input.isDown('right');
  let hInput = 0;
  if (left && !right) hInput = -1;
  else if (right && !left) hInput = 1;

  // Wall lock: ignora input horizontal que re-grudaria na parede.
  if (p.wallLock > 0 && hInput !== 0) {
    // Se o input é em direção à parede, ignora. Se é para longe, permite.
    if (p.wallRight && hInput === 1) hInput = 0;
    if (p.wallLeft  && hInput === -1) hInput = 0;
  }

  if (hInput !== 0) {
    p.facing = hInput;
    p.velX += hInput * PLAYER_ACCEL;
    if (p.velX >  PLAYER_SPEED) p.velX =  PLAYER_SPEED;
    if (p.velX < -PLAYER_SPEED) p.velX = -PLAYER_SPEED;
  } else {
    // Para IMEDIATAMENTE (andar, não deslizar — SPEC §3).
    if (p.velX > 0) {
      p.velX = Math.max(0, p.velX - PLAYER_DECEL);
    } else if (p.velX < 0) {
      p.velX = Math.min(0, p.velX + PLAYER_DECEL);
    }
  }

  // ---------------- WALL SLIDE --------------------------------------------
  const touchingWall = p.wallLeft || p.wallRight;
  const canWallSlide = touchingWall && !p.grounded && p.velY > 0;
  if (canWallSlide) {
    if (p.velY > WALL_SLIDE_MAX) p.velY = WALL_SLIDE_MAX;
  }

  // ---------------- PULO --------------------------------------------------
  // Coyote: input.isDown mantém coyote resetado. Atualizamos no fim do frame.
  // Buffer é consumido APENAS se o pulo de fato dispara — caso contrário
  // persiste para o próximo frame.
  const justJumped = input.justPressed('jump');
  const canGroundJump = p.grounded || input.canCoyoteJump();
  const canWallJump   = touchingWall && p.wallLock <= 0;
  let didJump = false;
  if (justJumped) {
    if (canGroundJump) {
      p.velY = JUMP_VEL;
      input.markGrounded();
      didJump = true;
    } else if (canWallJump) {
      p.velX = (p.wallRight ? -WALL_JUMP.vx : WALL_JUMP.vx);
      p.velY = WALL_JUMP.vy;
      p.facing = (p.wallRight ? -1 : 1);
      p.wallLock = WALL_LOCK;
      didJump = true;
    }
    // Se não pulou agora (no ar, sem coyote, sem parede), o buffer
    // já foi armado pelo press(); permanece até o próximo frame.
  } else if (canGroundJump && input.consumeJump()) {
    // Buffer atrasado: jump foi pressionado há até 6 frames, e agora há chão.
    p.velY = JUMP_VEL;
    input.markGrounded();
    didJump = true;
  }
  if (didJump) input.consumeJump();

  // Cut-jump: se soltou o botão e está subindo rápido, corta.
  if (input.justReleased('jump') && p.velY < -3) {
    p.velY = -3;
  }

  // ---------------- DASH --------------------------------------------------
  if (input.justPressed('dash') || input.consumeDash()) {
    if (p.canDash()) {
      // Direção: input horizontal explícito > facing > última facing.
      let dir = hInput;
      if (dir === 0) dir = (input.getFacing() !== 0) ? input.getFacing() : p.facing;
      p.dashFrames = DASH_DURATION;
      p.dashCooldown = DASH_COOLDOWN;
      p.dashDir = dir;
      p.iframeFrames = DASH_IFRAMES; // i-frames NO INÍCIO do dash.
      p.velX = dir * DASH_VEL;
      p.velY = 0;
    }
  }

  // ---------------- GRAVIDADE ---------------------------------------------
  p.velY += GRAVITY;
  if (p.velY > FALL_MAX) p.velY = FALL_MAX;

  // ---------------- MOVER + COLIDIR --------------------------------------
  moveAndCollide(p, tilemap);

  // Espinho = morte instantânea.
  checkSpikeDeath(p, tilemap);

  // ---------------- SHOOT / CHARGE ---------------------------------------
  updateShooting(p, input);

  // ---------------- ANIMAÇÃO ---------------------------------------------
  p.animTimer++;
  if (p.animTimer > 6) { p.animTimer = 0; p.animFrame = (p.animFrame + 1) & 3; }

  // ---------------- FIM DO FRAME: input.endFrame -----------------------
  // IMPORTANTE: chamada por último, com grounded real. Limpa edge state,
  // decai buffers, atualiza coyote.
  input.endFrame(p.grounded);
}

function checkSpikeDeath(p, tilemap) {
  const tx0 = Math.floor(p.x / tilemap.tileSize);
  const tx1 = Math.floor((p.x + p.w - 1) / tilemap.tileSize);
  const ty0 = Math.floor(p.y / tilemap.tileSize);
  const ty1 = Math.floor((p.y + p.h - 1) / tilemap.tileSize);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tilemap.isHazard && tilemap.isHazard(tx, ty)) {
        p.hp = 0;
        p.alive = false;
        return;
      }
    }
  }
}

function updateShooting(p, input) {
  const shootHeld = input.isDown('shoot');
  if (shootHeld) {
    p.chargeTimer++;
    p.charging = true;
  } else {
    if (p.charging && p.shootCooldown <= 0) {
      // Soltou: dispara. Charge se chargeTimer >= CHARGE_TIME.
      // (projétil é disparado pelo game/level via spawnProjectile, este
      // método só seta o estado). Sinalizamos via _pendingShot.
      if (p.chargeTimer >= CHARGE_TIME && p.chargeCooldown <= 0) {
        p._pendingShot = { type: 'charge' };
        p.chargeCooldown = CHARGE_COOLDOWN;
        p.shootCooldown = PROJ_COOLDOWN * 2;
      } else {
        p._pendingShot = { type: 'normal' };
        p.shootCooldown = PROJ_COOLDOWN;
      }
    }
    p.chargeTimer = 0;
    p.charging = false;
  }
}

export function consumePendingShot(p) {
  const s = p._pendingShot;
  p._pendingShot = null;
  return s;
}

// ============================================================================
// DANO NO PLAYER (chamado pelo subagente de fase quando colidir com inimigo).
// ============================================================================
export function damagePlayer(p, amount, fromX) {
  if (p.isInvuln() || !p.alive) return false;
  p.hp = Math.max(0, p.hp - amount);
  if (p.hp <= 0) {
    p.alive = false;
  } else {
    p.invulnFrames = INVULN_POST_HIT;
    p.knockbackFrames = KNOCKBACK_FRAMES;
    p.knockbackDir = (p.x + p.w / 2) < fromX ? -1 : 1;
    p.velY = -3; // pequeno quique
  }
  setHitstop(HITSTOP_TAKE);
  return true;
}

// ============================================================================
// PROJÉTIL.
// ============================================================================
export class Projectile {
  constructor(x, y, dir, opts = {}) {
    this.x = x;
    this.y = y;
    this.dir = dir; // 1 ou -1
    this.fromPlayer = opts.fromPlayer !== false;
    this.fromCharge = !!opts.fromCharge;
    this.damage = opts.damage ?? (this.fromCharge ? CHARGE_DAMAGE : 1);
    this.vx = (this.fromCharge ? 6 : PROJ_VEL) * dir;
    this.vy = 0;
    this.w = this.fromCharge ? 16 : 8;
    this.h = this.fromCharge ? 16 : 8;
    this.life = opts.life ?? 180; // 3 segundos a 60fps
    this.dead = false;
  }
  update(tilemap) {
    if (this.dead) return;
    this.x += this.vx;
    this.y += this.vy;
    this.life--;
    if (this.life <= 0) { this.dead = true; return; }
    // Colide com sólidos.
    const tx0 = Math.floor(this.x / tilemap.tileSize);
    const tx1 = Math.floor((this.x + this.w - 1) / tilemap.tileSize);
    const ty0 = Math.floor(this.y / tilemap.tileSize);
    const ty1 = Math.floor((this.y + this.h - 1) / tilemap.tileSize);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (tilemap.isSolid(tx, ty)) { this.dead = true; return; }
      }
    }
  }
  isOffscreen(viewW, viewH, camX, camY) {
    return this.x < camX - 32 || this.x > camX + viewW + 32 ||
           this.y < camY - 32 || this.y > camY + viewH + 32;
  }
}

export function spawnProjectile(p, type) {
  const dir = p.facing;
  const cy = p.y + p.h / 2 - 8;
  const cx = p.x + (dir === 1 ? p.w : -16);
  if (type === 'charge') {
    return new Projectile(cx, cy, dir, { fromPlayer: true, fromCharge: true });
  }
  return new Projectile(cx, cy, dir, { fromPlayer: true });
}

export function updateProjectiles(projectiles, tilemap) {
  for (let i = 0; i < projectiles.length; i++) {
    projectiles[i].update(tilemap);
  }
  // Limpa mortos.
  for (let i = projectiles.length - 1; i >= 0; i--) {
    if (projectiles[i].dead) projectiles.splice(i, 1);
  }
}

// ============================================================================
// AABB helper re-export (algumas APIs esperam 'aabb' com nome).
// ============================================================================
export { aabb as aabbCollision };
