'use strict';

// ─────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────
const TILE        = 6;          // world-units per maze cell
const WALL_H      = 4;
const PLAYER_H    = 1.7;
const PLAYER_SPEED  = 6;
const SPRINT_MULT   = 1.9;
const HUGGY_SPEED_BASE = 3.8;
const HUGGY_ACCEL    = 0.015;
const HUGGY_ATTACK_DIST = 1.6;
const HUGGY_CHASE_DIST  = 22;
const TOTAL_STARS   = 8;
const HEALTH_MAX    = 100;
const HEALTH_DRAIN  = 28;  // per second while huggy is on you

// ─────────────────────────────────────────
//  Maze  (0=floor, 1=wall)
//  16×16 hand-crafted toy-factory layout
// ─────────────────────────────────────────
const MAZE = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,1,0,0,0,0,0,1,0,0,0,0,1],
  [1,0,1,0,0,0,1,1,0,1,0,0,1,1,0,1],
  [1,0,1,0,1,0,0,1,0,0,0,1,0,0,0,1],
  [1,0,0,0,1,1,0,0,0,1,0,1,0,1,1,1],
  [1,1,1,0,0,0,0,1,0,1,0,0,0,0,0,1],
  [1,0,0,0,1,0,1,1,0,0,1,1,1,0,1,1],
  [1,0,1,1,1,0,0,0,0,1,0,0,0,0,0,1],
  [1,0,0,0,0,0,1,0,1,1,0,1,0,1,0,1],
  [1,1,0,1,1,0,0,0,0,0,0,1,0,0,0,1],
  [1,0,0,0,1,1,1,0,1,0,1,1,0,1,0,1],
  [1,0,1,0,0,0,0,0,1,0,0,0,0,1,0,1],
  [1,0,1,1,1,0,1,0,0,0,1,0,1,0,0,1],
  [1,0,0,0,0,0,1,1,0,1,0,0,0,0,0,1],
  [1,0,1,0,1,0,0,0,0,0,1,0,1,1,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];
const ROWS = MAZE.length;
const COLS = MAZE[0].length;

// ─────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────
function cellToWorld(row, col) {
  return new THREE.Vector3(col * TILE + TILE / 2, 0, row * TILE + TILE / 2);
}
function worldToCell(x, z) {
  return { row: Math.floor(z / TILE), col: Math.floor(x / TILE) };
}
function isWall(x, z) {
  const { row, col } = worldToCell(x, z);
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return true;
  return MAZE[row][col] === 1;
}
function freeCells() {
  const cells = [];
  for (let r = 1; r < ROWS - 1; r++)
    for (let c = 1; c < COLS - 1; c++)
      if (MAZE[r][c] === 0) cells.push({ row: r, col: c });
  return cells;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─────────────────────────────────────────
//  Audio (Web Audio API)
// ─────────────────────────────────────────
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playTone(freq, type, duration, vol = 0.15, delay = 0) {
  try {
    const ctx = getAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime + delay);
    gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + duration + 0.05);
  } catch (_) {}
}
function sfxCollect() {
  playTone(520, 'sine', 0.12, 0.2);
  playTone(780, 'sine', 0.12, 0.2, 0.12);
}
function sfxHurt() {
  playTone(80, 'sawtooth', 0.3, 0.35);
  playTone(60, 'sawtooth', 0.3, 0.25, 0.15);
}
function sfxWin() {
  [440, 550, 660, 880].forEach((f, i) => playTone(f, 'sine', 0.3, 0.2, i * 0.15));
}
function sfxLose() {
  [220, 180, 140, 100].forEach((f, i) => playTone(f, 'sawtooth', 0.4, 0.3, i * 0.15));
}

// ─────────────────────────────────────────
//  Game state
// ─────────────────────────────────────────
let scene, camera, renderer;
let clock, animId;
let starsCollected = 0;
let health = HEALTH_MAX;
let gameActive = false;
let gameOver = false;
let huggySpeed = HUGGY_SPEED_BASE;

const keys   = {};
let   yaw    = 0;
let   pitch  = 0;
let   pointerLocked = false;

const playerPos = new THREE.Vector3();
const huggyPos  = new THREE.Vector3();
let   huggyCurrent3D; // Three.js group
let   starMeshes = [];
let   exitMesh;
let   exitLight;
let   ambientFlicker = 0;

// ─────────────────────────────────────────
//  Init
// ─────────────────────────────────────────
function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0006);
  scene.fog = new THREE.FogExp2(0x0a0006, 0.045);

  // Camera
  camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 120);

  // Renderer
  const canvas = document.getElementById('game-canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  clock = new THREE.Clock();

  buildLevel();
  spawnStars();
  spawnExit();
  spawnHuggy();
  spawnPlayer();
  setupHUD();

  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', e => { keys[e.code] = true; });
  document.addEventListener('keyup',   e => { keys[e.code] = false; });
  document.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('click', () => canvas.requestPointerLock());
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
  });
}

// ─────────────────────────────────────────
//  Level geometry
// ─────────────────────────────────────────
function buildLevel() {
  // Floor
  const floorGeo = new THREE.PlaneGeometry(COLS * TILE, ROWS * TILE);
  const floorMat = new THREE.MeshLambertMaterial({ color: 0x1a0e1a });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(COLS * TILE / 2, 0, ROWS * TILE / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  // Ceiling
  const ceilMat = new THREE.MeshLambertMaterial({ color: 0x100a10 });
  const ceil = new THREE.Mesh(floorGeo.clone(), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(COLS * TILE / 2, WALL_H, ROWS * TILE / 2);
  scene.add(ceil);

  // Walls
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x3a1a3a });
  const wallMatAlt = new THREE.MeshLambertMaterial({ color: 0x2a0f2a });

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (MAZE[r][c] !== 1) continue;
      const geo = new THREE.BoxGeometry(TILE, WALL_H, TILE);
      const mat = (r + c) % 2 === 0 ? wallMat : wallMatAlt;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(c * TILE + TILE / 2, WALL_H / 2, r * TILE + TILE / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }

  // Atmospheric ceiling lights (dim, scattered)
  const lightPositions = shuffle(freeCells()).slice(0, 8);
  lightPositions.forEach(({ row, col }) => {
    const light = new THREE.PointLight(0x5500aa, 0.8, 12);
    light.position.set(col * TILE + TILE / 2, WALL_H - 0.3, row * TILE + TILE / 2);
    scene.add(light);
    const lampGeo = new THREE.SphereGeometry(0.15, 6, 6);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xaa55ff });
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.copy(light.position);
    scene.add(lamp);
  });

  // Ambient
  scene.add(new THREE.AmbientLight(0x110011, 0.4));

  // Decorative props (toy boxes)
  addProps();
}

function addProps() {
  const cells = shuffle(freeCells()).slice(0, 18);
  const colors = [0xff3366, 0x33aaff, 0xffcc00, 0x66ff33];
  cells.forEach(({ row, col }) => {
    const w = 0.5 + Math.random() * 0.6;
    const h = 0.3 + Math.random() * 0.8;
    const geo = new THREE.BoxGeometry(w, h, w);
    const mat = new THREE.MeshLambertMaterial({ color: colors[Math.floor(Math.random() * colors.length)] });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      col * TILE + TILE / 2 + (Math.random() - 0.5) * (TILE - 1.5),
      h / 2,
      row * TILE + TILE / 2 + (Math.random() - 0.5) * (TILE - 1.5)
    );
    mesh.castShadow = true;
    scene.add(mesh);
  });
}

// ─────────────────────────────────────────
//  Stars (collectibles)
// ─────────────────────────────────────────
function spawnStars() {
  starMeshes = [];
  const cells = shuffle(freeCells());
  // reserve first cell for player, last for huggy
  const used = new Set();
  used.add(`1,1`);

  let count = 0;
  for (const cell of cells) {
    const key = `${cell.row},${cell.col}`;
    if (used.has(key)) continue;
    used.add(key);

    const group = new THREE.Group();
    // star body: octahedron proxy
    const geo = new THREE.OctahedronGeometry(0.3, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffdd00 });
    const mesh = new THREE.Mesh(geo, mat);
    // glow point
    const glow = new THREE.PointLight(0xffcc00, 0.7, 4);
    group.add(mesh, glow);
    const wp = cellToWorld(cell.row, cell.col);
    group.position.set(wp.x + (Math.random() - 0.5) * 2, 1.2, wp.z + (Math.random() - 0.5) * 2);
    group.userData = { row: cell.row, col: cell.col, collected: false };
    scene.add(group);
    starMeshes.push(group);

    if (++count >= TOTAL_STARS) break;
  }
}

// ─────────────────────────────────────────
//  Exit door
// ─────────────────────────────────────────
function spawnExit() {
  // Place exit at bottom-right area (row 14, col 14)
  const pos = cellToWorld(14, 14);
  const geo = new THREE.BoxGeometry(TILE * 0.8, WALL_H, 0.3);
  const mat = new THREE.MeshBasicMaterial({ color: 0x003300 });
  exitMesh = new THREE.Mesh(geo, mat);
  exitMesh.position.set(pos.x, WALL_H / 2, pos.z);
  scene.add(exitMesh);

  exitLight = new THREE.PointLight(0x00ff44, 0, 8);
  exitLight.position.copy(exitMesh.position);
  scene.add(exitLight);
}

// ─────────────────────────────────────────
//  Huggy Wuggy (monster)
// ─────────────────────────────────────────
function buildHuggyMesh() {
  const group = new THREE.Group();

  // Body (cylinder + sphere caps as capsule substitute for r128)
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x1155cc });
  const bodyTube = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.4, 12), bodyMat);
  bodyTube.position.y = 1.5;
  group.add(bodyTube);
  const bodyCap1 = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 6), bodyMat);
  bodyCap1.position.y = 2.2; group.add(bodyCap1);
  const bodyCap2 = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 6), bodyMat);
  bodyCap2.position.y = 0.8; group.add(bodyCap2);

  // Head
  const headGeo = new THREE.SphereGeometry(0.5, 10, 10);
  const headMat = new THREE.MeshLambertMaterial({ color: 0x1166dd });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 2.8;
  group.add(head);

  // Eyes (glowing)
  const eyeGeo = new THREE.SphereGeometry(0.1, 6, 6);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  [-0.18, 0.18].forEach(xOff => {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(xOff, 2.85, 0.4);
    group.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.055, 5, 5),
      new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    pupil.position.set(xOff, 2.85, 0.47);
    group.add(pupil);
  });

  // Mouth (wide grin)
  const mouthGeo = new THREE.TorusGeometry(0.28, 0.045, 6, 14, Math.PI);
  const mouthMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const mouth = new THREE.Mesh(mouthGeo, mouthMat);
  mouth.position.set(0, 2.55, 0.42);
  mouth.rotation.z = Math.PI;
  group.add(mouth);

  // Arms
  const armMat = new THREE.MeshLambertMaterial({ color: 0x1155cc });
  const armGeo = new THREE.CylinderGeometry(0.15, 0.15, 1.2, 8);
  [-0.75, 0.75].forEach((xOff, i) => {
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.position.set(xOff, 1.8, 0);
    arm.rotation.z = i === 0 ? 0.5 : -0.5;
    group.add(arm);
  });

  // Legs
  const legGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.9, 8);
  [-0.25, 0.25].forEach(xOff => {
    const leg = new THREE.Mesh(legGeo, armMat);
    leg.position.set(xOff, 0.3, 0);
    group.add(leg);
  });

  // Eye glow
  const eyeLight = new THREE.PointLight(0xff2200, 1.2, 5);
  eyeLight.position.set(0, 2.8, 0.5);
  group.add(eyeLight);
  group.userData.eyeLight = eyeLight;

  return group;
}

function spawnHuggy() {
  huggyCurrent3D = buildHuggyMesh();
  const startCell = { row: 13, col: 13 };
  huggyPos.copy(cellToWorld(startCell.row, startCell.col));
  huggyCurrent3D.position.copy(huggyPos);
  scene.add(huggyCurrent3D);
}

// ─────────────────────────────────────────
//  Player spawn
// ─────────────────────────────────────────
function spawnPlayer() {
  const wp = cellToWorld(1, 1);
  playerPos.set(wp.x, PLAYER_H, wp.z);
  yaw = 0; pitch = 0;
  camera.position.copy(playerPos);
}

// ─────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────
function setupHUD() {
  document.getElementById('stars-total').textContent = TOTAL_STARS;
  document.getElementById('total-stars').textContent = TOTAL_STARS;
  document.getElementById('stars-collected').textContent = '0';
  document.getElementById('health-bar').style.width = '100%';
  document.getElementById('hud').style.display = 'block';
}
function updateHUD() {
  document.getElementById('stars-collected').textContent = starsCollected;
  document.getElementById('health-bar').style.width = (health / HEALTH_MAX * 100).toFixed(1) + '%';
  const pct = health / HEALTH_MAX;
  const hbar = document.getElementById('health-bar');
  hbar.style.background = `linear-gradient(90deg, hsl(${pct * 120 - 10},90%,45%), hsl(${pct * 80},80%,55%))`;
}

// ─────────────────────────────────────────
//  Input
// ─────────────────────────────────────────
function onMouseMove(e) {
  if (!pointerLocked || !gameActive) return;
  const sens = 0.0015;
  yaw   -= e.movementX * sens;
  pitch -= e.movementY * sens;
  pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, pitch));
}

// ─────────────────────────────────────────
//  Movement with collision
// ─────────────────────────────────────────
const _moveDir = new THREE.Vector3();
const _fwd     = new THREE.Vector3();
const _right   = new THREE.Vector3();

function movePlayer(dt) {
  const sprint  = keys['ShiftLeft'] || keys['ShiftRight'];
  const speed   = PLAYER_SPEED * (sprint ? SPRINT_MULT : 1);

  _fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
  _right.set(Math.cos(yaw), 0, -Math.sin(yaw));

  _moveDir.set(0, 0, 0);
  if (keys['KeyW'] || keys['ArrowUp'])    _moveDir.addScaledVector(_fwd,   1);
  if (keys['KeyS'] || keys['ArrowDown'])  _moveDir.addScaledVector(_fwd,  -1);
  if (keys['KeyA'] || keys['ArrowLeft'])  _moveDir.addScaledVector(_right,-1);
  if (keys['KeyD'] || keys['ArrowRight']) _moveDir.addScaledVector(_right, 1);
  if (_moveDir.lengthSq() > 0) _moveDir.normalize();

  const margin = 0.5;
  const nx = playerPos.x + _moveDir.x * speed * dt;
  const nz = playerPos.z + _moveDir.z * speed * dt;

  if (!isWall(nx + Math.sign(_moveDir.x) * margin, playerPos.z)) playerPos.x = nx;
  if (!isWall(playerPos.x, nz + Math.sign(_moveDir.z) * margin)) playerPos.z = nz;

  playerPos.y = PLAYER_H;
  camera.position.copy(playerPos);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}

// ─────────────────────────────────────────
//  Huggy AI  (simple pursuit)
// ─────────────────────────────────────────
const _toPlayer = new THREE.Vector3();
let   huggyStepped = 0;

function updateHuggy(dt) {
  _toPlayer.set(
    playerPos.x - huggyPos.x,
    0,
    playerPos.z - huggyPos.z
  );
  const dist = _toPlayer.length();

  if (dist < HUGGY_CHASE_DIST) {
    huggySpeed = Math.min(huggySpeed + HUGGY_ACCEL, HUGGY_SPEED_BASE + 3);
    _toPlayer.normalize();

    const step = huggySpeed * dt;
    const nx = huggyPos.x + _toPlayer.x * step;
    const nz = huggyPos.z + _toPlayer.z * step;

    const margin = 0.6;
    if (!isWall(nx + Math.sign(_toPlayer.x) * margin, huggyPos.z)) huggyPos.x = nx;
    if (!isWall(huggyPos.x, nz + Math.sign(_toPlayer.z) * margin)) huggyPos.z = nz;

    huggyCurrent3D.position.set(huggyPos.x, 0, huggyPos.z);

    // Face player
    huggyCurrent3D.rotation.y = Math.atan2(_toPlayer.x, _toPlayer.z);

    // Arm bob when walking
    huggyStepped += dt * huggySpeed * 3;
    const bob = Math.sin(huggyStepped) * 0.12;
    huggyCurrent3D.position.y = Math.abs(bob) * 0.3;

    // Eye flicker based on chase
    const eyeLight = huggyCurrent3D.userData.eyeLight;
    if (eyeLight) eyeLight.intensity = 1.2 + Math.sin(huggyStepped * 4) * 0.4;
  }

  // Attack
  if (dist < HUGGY_ATTACK_DIST) {
    health -= HEALTH_DRAIN * dt;
    if (!_hurtFlashActive) triggerHurtFlash();
    if (health <= 0) { health = 0; triggerGameOver(); }
  }
}

// ─────────────────────────────────────────
//  Star collection
// ─────────────────────────────────────────
const _toStar = new THREE.Vector3();

function checkStars(dt) {
  starMeshes.forEach(star => {
    if (star.userData.collected) return;
    star.rotation.y += dt * 2;
    _toStar.set(
      playerPos.x - star.position.x,
      0,
      playerPos.z - star.position.z
    );
    if (_toStar.length() < 1.4) {
      star.userData.collected = true;
      scene.remove(star);
      starsCollected++;
      sfxCollect();
      updateHUD();
      if (starsCollected >= TOTAL_STARS) activateExit();
    }
  });
}

function activateExit() {
  exitMesh.material.color.set(0x00ff44);
  exitLight.intensity = 3;
  document.getElementById('status-msg').textContent = '🚪 Ausgang aktiviert! Renne zur grünen Tür!';
}

// ─────────────────────────────────────────
//  Exit check
// ─────────────────────────────────────────
function checkExit() {
  if (starsCollected < TOTAL_STARS) return;
  const dx = playerPos.x - exitMesh.position.x;
  const dz = playerPos.z - exitMesh.position.z;
  if (Math.sqrt(dx * dx + dz * dz) < 2.5) triggerWin();
}

// ─────────────────────────────────────────
//  Win / Lose
// ─────────────────────────────────────────
function triggerGameOver() {
  if (gameOver) return;
  gameOver = true;
  gameActive = false;
  sfxLose();
  document.exitPointerLock();
  document.getElementById('hud').style.display = 'none';
  showScreen('gameover-screen');
}

function triggerWin() {
  if (gameOver) return;
  gameOver = true;
  gameActive = false;
  sfxWin();
  document.exitPointerLock();
  document.getElementById('hud').style.display = 'none';
  showScreen('win-screen');
}

// ─────────────────────────────────────────
//  Hurt flash
// ─────────────────────────────────────────
let _hurtFlashActive = false;
function triggerHurtFlash() {
  _hurtFlashActive = true;
  sfxHurt();
  const el = document.getElementById('alert-flash');
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  setTimeout(() => { _hurtFlashActive = false; }, 400);
}

// ─────────────────────────────────────────
//  Ambient flicker
// ─────────────────────────────────────────
function flickerLights(dt) {
  ambientFlicker += dt;
  if (ambientFlicker > 0.08) {
    ambientFlicker = 0;
    scene.children.forEach(child => {
      if (child.isPointLight && !child.parent) {
        child.intensity = 0.6 + Math.random() * 0.4;
      }
    });
  }
}

// ─────────────────────────────────────────
//  Resize
// ─────────────────────────────────────────
function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

// ─────────────────────────────────────────
//  Game loop
// ─────────────────────────────────────────
function loop() {
  animId = requestAnimationFrame(loop);
  if (!gameActive) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  movePlayer(dt);
  updateHuggy(dt);
  checkStars(dt);
  checkExit();
  flickerLights(dt);
  updateHUD();
  renderer.render(scene, camera);
}

// ─────────────────────────────────────────
//  Start / Reset
// ─────────────────────────────────────────
function startGame() {
  if (animId) cancelAnimationFrame(animId);

  // clear old scene if restarting
  if (scene) {
    while (scene.children.length) scene.remove(scene.children[0]);
  }
  starsCollected = 0;
  health = HEALTH_MAX;
  gameOver = false;
  huggySpeed = HUGGY_SPEED_BASE;

  init();
  gameActive = true;
  setupHUD();
  updateHUD();
  document.getElementById('status-msg').textContent = '';

  hideAllScreens();
  document.getElementById('hud').style.display = 'block';

  const canvas = document.getElementById('game-canvas');
  canvas.requestPointerLock();

  loop();
}

// ─────────────────────────────────────────
//  Screen helpers
// ─────────────────────────────────────────
function showScreen(id) {
  document.getElementById(id).classList.add('active');
}
function hideAllScreens() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
}

// ─────────────────────────────────────────
//  Button wiring
// ─────────────────────────────────────────
document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('retry-btn').addEventListener('click', startGame);
document.getElementById('win-retry-btn').addEventListener('click', startGame);
document.getElementById('total-stars').textContent = TOTAL_STARS;
