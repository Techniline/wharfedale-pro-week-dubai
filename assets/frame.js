/* Soundcheck photo frame.
 * Draws a guest photo with the event branding bar beneath it. The frame
 * follows the photo's own shape (portrait stays portrait, landscape stays
 * landscape) so nothing is cropped. Browsers apply the photo's EXIF rotation
 * when decoding, so sideways-shot photos come out upright.
 */
(function () {
  var TEAL = '#0dc0df';
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
          document.fonts.load('900 40px Poppins'),
          document.fonts.load('700 40px Poppins'),
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

  // Speaker-grille texture, the same tile as assets/grille.svg, drawn on a
  // canvas so it needs no extra download. s scales the 34 x 22 tile.
  function grillePattern(ctx, s) {
    var t = document.createElement('canvas');
    t.width = Math.round(34 * s); t.height = Math.round(22 * s);
    var g = t.getContext('2d');
    g.fillStyle = '#080808'; g.fillRect(0, 0, t.width, t.height);
    g.scale(t.width / 34, t.height / 22);
    g.lineJoin = 'round'; g.lineCap = 'round';
    function zig(dy, color, width) {
      g.beginPath();
      g.moveTo(-8.5, 3 + dy); g.lineTo(0, 15 + dy); g.lineTo(8.5, 3 + dy); g.lineTo(17, 15 + dy);
      g.lineTo(25.5, 3 + dy); g.lineTo(34, 15 + dy); g.lineTo(42.5, 3 + dy);
      g.strokeStyle = color; g.lineWidth = width; g.stroke();
    }
    zig(1.5, '#030303', 8);
    zig(0, '#191919', 7);
    zig(-2, '#242424', 2.2);
    return ctx.createPattern(t, 'repeat');
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
      var W = portrait ? 1080 : 1440;
      var ph = Math.round(W * nh / nw);
      var bar = Math.round(W * (portrait ? 0.2 : 0.125));
      var H = ph + bar;

      var c = document.createElement('canvas');
      c.width = W; c.height = H;
      var ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';

      // photo, full and uncropped
      ctx.drawImage(photo, 0, 0, W, ph);

      // ---- bar: the event's speaker grille (as on the website and key art)
      ctx.save();
      ctx.translate(0, ph);
      ctx.fillStyle = grillePattern(ctx, W / 1080 * 1.15);
      ctx.fillRect(0, 0, W, bar);
      ctx.restore();
      // darker towards the bottom, with a faint cyan glow on the right behind the hosted-by block
      var tint = ctx.createLinearGradient(0, ph, 0, H);
      tint.addColorStop(0, 'rgba(0,0,0,0.10)');
      tint.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = tint;
      ctx.fillRect(0, ph, W, bar);
      var glow = ctx.createRadialGradient(W, ph, 0, W, ph, W * 0.55);
      glow.addColorStop(0, 'rgba(13,192,223,0.14)');
      glow.addColorStop(1, 'rgba(13,192,223,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, ph, W, bar);
      // soft fade above the bar so the photo eases into it
      var fade = ctx.createLinearGradient(0, ph - bar * 0.6, 0, ph);
      fade.addColorStop(0, 'rgba(0,0,0,0)');
      fade.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, ph - bar * 0.6, W, bar * 0.6);

      // teal corner brackets on the photo (top corners, like the page's viewfinder)
      var size = W * (portrait ? 0.07 : 0.05), inset = W * 0.03;
      ctx.save();
      ctx.strokeStyle = TEAL; ctx.lineWidth = W * 0.0035; ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = W * 0.008;
      corner(ctx, inset, inset, size, 1, 1, size * 0.25);
      corner(ctx, W - inset, inset, size, -1, 1, size * 0.25);
      ctx.restore();

      // accent line along the top edge of the bar: cyan into Techniline teal
      var line = ctx.createLinearGradient(0, 0, W, 0);
      line.addColorStop(0, TEAL); line.addColorStop(1, '#019298');
      ctx.fillStyle = line;
      ctx.fillRect(0, ph, W, Math.max(3, Math.round(W * 0.0035)));

      var pad = W * 0.045, mid = ph + bar / 2;

      // ---- Wharfedale Pro logo, larger than the bar: the script sits in the bar
      // while the chevron rises over the bottom of the photo
      var lh = bar * (portrait ? 1.08 : 1.25), lw = lh * (logo.naturalWidth || 667) / (logo.naturalHeight || 540);
      var ly = H - bar * 0.1 - lh;
      var lcx = pad + lw / 2, lcy = ly + lh * 0.3;
      var shade = ctx.createRadialGradient(lcx, lcy, 0, lcx, lcy, lw * 0.85);
      shade.addColorStop(0, 'rgba(8,8,8,0.62)');
      shade.addColorStop(0.55, 'rgba(8,8,8,0.3)');
      shade.addColorStop(1, 'rgba(8,8,8,0)');
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

      // ---- SOUNDCHECK, then "2026  WHARFEDALE PRO WEEK - DUBAI", shrunk if it would reach the right block
      var tSize = W * (portrait ? 0.062 : 0.042), ySize = tSize * 0.44, eSize = tSize * 0.25;
      var event = 'WHARFEDALE PRO WEEK ' + dot + ' DUBAI', eSp = eSize * 0.18;
      ctx.font = '900 ' + tSize + 'px Poppins, Manrope, sans-serif';
      var titleW = ctx.measureText('SOUNDCHECK').width;
      ctx.font = '800 ' + ySize + 'px Poppins, Manrope, sans-serif';
      var yearW = ctx.measureText('2026').width;
      ctx.font = '800 ' + eSize + 'px Manrope, Arial, sans-serif';
      var line2W = yearW + tSize * 0.18 + spacedWidth(ctx, event, eSp);
      var room = (right - hostW - W * 0.03) - x;
      var fit = Math.min(1, room / Math.max(titleW, line2W));
      tSize *= fit; ySize *= fit; eSize *= fit; eSp *= fit; yearW *= fit;
      var blockH = tSize * 0.78 + tSize * 0.16 + ySize * 0.78;
      var top = mid - blockH / 2;
      ctx.textBaseline = 'alphabetic';
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = W * 0.006;
      ctx.fillStyle = TEAL;
      ctx.font = '900 ' + tSize + 'px Poppins, Manrope, sans-serif';
      ctx.fillText('SOUNDCHECK', x, top + tSize * 0.78);
      var base2 = top + tSize * 0.78 + tSize * 0.16 + ySize * 0.78;
      ctx.fillStyle = '#d9d9d9';
      ctx.font = '800 ' + ySize + 'px Poppins, Manrope, sans-serif';
      ctx.fillText('2026', x, base2);
      ctx.fillStyle = '#9a9a9a';
      ctx.font = '800 ' + eSize + 'px Manrope, Arial, sans-serif';
      drawSpaced(ctx, event, x + yearW + tSize * 0.18, base2 - (ySize - eSize) * 0.12, eSp);
      ctx.restore();

      // draw the right block, vertically centred in the bar
      var blockR = mSize + gap * 1.6 + hSize + gap + tlh;
      var y0 = mid - blockR / 2;
      ctx.font = '700 ' + mSize + 'px Manrope, Arial, sans-serif';
      ctx.fillStyle = TEAL;
      drawSpaced(ctx, meta, right - metaW, y0 + mSize * 0.8, mSize * 0.16);
      y0 += mSize + gap * 1.6;
      ctx.font = '800 ' + hSize + 'px Manrope, Arial, sans-serif';
      ctx.fillStyle = '#9a9a9a';
      drawSpaced(ctx, label, right - labelW, y0 + hSize * 0.8, spacing);
      y0 += hSize + gap;
      ctx.drawImage(tl, right - tlw, y0, tlw, tlh);

      return { dataUrl: c.toDataURL('image/jpeg', 0.82), w: W, h: H };
    });
  };
})();
