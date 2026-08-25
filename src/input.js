// input.js — Teclado, edge detection, buffers, coyote counter.
// ES module, sem dependências. Veja SPEC.md §3 e §10.

import {
  COYOTE_FRAMES,
  JUMP_BUFFER,
} from './engine.js';

const KEY_LEFT  = new Set(['ArrowLeft',  'KeyA']);
const KEY_RIGHT = new Set(['ArrowRight', 'KeyD']);
const KEY_UP    = new Set(['ArrowUp',    'KeyW']);
const KEY_DOWN  = new Set(['ArrowDown',  'KeyS']);
const KEY_JUMP  = new Set(['KeyZ', 'Space', 'KeyJ', 'ArrowUp', 'KeyW']);
const KEY_DASH  = new Set(['KeyX', 'ShiftLeft', 'ShiftRight', 'KeyK', 'KeyL']);
const KEY_SHOOT = new Set(['KeyC', 'ControlLeft', 'ControlRight']);
const KEY_CHARGE_HOLD = new Set(['KeyC', 'ControlLeft', 'ControlRight']);
const KEY_PAUSE  = new Set(['KeyP', 'Escape']);
const KEY_RESTART = new Set(['KeyR']);

const PREVENT_DEFAULT_CODES = new Set([
  'ArrowLeft','ArrowRight','ArrowUp','ArrowDown',
  'Space','Slash','Period','Comma',
]);

function hasAny(set, list) {
  for (const k of list) if (set.has(k)) return true;
  return false;
}

export class Input {
  constructor() {
    this._down = new Set();
    this._justPressed = new Set();
    this._justReleased = new Set();

    // Direction tracking (1 = right, -1 = left, 0 = neutral).
    this._facing = 0;
    this._lastFacing = 1;

    // Buffers (frames remaining).
    this._jumpBuffer = 0;
    this._dashBuffer = 0;

    // Coyote counter (frames since last grounded contact).
    this._coyoteCounter = COYOTE_FRAMES + 1;

    // Pause / restart (single-frame).
    this._pausePressed = false;
    this._restartPressed = false;

    this._onKeyDown = (e) => this._handleKeyDown(e);
    this._onKeyUp   = (e) => this._handleKeyUp(e);
    this._onBlur    = () => this._releaseAll();
  }

  attach() {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup',   this._onKeyUp);
    window.addEventListener('blur',    this._onBlur);
  }

  detach() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup',   this._onKeyUp);
    window.removeEventListener('blur',    this._onBlur);
  }

  _handleKeyDown(e) {
    if (PREVENT_DEFAULT_CODES.has(e.code)) e.preventDefault();
    if (this._down.has(e.code)) return; // ignora auto-repeat
    this._down.add(e.code);
    this._justPressed.add(e.code);
    // Buffer inicial = JUMP_BUFFER + 1: após JUMP_BUFFER decrementos
    // (um por frame via endFrame), o buffer ainda tem 1 frame válido,
    // totalizando JUMP_BUFFER frames de validade conforme a SPEC.
    if (KEY_JUMP.has(e.code))  this._jumpBuffer = JUMP_BUFFER + 1;
    if (KEY_DASH.has(e.code))  this._dashBuffer = 7;
    if (KEY_PAUSE.has(e.code)) this._pausePressed = true;
    if (KEY_RESTART.has(e.code)) this._restartPressed = true;
  }

  _handleKeyUp(e) {
    if (this._down.has(e.code)) {
      this._down.delete(e.code);
      this._justReleased.add(e.code);
    }
  }

  _releaseAll() {
    this._justPressed.clear();
    this._justReleased.clear();
    this._down.clear();
  }

  clearTransient({ preserveJumpRelease = false } = {}) {
    const releasedJumpCodes = preserveJumpRelease
      ? [...KEY_JUMP].filter((code) => this._justReleased.has(code))
      : [];
    this._justPressed.clear();
    this._justReleased.clear();
    for (const code of releasedJumpCodes) this._justReleased.add(code);
    this._pausePressed = false;
    this._restartPressed = false;
  }

  resetForRun() {
    this.clearTransient();
    this._jumpBuffer = 0;
    this._dashBuffer = 0;
    this._coyoteCounter = COYOTE_FRAMES + 1;
    this._facing = 0;
    this._lastFacing = 1;
  }

  // ----------------------------------------------------------------
  // API para testes / gamepad: simula keydown/keyup sem DOM.
  // ----------------------------------------------------------------
  press(code) {
    if (this._down.has(code)) return;
    this._down.add(code);
    this._justPressed.add(code);
    if (KEY_JUMP.has(code))  this._jumpBuffer = JUMP_BUFFER + 1;
    if (KEY_DASH.has(code))  this._dashBuffer = 7;
    if (KEY_PAUSE.has(code)) this._pausePressed = true;
    if (KEY_RESTART.has(code)) this._restartPressed = true;
  }
  release(code) {
    if (this._down.has(code)) {
      this._down.delete(code);
      this._justReleased.add(code);
    }
  }

  // ----------------------------------------------------------------
  // endFrame(grounded) — chamado UMA vez por frame pelo engine, APÓS
  // toda a lógica de jogo. Faz:
  //   - atualiza facing (baseado em left/right atuais)
  //   - gerencia coyote (reset se grounded, ++ se não)
  //   - decai jump/dash buffers
  //   - limpa flags de "acabou de acontecer" (just*, pause, restart)
  // ----------------------------------------------------------------
  endFrame(grounded = false) {
    const left  = this.isDown('left');
    const right = this.isDown('right');
    if (left && !right) { this._facing = -1; this._lastFacing = -1; }
    else if (right && !left) { this._facing = 1; this._lastFacing = 1; }
    else { this._facing = 0; }

    if (grounded) this._coyoteCounter = 0;
    else this._coyoteCounter++;

    if (this._jumpBuffer > 0) this._jumpBuffer--;
    if (this._dashBuffer > 0) this._dashBuffer--;

    this._justPressed.clear();
    this._justReleased.clear();
    this._pausePressed = false;
    this._restartPressed = false;
  }

  // ----------------------------------------------------------------
  // Consultas
  // ----------------------------------------------------------------
  isDown(name) {
    if (name === 'left')    return hasAny(this._down, KEY_LEFT);
    if (name === 'right')   return hasAny(this._down, KEY_RIGHT);
    if (name === 'up')      return hasAny(this._down, KEY_UP);
    if (name === 'down')    return hasAny(this._down, KEY_DOWN);
    if (name === 'jump')    return hasAny(this._down, KEY_JUMP);
    if (name === 'dash')    return hasAny(this._down, KEY_DASH);
    if (name === 'shoot')   return hasAny(this._down, KEY_SHOOT);
    if (name === 'charge')  return hasAny(this._down, KEY_CHARGE_HOLD);
    if (name === 'pause')   return hasAny(this._down, KEY_PAUSE);
    if (name === 'restart') return hasAny(this._down, KEY_RESTART);
    return this._down.has(name);
  }

  justPressed(name) {
    if (name === 'jump')    return hasAny(this._justPressed, KEY_JUMP);
    if (name === 'dash')    return hasAny(this._justPressed, KEY_DASH);
    if (name === 'shoot')   return hasAny(this._justPressed, KEY_SHOOT);
    if (name === 'pause')   return hasAny(this._justPressed, KEY_PAUSE);
    if (name === 'restart') return hasAny(this._justPressed, KEY_RESTART);
    return this._justPressed.has(name);
  }

  justReleased(name) {
    if (name === 'jump')    return hasAny(this._justReleased, KEY_JUMP);
    if (name === 'dash')    return hasAny(this._justReleased, KEY_DASH);
    if (name === 'shoot')   return hasAny(this._justReleased, KEY_SHOOT);
    return this._justReleased.has(name);
  }

  // Direção de facing: 1 = direita, -1 = esquerda, 0 = neutro.
  getFacing()      { return this._facing; }
  // Última direção não-neutra, usada em wall jump.
  getLastFacing()  { return this._lastFacing || 1; }

  // ----------------------------------------------------------------
  // Buffers (jump 6f, dash 6f — SPEC §3)
  // ----------------------------------------------------------------
  consumeJump() {
    if (this._jumpBuffer > 0) { this._jumpBuffer = 0; return true; }
    return false;
  }
  consumeDash() {
    if (this._dashBuffer > 0) { this._dashBuffer = 0; return true; }
    return false;
  }
  jumpBufferFrames() { return this._jumpBuffer; }
  dashBufferFrames() { return this._dashBuffer; }
  pressJump()        { this._jumpBuffer = JUMP_BUFFER + 1; }
  pressDash()        { this._dashBuffer = 7; }

  // ----------------------------------------------------------------
  // Coyote
  //   "6 frames após sair do chão" — o 6º frame no ar AINDA permite pulo;
  //   no 7º frame, NÃO pode mais pular.
  //   coyoteCounter = 0 enquanto grounded; incrementa cada frame no ar.
  //   canCoyoteJump() = true quando counter <= COYOTE_FRAMES (i.e. <= 6).
  // ----------------------------------------------------------------
  markGrounded()    { this._coyoteCounter = 0; }
  coyoteFrames()    { return this._coyoteCounter; }
  canCoyoteJump()   { return this._coyoteCounter <= COYOTE_FRAMES; }

  // ----------------------------------------------------------------
  // Pause / Restart
  // ----------------------------------------------------------------
  pauseJustPressed()  { return this._pausePressed; }
  restartJustPressed() { return this._restartPressed; }
  isPauseDown()       { return this.isDown('pause'); }
  isRestartDown()     { return this.isDown('restart'); }
}
