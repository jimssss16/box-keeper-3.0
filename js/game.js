// ============================================================
// Box Nester — recursive box-pushing puzzle engine
// ============================================================

const DIRS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
const EJECT_ORDER = [[1, 0], [0, 1], [-1, 0], [0, -1]];

let nextBoxId = 1;
let gameState = null;
const STORAGE_KEY = "box-nester-progress";

// ---------- World / Box factories ----------

function makeInteriorWorld(size, innerWalls) {
  const s = size || 5;
  const walls = new Set();
  for (let x = 0; x < s; x++) {
    walls.add(x + ",0");
    walls.add(x + "," + (s - 1));
  }
  for (let y = 0; y < s; y++) {
    walls.add("0," + y);
    walls.add((s - 1) + "," + y);
  }
  (innerWalls || []).forEach(([x, y]) => walls.add(x + "," + y));
  const entrance = { x: Math.floor(s / 2), y: Math.floor(s / 2) };
  return { w: s, h: s, walls, boxes: [], entrance };
}

function makeBox(color, size, innerWalls, isCollector) {
  return { id: nextBoxId++, color, x: 0, y: 0, isCollector: !!isCollector, interior: makeInteriorWorld(size, innerWalls) };
}

function loadLevel(idx) {
  const data = LEVELS[idx];
  const h = data.map.length, w = data.map[0].length;
  const root = { w, h, walls: new Set(), boxes: [] };
  const player = { x: 0, y: 0, dir: "down" };
  const boxByDigit = {};

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = data.map[y][x];
      if (ch === "#") root.walls.add(x + "," + y);
      else if (ch === "P") { player.x = x; player.y = y; }
      else if (/[1-9]/.test(ch)) {
        const cfg = (data.interiors && data.interiors[ch]) || {};
        const isCollector = data.collector === ch;
        const color = isCollector ? "#ff3b3b" : (data.boxColors[ch] || "#888");
        // the collector always gets a roomy interior (min 9x9) so every
        // box collected into it lands on a retrievable, non-corner tile
        const size = isCollector ? Math.max(cfg.size || 0, 9) : cfg.size;
        const box = makeBox(color, size, cfg.walls, isCollector);
        box.x = x; box.y = y;
        root.boxes.push(box);
        boxByDigit[ch] = box;
      }
    }
  }

  // pre-nested cargo boxes placed inside a container at level start
  if (data.nested) {
    Object.keys(data.nested).forEach(digit => {
      const container = boxByDigit[digit];
      if (!container) return;
      data.nested[digit].forEach(cargoDef => {
        const cargo = makeBox(cargoDef.color, cargoDef.size, cargoDef.walls);
        cargo.x = cargoDef.x;
        cargo.y = cargoDef.y;
        container.interior.boxes.push(cargo);
      });
    });
  }

  const nav = [];
  let currentWorld = root;

  if (data.startInside) {
    const box = boxByDigit[data.startInside];
    nav.push({ world: box.interior, box });
    currentWorld = box.interior;
    player.x = box.interior.entrance.x;
    player.y = box.interior.entrance.y;
  }

  gameState = {
    root, player, nav, currentWorld,
    levelIdx: idx,
    won: false,
    pullMode: false,
    moves: 0,
  };
}

// ---------- Grid helpers ----------

function isWall(world, x, y) {
  return world.walls.has(x + "," + y) || x < 0 || y < 0 || x >= world.w || y >= world.h;
}

function boxAt(world, x, y) {
  return world.boxes.find(b => b.x === x && b.y === y) || null;
}

// A cell only counts as a safe "storage spot" if it's at least 2 tiles
// from every wall of the room. Anything touching a wall can only ever
// slide parallel to that wall (the tile you'd need to stand on to push
// it away from the wall is the wall itself) - so a box placed right at
// the edge, and worst of all in a literal corner, can become permanently
// stuck. Since boxes need to be retrievable later, we only ever place
// newly-collected boxes on safe interior tiles.
function isSafeStorageTile(world, x, y) {
  return x >= 2 && x <= world.w - 3 && y >= 2 && y <= world.h - 3;
}

function findFreeSpot(world) {
  // Prefer a spot with no immediately-adjacent box, so anything stored
  // inside stays easy to grab and pull back out later rather than getting
  // wedged in a solid line against its neighbors.
  const isFree = (x, y) => !(x === world.entrance.x && y === world.entrance.y) && !boxAt(world, x, y);
  const hasAdjacentBox = (x, y) => [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => boxAt(world, x+dx, y+dy));

  for (let y = 2; y <= world.h - 3; y++) {
    for (let x = 2; x <= world.w - 3; x++) {
      if (isFree(x, y) && !hasAdjacentBox(x, y)) return { x, y };
    }
  }
  for (let y = 2; y <= world.h - 3; y++) {
    for (let x = 2; x <= world.w - 3; x++) {
      if (isFree(x, y)) return { x, y };
    }
  }
  return null;
}

function mergeBoxes(world, containerBox, movingBox) {
  if (!containerBox.isCollector) return false; // only the red box may collect other boxes
  const idx = world.boxes.indexOf(movingBox);
  if (idx === -1) return false;
  const spot = findFreeSpot(containerBox.interior);
  if (!spot) return false;
  world.boxes.splice(idx, 1);
  movingBox.x = spot.x;
  movingBox.y = spot.y;
  containerBox.interior.boxes.push(movingBox);
  return true;
}

// Push a box out of the interior world it currently sits in, into the
// world that contains its container box (one level up the nesting tree).
function ejectBox(interiorWorld, box) {
  if (gameState.nav.length === 0) return false;
  const top = gameState.nav[gameState.nav.length - 1];
  if (top.world !== interiorWorld) return false;
  const parentWorld = gameState.nav.length > 1
    ? gameState.nav[gameState.nav.length - 2].world
    : gameState.root;
  const cx = top.box.x, cy = top.box.y;
  for (const [dx, dy] of EJECT_ORDER) {
    const tx = cx + dx, ty = cy + dy;
    if (!isWall(parentWorld, tx, ty) && !boxAt(parentWorld, tx, ty)) {
      const idx = interiorWorld.boxes.indexOf(box);
      interiorWorld.boxes.splice(idx, 1);
      box.x = tx; box.y = ty;
      parentWorld.boxes.push(box);
      return true;
    }
  }
  return false;
}

// ---------- Actions ----------

function isCurrentWorldInterior(world) {
  return gameState.nav.length > 0 && gameState.nav[gameState.nav.length - 1].world === world;
}

function tryMove(dir) {
  if (!gameState || gameState.won) return;
  const [dx, dy] = DIRS[dir];
  const p = gameState.player;
  p.dir = dir;
  const world = gameState.currentWorld;

  if (gameState.pullMode) {
    const bxh = p.x - dx, byh = p.y - dy;
    const pullBox = boxAt(world, bxh, byh);
    const nx = p.x + dx, ny = p.y + dy;
    if (pullBox && !pullBox.isCollector && !isWall(world, nx, ny)) {
      const frontBox = boxAt(world, nx, ny);
      if (frontBox) {
        if (!mergeBoxes(world, frontBox, pullBox)) { render(); return; }
      } else if (isCurrentWorldInterior(world) && p.x === world.entrance.x && p.y === world.entrance.y) {
        // player is standing on the exit tile and pulls a box onto it -> eject
        if (!ejectBox(world, pullBox)) { render(); return; }
      } else {
        pullBox.x = p.x; pullBox.y = p.y;
      }
      p.x = nx; p.y = ny;
      gameState.moves++;
      checkWin();
    }
    render();
    return;
  }

  const nx = p.x + dx, ny = p.y + dy;
  if (isWall(world, nx, ny)) { render(); return; }

  const targetBox = boxAt(world, nx, ny);
  if (targetBox) {
    if (targetBox.isCollector) { render(); return; } // the red box is fixed in place - only enterable
    const bx = nx + dx, by = ny + dy;
    const pushingOntoExit = isCurrentWorldInterior(world) && bx === world.entrance.x && by === world.entrance.y && !boxAt(world, bx, by);

    if (pushingOntoExit) {
      if (!ejectBox(world, targetBox)) { render(); return; }
      p.x = nx; p.y = ny;
      gameState.moves++;
      checkWin();
      render();
      return;
    }

    if (isWall(world, bx, by)) { render(); return; }
    const beyondBox = boxAt(world, bx, by);
    if (beyondBox) {
      if (!mergeBoxes(world, beyondBox, targetBox)) { render(); return; }
    } else {
      targetBox.x = bx; targetBox.y = by;
    }
    p.x = nx; p.y = ny;
    gameState.moves++;
    checkWin();
    render();
    return;
  }

  p.x = nx; p.y = ny;
  gameState.moves++;
  render();
}

function tryEnterExit() {
  if (!gameState || gameState.won) return;
  const world = gameState.currentWorld;
  const p = gameState.player;

  // Exit: standing on the entrance/exit tile of an interior world
  if (gameState.nav.length > 0 && p.x === world.entrance.x && p.y === world.entrance.y) {
    const top = gameState.nav.pop();
    const parentWorld = gameState.nav.length > 0
      ? gameState.nav[gameState.nav.length - 1].world
      : gameState.root;
    gameState.currentWorld = parentWorld;
    p.x = top.box.x;
    p.y = top.box.y;
    render();
    updateBreadcrumb();
    return;
  }

  // Enter: box directly in front of player
  const [dx, dy] = DIRS[p.dir];
  const fx = p.x + dx, fy = p.y + dy;
  const box = boxAt(world, fx, fy);
  if (box) {
    gameState.nav.push({ world: box.interior, box });
    gameState.currentWorld = box.interior;
    p.x = box.interior.entrance.x;
    p.y = box.interior.entrance.y;
    render();
    updateBreadcrumb();
  }
}

function checkWin() {
  if (gameState.root.boxes.length === 1 && !gameState.won) {
    gameState.won = true;
    saveProgress(gameState.levelIdx);
    document.getElementById("win-banner").classList.remove("hidden");
  }
}

// ---------- Progress persistence ----------

function saveProgress(idx) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const done = raw ? new Set(JSON.parse(raw)) : new Set();
    done.add(idx);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...done]));
  } catch (e) { /* localStorage unavailable, ignore */ }
}

function getProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (e) {
    return new Set();
  }
}

// ---------- Rendering ----------

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPlayer(cx, cy, r, dir) {
  const [dx, dy] = DIRS[dir];

  // soft shadow
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.8, r * 0.72, r * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();

  // antenna
  ctx.strokeStyle = "#1f7ae0";
  ctx.lineWidth = Math.max(1.5, r * 0.09);
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.92);
  ctx.lineTo(cx, cy - r * 1.45);
  ctx.stroke();
  const antGlow = ctx.createRadialGradient(cx, cy - r * 1.45, 0, cx, cy - r * 1.45, r * 0.22);
  antGlow.addColorStop(0, "#fff3c4");
  antGlow.addColorStop(1, "#ffb703");
  ctx.fillStyle = antGlow;
  ctx.beginPath();
  ctx.arc(cx, cy - r * 1.45, r * 0.16, 0, Math.PI * 2);
  ctx.fill();

  // body: rounded-square bot with a vertical gradient
  const grad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(1, "#a9cfff");
  ctx.fillStyle = grad;
  roundRect(ctx, cx - r, cy - r * 0.92, r * 2, r * 1.92, r * 0.5);
  ctx.fill();
  ctx.strokeStyle = "#1f7ae0";
  ctx.lineWidth = Math.max(2, r * 0.13);
  roundRect(ctx, cx - r, cy - r * 0.92, r * 2, r * 1.92, r * 0.5);
  ctx.stroke();

  // cheeks (color accent, faces movement direction slightly)
  ctx.fillStyle = "rgba(255,120,150,0.55)";
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.55 + dx * r * 0.1, cy + r * 0.32, r * 0.16, r * 0.1, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + r * 0.55 + dx * r * 0.1, cy + r * 0.32, r * 0.16, r * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // eyes, glance toward movement direction
  const eyeY = cy - r * 0.05 + dy * r * 0.12;
  const eyeSpacing = r * 0.42;
  [-1, 1].forEach(side => {
    const ex = cx + side * eyeSpacing + dx * r * 0.12;
    ctx.fillStyle = "#0b1b33";
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, r * 0.17, r * 0.21, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(ex + dx * r * 0.05 - side * r * 0.03, eyeY - r * 0.06, r * 0.055, 0, Math.PI * 2);
    ctx.fill();
  });
}

function render() {
  const world = gameState.currentWorld;
  const cell = Math.min(canvas.width / world.w, canvas.height / world.h);
  const offX = (canvas.width - cell * world.w) / 2;
  const offY = (canvas.height - cell * world.h) / 2;

  ctx.fillStyle = "#0a1830";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const insideHere = isCurrentWorldInterior(world);

  // floor + walls
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      const px = offX + x * cell, py = offY + y * cell;
      if (isWall(world, x, y)) {
        ctx.fillStyle = "#1f7ae0";
        ctx.fillRect(px, py, cell, cell);
        ctx.fillStyle = "#0a1830";
        ctx.fillRect(px + cell * 0.12, py + cell * 0.12, cell * 0.76, cell * 0.76);
      } else {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#16305a" : "#142a4d";
        ctx.fillRect(px, py, cell, cell);
      }
    }
  }

  // entrance / exit marker
  if (insideHere) {
    const ex = offX + world.entrance.x * cell, ey = offY + world.entrance.y * cell;
    ctx.strokeStyle = "#56b6ff";
    ctx.lineWidth = Math.max(2, cell * 0.06);
    ctx.setLineDash([cell * 0.12, cell * 0.08]);
    ctx.strokeRect(ex + cell * 0.08, ey + cell * 0.08, cell * 0.84, cell * 0.84);
    ctx.setLineDash([]);
  }

  // boxes
  for (const box of world.boxes) {
    const px = offX + box.x * cell, py = offY + box.y * cell;
    const pad = cell * 0.08;

    if (box.isCollector) {
      ctx.save();
      ctx.shadowColor = "rgba(255,59,59,0.85)";
      ctx.shadowBlur = cell * 0.35;
    }

    ctx.fillStyle = box.color;
    roundRect(ctx, px + pad, py + pad, cell - pad * 2, cell - pad * 2, cell * 0.12);
    ctx.fill();
    ctx.strokeStyle = box.isCollector ? "#fff0b3" : "rgba(255,255,255,0.85)";
    ctx.lineWidth = Math.max(2, cell * (box.isCollector ? 0.07 : 0.05));
    roundRect(ctx, px + pad, py + pad, cell - pad * 2, cell - pad * 2, cell * 0.12);
    ctx.stroke();

    if (box.isCollector) {
      ctx.restore();
      // small target/magnet icon marking it as the collector
      const cx = px + cell / 2, cy = py + cell / 2;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = Math.max(1.5, cell * 0.045);
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.06, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fill();
    }

    // dot grid indicating nested contents
    if (box.interior.boxes.length > 0) {
      const n = Math.min(box.interior.boxes.length, 4);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      const dotR = cell * 0.045;
      const cx = px + cell / 2, cy = py + cell / 2;
      const offsets = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (let i = 0; i < n; i++) {
        const [ox, oy] = offsets[i];
        ctx.beginPath();
        ctx.arc(cx + ox * cell * 0.15, cy + oy * cell * 0.15, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // pull-mode indicator: highlight whichever box is directly behind the
  // player right now (in any of the 4 directions) — that's what gets
  // pulled next if you move.
  if (gameState.pullMode) {
    const p = gameState.player;
    ["up", "down", "left", "right"].forEach(d => {
      const [ddx, ddy] = DIRS[d];
      const bx = p.x - ddx, by = p.y - ddy;
      const b = boxAt(world, bx, by);
      if (b) {
        const bpx = offX + b.x * cell, bpy = offY + b.y * cell;
        ctx.strokeStyle = "#ffb703";
        ctx.lineWidth = Math.max(2, cell * 0.06);
        ctx.setLineDash([cell * 0.1, cell * 0.06]);
        ctx.strokeRect(bpx + cell * 0.04, bpy + cell * 0.04, cell * 0.92, cell * 0.92);
        ctx.setLineDash([]);
      }
    });
  }

  // player
  {
    const p = gameState.player;
    const px = offX + p.x * cell, py = offY + p.y * cell;
    drawPlayer(px + cell / 2, py + cell / 2, cell * 0.32, p.dir);
  }
}

function updateBreadcrumb() {
  const el = document.getElementById("breadcrumb");
  if (gameState.nav.length === 0) {
    el.textContent = "Only the red box can collect other boxes.";
    return;
  }
  el.textContent = "Inside box — " + gameState.nav.length + " layer" + (gameState.nav.length > 1 ? "s" : "") + " deep. Push a box onto the dashed tile to send it back out.";
}

// ---------- UI wiring ----------

function resetUiChrome() {
  document.getElementById("win-banner").classList.add("hidden");
  document.getElementById("pull-btn").classList.remove("active");
  document.getElementById("pull-btn").textContent = "Pull: OFF";
  document.getElementById("level-title").textContent = LEVELS[gameState.levelIdx].name;
  updateBreadcrumb();
  render();
}

function restartLevel() {
  loadLevel(gameState.levelIdx);
  resetUiChrome();
}

function goToLevel(idx) {
  if (idx < 0 || idx >= LEVELS.length) return;
  loadLevel(idx);
  resetUiChrome();
}

function togglePull() {
  gameState.pullMode = !gameState.pullMode;
  const btn = document.getElementById("pull-btn");
  btn.textContent = "Pull: " + (gameState.pullMode ? "ON" : "OFF");
  btn.classList.toggle("active", gameState.pullMode);
}

function buildLevelMenu() {
  const grid = document.getElementById("level-grid");
  grid.innerHTML = "";
  const done = getProgress();
  LEVELS.forEach((lvl, i) => {
    const btn = document.createElement("button");
    btn.className = "level-btn" + (done.has(i) ? " done" : "");
    btn.textContent = i + 1;
    btn.addEventListener("click", () => {
      goToLevel(i);
      document.getElementById("level-menu").classList.add("hidden");
    });
    grid.appendChild(btn);
  });
}

function init() {
  goToLevel(0);

  document.querySelectorAll(".dpad-btn").forEach(btn => {
    btn.addEventListener("click", () => tryMove(btn.dataset.dir));
  });
  document.getElementById("enter-btn").addEventListener("click", tryEnterExit);
  document.getElementById("pull-btn").addEventListener("click", togglePull);
  document.getElementById("restart-btn").addEventListener("click", restartLevel);
  document.getElementById("next-level-btn").addEventListener("click", () => {
    goToLevel(Math.min(gameState.levelIdx + 1, LEVELS.length - 1));
  });
  document.getElementById("menu-btn").addEventListener("click", () => {
    buildLevelMenu();
    document.getElementById("level-menu").classList.remove("hidden");
  });
  document.getElementById("close-menu-btn").addEventListener("click", () => {
    document.getElementById("level-menu").classList.add("hidden");
  });

  window.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowUp": case "w": case "W": tryMove("up"); e.preventDefault(); break;
      case "ArrowDown": case "s": case "S": tryMove("down"); e.preventDefault(); break;
      case "ArrowLeft": case "a": case "A": tryMove("left"); e.preventDefault(); break;
      case "ArrowRight": case "d": case "D": tryMove("right"); e.preventDefault(); break;
      case "e": case "E": tryEnterExit(); break;
      case "r": case "R": restartLevel(); break;
      case "Shift": togglePull(); break;
    }
  });

  // basic swipe support for mobile
  let touchStart = null;
  canvas.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  canvas.addEventListener("touchend", (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) tryMove(dx > 0 ? "right" : "left");
    else tryMove(dy > 0 ? "down" : "up");
    touchStart = null;
  }, { passive: true });

  window.addEventListener("resize", render);
}

init();

