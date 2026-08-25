import * as engine from '../src/engine.js';
import * as level from '../src/level.js';

let pass = 0;
let fail = 0;

function check(condition, message) {
  if (condition) {
    pass++;
    console.log(`PASS: ${message}`);
  } else {
    fail++;
    console.error(`FAIL: ${message}`);
  }
}

check(
  typeof engine.playerAnimationFrame === 'function',
  'engine exports the player v2 animation selector',
);

if (typeof engine.playerAnimationFrame === 'function') {
  const player = new engine.Player(0, 0);
  player.grounded = true;
  player.animFrame = 2;
  check(engine.playerAnimationFrame(player) === 2, 'idle uses frames 0-3');

  player.velX = 1;
  check(engine.playerAnimationFrame(player) === 6, 'running uses frames 4-7');

  player.velX = 0;
  player.grounded = false;
  player.velY = -1;
  check(engine.playerAnimationFrame(player) === 8, 'rising uses frame 8');

  player.velY = 1;
  check(engine.playerAnimationFrame(player) === 9, 'falling uses frame 9');

  player.dashFrames = 1;
  check(engine.playerAnimationFrame(player) === 10, 'dash uses frame 10');

  // Atirar não rouba mais a pose de quem está no ar ou andando: a pose parada
  // de tiro só vale de pé e sem se mover.
  player.dashFrames = 0;
  player.charging = true;
  check(engine.playerAnimationFrame(player) === 9, 'falling while shooting stays on frame 9');

  player.grounded = true;
  player.velX = 0;
  player.velY = 0;
  check(engine.playerAnimationFrame(player) === 11, 'shooting uses frame 11');

  player.charging = false;
  player.knockbackFrames = 1;
  check(engine.playerAnimationFrame(player) === 12, 'damage uses frame 12');
}

check(
  typeof level.enemyAnimationFrame === 'function',
  'level exports the enemy v2 animation selector',
);

if (typeof level.enemyAnimationFrame === 'function') {
  const walker = new level.EnemyWalker(0, 0);
  const flyer = new level.EnemyFlyer(0, 0);
  const turret = new level.EnemyTurret(0, 0);
  walker.animFrame = flyer.animFrame = turret.animFrame = 3;

  check(level.enemyAnimationFrame(walker) === 3, 'walker uses frames 0-3');
  check(level.enemyAnimationFrame(flyer) === 7, 'flyer uses frames 4-7');
  check(level.enemyAnimationFrame(turret) === 11, 'turret uses frames 8-11');
}

// ---------------------------------------------------------------------------
// ANDAR ATIRANDO TEM POSE PRÓPRIA
// A pose de tiro vinha antes do teste de movimento na ordem de prioridade, e
// o sheet não tinha frame de andar-atirando: quem andava segurando o tiro
// deslizava pela tela com o boneco congelado na pose de disparo.
// ---------------------------------------------------------------------------
if (typeof engine.playerAnimationFrame === 'function') {
  const p = new engine.Player(0, 0);
  p.grounded = true;
  p.velX = 2;
  p.animFrame = 1;

  p.charging = true;
  check(
    engine.playerAnimationFrame(p) === 14,
    'andar carregando usa o ciclo de andar-atirando (13-16), não a pose parada',
  );

  p.charging = false;
  p.shootCooldown = 5;
  check(
    engine.playerAnimationFrame(p) === 14,
    'andar logo após disparar também usa o ciclo de andar-atirando',
  );

  // O ciclo de andar-atirando anda junto com o de andar: mesma cadência.
  p.animFrame = 3;
  check(engine.playerAnimationFrame(p) === 16, 'andar-atirando percorre os 4 frames');

  // Parado, a pose de disparo continua sendo a 11.
  p.velX = 0;
  check(engine.playerAnimationFrame(p) === 11, 'parado atirando continua no frame 11');

  // Parado com a carga cheia tem pose própria.
  p.shootCooldown = 0;
  p.charging = true;
  p.chargeTimer = engine.CHARGE_TIME;
  check(
    engine.playerAnimationFrame(p) === 17,
    'parado com carga cheia usa a pose de charge (frame 17)',
  );

  // No ar, tiro não rouba a pose de pulo.
  p.grounded = false;
  p.velY = -2;
  check(engine.playerAnimationFrame(p) === 8, 'subir atirando continua na pose de pulo');
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
