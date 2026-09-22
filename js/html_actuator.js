// Turns game state into DOM. Owns every visual effect on the board.
//
// There are three kinds of animation, and they all work by letting the browser
// paint the "before" state once and then swapping in the "after" state so CSS
// transitions / keyframes have something to move between:
//
//   1. slide  - a moved tile is appended at its previousPosition, then one
//               frame later its position class is swapped, so the `transition`
//               on `transform` animates the tile to the new cell.
//   2. appear - a brand new tile gets `.tile-new`, whose keyframe scales it
//               up from 0.
//   3. merge  - the merged tile gets `.tile-merged` (a scale overshoot) and the
//               two source tiles are re-appended underneath it so they show
//               through while the merge plays.
function HTMLActuator() {
  this.tileContainer    = document.querySelector(".tile-container");
  this.gridContainer    = document.querySelector(".grid-container");
  this.scoreContainer   = document.querySelector(".score-container");
  this.bestContainer    = document.querySelector(".best-container");
  this.messageContainer = document.querySelector(".game-message");
  this.boardContainer   = document.querySelector(".game-container");

  // The score currently on screen, so we can flash the difference.
  this.score = 0;
}

HTMLActuator.prototype.actuate = function (grid, metadata) {
  var self = this;

  // Wait for the next frame so the previous move has finished painting;
  // this is what makes the slide animation visible at all.
  window.requestAnimationFrame(function () {
    self.resizeBoard(grid.size);
    self.clearContainer(self.tileContainer);

    grid.cells.forEach(function (column) {
      column.forEach(function (cell) {
        if (cell) {
          self.addTile(cell);
        }
      });
    });

    self.updateScore(metadata.score);
    self.updateBestScore(metadata.bestScore);

    if (metadata.terminated) {
      if (metadata.over) {
        self.message(false); // You lose
      } else if (metadata.won) {
        self.message(true); // You win!
      }
    }
  });
};

// Rebuild the backdrop of empty cells and tell CSS how many per side there
// are. Everything else in the layout is derived from that count, so this is
// all it takes to switch the board between 3x3 and 8x8.
HTMLActuator.prototype.resizeBoard = function (size) {
  if (!this.gridContainer) return;

  if (this.boardSize === size) return;
  this.boardSize = size;

  if (this.boardContainer) {
    this.boardContainer.style.setProperty("--n", size);
  }

  // Keep the slider and its readout in step with the game, which matters
  // after a resume or an undo that restored a different-sized board.
  var slider = document.querySelector(".board-size-slider");
  if (slider) slider.value = size;
  var readout = document.querySelector(".board-size-value");
  if (readout) readout.textContent = size + "\u00d7" + size;

  this.clearContainer(this.gridContainer);

  var cellCount = size * size;
  for (var i = 0; i < cellCount; i++) {
    var cell = document.createElement("div");
    cell.className = "grid-cell";
    this.gridContainer.appendChild(cell);
  }
};

// Dismiss the win/lose overlay (used by restart, undo and keep playing).
HTMLActuator.prototype.continueGame = function () {
  this.clearMessage();
};

HTMLActuator.prototype.updateBoardSizeLock = function (locked) {
  var lock = document.querySelector(".board-size-lock");
  if (!lock) return;

  if (locked) {
    lock.classList.add("locked");
    lock.setAttribute("aria-label", "Board size locked");
  } else {
    lock.classList.remove("locked");
    lock.setAttribute("aria-label", "Board size unlocked");
  }
};

HTMLActuator.prototype.showSizeChangeConfirmation = function (size, currentSize) {
  var slider = document.querySelector(".board-size-slider");
  if (slider) slider.value = currentSize;
  var readout = document.querySelector(".board-size-value");
  if (readout) readout.textContent = currentSize + "\u00d7" + currentSize;

  this.clearMessage();
  this.messageContainer.classList.add("game-size-change");
  this.messageContainer.getElementsByTagName("p")[0].textContent =
    "Changing the board size will reset your current game.";
};

HTMLActuator.prototype.cancelSizeChange = function (size, terminated, over, won) {
  var slider = document.querySelector(".board-size-slider");
  if (slider) slider.value = size;
  var readout = document.querySelector(".board-size-value");
  if (readout) readout.textContent = size + "\u00d7" + size;

  this.clearMessage();
  if (terminated) this.message(won && !over);
};

HTMLActuator.prototype.clearContainer = function (container) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
};

HTMLActuator.prototype.addTile = function (tile) {
  var self = this;

  var wrapper  = document.createElement("div");
  var inner    = document.createElement("div");
  var position = tile.previousPosition || { x: tile.x, y: tile.y };
  var positionClass = this.positionClass(position);

  // Plain class string rather than classList: replacing position classes via
  // classList can glitch and leave the tile stuck mid-transition.
  var classes = ["tile", "tile-" + tile.value, positionClass];

  if (tile.value > 2048) classes.push("tile-super");

  this.applyClasses(wrapper, classes);

  inner.classList.add("tile-inner");
  inner.textContent = tile.value;

  if (tile.previousPosition) {
    // Draw at the old cell first, then move: the CSS transition does the rest.
    window.requestAnimationFrame(function () {
      classes[2] = self.positionClass({ x: tile.x, y: tile.y });
      self.applyClasses(wrapper, classes);
    });
  } else if (tile.mergedFrom) {
    classes.push("tile-merged");
    this.applyClasses(wrapper, classes);

    // Render both source tiles so they are visible during the merge.
    tile.mergedFrom.forEach(function (merged) {
      self.addTile(merged);
    });
  } else {
    classes.push("tile-new");
    this.applyClasses(wrapper, classes);
  }

  wrapper.appendChild(inner);
  this.tileContainer.appendChild(wrapper);
};

HTMLActuator.prototype.applyClasses = function (element, classes) {
  element.setAttribute("class", classes.join(" "));
};

HTMLActuator.prototype.normalizePosition = function (position) {
  // CSS position classes are 1-based.
  return { x: position.x + 1, y: position.y + 1 };
};

HTMLActuator.prototype.positionClass = function (position) {
  position = this.normalizePosition(position);
  return "tile-position-" + position.x + "-" + position.y;
};

HTMLActuator.prototype.updateScore = function (score) {
  this.clearContainer(this.scoreContainer);

  var difference = score - this.score;
  this.score = score;

  this.scoreContainer.textContent = this.score;

  if (difference > 0) {
    var addition = document.createElement("div");
    addition.classList.add("score-addition");
    addition.textContent = "+" + difference;

    this.scoreContainer.appendChild(addition);
  }
};

HTMLActuator.prototype.updateBestScore = function (bestScore) {
  this.bestContainer.textContent = bestScore;
};

HTMLActuator.prototype.message = function (won) {
  var type    = won ? "game-won" : "game-over";
  var message = won ? "You win!" : "Game over!";

  this.messageContainer.classList.add(type);
  this.messageContainer.getElementsByTagName("p")[0].textContent = message;
};

HTMLActuator.prototype.clearMessage = function () {
  // One at a time: older IE only accepts a single value here.
  this.messageContainer.classList.remove("game-won");
  this.messageContainer.classList.remove("game-over");
  this.messageContainer.classList.remove("game-size-change");
};