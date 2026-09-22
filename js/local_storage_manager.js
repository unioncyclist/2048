// Falls back to an in-memory store when localStorage is unavailable
// (private browsing, disabled storage). Keeps the game playable either way.
window.fakeStorage = {
  _data: {},

  setItem: function (id, val) {
    return this._data[id] = String(val);
  },

  getItem: function (id) {
    return this._data.hasOwnProperty(id) ? this._data[id] : undefined;
  },

  removeItem: function (id) {
    return delete this._data[id];
  },

  clear: function () {
    return this._data = {};
  }
};

// The board is square, and the player chooses how big it is. These are the
// limits the slider offers.
var BOARD_MIN_SIZE = 3;
var BOARD_MAX_SIZE = 8;
var BOARD_DEFAULT_SIZE = 4;

function LocalStorageManager() {
  this.bestScoreKey = "bestScore";
  this.gameStateKey = "gameState";
  this.boardSizeKey = "boardSize";

  // Undo history: one serialized snapshot per move, plus a counter.
  this.totalMovesKey = "totalMoves";
  this.lastMoveKey   = "move#";
  // Only this many snapshots are kept; localStorage has a small quota and
  // a long game would otherwise fill it and stall the page.
  this.undoLimit     = 1000;

  var supported = this.localStorageSupported();
  this.storage = supported ? window.localStorage : window.fakeStorage;
}

LocalStorageManager.prototype.localStorageSupported = function () {
  var testKey = "test";
  var storage = window.localStorage;

  try {
    storage.setItem(testKey, "1");
    storage.removeItem(testKey);
    return true;
  } catch (error) {
    return false;
  }
};

// --- Best score ------------------------------------------------------
// Storage hands back strings, so parse on the way out; callers compare and
// display this as a number.
LocalStorageManager.prototype.getBestScore = function () {
  return parseInt(this.storage.getItem(this.bestScoreKey), 10) || 0;
};

LocalStorageManager.prototype.setBestScore = function (score) {
  this.storage.setItem(this.bestScoreKey, score);
};

// --- Board size ------------------------------------------------------

// Clamp to the supported range so a hand-edited or corrupt stored value
// cannot produce a board the game cannot draw.
function clampBoardSize(size) {
  size = parseInt(size, 10);
  if (isNaN(size)) return BOARD_DEFAULT_SIZE;
  return Math.min(BOARD_MAX_SIZE, Math.max(BOARD_MIN_SIZE, size));
}

// Returns null when the player has never chosen a size, so callers can tell
// "no preference recorded" apart from an explicit choice. Returning the
// default here would make the preference always win over a requested size.
LocalStorageManager.prototype.getBoardSize = function () {
  var stored = this.storage.getItem(this.boardSizeKey);
  if (stored === null || stored === undefined || stored === "") return null;
  return clampBoardSize(stored);
};

LocalStorageManager.prototype.setBoardSize = function (size) {
  this.storage.setItem(this.boardSizeKey, clampBoardSize(size));
};

// --- Current game ----------------------------------------------------
LocalStorageManager.prototype.getGameState = function () {
  var stateJSON = this.storage.getItem(this.gameStateKey);
  return stateJSON ? JSON.parse(stateJSON) : null;
};

LocalStorageManager.prototype.setGameState = function (gameState) {
  this.storage.setItem(this.gameStateKey, JSON.stringify(gameState));
};

LocalStorageManager.prototype.clearGameState = function () {
  this.storage.removeItem(this.gameStateKey);
};

// --- Undo history ----------------------------------------------------

// Returns the most recent snapshot. When `willUse` is true the snapshot is
// popped off the history (it is about to be restored).
LocalStorageManager.prototype.getLastMove = function (willUse) {
  var i = this.getTotalMoves();
  var stateJSON = this.storage.getItem(this.lastMoveKey + i.toString());

  if (willUse && stateJSON) {
    this.storage.removeItem(this.lastMoveKey + i.toString());
    this.setTotalMoves(--i);
  }

  return stateJSON ? JSON.parse(stateJSON) : null;
};

LocalStorageManager.prototype.setLastMove = function (lastMove) {
  var i = this.getTotalMoves();
  this.storage.setItem(this.lastMoveKey + (++i).toString(),
                       JSON.stringify(lastMove));
  this.setTotalMoves(i);
};

LocalStorageManager.prototype.clearLastMoves = function () {
  for (var i = this.getTotalMoves(); i > 0; i--) {
    this.storage.removeItem(this.lastMoveKey + i.toString());
  }
  this.storage.removeItem(this.totalMovesKey);
};

LocalStorageManager.prototype.getTotalMoves = function () {
  return parseInt(this.storage.getItem(this.totalMovesKey), 10) || 0;
};

LocalStorageManager.prototype.setTotalMoves = function (moves) {
  this.storage.setItem(this.totalMovesKey, moves);
};

// Drop the oldest snapshots once the history exceeds the cap, so the
// undo stack stays bounded no matter how long the game runs.
LocalStorageManager.prototype.trailingUndo = function () {
  var i = this.getTotalMoves();
  if (i > this.undoLimit) {
    var oldest = i - this.undoLimit;
    this.storage.removeItem(this.lastMoveKey + oldest.toString());
  }
};