/* skinview.js —— 问题一趋肤效应交互演示(纯解析,无依赖)
 * J(r) = C·J0(kr),k=(1−j)/δ;δ=√(2/(ωμσ));Rac/Rdc = Re[ ka·J0(ka) / (2·J1(ka)) ]
 * 复宗量 Bessel 用幂级数(40 项,|ka|≤~10 精度足够)。
 * 校准:200 kHz 时 δ=147.77 μm、Rac/Rdc=3.647(与论文/COMSOL 一致)。
 */
(function () {
  'use strict';
  var SIGMA = 5.8e7, MU0 = 4 * Math.PI * 1e-7, A_MM = 1.0;   // a = 1 mm

  function cabs(re, im) { return Math.hypot(re, im); }
  function cmul(ar, ai, br, bi) { return [ar * br - ai * bi, ar * bi + ai * br]; }
  function cdiv(ar, ai, br, bi) { var d = br * br + bi * bi; return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d]; }
  // J0(z)、J1(z) 幂级数(z 为复数,返回 [re, im])
  function J0(zr, zi) {
    // Σ (−1)^m (z²/4)^m / (m!)²
    var sr = 1, si = 0, termr = 1, termi = 0;
    var q = cmul(zr, zi, zr, zi); q[0] /= 4; q[1] /= 4;   // z²/4
    for (var m = 1; m < 60; m++) {
      var t = cmul(termr, termi, q[0], q[1]);
      var f = m * m;
      termr = -t[0] / f; termi = -t[1] / f;
      sr += termr; si += termi;
      if (cabs(termr, termi) < 1e-14 * cabs(sr, si)) break;
    }
    return [sr, si];
  }
  function J1(zr, zi) {
    // Σ (−1)^m (z/2)^{2m+1} / (m!(m+1)!)
    var h = [zr / 2, zi / 2];
    var termr = h[0], termi = h[1], sr = h[0], si = h[1];
    var q = cmul(zr, zi, zr, zi); q[0] /= 4; q[1] /= 4;
    for (var m = 1; m < 60; m++) {
      var t = cmul(termr, termi, q[0], q[1]);
      var f = m * (m + 1);
      termr = -t[0] / f; termi = -t[1] / f;
      sr += termr; si += termi;
      if (cabs(termr, termi) < 1e-14 * cabs(sr, si)) break;
    }
    return [sr, si];
  }
  function deltaMM(fHz) { return Math.sqrt(2 / (2 * Math.PI * fHz * MU0 * SIGMA)) * 1000; }
  function racRatio(fHz) {
    var d = deltaMM(fHz), ka = [(1 / d) * A_MM, (-1 / d) * A_MM];
    var num = cmul(ka[0], ka[1], 0, 0);                     // ka·J0(ka) 先算 ka²? 不——直接:
    var j0 = J0(ka[0], ka[1]), j1 = J1(ka[0], ka[1]);
    var kzj0 = cmul(ka[0], ka[1], j0[0], j0[1]);            // ka·J0(ka)
    var rat = cdiv(kzj0[0], kzj0[1], 2 * j1[0], 2 * j1[1]); // /(2J1)
    return rat[0];                                          // 取实部
  }
  function jNorm(rmm, fHz) {                                // |J(r)|/|J(a)|
    var d = deltaMM(fHz);
    var k = [1 / d, -1 / d];
    var inner = cmul(k[0] * rmm, k[1] * rmm, 1, 0);         // 占位
    var arg = [k[0] * rmm, k[1] * rmm];
    var cj = J0(arg[0], arg[1]);
    var ca = J0(k[0] * A_MM, k[1] * A_MM);
    return cabs(cj[0], cj[1]) / cabs(ca[0], ca[1]) || 1e-12;
  }
  // 颜色:深蓝(0)→青→黄→红(1),对数压缩
  function heat(t) {
    var stops = [[0.05, 0.08, 0.28], [0.06, 0.50, 0.78], [0.97, 0.85, 0.25], [0.95, 0.25, 0.12]];
    t = Math.min(1, Math.max(0, t));
    var x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
    var a = stops[i], b = stops[i + 1];
    return 'rgb(' + Math.round((a[0] + f * (b[0] - a[0])) * 255) + ',' +
      Math.round((a[1] + f * (b[1] - a[1])) * 255) + ',' +
      Math.round((a[2] + f * (b[2] - a[2])) * 255) + ')';
  }
  function cssv(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  var disc = document.getElementById('skin-disc');
  var curve = document.getElementById('skin-curve');
  var slider = document.getElementById('skin-f');
  var out = document.getElementById('skin-out');
  if (!disc || !curve) return;
  var dctx = disc.getContext('2d'), cctx = curve.getContext('2d');

  function drawDisc(f) {
    var w = disc.width, h = disc.height, cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 8;
    dctx.clearRect(0, 0, w, h);
    dctx.fillStyle = cssv('--surface') || '#1a1a19';
    dctx.fillRect(0, 0, w, h);
    var d = deltaMM(f);
    for (var px = 0; px < w; px += 2) {
      for (var py = 0; py < h; py += 2) {
        var dx = (px - cx) / R * A_MM, dy = (py - cy) / R * A_MM;
        var r = Math.hypot(dx, dy);
        if (r > A_MM) continue;
        var t = jNorm(r, f);
        t = Math.log10(1 + 999 * t) / 3;                     // 对数增强对比
        dctx.fillStyle = heat(t);
        dctx.fillRect(px, py, 2, 2);
      }
    }
    // 趋肤深度环
    var dr = Math.max(1 - d / A_MM, 0) * R;
    dctx.strokeStyle = 'rgba(255,255,255,0.9)';
    dctx.setLineDash([5, 4]); dctx.lineWidth = 1.5;
    dctx.beginPath(); dctx.arc(cx, cy, Math.max(dr, 2), 0, 6.2832); dctx.stroke();
    dctx.setLineDash([]);
    dctx.fillStyle = cssv('--ink-2') || '#c3c2b7';
    dctx.font = '11px ui-monospace, Menlo, monospace';
    dctx.fillText('δ = ' + (d * 1000).toFixed(1) + ' μm', cx + 6, cy - R + 14);
    dctx.fillText('r = 0', cx - 12, cy + 4);
  }

  function drawCurve(f) {
    var w = curve.width, h = curve.height;
    cctx.clearRect(0, 0, w, h);
    cctx.fillStyle = cssv('--surface') || '#1a1a19';
    cctx.fillRect(0, 0, w, h);
    var ml = 34, mb = 22, mt = 10, mr = 8;
    var gw = w - ml - mr, gh = h - mt - mb;
    cctx.strokeStyle = cssv('--grid') || '#2c2c2a';
    for (var i = 0; i <= 4; i++) {
      var y = mt + gh * i / 4;
      cctx.beginPath(); cctx.moveTo(ml, y); cctx.lineTo(w - mr, y); cctx.stroke();
    }
    cctx.strokeStyle = cssv('--accent') || '#3987e5';
    cctx.lineWidth = 2;
    cctx.beginPath();
    for (var k = 0; k <= 200; k++) {
      var r = k / 200;
      var v = jNorm(r * A_MM, f);
      var ly = Math.max(1e-4, v);
      var ylog = Math.log10(ly / 1e-4) / 4;                  // 1e-4..1 对数
      var px = ml + gw * r, py = mt + gh * (1 - Math.min(1, Math.max(0, ylog)));
      if (k === 0) cctx.moveTo(px, py); else cctx.lineTo(px, py);
    }
    cctx.stroke();
    // δ 竖线
    var d = deltaMM(f) / A_MM;
    cctx.strokeStyle = 'rgba(255,255,255,0.8)';
    cctx.setLineDash([4, 4]);
    cctx.beginPath(); cctx.moveTo(ml + gw * (1 - d), mt); cctx.lineTo(ml + gw * (1 - d), mt + gh); cctx.stroke();
    cctx.setLineDash([]);
    cctx.fillStyle = cssv('--muted') || '#898781';
    cctx.font = '11px ui-monospace, Menlo, monospace';
    cctx.fillText('|J(r)|/|J(a)|(对数)', ml, mt + 10);
    cctx.fillText('r/a: 0 → 1', ml, h - 8);
  }

  function fmtF(f) { return f >= 1e6 ? (f / 1e6).toFixed(2) + ' MHz' : (f / 1e3).toFixed(0) + ' kHz'; }
  function update() {
    var f = Math.pow(10, parseFloat(slider.value));          // log 滑杆
    drawDisc(f); drawCurve(f);
    var d = deltaMM(f), ratio = racRatio(f);
    out.innerHTML =
      '<div class="sk-row"><span>f = <b class="num">' + fmtF(f) + '</b></span>' +
      '<span>δ = <b class="num">' + (d * 1000).toFixed(1) + ' μm</b></span>' +
      '<span>a/δ = <b class="num">' + (A_MM / d).toFixed(2) + '</b></span>' +
      '<span>R<sub>ac</sub>/R<sub>dc</sub> = <b class="num">' + ratio.toFixed(3) + '</b></span></div>';
  }
  if (slider) slider.addEventListener('input', update);
  window.addEventListener('themechange', update);
  update();
})();
