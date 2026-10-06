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

  // Cheap, cross-browser blur (canvas ctx.filter isn't available on older iOS):
  // shrink the region a lot, then scale it back up with smoothing.
  function softBlur(src, sx, sy, sw, sh, dw, dh) {
    var s1 = document.createElement('canvas');
    s1.width = Math.max(8, Math.round(dw / 28)); s1.height = Math.max(4, Math.round(dh / 28));
    var c1 = s1.getContext('2d');
    c1.imageSmoothingQuality = 'high';
    c1.drawImage(src, sx, sy, sw, sh, 0, 0, s1.width, s1.height);
    var s2 = document.createElement('canvas');
    s2.width = Math.round(dw / 7); s2.height = Math.max(4, Math.round(dh / 7));
    var c2 = s2.getContext('2d');
    c2.imageSmoothingQuality = 'high';
    c2.drawImage(s1, 0, 0, s2.width, s2.height);
    return s2;
  }

  // "14 OCT 2026" and "10:43 PM" in Dubai time, whatever the phone's own time zone
  function dubaiStamp(d, sep) {
    try {
      var day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' }).format(d);
      var time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' }).format(d);
      return (day + sep + time).toUpperCase();
    } catch (e) {
      var months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      var h = d.getHours(), m = d.getMinutes();
      return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() + sep +
        ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM');
    }
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
      ctx.imageSmoothingQuality = 'high';

      // photo, full and uncropped
      ctx.drawImage(photo, 0, 0, W, ph);

      // ---- glass bar: the bottom of the photo continues underneath, mirrored and blurred
      var stripH = Math.min(ph, bar * 1.4);
      var glass = softBlur(c, 0, ph - stripH, W, stripH, W, bar);
      ctx.save();
      ctx.translate(0, ph + bar);
      ctx.scale(1, -1); // mirror so the colours flow straight on from the photo's edge
      ctx.drawImage(glass, 0, 0, W, bar);
      ctx.restore();
      var tint = ctx.createLinearGradient(0, ph, 0, H);
      tint.addColorStop(0, 'rgba(3,12,11,0.50)');
      tint.addColorStop(1, 'rgba(3,10,9,0.86)');
      ctx.fillStyle = tint;
      ctx.fillRect(0, ph, W, bar);
      var glow = ctx.createRadialGradient(0, H, 0, 0, H, W * 0.7);
      glow.addColorStop(0, 'rgba(23,230,196,0.20)');
      glow.addColorStop(1, 'rgba(23,230,196,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, ph, W, bar);
      // soft fade above the bar so there's no hard edge
      var fade = ctx.createLinearGradient(0, ph - bar * 0.55, 0, ph);
      fade.addColorStop(0, 'rgba(3,12,11,0)');
      fade.addColorStop(1, 'rgba(3,12,11,0.42)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, ph - bar * 0.55, W, bar * 0.55);

      // teal corner brackets on the photo (top corners, like the page's viewfinder)
      var size = W * (portrait ? 0.07 : 0.05), inset = W * 0.03;
      ctx.save();
      ctx.strokeStyle = TEAL; ctx.lineWidth = W * 0.0035; ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = W * 0.008;
      corner(ctx, inset, inset, size, 1, 1, size * 0.25);
      corner(ctx, W - inset, inset, size, -1, 1, size * 0.25);
      ctx.restore();

      // ---- sound-wave accent along the top edge of the bar (fades out at both ends)
      function wave(amp, period, phase, width, alpha, glowPx) {
        ctx.save();
        ctx.beginPath();
        for (var px = 0; px <= W; px += 4) {
          var env = Math.pow(Math.sin(Math.PI * px / W), 0.7);
          var py = ph + amp * env * Math.sin(px / period * Math.PI * 2 + phase);
          if (px === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = 'rgba(23,230,196,' + alpha + ')';
        ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        if (glowPx) { ctx.shadowColor = 'rgba(23,230,196,0.9)'; ctx.shadowBlur = glowPx; }
        ctx.stroke();
        ctx.restore();
      }
      wave(bar * 0.11, W / 4.2, 1.3, Math.max(1.5, W * 0.0014), 0.35, 0);
      wave(bar * 0.075, W / 7, 0, Math.max(2, W * 0.0024), 0.95, W * 0.008);

      var pad = W * 0.045, mid = ph + bar / 2;

      // ---- Wharfedale Pro logo, larger than the bar: the script sits in the bar
      // while the chevron rises over the bottom of the photo (and over the wave)
      var lh = bar * (portrait ? 1.08 : 1.25), lw = lh * (logo.naturalWidth || 667) / (logo.naturalHeight || 540);
      var ly = H - bar * 0.1 - lh;
      var lcx = pad + lw / 2, lcy = ly + lh * 0.3;
      var shade = ctx.createRadialGradient(lcx, lcy, 0, lcx, lcy, lw * 0.85);
      shade.addColorStop(0, 'rgba(4,8,7,0.62)');
      shade.addColorStop(0.55, 'rgba(4,8,7,0.3)');
      shade.addColorStop(1, 'rgba(4,8,7,0)');
      ctx.fillStyle = shade;
      ctx.fillRect(lcx - lw, lcy - lw, lw * 2, lw * 2);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = W * 0.012; ctx.shadowOffsetY = W * 0.002;
      ctx.drawImage(logo, pad, ly, lw, lh);
      ctx.restore();
      var x = pad + lw + W * 0.026;

      // divider
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(x, mid - bar * 0.25, Math.max(1, W * 0.0015), bar * 0.5);
      x += W * 0.026;

      // ---- right block: "14 OCT 2026 / 10:43 PM", HOSTED BY, Techniline
      var dot = String.fromCharCode(183); // middle dot, kept as a code so the file stays ASCII
      var meta = dubaiStamp(new Date(), '  ' + dot + '  ');
      var hSize = W * (portrait ? 0.016 : 0.0115), mSize = hSize * 1.05;
      var tlh = W * (portrait ? 0.032 : 0.024), tlw = tlh * tl.naturalWidth / tl.naturalHeight;
      var right = W - pad, gap = W * 0.008;
      var spacing = hSize * 0.25, label = 'HOSTED BY';
      ctx.font = '800 ' + hSize + 'px Manrope, Arial, sans-serif';
      var labelW = spacedWidth(ctx, label, spacing);
      ctx.font = '700 ' + mSize + 'px Manrope, Arial, sans-serif';
      var metaW = spacedWidth(ctx, meta, mSize * 0.16);
      var hostW = Math.max(tlw, labelW, metaW);

      // ---- Soundcheck / Wharfedale Pro Week - Dubai, shrunk if it would reach the right block
      var tSize = W * (portrait ? 0.06 : 0.04), sSize = W * (portrait ? 0.0285 : 0.021);
      var sub = 'Wharfedale Pro Week ' + dot + ' Dubai';
      ctx.font = 'italic 400 ' + sSize + 'px Fraunces, Georgia, serif';
      var subW = ctx.measureText(sub).width;
      ctx.font = '400 ' + tSize + 'px Fraunces, Georgia, serif';
      var room = (right - hostW - W * 0.03) - x;
      var fit = Math.min(1, room / Math.max(subW, ctx.measureText('Soundcheck').width));
      tSize *= fit; sSize *= fit;
      var blockH = tSize * 0.95 + W * 0.006 + sSize;
      var top = mid - blockH / 2;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ffffff';
      ctx.font = '400 ' + tSize + 'px Fraunces, Georgia, serif';
      ctx.fillText('Soundcheck', x, top + tSize * 0.78);
      ctx.font = 'italic 400 ' + sSize + 'px Fraunces, Georgia, serif';
      var sw = ctx.measureText(sub).width;
      var grad = ctx.createLinearGradient(x, 0, x + sw, 0);
      grad.addColorStop(0, '#8ff5e3'); grad.addColorStop(0.45, TEAL); grad.addColorStop(1, '#00a693');
      ctx.fillStyle = grad;
      ctx.fillText(sub, x, top + tSize * 0.95 + W * 0.006 + sSize * 0.8);

      // draw the right block, vertically centred in the bar
      var blockR = mSize + gap * 1.6 + hSize + gap + tlh;
      var y0 = mid - blockR / 2;
      ctx.font = '700 ' + mSize + 'px Manrope, Arial, sans-serif';
      ctx.fillStyle = '#8ff5e3';
      drawSpaced(ctx, meta, right - metaW, y0 + mSize * 0.8, mSize * 0.16);
      y0 += mSize + gap * 1.6;
      ctx.font = '800 ' + hSize + 'px Manrope, Arial, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      drawSpaced(ctx, label, right - labelW, y0 + hSize * 0.8, spacing);
      y0 += hSize + gap;
      ctx.drawImage(tl, right - tlw, y0, tlw, tlh);

      return { dataUrl: c.toDataURL('image/jpeg', 0.88), w: W, h: H };
    });
  };
})();
