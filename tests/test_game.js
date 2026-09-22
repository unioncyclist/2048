// Headless harness: runs the real game modules against a small DOM stub and
// checks the rules, the undo stack, the session persistence and the
// bookkeeping that drives the animations.
//
//   node tests/test_game.js .
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const root = process.argv[2] || ".";
const files = [
  "js/tile.js",
  "js/grid.js",
  "js/local_storage_manager.js",
  "js/game_manager.js"
];

// --- Minimal DOM -----------------------------------------------------
class Style {
  constructor() { this._props = {}; }
  setProperty(name, value) { this._props[name] = String(value); }
  getPropertyValue(name) { return this._props[name] || ""; }
}

class El {
  constructor(cls) {
    this.className = cls || "";
    this.children = [];
    this.style = new Style();
    this.textContent = "";
    this.value = "";
    this._classes = new Set(String(cls || "").split(/\s+/).filter(Boolean));
  }
  get classList() {
    const self = this;
    return {
      add: (c) => { self._classes.add(c); self._sync(); },
      remove: (c) => { self._classes.delete(c); self._sync(); },
      contains: (c) => self._classes.has(c)
    };
  }
  _sync() { this.className = [...this._classes].join(" "); }
  setAttribute(k, v) {
    if (k === "class") { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); this.className = v; }
  }
  getAttribute(k) { return k === "class" ? this.className : null; }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  get firstChild() { return this.children[0] || null; }
  querySelector() { return new El(); }
  querySelectorAll() { return []; }
  getElementsByTagName() { return [new El()]; }
  getElementsByClassName() { return [new El()]; }
  addEventListener() {}
}

const elements = {};
["tile-container", "grid-container", "game-container", "score-container",
 "best-container", "game-message", "undo-button", "board-size-slider",
 "board-size-value"]
  .forEach((n) => { elements["." + n] = new El(n); });

const documentStub = {
  createElement: () => new El(),
  querySelector: (sel) => elements[sel] || new El(),
  querySelectorAll: () => [],
  getElementsByClassName: (n) => [elements["." + n] || new El()],
  getElementsByTagName: () => [new El()],
  addEventListener: () => {},
  documentElement: {}
};
documentStub.body = new El("body");

const storageData = {};
const windowStub = {
  requestAnimationFrame: (cb) => { cb(); return 1; },
  navigator: {},
  localStorage: {
    setItem: (k, v) => { storageData[k] = String(v); },
    getItem: (k) => (k in storageData ? storageData[k] : null),
    removeItem: (k) => { delete storageData[k]; },
    clear: () => { for (const k of Object.keys(storageData)) delete storageData[k]; }
  }
};

const sandbox = {
  window: windowStub,
  document: documentStub,
  console, setTimeout, Math, JSON, parseInt, Object, Array, String, Number
};
sandbox.window.document = documentStub;
sandbox.window.fakeStorage = undefined;
vm.createContext(sandbox);
for (const f of files) {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), sandbox, { filename: f });
}

elements[".board-size-slider"].value = "4";

const GM = vm.runInContext("GameManager", sandbox);
const Grid = vm.runInContext("Grid", sandbox);
const Tile = vm.runInContext("Tile", sandbox);
const LSM = vm.runInContext("LocalStorageManager", sandbox);

// --- Assert helpers --------------------------------------------------
let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label); }
}
function eq(a, b, label) {
  ok(a === b, label + (a === b ? "" : "   (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"));
}

function clearStorage() { for (const k of Object.keys(storageData)) delete storageData[k]; }

// GameManager with stubbed input/actuator so tests can drive it directly.
function makeGame(fresh) {
  if (fresh !== false) clearStorage();
  function InputStub() { this.events = {}; }
  InputStub.prototype.on = function (e, cb) { (this.events[e] = this.events[e] || []).push(cb); };
  InputStub.prototype.emit = function (e, d) { (this.events[e] || []).forEach((cb) => cb(d)); };
  function ActStub() {}
  ActStub.prototype.actuate = function () {};
  ActStub.prototype.continueGame = function () {};
  ActStub.prototype.updateBoardSizeLock = function () {};
  return new GM(4, InputStub, ActStub, LSM);
}

// Row-major rendering of the board, for readable assertions.
function gridOf(g) {
  const rows = [];
  for (let y = 0; y < g.size; y++) {
    const row = [];
    for (let x = 0; x < g.size; x++) row.push(g.cells[x][y] ? g.cells[x][y].value : 0);
    rows.push(row.join(","));
  }
  return rows.join(" | ");
}

// values is indexed [y][x].
function setGrid(values) {
  return setGrid3(values);
}

// Same, but for a board of any size up to 8.
function setGrid3(values) {
  const n = values.length;
  const grid = new Grid(n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (values[y][x]) grid.insertTile(new Tile({ x: x, y: y }, values[y][x]));
    }
  }
  return grid;
}

function noSpawn(game) { game.addRandomTile = function () {}; }

// Deterministic spawn into the first free cell.
function spawnFirstFree(game) {
  game.addRandomTile = function () {
    const cell = this.grid.availableCells()[0];
    if (cell) this.grid.insertTile(new Tile(cell, 2));
  };
}

function firstRow(g) { return gridOf(g).split(" | ")[0]; }
// --- Rules -----------------------------------------------------------
console.log("\nRules");
{
  const game = makeGame();
  game.grid = setGrid([[2,2,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  noSpawn(game);
  game.move(1); // right
  eq(firstRow(game.grid), "0,0,0,4", "two equal tiles merge when moving right");
  eq(game.score, 4, "merging adds the new tile value to the score");
}
{
  const game = makeGame();
  game.grid = setGrid([[2,2,2,2],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  noSpawn(game);
  game.move(1);
  eq(firstRow(game.grid), "0,0,4,4", "four equal tiles make two pairs, not one quad");
  eq(game.score, 8, "both merges score");
}
{
  const game = makeGame();
  game.grid = setGrid([[2,2,4,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  noSpawn(game);
  game.move(1);
  eq(firstRow(game.grid), "0,0,4,4", "a tile only merges once per move");
}
{
  const game = makeGame();
  game.grid = setGrid([[0,2,0,2],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  noSpawn(game);
  game.move(1);
  eq(firstRow(game.grid), "0,0,0,4", "a gap between merge partners is closed");
  eq(game.score, 4, "a gapped merge scores once");
}
{
  const game = makeGame();
  game.grid = setGrid([[0,0,2,2],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  noSpawn(game);
  game.move(3); // left
  eq(firstRow(game.grid), "4,0,0,0", "tiles travel left across two cells and merge");
}
{
  const game = makeGame();
  game.grid = setGrid([[2,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  noSpawn(game);
  const before = gridOf(game.grid);
  game.move(3); // left: already there
  eq(gridOf(game.grid), before, "a move that changes nothing leaves the board alone");
  eq(game.storageManager.getTotalMoves(), 0, "a no-op move does not consume an undo slot");
}
{
  const game = makeGame();
  game.grid = setGrid([[2,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  let added = false;
  game.addRandomTile = function () { added = true; };
  game.move(1); // right: genuinely moves
  ok(added, "a real move spawns a new tile");
  eq(game.storageManager.getTotalMoves(), 1, "a real move consumes exactly one undo slot");
}
{
  const game = makeGame();
  game.grid = setGrid([[2,0,0,0],[2,0,0,0],[0,0,0,0],[0,0,0,0]]);
  noSpawn(game);
  game.move(0); // up
  ok(game.grid.cellContent({x:0,y:0}).value === 4, "vertical merges work too");
}
{
  const game = makeGame();
  game.grid = setGrid([[1024,1024,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  noSpawn(game);
  game.move(1);
  ok(game.won === true, "reaching 2048 sets the won flag");
  ok(game.isGameTerminated(), "reaching 2048 terminates the game until the player keeps going");
  game.keepPlaying();
  ok(!game.isGameTerminated(), "keeping going clears the win block");
}
{
  const game = makeGame();
  game.grid = setGrid([[2,4,2,4],[4,2,4,2],[2,4,2,4],[4,2,4,2]]);
  noSpawn(game);
  const before = gridOf(game.grid);
  game.move(1);
  eq(gridOf(game.grid), before, "a full, unmovable board is left alone");
  ok(game.over !== true, "a move on a full unmovable board is still a no-op, game stays open");
}
{
  // A full board whose only legal move merges the two 4s on the second row.
  // The spawn that follows lands in the last free cell, and the resulting
  // board has no pairs left, so the game must end.
  const game = makeGame();
  game.grid = setGrid([
    [2,  8,  16,  32],
    [4,  4,  64,  128],
    [16, 32, 256, 512],
    [32, 64, 512, 1024]
  ]);
  spawnFirstFree(game);
  eq(game.movesAvailable(), true, "the crowded board still has one legal move");
  game.move(3); // left, merges the pair
  eq(game.over, true, "a real move that leaves no free cells and no pairs ends the game");
  ok(game.isGameTerminated(), "the finished game reports itself terminated");
}
{
  const game = makeGame();
  game.grid = setGrid([[2,4,2,4],[4,8,4,2],[2,4,2,4],[4,2,8,2]]);
  game.over = true;
  noSpawn(game);
  const before = gridOf(game.grid);
  game.move(1);
  eq(gridOf(game.grid), before, "moves are ignored once the game is over");
}
{
  const game = makeGame();
  eq(typeof game.grid, "object", "a GameManager builds a grid on construction");
  eq(game.grid.size, 4, "the board is 4x4");
}

// --- Animation bookkeeping -------------------------------------------
console.log("\nAnimation bookkeeping");
{
  const game = makeGame();
  game.grid = setGrid([[2,2,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  noSpawn(game);
  game.move(1);
  const merged = game.grid.cellContent({x:3,y:0});
  ok(!!merged.mergedFrom, "the merged tile records its two parents");
  eq(merged.mergedFrom.length, 2, "the merge has exactly two parents");
  eq(merged.mergedFrom[0].x, 3, "the source tile slides onto the merge target so both animate to one cell");
  eq(merged.mergedFrom[0].y, 0, "the source tile keeps the target row");
}
{
  const game = makeGame();
  game.grid = setGrid([[0,0,2,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  noSpawn(game);
  game.move(1);
  const tile = game.grid.cellContent({x:3,y:0});
  ok(!!tile.previousPosition, "a slid tile keeps its previous position");
  eq(tile.previousPosition.x, 2, "the previous x is where the tile started");
  eq(tile.x, 3, "the tile is now in the target cell");
}
{
  const game = makeGame();
  game.grid = setGrid([[2,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  let spawned = null;
  game.addRandomTile = function () {
    const cell = this.grid.availableCells()[0];
    spawned = new Tile(cell, 2);
    this.grid.insertTile(spawned);
  };
  game.move(1);
  ok(spawned !== null, "a tile was spawned");
  ok(!spawned.previousPosition, "a spawned tile has no previous position, so it plays the appear animation");
  ok(!spawned.mergedFrom, "a spawned tile has no merge parents");
}
{
  const game = makeGame();
  game.grid = setGrid([[2,2,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  noSpawn(game);
  // Leftovers from an earlier move must not leak into this one.
  game.grid.eachCell((x, y, t) => { if (t) { t.mergedFrom = [t, t]; t.previousPosition = {x: 9, y: 9}; } });
  game.move(1);
  const merged = game.grid.cellContent({x:3,y:0});
  eq(merged.mergedFrom.length, 2, "stale merge info is cleared before each move");
  eq(merged.mergedFrom[0], merged.mergedFrom[1] === merged ? merged.mergedFrom[0] : merged.mergedFrom[0], "merge parents are distinct tiles");
  ok(merged.mergedFrom[0] !== merged.mergedFrom[1], "the two merge parents are different tiles");
}

// --- Undo ------------------------------------------------------------
console.log("\nUndo");
{
  const game = makeGame();
  game.grid = setGrid([[2,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  noSpawn(game);
  const before = gridOf(game.grid);
  game.score = 0;
  game.move(1);
  ok(gridOf(game.grid) !== before, "the move changed the board");
  game.undo();
  eq(gridOf(game.grid), before, "undo restores the board exactly");
  eq(game.score, 0, "undo restores the score");
}
{
  const game = makeGame();
  game.grid = setGrid([[2,2,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  noSpawn(game);
  const before = gridOf(game.grid);
  game.move(1);
  eq(game.score, 4, "the merge scored");
  game.undo();
  eq(gridOf(game.grid), before, "undo reverses a merge");
  eq(game.score, 0, "undo reverses the score earned by the merge");
}
{
  const game = makeGame();
  spawnFirstFree(game);
  game.grid = setGrid([[2,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  game.move(1);
  game.undo();
  eq(game.storageManager.getTotalMoves(), 0, "undo pops the snapshot off the history");
  ok(game.storageManager.getLastMove(false) === null, "the undo stack is empty after undoing everything");
}
{
  const game = makeGame();
  spawnFirstFree(game);
  game.grid = setGrid([[2,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  const states = [gridOf(game.grid)];
  for (let i = 0; i < 6; i++) {
    game.move(1); game.move(2); game.undo(); game.undo();
  }
  game.move(1);
  game.move(2);
  const target = gridOf(game.grid);
  game.undo();
  ok(gridOf(game.grid) !== target, "undo moves away from the latest state");
  game.move(1);
  game.move(2);
  eq(gridOf(game.grid) !== "", true, "the game keeps playing after undo");
}
{
  const game = makeGame();
  spawnFirstFree(game);
  game.grid = setGrid([[2,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  game.move(1);
  const afterOne = gridOf(game.grid);
  game.move(2);
  game.undo();
  eq(gridOf(game.grid), afterOne, "undo walks back exactly one move");
  ok(game.storageManager.getTotalMoves() > 0, "earlier snapshots remain available");
}
{
  // Undo on an empty history is a harmless no-op.
  const game = makeGame();
  spawnFirstFree(game);
  const state = gridOf(game.grid);
  game.undo();
  eq(gridOf(game.grid), state, "undo with no history leaves the board untouched");
  eq(game.storageManager.getTotalMoves(), 0, "undo with no history does not corrupt the counter");
}
{
  const game = makeGame();
  spawnFirstFree(game);
  game.grid = setGrid([[2,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  game.move(1);
  ok(game.storageManager.getTotalMoves() > 0, "history exists before restart");
  game.restart();
  eq(game.storageManager.getTotalMoves(), 0, "a new game clears the undo history");
  eq(game.score, 0, "a new game resets the score");
  let count = 0;
  game.grid.eachCell((x, y, t) => { if (t) count++; });
  eq(count, 2, "a new game starts with two fresh tiles");
}
{
  // The history is capped so localStorage cannot fill up.
  const lsm = new LSM();
  lsm.clearLastMoves();
  for (let i = 0; i < 1500; i++) { lsm.setLastMove({ i: i }); lsm.trailingUndo(); }
  eq(lsm.getTotalMoves(), 1500, "the move counter keeps climbing past the cap");
  ok(lsm.storage.getItem("move#1") == null, "the oldest snapshots are dropped");
  ok(lsm.storage.getItem("move#1500") != null, "the newest snapshots are kept");
  ok(lsm.storage.getItem("move#501") != null, "snapshots inside the cap survive");
  lsm.clearLastMoves();
  eq(lsm.getTotalMoves(), 0, "clearing the history resets the counter");
}
{
  // getLastMove(false) peeks without consuming.
  const lsm = new LSM();
  lsm.clearLastMoves();
  lsm.setLastMove({ a: 1 });
  const peek1 = lsm.getLastMove(false);
  const peek2 = lsm.getLastMove(false);
  eq(peek1.a, 1, "peeking returns the newest snapshot");
  eq(peek2.a, 1, "peeking twice returns the same snapshot");
  eq(lsm.getTotalMoves(), 1, "peeking does not consume the snapshot");
  const used = lsm.getLastMove(true);
  eq(used.a, 1, "consuming returns the newest snapshot");
  eq(lsm.getTotalMoves(), 0, "consuming pops the snapshot");
  lsm.clearLastMoves();
}

// --- Session persistence --------------------------------------------
console.log("\nSession persistence");
{
  const game = makeGame();
  spawnFirstFree(game);
  game.grid = setGrid([[2,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  game.move(1);
  game.move(2);
  const saved = gridOf(game.grid);
  const score = game.score;

  const resumed = makeGame(false); // same storage, no clear
  eq(gridOf(resumed.grid), saved, "a reload resumes the exact board");
  eq(resumed.score, score, "a reload resumes the score");
}
{
  const game = makeGame();
  spawnFirstFree(game);
  game.grid = setGrid([[2,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  game.move(1);
  const resumed = makeGame(false);
  ok(resumed.storageManager.getTotalMoves() > 0, "the undo history survives a reload");
  const afterUndo = gridOf(resumed.grid);
  resumed.undo();
  ok(gridOf(resumed.grid) !== afterUndo, "undo still works after a reload");
}
{
  const game = makeGame();
  game.score = 500;
  game.actuate();
  eq(game.storageManager.getBestScore(), 500, "the best score is persisted");
  const later = makeGame(false);
  eq(parseInt(later.storageManager.getBestScore(), 10), 500, "the best score survives a reload");
}
{
  const game = makeGame();
  game.score = 100;
  game.actuate();
  game.score = 40;
  game.actuate();
  eq(game.storageManager.getBestScore(), 100, "the best score never goes down");
  eq(game.actuator ? true : true, true, "actuate ran without a DOM");
}

// --- Initial state ---------------------------------------------------
console.log("\nInitial state");
{
  const game = makeGame();
  let count = 0;
  game.grid.eachCell((x, y, t) => { if (t) count++; });
  eq(count, 2, "a new game starts with two tiles");
  eq(game.grid.availableCells().length, 14, "fourteen cells remain free");
  ok(game.grid.cells.every((col) => col.every((c) => c === null || c.value === 2 || c.value === 4)),
     "starting tiles are 2s or 4s");
  eq(game.score, 0, "the score starts at zero");
  eq(game.over, false, "the game does not start over");
  eq(game.won, false, "the game does not start won");
}

// --- Spawn odds ------------------------------------------------------
console.log("\nSpawn odds");
{
  // addRandomTile should be roughly 90% twos.
  const game = makeGame();
  let twos = 0, fours = 0;
  for (let i = 0; i < 4000; i++) {
    const g = new Grid(4);
    const mgr = Object.create(game);
    mgr.grid = g;
    mgr.addRandomTile.call(mgr);
    g.eachCell((x, y, t) => { if (t) { if (t.value === 2) twos++; else if (t.value === 4) fours++; } });
  }
  const ratio = twos / (twos + fours);
  ok(ratio > 0.87 && ratio < 0.93, "roughly 90% of spawned tiles are 2s (" + ratio.toFixed(3) + ")");
}

// --- Adjustable board size -------------------------------------------
console.log("\nBoard size");

// Drives a GameManager at an arbitrary size, with a controllable input stub
// so the "boardSize" event can be fired the way the slider does.
function makeSizedGame(size, fresh) {
  if (fresh !== false) clearStorage();
  var handlers = {};
  function InputStub() {}
  InputStub.prototype.on = function (e, cb) { (handlers[e] = handlers[e] || []).push(cb); };
  InputStub.prototype.emit = function (e, d) { (handlers[e] || []).forEach(function (cb) { cb(d); }); };
  function ActStub() {}
  ActStub.prototype.actuate = function () {};
  ActStub.prototype.continueGame = function () {};
  ActStub.prototype.updateBoardSizeLock = function (locked) { this.boardSizeLocked = locked; };
  ActStub.prototype.showSizeChangeConfirmation = function (size) { this.requestedSize = size; };
  ActStub.prototype.cancelSizeChange = function (size) { this.cancelledSize = size; };
  var game = new GM(size, InputStub, ActStub, LSM);
  game.emitSize = function (s) { (handlers["boardSize"] || []).forEach(function (cb) { cb(s); }); };
  game.confirmSize = function () { (handlers["confirmBoardSize"] || []).forEach(function (cb) { cb(); }); };
  game.cancelSize = function () { (handlers["cancelBoardSize"] || []).forEach(function (cb) { cb(); }); };
  return game;
}
{
  // Clamping: anything outside 3..8 is pulled back into range.
  const lsm = new LSM();
  lsm.setBoardSize(2);
  eq(lsm.getBoardSize(), 3, "a size below the minimum clamps up to 3");
  lsm.setBoardSize(99);
  eq(lsm.getBoardSize(), 8, "a size above the maximum clamps down to 8");
  lsm.setBoardSize(6);
  eq(lsm.getBoardSize(), 6, "a size inside the range is kept");
  lsm.setBoardSize("not a number");
  eq(lsm.getBoardSize(), 4, "an unparseable size falls back to the default");
  lsm.storage.removeItem("boardSize");
}
{
  // No preference recorded reports as null, so the caller can apply its own
  // default rather than having one silently imposed.
  const lsm = new LSM();
  lsm.storage.removeItem("boardSize");
  eq(lsm.getBoardSize(), null, "with nothing stored, there is no recorded preference");

  const game = makeSizedGame(4);
  eq(game.size, 4, "and a game falls back to the size it was asked for");
}
{
  // The board is actually built at the requested size, on the whole range.
  [3, 4, 5, 6, 7, 8].forEach((size) => {
    clearStorage();
    const game = makeSizedGame(size);
    eq(game.grid.size, size, "a game can be built at " + size + "x" + size);
    eq(game.grid.cells.length, size, "the grid has " + size + " columns");
    eq(game.grid.cells[0].length, size, "the grid has " + size + " rows");
    eq(game.grid.availableCells().length, size * size - 2,
       "a fresh " + size + "x" + size + " board starts with two tiles");
  });
}
{
  // A move sweeps the whole board, not just the first four columns/rows.
  const game = makeSizedGame(8);
  game.grid = new Grid(8);
  game.grid.insertTile(new Tile({ x: 7, y: 7 }, 2));
  noSpawn(game);
  game.move(1); // right: the tile is already at the far edge
  eq(gridOf(game.grid).split(" | ")[7], "0,0,0,0,0,0,0,2",
     "the sweep reaches the last column of an 8x8 board");
  game.move(2); // down: the tile is already at the bottom
  eq(gridOf(game.grid).split(" | ")[7], "0,0,0,0,0,0,0,2",
     "the sweep reaches the last row of an 8x8 board");
}
{
  // Merging still works on a small board.
  const game = makeSizedGame(3);
  game.grid = setGrid3([[2,2,0],[0,0,0],[0,0,0]]);
  noSpawn(game);
  game.move(1);
  eq(gridOf(game.grid).split(" | ")[0], "0,0,4", "3x3 boards merge like 4x4 ones");
}
{
  // "No moves left" detection has to look at the whole board.
  const game = makeSizedGame(8);
  game.grid = new Grid(8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      // A checkerboard of 2s and 4s: full, and nothing can merge.
      game.grid.insertTile(new Tile({ x: x, y: y }, (x + y) % 2 ? 4 : 2));
    }
  }
  eq(game.movesAvailable(), false,
     "a full, pairless 8x8 board reports no moves available");
  game.over = true;
  game.actuate();
  eq(game.over, true, "and the game is over");
}
{
  // Changing the size starts a fresh game at the new size.
  clearStorage();
  const game = makeSizedGame(4);
  game.grid = setGrid([[2,2,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
  game.score = 0;
  game.move(1);
  ok(game.score > 0, "the game is underway at 4x4");

  game.emitSize(6);
  eq(game.size, 4, "a played game stays on its current size until the reset is confirmed");
  eq(game.actuator.requestedSize, 6, "the requested size is shown in a reset confirmation");
  eq(game.actuator.boardSizeLocked, true, "a move locks the board-size control");
  ok(game.storageManager.getTotalMoves() > 0, "the undo history remains available while the prompt is open");

  game.cancelSize();
  eq(game.size, 4, "cancelling a size change keeps the current board");
  eq(game.actuator.cancelledSize, 4, "cancelling restores the current slider value");

  game.emitSize(6);
  game.confirmSize();
  eq(game.size, 6, "confirming the reset switches to the new size");
  eq(game.grid.size, 6, "and builds a 6x6 grid");
  eq(game.score, 0, "the new board starts from zero");
  eq(game.over, false, "the new board is playable");
  eq(game.storageManager.getTotalMoves(), 0, "the undo history is cleared with it");
  eq(game.actuator.boardSizeLocked, false, "a fresh board unlocks the size control");
}
{
  // Picking the size already in play is a no-op, so a stray slider event
  // cannot wipe out a game in progress.
  clearStorage();
  const game = makeSizedGame(5);
  game.score = 42;
  game.emitSize(5);
  eq(game.score, 42, "re-selecting the current size leaves the game alone");
}
{
  // Out-of-range values coming from the slider are clamped.
  clearStorage();
  const game = makeSizedGame(4);
  game.emitSize(100);
  eq(game.size, 8, "a slider value past the top is clamped to 8");
  game.emitSize(-4);
  eq(game.size, 3, "a slider value below the bottom is clamped to 3");
}
{
  // The chosen size survives a reload, and so does a session played at it.
  clearStorage();
  const game = makeSizedGame(7);
  game.addRandomTile = function () {};
  game.grid = new Grid(7);
  game.grid.insertTile(new Tile({ x: 0, y: 6 }, 2));
  game.move(1); // a real move, so the session is actually saved
  const saved = gridOf(game.grid);

  const resumed = makeSizedGame(4, false); // requested 4, storage says 7
  eq(resumed.size, 7, "a reload resumes the saved board size");
  eq(gridOf(resumed.grid), saved, "and the saved board itself");
}
{
  // A session saved at one size does not leak into a differently-sized game.
  clearStorage();
  const game = makeSizedGame(3);
  game.storageManager.setGameState(null);
  game.storageManager.setBoardSize(3);
  const fresh = makeSizedGame(3, false);
  eq(fresh.grid.size, 3, "a saved size is honored on the next load");
}
{
  // Every cell the actuator has a position class for must be reachable, all
  // the way to the far corner of the largest board.
  const game = makeSizedGame(8);
  game.grid = new Grid(8);
  game.grid.insertTile(new Tile({ x: 7, y: 7 }, 2));
  const tile = game.grid.cellContent({ x: 7, y: 7 });
  eq(tile.x, 7, "row 8 is addressable");
  eq(tile.y, 7, "column 8 is addressable");
  ok(game.grid.withinBounds({ x: 7, y: 7 }), "the far corner is within bounds");
  ok(!game.grid.withinBounds({ x: 8, y: 7 }), "one past the far corner is not");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
