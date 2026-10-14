/* Soundcheck LED screens (7 x 3.5 m wall, 2:1).
 * Every big-screen page is laid out on a fixed 1920 x 960 canvas (.screen) and
 * scaled to fill the display, so the layout lines up exactly whatever the
 * wall's real resolution is (1920x960, 3840x1920, ...).
 *   ?anchor=top   pin the canvas to the top-left instead of centring it (for LED
 *                 processors that map a 2:1 wall onto the top of a 16:9 input)
 *   F             full screen;  the mouse cursor hides after 2 seconds.
 */
(function () {
  var W = 1920, H = 960;
  var top = /[?&]anchor=top\b/.test(location.search);
  function fit() {
    var el = document.querySelector('.screen');
    if (!el) return;
    var s = Math.min(innerWidth / W, innerHeight / H);
    var x = top ? 0 : (innerWidth - W * s) / 2, y = top ? 0 : (innerHeight - H * s) / 2;
    el.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
    window.SCREEN_SCALE = s;
  }
  window.fitScreen = fit;
  addEventListener('resize', fit);
  document.addEventListener('DOMContentLoaded', fit);
  fit();

  document.addEventListener('keydown', function (e) {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === 'f' || e.key === 'F') {
      if (!document.fullscreenElement) { if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); }
      else if (document.exitFullscreen) document.exitFullscreen();
    }
  });
  var idle;
  function wake() {
    document.documentElement.classList.remove('cursor-off');
    clearTimeout(idle);
    idle = setTimeout(function () { document.documentElement.classList.add('cursor-off'); }, 2000);
  }
  addEventListener('mousemove', wake); wake();
})();
