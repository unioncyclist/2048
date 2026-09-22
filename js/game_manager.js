// The rules engine. Owns the grid, the score, and the undo history.
// Talks to the outside world only through the input, actuator and storage
// managers passed in.
function GameManager(size, InputManager, Actuator, StorageManager) {
  this.inputManager   = new InputManager();
  this.storageManager = new StorageManager();
  this.actuator       = new Actuator();

  // The board is square and its size is adjustable at runtime, so the
  // constructor's `size` is only a fallback: a size the player picked
  // earlier wins over it. getBoardSize returns null when there is no
  // recorded preference.
  var savedSize = this.storageManager.getBoardSize();
  this.size = savedSize === null ? size : savedSize;

  this.startTiles = 2;

  this.inputManager.on("move", this.move.bind(this));
  this.inputManager.on("restart", this.restart.bind(this));
  this.inputManager.on("undo", this.undo.bind(this));
  this.inputManager.on("keepPlaying", this.keepPlaying.bind(this));
  this.inputManager.on("boardSize", this.changeSize.bind(this));
  this.inputManager.on("confirmBoardSize", this.confirmSizeChange.bind(this));
  this.inputManager.on("cancelBoardSize", this.cancelSizeChange.bind(this));

  this.setup();
}

// Switch to a board of a different size. Once a move exists, changing the
// board would destroy a game the player can still undo, so ask first.
GameManager.prototype.changeSize = function (size) {
  size = clampBoardSize(size);
  if (size === this.size) return;

  if (this.storageManager.getLastMove(false) !== null) {
    this.pendingBoardSize = size;
    this.actuator.showSizeChangeConfirmation(size, this.size);
    return;
  }

  this.applySizeChange(size);
};

GameManager.prototype.confirmSizeChange = function (size) {
  if (this.pendingBoardSize !== undefined) {
    size = this.pendingBoardSize;
  }
  if (size === undefined) return;

  this.pendingBoardSize = undefined;
  this.applySizeChange(size);
};

GameManager.prototype.cancelSizeChange = function (size) {
  if (this.pendingBoardSize === undefined && size === undefined) return;

  this.pendingBoardSize = undefined;
  this.actuator.cancelSizeChange(this.size, this.isGameTerminated(),
                                 this.over, this.won);
};

GameManager.prototype.applySizeChange = function (size) {
  this.size = size;
  this.storageManager.setBoardSize(size);
  this.restart();
};

// Start a fresh game and drop the undo history with it.
GameManager.prototype.restart = function () {
  this.storageManager.clearLastMoves();
  this.storageManager.clearGameState();
  this.actuator.continueGame(); // Clear the game won/lost message
  this.setup();
};

// Step back one move by restoring the previous board from the undo history.
GameManager.prototype.undo = function () {
  var data = this.storageManager.getLastMove(true);
  if (data !== null) {
    this.storageManager.setGameState(data);
    this.actuator.continueGame();
    this.setup();
  }
};

// Keep playing after winning (allows going over 2048).
// The flag is deliberately not named `keepPlaying`: an own property would
// shadow this very method on the instance.
GameManager.prototype.keepPlaying = function () {
  this.keepPlayingAfterWin = true;
  this.actuator.continueGame(); // Clear the game won/lost message
};

// True when the game is lost, or won and the player has not kept playing.
GameManager.prototype.isGameTerminated = function () {
  return this.over || (this.won && !this.keepPlayingAfterWin);
};

// Set up the game, restoring a saved session when one exists.
GameManager.prototype.setup = function () {
  var previousState = this.storageManager.getGameState();

  if (previousState) {
    // Resume where the player left off. The saved board carries its own
    // size, which is authoritative: it is what that session was played on.
    this.size        = previousState.grid.size;
    this.grid        = new Grid(previousState.grid.size,
                                previousState.grid.cells);
    this.score       = previousState.score;
    this.over        = previousState.over;
    this.won         = previousState.won;
    this.keepPlayingAfterWin = !!previousState.keepPlaying;
  } else {
    this.grid        = new Grid(this.size);
    this.score       = 0;
    this.over        = false;
    this.won         = false;
    this.keepPlayingAfterWin = false;

    this.addStartTiles();
  }

  this.actuate();
};

GameManager.prototype.addStartTiles = function () {
  for (var i = 0; i < this.startTiles; i++) {
    this.addRandomTile();
  }
};

// Drop a 2 (90%) or a 4 (10%) onto a random free cell.
GameManager.prototype.addRandomTile = function () {
  if (this.grid.cellsAvailable()) {
    var value = Math.random() < 0.9 ? 2 : 4;
    var tile = new Tile(this.grid.randomAvailableCell(), value);

    this.grid.insertTile(tile);
  }
};

// Push the current state to storage and to the screen.
GameManager.prototype.actuate = function () {
  if (this.storageManager.getBestScore() < this.score) {
    this.storageManager.setBestScore(this.score);
  }

  // Losing ends the session; winning does not, in case they keep playing.
  if (this.over) {
    this.storageManager.clearGameState();
  } else {
    this.storageManager.setGameState(this.serialize());
  }

  // Grey out the undo button when there is nothing left to undo.
  var undoButton = document.querySelector(".undo-button");
  if (undoButton) {
    if (this.storageManager.getLastMove(false) !== null) {
      undoButton.classList.remove("disabled");
    } else {
      undoButton.classList.add("disabled");
    }
  }

  this.actuator.updateBoardSizeLock(
    this.storageManager.getLastMove(false) !== null
  );

  this.actuator.actuate(this.grid, {
    score:      this.score,
    over:       this.over,
    won:        this.won,
    bestScore:  this.storageManager.getBestScore(),
    terminated: this.isGameTerminated()
  });
};

GameManager.prototype.serialize = function () {
  return {
    grid:        this.grid.serialize(),
    score:       this.score,
    over:        this.over,
    won:         this.won,
    // Serialized under the original key so existing saved sessions still load.
    keepPlaying: this.keepPlayingAfterWin
  };
};

// Remember where every tile was, and forget last move's merge bookkeeping.
// This is what gives the actuator the old position to animate from.
GameManager.prototype.prepareTiles = function () {
  this.grid.eachCell(function (x, y, tile) {
    if (tile) {
      tile.mergedFrom = null;
      tile.savePosition();
    }
  });
};

GameManager.prototype.moveTile = function (tile, cell) {
  this.grid.cells[tile.x][tile.y] = null;
  this.grid.cells[cell.x][cell.y] = tile;
  tile.updatePosition(cell);
};

// Move every tile in the given direction and merge the collisions.
// 0: up, 1: right, 2: down, 3: left
GameManager.prototype.move = function (direction) {
  var self = this;

  if (this.isGameTerminated()) return; // Don't do anything if the game's over

  var cell, tile;

  var vector     = this.getVector(direction);
  var traversals = this.buildTraversals(vector);
  var moved      = false;

  // Snapshot before the move so it can be restored by undo.
  var snapshot = this.serialize();

  this.prepareTiles();

  // Walk the grid starting from the edge we are moving towards, so tiles
  // resolve in the correct order.
  traversals.x.forEach(function (x) {
    traversals.y.forEach(function (y) {
      cell = { x: x, y: y };
      tile = self.grid.cellContent(cell);

      if (tile) {
        var positions = self.findFarthestPosition(cell, vector);
        var next      = self.grid.cellContent(positions.next);

        // Merge, but only one merge per tile per move.
        if (next && next.value === tile.value && !next.mergedFrom) {
          var merged = new Tile(positions.next, tile.value * 2);
          merged.mergedFrom = [tile, next];

          self.grid.insertTile(merged);
          self.grid.removeTile(tile);

          // Slide the original tile onto the merge target so the two
          // animations land in the same cell.
          tile.updatePosition(positions.next);

          self.score += merged.value;

          if (merged.value === 2048) self.won = true;
        } else {
          self.moveTile(tile, positions.farthest);
        }

        if (!self.positionsEqual(cell, tile)) {
          moved = true; // The tile moved from its original cell!
        }
      }
    });
  });

  // Only a move that actually changed the board counts: it costs a random
  // tile, consumes an undo slot, and may end the game.
  if (moved) {
    this.storageManager.setLastMove(snapshot);
    this.storageManager.trailingUndo();

    this.addRandomTile();

    if (!this.movesAvailable()) {
      this.over = true; // Game over!
    }

    this.actuate();
  }
};

// Unit vector for each direction.
GameManager.prototype.getVector = function (direction) {
  var map = {
    0: { x: 0,  y: -1 }, // Up
    1: { x: 1,  y: 0 },  // Right
    2: { x: 0,  y: 1 },  // Down
    3: { x: -1, y: 0 }   // Left
  };

  return map[direction];
};

// Visit order for the sweep, always from the far edge backwards.
GameManager.prototype.buildTraversals = function (vector) {
  var traversals = { x: [], y: [] };

  // Iterate the grid's size rather than this.size so a resized board can
  // never be swept with a stale count.
  for (var pos = 0; pos < this.grid.size; pos++) {
    traversals.x.push(pos);
    traversals.y.push(pos);
  }

  if (vector.x === 1) traversals.x = traversals.x.reverse();
  if (vector.y === 1) traversals.y = traversals.y.reverse();

  return traversals;
};

GameManager.prototype.findFarthestPosition = function (cell, vector) {
  var previous;

  // Keep stepping until we hit a wall or an occupied cell.
  do {
    previous = cell;
    cell     = { x: previous.x + vector.x, y: previous.y + vector.y };
  } while (this.grid.withinBounds(cell) && this.grid.cellAvailable(cell));

  return {
    farthest: previous,
    next: cell // May hold a merge candidate
  };
};

GameManager.prototype.movesAvailable = function () {
  return this.grid.cellsAvailable() || this.tileMatchesAvailable();
};

// Brute force check for any adjacent equal pair.
GameManager.prototype.tileMatchesAvailable = function () {
  var self = this;
  var tile;

  for (var x = 0; x < this.grid.size; x++) {
    for (var y = 0; y < this.grid.size; y++) {
      tile = this.grid.cellContent({ x: x, y: y });

      if (tile) {
        for (var direction = 0; direction < 4; direction++) {
          var vector = self.getVector(direction);
          var cell   = { x: x + vector.x, y: y + vector.y };
          var other  = self.grid.cellContent(cell);

          if (other && other.value === tile.value) {
            return true; // These two tiles can be merged
          }
        }
      }
    }
  }

  return false;
};

GameManager.prototype.positionsEqual = function (first, second) {
  return first.x === second.x && first.y === second.y;
};