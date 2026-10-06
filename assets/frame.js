/* Soundcheck photo frame.
 * Draws a guest photo with the event branding bar beneath it. The frame
 * follows the photo's own shape (portrait stays portrait, landscape stays
 * landscape) so nothing is cropped. Browsers apply the photo's EXIF rotation
 * when decoding, so sideways-shot photos come out upright.
 */
(function () {
  var TEAL = '#17e6c4';
  var assets = null;

  function loadImg(src) {
    return new Promise(function (res, rej) {
      var i = new Image();
      i.onload = function () { res(i); };
      i.onerror = rej;
      i.src = src;
    });
  }

  function loadAssets() {
    if (!assets) {
      assets = Promise.all([
        loadImg('assets/wharfedale-pro.svg'),
        loadImg('assets/techniline.png'),
        document.fonts ? Promise.all([
          document.fonts.load('400 40px Fraunces'),
          document.fonts.load('italic 400 40px Fraunces'),
          document.fonts.load('800 20px Manrope')
        ]) : null
      ]);
    }
    return assets;
  }

  // Letter-spaced text without relying on ctx.letterSpacing (missing on older iOS)
  function spacedWidth(ctx, text, spacing) {
    var w = 0;
    for (var i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width + (i < text.length - 1 ? spacing : 0);
    return w;
  }
  function drawSpaced(ctx, text, x, y, spacing) {
    for (var i = 0; i < text.length; i++) {
      ctx.fillText(text[i], x, y);
      x += ctx.measureText(text[i]).width + spacing;
    }
  }

  function corner(ctx, x, y, size, dx, dy, r) {
    // An L-shaped bracket with a rounded elbow at (x, y), arms pointing (dx, dy)
    ctx.beginPath();
    ctx.moveTo(x + dx * size, y);
    ctx.lineTo(x + dx * r, y);
    ctx.quadraticCurveTo(x, y, x, y + dy * r);
    ctx.lineTo(x, y + dy * size);
    ctx.stroke();
  }

  /** Returns a Promise of { dataUrl, w, h } for the branded JPEG. */
  window.makeSoundcheckFrame = function (photo) {
    return loadAssets().then(function (a) {
      var logo = a[0], tl = a[1];
      var nw = photo.naturalWidth, nh = photo.naturalHeight;
      var portrait = nh > nw;
      var W = portrait ? 1440 : 2048;
      var ph = Math.round(W * nh / nw);
      var bar = Math.round(W * (portrait ? 0.2 : 0.125));
      var H = ph + bar;

      var c = document.createElement('canvas');
      c.width = W; c.height = H;
      var ctx = c.getContext('2d');

      // photo, full and uncropped
      ctx.drawImage(photo, 0, 0, W, ph);

      // teal corner brackets on the photo (top corners, like the page's viewfinder)
      var size = W * (portrait ? 0.07 : 0.05), inset = W * 0.03;
      ctx.save();
      ctx.strokeStyle = TEAL; ctx.lineWidth = W * 0.0035; ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = W * 0.008;
      corner(ctx, inset, inset, size, 1, 1, size * 0.25);
      corner(ctx, W - inset, inset, size, -1, 1, size * 0.25);
      ctx.restore();

      // branding bar
      ctx.fillStyle = '#070b0a';
      ctx.fillRect(0, ph, W, bar);
      var glow = ctx.createRadialGradient(0, H, 0, 0, H, W * 0.7);
      glow.addColorStop(0, 'rgba(23,230,196,0.18)');
      glow.addColorStop(1, 'rgba(23,230,196,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, ph, W, bar);
      ctx.fillStyle = 'rgba(23,230,196,0.6)';
      ctx.fillRect(0, ph, W, Math.max(2, Math.round(W * 0.0025)));

      var pad = W * 0.045, mid = ph + bar / 2;

      // Wharfedale Pro logo
      var lh = bar * 0.68, lw = lh * (logo.naturalWidth || 667) / (logo.naturalHeight || 540);
      ctx.drawImage(logo, pad, mid - lh / 2, lw, lh);
      var x = pad + lw + W * 0.026;

      // divider
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(x, mid - bar * 0.25, Math.max(1, W * 0.0015), bar * 0.5);
      x += W * 0.026;

      // Soundcheck / Wharfedale Pro Week - Dubai
      var tSize = W * (portrait ? 0.06 : 0.04), sSize = W * (portrait ? 0.0285 : 0.021);
      var blockH = tSize * 0.95 + W * 0.006 + sSize;
      var top = mid - blockH / 2;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ffffff';
      ctx.font = '400 ' + tSize + 'px Fraunces, Georgia, serif';
      ctx.fillText('Soundcheck', x, top + tSize * 0.78);
      ctx.font = 'italic 400 ' + sSize + 'px Fraunces, Georgia, serif';
      // middle dot built from its code so the file stays plain ASCII
      var sub = 'Wharfedale Pro Week ' + String.fromCharCode(183) + ' Dubai';
      var sw = ctx.measureText(sub).width;
      var grad = ctx.createLinearGradient(x, 0, x + sw, 0);
      grad.addColorStop(0, '#8ff5e3'); grad.addColorStop(0.45, TEAL); grad.addColorStop(1, '#00a693');
      ctx.fillStyle = grad;
      ctx.fillText(sub, x, top + tSize * 0.95 + W * 0.006 + sSize * 0.8);

      // Hosted by Techniline, right-aligned
      var hSize = W * (portrait ? 0.019 : 0.0115), tlh = W * (portrait ? 0.038 : 0.024);
      var tlw = tlh * tl.naturalWidth / tl.naturalHeight;
      var right = W - pad;
      ctx.font = '800 ' + hSize + 'px Manrope, Arial, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      var spacing = hSize * 0.25, label = 'HOSTED BY';
      var hb = (hSize + W * 0.008 + tlh);
      drawSpaced(ctx, label, right - spacedWidth(ctx, label, spacing), mid - hb / 2 + hSize * 0.8, spacing);
      ctx.drawImage(tl, right - tlw, mid - hb / 2 + hSize + W * 0.008, tlw, tlh);

      return { dataUrl: c.toDataURL('image/jpeg', 0.88), w: W, h: H };
    });
  };
})();
