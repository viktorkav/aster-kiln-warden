import { Camera, HP_MAX, Player } from './engine.js';
import { Level } from './level.js';

export function createRunState(grid, viewW, viewH) {
  const level = new Level(grid);
  const tilemap = level.tilemap;
  const player = new Player(level.playerStart.x, level.playerStart.y);
  const camera = new Camera(viewW, viewH, tilemap.pixelWidth, tilemap.pixelHeight);
  camera.snapTo(player);

  return {
    level,
    tilemap,
    player,
    camera,
    playerProjectiles: [],
    state: 'READY',
    stateTimer: 30,
    goTimer: 0,
    paused: false,
    deathTimer: 0,
    winTimer: 0,
    fadeAlpha: 0,
    frame: 0,
  };
}

export function nextPauseState(paused, pausePressed) {
  return pausePressed ? !paused : paused;
}

export function respawnPoint(level) {
  return level.checkpointActive ? level.checkpoint : level.playerStart;
}

export function applyBossReward(player) {
  player.hp = HP_MAX;
}
