// Boot. Wait for the first frame so the initial two tiles animate in
// instead of being painted already in place.
window.requestAnimationFrame(function () {
  new GameManager(4, KeyboardInputManager, HTMLActuator, LocalStorageManager);
});