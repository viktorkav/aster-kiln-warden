// Regressões de comportamento de level.js. Roda com: node tests/level-regressions.mjs
import {
  Boss,
  CHECKPOINT,
  EnemyWalker,
  LEVEL_GRID,
  Level,
  PLAYER_SPAWN,
} from '../src/level.js';
import { makeTilemapFromGrid } from '../src/engine.js';

let pass = 0;
let fail = 0;

function check(condition, message) {
  if (condition) {
    pass++;
    console.log('PASS', message);
  } else {
    fail++;
    console.log('FAIL', message);
  }
}

const floorTilemap = makeTilemapFromGrid([
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 1, 1, 0],
]);
const player = { x: 3760, y: 112, w: 16, h: 32, alive: true };

// Esta falha se uma nova run já considerar o checkpoint futuro como ativo.
{
  const level = new Level(LEVEL_GRID);
  const beforeCheckpoint = { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y, w: 16, h: 32 };
  const onCheckpoint = { x: CHECKPOINT.x, y: CHECKPOINT.y, w: 16, h: 32 };

  check(level.checkpointActive === false,
    'checkpoint começa inativo em uma nova run');
  check(typeof level.tryActivateCheckpoint === 'function',
    'level expõe ativação de checkpoint por colisão');
  if (typeof level.tryActivateCheckpoint === 'function') {
    check(level.tryActivateCheckpoint(beforeCheckpoint) === false,
      'player longe do tile 4 não ativa checkpoint');
    check(level.tryActivateCheckpoint(onCheckpoint) === true && level.checkpointActive,
      'sobrepor o tile 4 ativa checkpoint');
    check(level.tryActivateCheckpoint(onCheckpoint) === false,
      'checkpoint ativado permanece idempotente');
  }
}

// Esta falha se o walker nunca ganhar velocidade vertical ou atravessar a borda.
{
  const walker = new EnemyWalker(40, 0);
  for (let i = 0; i < 80; i++) walker.update(floorTilemap);
  check(walker.grounded && walker.y > 100 && walker.y < 113,
    'walker cai sob gravidade e repousa sobre a plataforma');

  for (let i = 0; i < 80; i++) walker.update(floorTilemap);
  check(walker.x >= 32 && walker.x + walker.w <= 96,
    'walker inverte antes de abandonar a borda da plataforma');
}

// Esta falha se o dano deixa o padrão anterior continuar ao cruzar 19 HP.
{
  const boss = new Boss(3800, 88);
  const projectiles = [];
  boss.state = 'shoot';
  boss.stateTimer = 100;
  boss.shotsFired = 1;
  boss.shotTimer = 50;
  boss.takeDamage(10, 3700); // 28 -> 18, cruzando para a fase 2

  check(boss.state === 'transition' && boss.stateTimer === 60 && boss.shotsFired === 0,
    'cruzar 19 HP interrompe o padrão e inicia transição de 60 frames');

  for (let i = 0; i < 59; i++) boss.update(floorTilemap, player, projectiles);
  check(boss.state === 'transition' && projectiles.length === 0,
    'transição de fase não dispara o padrão anterior antes de 60 frames');

  boss.update(floorTilemap, player, projectiles);
  check(boss.state === 'charge' && boss.invuln === 30,
    'após a transição, fase 2 entra no charge com i-frames');
}

// Esta falha se a fase 3 retoma/continua charge, em vez do spread após a transição.
{
  const boss = new Boss(3800, 88);
  const projectiles = [];
  boss.takeDamage(19, 3700); // 28 -> 9, cruzando diretamente para a fase 3
  check(boss.state === 'transition' && boss.stateTimer === 60,
    'cruzar 10 HP também inicia uma transição de fase completa');
  for (let i = 0; i < 60; i++) boss.update(floorTilemap, player, projectiles);
  check(boss.state === 'shoot' && boss.shotsFired === 0,
    'após a transição, fase 3 inicia o padrão de spread');
  boss.update(floorTilemap, player, projectiles);
  check(projectiles.length === 3 && new Set(projectiles.map((p) => p.vy.toFixed(2))).size === 3,
    'padrão da fase 3 dispara três projéteis em leque');
}

// Esta falha se charge shot só pisca o chefe, sem deslocá-lo para longe do impacto.
{
  const boss = new Boss(3800, 88);
  const projectiles = [];
  const beforeX = boss.x;
  const hit = boss.takeDamage(3, 3700, { charge: true });
  boss.update(floorTilemap, player, projectiles);
  check(hit && boss.knockbackFrames > 0 && boss.x > beforeX,
    'charge shot expõe knockback e desloca o chefe para longe do impacto');
}

// Esta falha se o freeze final do chefe durar 31 ticks em vez dos 30 da SPEC.
{
  const boss = new Boss(3800, 88);
  boss.takeDamage(boss.hp, 3700);
  for (let i = 0; i < 29; i++) boss.updateDeath();
  check(!boss.dead, 'boss ainda não conclui a morte antes de 30 frames');
  boss.updateDeath();
  check(boss.dead, 'boss conclui a morte exatamente no frame 30');
}

// ---------------------------------------------------------------------------
// O CHEFE NASCE COM OS PÉS NO CHÃO
// O y de spawn era 88 fixo, 56 px acima do piso da sala — o Kiln Warden tem
// pernas e ficava pairando parado no ar até morrer.
// ---------------------------------------------------------------------------
{
  const level = new Level(LEVEL_GRID);
  const player = { x: 116 * 32, y: 7 * 32 - 32, w: 16, h: 32, alive: true };
  level.update(player);

  check(level.boss !== null, 'cruzar a porta spawna o chefe');
  const chao = 7 * 32; // topo da linha de chão (SPEC §5)
  check(
    level.boss.y + level.boss.h === chao,
    `chefe nasce apoiado no chão (base em ${level.boss.y + level.boss.h}, chão em ${chao})`,
  );
  check(
    level.boss.baseY + level.boss.h === chao,
    'a altura de repouso do chefe é a do chão, não uma constante solta',
  );

  // E continua no chão depois de rodar: qualquer hover tira os pés do piso.
  const bases = new Set();
  for (let i = 0; i < 120; i++) {
    level.boss.update(level.tilemap, player, level.enemyProjectiles);
    bases.add(level.boss.y + level.boss.h);
  }
  check(
    bases.size === 1 && bases.has(chao),
    `chefe não flutua durante o combate (viu bases ${[...bases].join(', ')})`,
  );
}

console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
