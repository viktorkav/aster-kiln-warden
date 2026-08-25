// smoke.mjs — smoke test de integração (orquestrador): level.js + engine.js reais.
// Roda com: node tests/smoke.mjs  (sem DOM; game.js NÃO é importado aqui)
import { LEVEL_GRID, Level, EnemyWalker, EnemyFlyer, EnemyTurret, PLAYER_SPAWN } from '../src/level.js';
import { Player, Projectile, HP_MAX, setHitstop, isHitstop, updatePlayer, damagePlayer } from '../src/engine.js';
import { Input } from '../src/input.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };

// ---- Grid ---------------------------------------------------------------
ok(LEVEL_GRID.length === 9 && LEVEL_GRID[0].length === 128, 'grid 9x128');
ok(LEVEL_GRID[7][0] === 1 && LEVEL_GRID[8][0] === 1, 'ground rows 7-8 solid');
ok(LEVEL_GRID[7][25] === 0 && LEVEL_GRID[7][26] === 0 && LEVEL_GRID[7][24] === 1 && LEVEL_GRID[7][27] === 1, 'gap 25-26');
ok(LEVEL_GRID[7][55] === 0 && LEVEL_GRID[7][56] === 0, 'gap 55-56');
ok(LEVEL_GRID[5][40] === 2 && LEVEL_GRID[5][50] === 2, 'platform row5 cols 40-50');
ok(LEVEL_GRID[6][78] === 3 && LEVEL_GRID[6][79] === 3, 'spikes 78-79 row6');
ok(LEVEL_GRID[6][60] === 4 && LEVEL_GRID[6][115] === 6, 'checkpoint tile + boss door tile');
ok(LEVEL_GRID[0][115] === 1 && LEVEL_GRID[0][127] === 1 && LEVEL_GRID[6][127] === 1, 'boss room ceiling + back wall');

// ---- Level: inimigos ------------------------------------------------------
const lvl = new Level(LEVEL_GRID);
ok(lvl.enemies.length === 7, '7 enemies (' + lvl.enemies.length + ')');
ok(lvl.enemies.filter(e => e instanceof EnemyWalker).length === 3, '3 walkers');
ok(lvl.enemies.filter(e => e instanceof EnemyFlyer).length === 2, '2 flyers');
ok(lvl.enemies.filter(e => e instanceof EnemyTurret).length === 2, '2 turrets');

// ---- Player anda + pula sobre o gap 25-26 -----------------------------------
const p = new Player(780, 7 * 32 - 32); // 20px antes da borda do gap (800)
const input = new Input();
input.press('KeyD');
input.press('KeyZ'); // pulo no primeiro frame
for (let i = 0; i < 70; i++) updatePlayer(p, input, lvl.tilemap);
input.release('KeyZ');
ok(p.x > 864 && p.grounded, 'pulo cruza o gap 25-26 (x=' + Math.round(p.x) + ', grounded=' + p.grounded + ')');
ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'sem NaN nas coordenadas');
ok(p.hp === HP_MAX && p.alive, 'HP 28 e vivo após a travessia');

// ---- Espinho = morte instantânea ------------------------------------------
const p2 = new Player(78 * 32, 7 * 32 - 32);
const input2 = new Input();
updatePlayer(p2, input2, lvl.tilemap);
updatePlayer(p2, input2, lvl.tilemap);
ok(!p2.alive, 'espinho matou instantaneamente');

// ---- Trigger do chefe + phases + padrões ------------------------------------
const p3 = new Player(116 * 32 + 40, 7 * 32 - 32);
const input3 = new Input();
const lvl3 = new Level(LEVEL_GRID);
lvl3.update(p3);
ok(lvl3.boss !== null, 'chefe spawnou ao cruzar a porta');
const boss = lvl3.boss;
ok(boss.hp === 28, 'boss HP 28');
ok(boss.phase() === 1, 'phase 1 com HP 28');

// Phase 1: 3 tiros retos com 50f de intervalo
boss.state = 'rest'; boss.stateTimer = 1;
let shots = 0;
for (let i = 0; i < 140; i++) { boss.update(lvl3.tilemap, p3, lvl3.enemyProjectiles); }
shots = lvl3.enemyProjectiles.length;
ok(shots === 3, 'phase1 disparou 3 projéteis em 140f (got ' + shots + ')');
ok(lvl3.enemyProjectiles.every(pr => pr.fromPlayer === false), 'projéteis do chefe fromPlayer=false');
ok(lvl3.enemyProjectiles.every(pr => Math.abs(pr.vx) === 4 && pr.vy === 0), 'phase1 vel 4 horizontal');

// Phase 2: cruzar o threshold interrompe o padrão e telegrafa 60f antes do charge.
boss.takeDamage(10, boss.x - 100);
ok(boss.phase() === 2, 'phase 2 com HP 15');
ok(boss.state === 'transition' && boss.stateTimer === 60, 'fase 2 interrompe padrão e entra em transição');
for (let i = 0; i < 60; i++) boss.update(lvl3.tilemap, p3, lvl3.enemyProjectiles);
ok(boss.state === 'charge' && boss.invuln === 30, 'charge começa com 30f de i-frames');
const xBefore = boss.x;
for (let i = 0; i < 20; i++) boss.update(lvl3.tilemap, p3, lvl3.enemyProjectiles);
ok(boss.x !== xBefore, 'charge avançou ' + Math.abs(Math.round(boss.x - xBefore)) + 'px');

// Phase 3: novo threshold interrompe o padrão atual e leva ao spread.
boss.invuln = 0;
boss.takeDamage(9, boss.x - 100);
lvl3.enemyProjectiles.length = 0;
ok(boss.state === 'transition' && boss.stateTimer === 60, 'fase 3 interrompe padrão e entra em transição');
for (let i = 0; i < 60; i++) boss.update(lvl3.tilemap, p3, lvl3.enemyProjectiles);
for (let i = 0; i < 143; i++) boss.update(lvl3.tilemap, p3, lvl3.enemyProjectiles);
ok(lvl3.enemyProjectiles.length === 9, 'phase3: 3 spreads × 3 projéteis após transição (got ' + lvl3.enemyProjectiles.length + ')');
const vs = [...new Set(lvl3.enemyProjectiles.map(pr => pr.vy.toFixed(2)))].sort();
ok(vs.length === 3, 'spread tem ângulos -15/0/+15 (vy=' + vs.join(',') + ')');

// i-frames do charge bloqueiam dano
boss.invuln = 10;
const beforeHp = boss.hp;
ok(boss.takeDamage(1, boss.x) === false && boss.hp === beforeHp, 'i-frames do charge bloqueiam dano');
boss.invuln = 0;
ok(boss.takeDamage(1, boss.x) === true && boss.hp === beforeHp - 1, 'dano normal passa');

// ---- Hit-stop global --------------------------------------------------------
setHitstop(4);
ok(isHitstop(), 'hit-stop global ativo após setHitstop(4)');

// ---- Walker vira na borda da plataforma -------------------------------------
const walker = new EnemyWalker(50 * 32, 5 * 32 - 16); // extremo direito da plataforma
for (let i = 0; i < 400; i++) walker.update(lvl.tilemap);
ok(walker.x >= 40 * 32 - 40 && walker.x <= 50 * 32 + 40, 'walker ficou na plataforma (x=' + Math.round(walker.x) + ')');

// ---- damagePlayer + knockback ------------------------------------------------
const p4 = new Player(PLAYER_SPAWN.x, PLAYER_SPAWN.y);
const input4 = new Input();
updatePlayer(p4, input4, lvl.tilemap);
const hit = damagePlayer(p4, 1, p4.x - 100);
ok(hit === true && p4.hp === HP_MAX - 1, 'damagePlayer aplicou 1 de dano');
ok(p4.invulnFrames > 0, 'invuln pós-hit ativa');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
