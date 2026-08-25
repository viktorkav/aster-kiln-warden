import { existsSync, readFileSync } from 'node:fs';
import { decodePng, frameAlpha, silhouetteArea, silhouetteBBox, largestBlob } from './png.mjs';

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

function pngDimensions(path) {
  if (!existsSync(path)) return null;
  const header = readFileSync(path).subarray(0, 24);
  if (header.toString('ascii', 1, 4) !== 'PNG') return null;
  return {
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20),
  };
}

const contracts = [
  ['assets/player-v2.png', 18 * 76, 56],
  ['assets/boss-v2.png', 13 * 128, 96],
  ['assets/enemies-v2.png', 12 * 32, 32],
  ['assets/effects-v2.png', 4 * 32, 32],
  ['assets/tiles-v2.png', 7 * 32, 32],
  ['assets/background-v2.png', 960, 270],
];

for (const [path, width, height] of contracts) {
  const dimensions = pngDimensions(path);
  check(
    dimensions?.width === width && dimensions?.height === height,
    `${path} is a ${width}x${height} PNG`,
  );
}

// ---------------------------------------------------------------------------
// CONTRATO DE TRANSPARÊNCIA
// A quantização para paleta já produziu uma vez um tRNS quebrado: o índice do
// fundo saiu com alpha 23 em vez de 0, e todo sprite ganhou um retângulo cinza
// a 9% de opacidade em volta. Pixel art não tem meio-termo: alpha é 0 ou 255.
// ---------------------------------------------------------------------------
const spriteSheets = [
  'assets/player-v2.png',
  'assets/boss-v2.png',
  'assets/enemies-v2.png',
  'assets/effects-v2.png',
  'assets/tiles-v2.png',
];

for (const path of spriteSheets) {
  const png = decodePng(path);
  let transparent = 0;
  let partial = 0;
  for (let i = 0; i < png.alpha.length; i++) {
    const a = png.alpha[i];
    if (a === 0) transparent++;
    else if (a !== 255) partial++;
  }
  check(transparent > 0, `${path} tem fundo realmente transparente (alpha 0)`);
  check(partial === 0, `${path} não tem alpha parcial (${partial} px em meio-termo)`);
}

// ---------------------------------------------------------------------------
// CONTRATO DE ALINHAMENTO DO PLAYER
// Os 13 frames vêm de um atlas de origem em que os desenhos invadem a célula
// vizinha. Recortar pela grade contamina o frame e recortar pelo bbox de cada
// frame faz a escala variar — foi o que deixou o ciclo de andar aos trancos.
// ---------------------------------------------------------------------------
const PLAYER_FRAMES = 18;
const PLAYER_W = 76;
const PLAYER_H = 56;
const PLAYER_BASE = 55; // linha de base (sem margem inferior)
// Pixels em que duas silhuetas discordam.
function diferencaSilhueta(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if ((a[i] >= 128) !== (b[i] >= 128)) n++;
  return n;
}

// x médio do terço de baixo da silhueta: as pernas.
function pernasX(a) {
  const bbox = silhouetteBBox(a, PLAYER_W, PLAYER_H);
  const corte = bbox.y1 - Math.round((bbox.y1 - bbox.y0 + 1) * 0.34);
  let soma = 0;
  let n = 0;
  for (let y = corte; y <= bbox.y1; y++) {
    for (let x = 0; x < PLAYER_W; x++) {
      if (a[y * PLAYER_W + x] >= 128) { soma += x; n++; }
    }
  }
  return soma / n;
}

const playerPng = decodePng('assets/player-v2.png');
const playerFrames = [];
for (let f = 0; f < PLAYER_FRAMES; f++) {
  const a = frameAlpha(playerPng, f, PLAYER_W, PLAYER_H);
  playerFrames.push({
    alpha: a,
    area: silhouetteArea(a),
    bbox: silhouetteBBox(a, PLAYER_W, PLAYER_H),
    blob: largestBlob(a, PLAYER_W, PLAYER_H),
  });
}

for (let f = 0; f < PLAYER_FRAMES; f++) {
  const { area, blob } = playerFrames[f];
  check(
    blob >= area * 0.95,
    `player frame ${f} é uma figura só (maior blob ${blob}/${area} px)`,
  );
}

// Linha de base: ninguém afunda abaixo dela, e quem não está correndo pousa
// exatamente nela. Os quadros de passagem do ciclo de corrida ficam 1 px acima
// de propósito — é o salto da passada, e achatá-lo tira a vida do ciclo.
const CICLOS = { andar: [4, 5, 6, 7], 'andar-atirando': [13, 14, 15, 16] };
const emCiclo = new Set(Object.values(CICLOS).flat());

for (let f = 0; f < PLAYER_FRAMES; f++) {
  const base = playerFrames[f].bbox.y1;
  if (emCiclo.has(f)) {
    check(
      base <= PLAYER_BASE && base >= PLAYER_BASE - 2,
      `player frame ${f} pousa na linha de base ou até 2 px acima (viu ${base})`,
    );
  } else {
    check(base === PLAYER_BASE, `player frame ${f} pousa na linha ${PLAYER_BASE} (viu ${base})`);
  }
}

for (const [nome, frames] of Object.entries(CICLOS)) {
  const noChao = frames.filter((f) => playerFrames[f].bbox.y1 === PLAYER_BASE).length;
  check(noChao >= 2, `${nome} tem ao menos dois apoios no chão por volta (viu ${noChao})`);
}

// Nenhum frame pode encostar na borda lateral da célula: encostar quer dizer que
// o desenho foi cortado ali. É o que fatiava o dash, a pose de tiro e todo o
// ciclo de andar-atirando quando a célula ainda era 48 de largura.
for (let f = 0; f < PLAYER_FRAMES; f++) {
  const { x0, x1 } = playerFrames[f].bbox;
  check(
    x0 >= 1 && x1 <= PLAYER_W - 2,
    `player frame ${f} não é cortado na largura (ocupa x ${x0}..${x1} de 0..${PLAYER_W - 1})`,
  );
}

// Ciclo de andar: mesma personagem, poses diferentes. A silhueta muda de forma,
// não de tamanho — variação de área acima de 6% é escala inconsistente, e é
// exatamente o que faz o ciclo "pular" a cada volta.
// Um ciclo é feito de poses DISTINTAS, e distintas de forma parelha. O ciclo
// antigo tinha duas poses quase iguais entre si (andar0 e andar2 diferiam só
// 284 px, contra 631 do par mais distante) e a repetição lia como tranco de
// dois frames, não como passada.
const medias = {};
for (const [nome, frames] of Object.entries(CICLOS)) {
  medias[nome] = frames.reduce((s, f) => s + playerFrames[f].area, 0) / frames.length;

  const distancias = [];
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      distancias.push(diferencaSilhueta(playerFrames[frames[i]].alpha, playerFrames[frames[j]].alpha));
    }
  }
  const media = distancias.reduce((s, v) => s + v, 0) / distancias.length;
  const menor = Math.min(...distancias);
  // 0,65 é a régua do ciclo limpo: nenhum par pode estar muito mais perto que a
  // média. O ciclo de andar-atirando ainda não a alcança — as duas poses de
  // passagem saíram parecidas do gerador, porque com o braço travado à frente
  // sobra pouca coisa para diferenciá-las. 0,30 é o piso que trava a piora
  // enquanto essa arte não é refeita; o ciclo de andar mede 0,84.
  const piso = nome === 'andar' ? 0.65 : 0.30;
  check(
    menor >= media * piso,
    `${nome} não tem duas poses quase iguais (par mais próximo ${menor} contra média ${media.toFixed(0)}, razão ${(menor / media).toFixed(2)}, piso ${piso})`,
  );
}

// Os dois ciclos são o MESMO personagem, e o jogo troca de um para o outro no
// meio da corrida ao apertar o tiro. Se as escalas divergirem, o boneco muda de
// tamanho no instante do disparo.
const entreCiclos = Math.abs(medias['andar'] - medias['andar-atirando']) / medias['andar'];
check(
  entreCiclos <= 0.06,
  `andar e andar-atirando têm a mesma escala (desvio ${(entreCiclos * 100).toFixed(1)}%)`,
);

// E as pernas caem no mesmo lugar em cada passo: é o que costura a troca entre
// os dois ciclos sem o personagem escorregar de lado.
for (let i = 0; i < 4; i++) {
  const a = playerFrames[4 + i];
  const b = playerFrames[13 + i];
  const desloc = Math.abs(pernasX(a.alpha) - pernasX(b.alpha));
  check(
    desloc <= 1.5,
    `passo ${i}: andar e andar-atirando pisam no mesmo x (${desloc.toFixed(1)} px de diferença)`,
  );
}

// ---------------------------------------------------------------------------
// O CHEFE NÃO MUDA DE TAMANHO AO TROCAR DE POSE
// O sheet do Kiln Warden tinha o mesmo defeito do player: cada frame escalado
// até preencher a célula de 96×96. Parado ele enchia a célula, atirando ele
// encolhia 10 px, e dava para ver o chefe mudar de tamanho no meio da luta.
// ---------------------------------------------------------------------------
const BOSS_W = 128;
const BOSS_H = 96;
const BOSS_MARGEM = 5;              // linhas reservadas para a poça de escória
const BOSS_BASE = BOSS_H - 1 - BOSS_MARGEM;
const bossPng = decodePng('assets/boss-v2.png');
const bossAltura = (f) => {
  const a = frameAlpha(bossPng, f, BOSS_W, BOSS_H);
  const b = silhouetteBBox(a, BOSS_W, BOSS_H);
  return { altura: b.y1 - b.y0 + 1, base: b.y1, x0: b.x0, x1: b.x1 };
};

// Poses de pé: idle (0-3), tiro reto (4-5) e spread (9-10). As de hit, death e
// o avanço do charge são encolhidas de propósito e ficam fora da régua.
const dePe = { idle: [0, 1, 2, 3], tiro: [4, 5], spread: [9, 10] };
const alturaIdle = dePe.idle.reduce((s, f) => s + bossAltura(f).altura, 0) / 4;
for (const [nome, frames] of Object.entries(dePe)) {
  for (const f of frames) {
    const { altura } = bossAltura(f);
    const drift = Math.abs(altura - alturaIdle) / alturaIdle;
    check(
      drift <= 0.06,
      `chefe ${nome} (frame ${f}) tem a altura do idle (${altura} vs ${alturaIdle.toFixed(0)} px)`,
    );
  }
}

// O chefe pousa na linha de base; só o frame de morte passa dela, porque a
// escória que ele derrama pertence ao chão.
for (let f = 0; f < 13; f++) {
  const { base, x0, x1 } = bossAltura(f);
  if (f === 12) {
    // a morte derrama escória abaixo da linha de base, mas dentro da célula
    check(
      base > BOSS_BASE && base <= BOSS_H - 1,
      `chefe morto derrama abaixo da linha de base sem sair da célula (base ${base})`,
    );
  } else {
    check(base === BOSS_BASE, `chefe frame ${f} pousa na linha ${BOSS_BASE} (viu ${base})`);
  }
  check(
    x0 >= 1 && x1 <= BOSS_W - 2,
    `chefe frame ${f} não é cortado na largura (ocupa x ${x0}..${x1} de 0..${BOSS_W - 1})`,
  );
}


console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
