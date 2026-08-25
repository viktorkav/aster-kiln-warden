import { LEVEL_GRID } from '../src/level.js';
import { HP_MAX } from '../src/engine.js';
import { Input } from '../src/input.js';

let session = null;
try {
  session = await import('../src/session.js');
} catch {
  // RED: the session module does not exist yet.
}

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

check(session !== null, 'session lifecycle module exists');

if (session) {
  const run = session.createRunState(LEVEL_GRID, 480, 270);
  check(run.state === 'READY' && run.stateTimer === 30, 'new run starts in READY for 30 frames');
  check(run.level.enemies.length === 7, 'new run recreates all enemies');
  check(run.player.x === run.level.playerStart.x, 'new run starts player at initial spawn');
  check(run.playerProjectiles.length === 0, 'new run clears player projectiles');
  check(run.camera.worldW === 4096, 'new run recreates camera with world bounds');

  run.level.enemies[0].alive = false;
  run.level.bossSpawned = true;
  run.playerProjectiles.push({ dead: false });
  run.state = 'WIN';
  const restarted = session.createRunState(LEVEL_GRID, 480, 270);
  check(restarted.level.enemies[0].alive, 'restart restores defeated enemies');
  check(!restarted.level.bossSpawned && restarted.level.boss === null, 'restart removes boss state');
  check(restarted.playerProjectiles.length === 0 && restarted.state === 'READY', 'restart clears combat and WIN state');

  check(session.nextPauseState(false, true) === true, 'pause press enters persistent pause');
  check(session.nextPauseState(true, false) === true, 'no new press keeps game paused');
  check(session.nextPauseState(true, true) === false, 'second pause press resumes game');

  const pointBefore = session.respawnPoint(restarted.level);
  check(
    pointBefore.x === restarted.level.playerStart.x,
    'inactive checkpoint respawns at initial spawn',
  );

  restarted.level.checkpointActive = true;
  const pointAfter = session.respawnPoint(restarted.level);
  check(
    pointAfter.x === restarted.level.checkpoint.x,
    'active checkpoint respawns at checkpoint',
  );

  restarted.player.hp = 1;
  session.applyBossReward(restarted.player);
  check(restarted.player.hp === HP_MAX, 'boss reward heals player before WIN');
}

const input = new Input();
input.press('KeyZ');
input.press('KeyX');
input.press('KeyP');
const jumpBufferBeforePause = input.jumpBufferFrames();
const dashBufferBeforePause = input.dashBufferFrames();

check(typeof input.clearTransient === 'function', 'input exposes transient-edge cleanup');
if (typeof input.clearTransient === 'function') {
  input.clearTransient();
  check(!input.pauseJustPressed(), 'transient cleanup consumes pause edge');
  check(
    input.jumpBufferFrames() === jumpBufferBeforePause &&
      input.dashBufferFrames() === dashBufferBeforePause,
    'paused ticks preserve jump and dash buffers',
  );

  input.release('KeyZ');
  input.clearTransient({ preserveJumpRelease: true });
  check(input.justReleased('jump'), 'hit-stop preserves jump release for cut-jump');
  input.clearTransient({ preserveJumpRelease: true });
  check(input.justReleased('jump'), 'preserved jump release survives every frozen tick');
  input.clearTransient();
}

check(typeof input.resetForRun === 'function', 'input exposes run reset cleanup');
if (typeof input.resetForRun === 'function') {
  input.press('KeyR');
  input.resetForRun();
  check(input.jumpBufferFrames() === 0 && input.dashBufferFrames() === 0, 'restart clears action buffers');
  check(
    input.isDown('restart') && !input.restartJustPressed(),
    'restart clears the edge but preserves held-key state against auto-repeat',
  );
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
