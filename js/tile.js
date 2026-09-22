// A single number on the board. Knows nothing about the DOM.
function Tile(position, value) {
  this.x = position.x;
  this.y = position.y;
  this.value = value || 2;

  // Where the tile was before the current move, used to animate the slide.
  this.previousPosition = null;
  // When two tiles merge, the result remembers both parents so the two of
  // them can be drawn underneath during the merge animation.
  this.mergedFrom = null;
}

Tile.prototype.savePosition = function () {
  this.previousPosition = { x: this.x, y: this.y };
};

Tile.prototype.updatePosition = function (position) {
  this.x = position.x;
  this.y = position.y;
};

Tile.prototype.serialize = function () {
  return {
    position: { x: this.x, y: this.y },
    value: this.value
  };
};