// Keyboard, button and swipe input. Emits named events; knows nothing about
// the game rules.
function KeyboardInputManager() {
  this.events = {};

  if (window.navigator.msPointerEnabled) {
    // IE10 pointer events
    this.eventTouchstart = "MSPointerDown";
    this.eventTouchmove  = "MSPointerMove";
    this.eventTouchend   = "MSPointerUp";
  } else {
    this.eventTouchstart = "touchstart";
    this.eventTouchmove  = "touchmove";
    this.eventTouchend   = "touchend";
  }

  this.listen();
}

KeyboardInputManager.prototype.on = function (event, callback) {
  if (!this.events[event]) {
    this.events[event] = [];
  }
  this.events[event].push(callback);
};

KeyboardInputManager.prototype.emit = function (event, data) {
  var callbacks = this.events[event];
  if (callbacks) {
    callbacks.forEach(function (callback) {
      callback(data);
    });
  }
};

KeyboardInputManager.prototype.listen = function () {
  var self = this;

  // Direction map. Keyed by keyCode for keyboard-layout independence, plus
  // the literal key for WASD / vim bindings.
  var keyMap = {
    38: 0, 39: 1, 40: 2, 37: 3, // Arrow keys
    75: 0, 76: 1, 74: 2, 72: 3, // Vim hjkl
    87: 0, 68: 1, 83: 2, 65: 3  // WASD
  };

  document.addEventListener("keydown", function (event) {
    var modifiers = event.altKey || event.ctrlKey || event.metaKey ||
                    event.shiftKey;

    if (modifiers) return;

    var code = event.which || event.keyCode;
    var mapped = keyMap[code];

    if (mapped !== undefined) {
      event.preventDefault();
      self.emit("move", mapped);
      return;
    }

    // R restarts, U undoes.
    if (code === 82) {
      self.restart.call(self, event);
    } else if (code === 85) {
      self.undo.call(self, event);
    }
  });

  // Buttons
  this.bindButtonPress(".retry-button", this.restart);
  this.bindButtonPress(".restart-button", this.restart);
  this.bindButtonPress(".keep-playing-button", this.keepPlaying);
  this.bindButtonPress(".undo-button", this.undo);
  this.bindButtonPress(".size-change-confirm-button", this.confirmBoardSize);
  this.bindButtonPress(".size-change-cancel-button", this.cancelBoardSize);

  // Board size slider. `input` fires continuously while dragging; the game
  // only rebuilds when the value actually lands on a new size.
  var slider = document.querySelector(".board-size-slider");
  if (slider) {
    this.bindBoardSize(slider);
  }

  // Swipe on the board
  var touchStartClientX, touchStartClientY;
  var gameContainer = document.getElementsByClassName("game-container")[0];

  gameContainer.addEventListener(this.eventTouchstart, function (event) {
    if ((!window.navigator.msPointerEnabled && event.touches.length > 1) ||
        event.targetTouches > 1) {
      return; // Ignore multi-finger gestures
    }

    if (window.navigator.msPointerEnabled) {
      touchStartClientX = event.pageX;
      touchStartClientY = event.pageY;
    } else {
      touchStartClientX = event.touches[0].clientX;
      touchStartClientY = event.touches[0].clientY;
    }

    event.preventDefault();
  });

  gameContainer.addEventListener(this.eventTouchmove, function (event) {
    event.preventDefault();
  });

  gameContainer.addEventListener(this.eventTouchend, function (event) {
    if ((!window.navigator.msPointerEnabled && event.touches.length > 0) ||
        event.targetTouches > 0) {
      return; // Still touching
    }

    var touchEndClientX, touchEndClientY;

    if (window.navigator.msPointerEnabled) {
      touchEndClientX = event.pageX;
      touchEndClientY = event.pageY;
    } else {
      touchEndClientX = event.changedTouches[0].clientX;
      touchEndClientY = event.changedTouches[0].clientY;
    }

    var dx = touchEndClientX - touchStartClientX;
    var absDx = Math.abs(dx);

    var dy = touchEndClientY - touchStartClientY;
    var absDy = Math.abs(dy);

    if (Math.max(absDx, absDy) > 10) {
      // Dominant axis wins: (right : left) : (down : up)
      self.emit("move", absDx > absDy ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
    }
  });
};

KeyboardInputManager.prototype.restart = function (event) {
  event.preventDefault();
  this.emit("restart");
};

KeyboardInputManager.prototype.keepPlaying = function (event) {
  event.preventDefault();
  this.emit("keepPlaying");
};

KeyboardInputManager.prototype.undo = function (event) {
  event.preventDefault();
  this.emit("undo");
};

KeyboardInputManager.prototype.confirmBoardSize = function (event) {
  event.preventDefault();
  this.emit("confirmBoardSize", this.lastBoardSize);
};

KeyboardInputManager.prototype.cancelBoardSize = function (event) {
  event.preventDefault();
  this.emit("cancelBoardSize", this.lastBoardSize);
};

KeyboardInputManager.prototype.bindButtonPress = function (selector, fn) {
  var button = document.querySelector(selector);
  button.addEventListener("click", fn.bind(this));
  button.addEventListener(this.eventTouchend, fn.bind(this));
};

// Wires the board-size slider. Dragging updates the readout immediately and
// emits a size change, which is what actually rebuilds the board.
KeyboardInputManager.prototype.bindBoardSize = function (slider) {
  var self = this;
  var readout = document.querySelector(".board-size-value");

  var report = function () {
    var size = parseInt(slider.value, 10);
    if (readout) readout.textContent = size + "\u00d7" + size;
    return size;
  };

  slider.addEventListener("input", function () {
    self.lastBoardSize = report();
  });

  // Only rebuild on release, otherwise a drag would restart the game once
  // per pixel of travel.
  slider.addEventListener("change", function () {
    self.emit("boardSize", report());
  });

  // The slider's initial position and readout are set by the actuator once
  // the game knows what size it is playing on; here we only report drags.
};