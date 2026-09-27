/* mlviewer.js —— 中心线数据驱动的多实例三维查看器(问题三多级绞合 / 问题二规则绞合共用)
 *
 * 数据契约(window.Q3ML_BRAID 等):{ kind:'ml'|'twist', N, S, period_mm, tube_r_mm,
 *   groups:[N], inner:[N], amps:[N], pts:[N][S][x,y,z](mm) }
 *
 * 着色模式:
 *   ml    : bundle(16 子束色相 × 内级明度)/ current(电流幅值热色)/ copper
 *   twist : ring(按环层)/ current / copper
 * 双后端:WebGL 管几何(three 已由页面全局加载);失败自动降级 2D Canvas 软件渲染。
 */
(function () {
  'use strict';

  var VIRIDIS = [
    [0.267, 0.005, 0.329], [0.267, 0.224, 0.514], [0.194, 0.408, 0.557],
    [0.129, 0.569, 0.549], [0.208, 0.718, 0.475], [0.565, 0.843, 0.263],
    [0.993, 0.906, 0.144]
  ];
  function viridis(t) {
    t = Math.min(1, Math.max(0, t));
    var x = t * (VIRIDIS.length - 1), i = Math.min(VIRIDIS.length - 2, Math.floor(x)), f = x - i;
    var a = VIRIDIS[i], b = VIRIDIS[i + 1];
    return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
  }
  function hot(t) {  // 深蓝→青→黄→红
    t = Math.min(1, Math.max(0, t));
    var stops = [[0.10, 0.15, 0.42], [0.06, 0.55, 0.82], [0.98, 0.86, 0.25], [0.92, 0.22, 0.13]];
    var x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
    var a = stops[i], b = stops[i + 1];
    return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
  }
  function hsl(h, s, l) {
    return 'hsl(' + Math.round(h * 360) + ',' + Math.round(s * 100) + '%,' + Math.round(l * 100) + '%)';
  }

  function mount(data, cfg) {
    var root = document.getElementById(cfg.prefix + 'viewer-panel');
    if (!root) return;
    var stage = root.querySelector('.v-stage');
    var glCanvas = document.getElementById(cfg.prefix + 'gl');
    var loadEl = document.getElementById(cfg.prefix + 'load');
    var pctEl = document.getElementById(cfg.prefix + 'pct');
    var modeEl = document.getElementById(cfg.prefix + 'mode');
    var zLabel = document.getElementById(cfg.prefix + 'z');
    var secCanvas = document.getElementById(cfg.prefix + 'sec');
    if (!stage || !glCanvas || !data) return;

    var N = data.N, S = data.S, Z = data.period_mm, R = data.tube_r_mm;
    var pts = data.pts.map(function (a) {
      var f = new Float32Array(S * 3);
      for (var k = 0; k < S; k++) { f[3*k] = a[k][0]; f[3*k+1] = a[k][1]; f[3*k+2] = a[k][2]; }
      return f;
    });
    var xyMax = 0;
    pts.forEach(function (a) {
      for (var k = 0; k < S; k++) xyMax = Math.max(xyMax, Math.abs(a[3*k]), Math.abs(a[3*k+1]));
    });
    var aMin = Math.min.apply(null, data.amps), aMax = Math.max.apply(null, data.amps);
    var groups = data.groups || [], inner = data.inner || [];
    var gCount = groups.length ? Math.max.apply(null, groups) + 1 : 1;

    var colorMode = cfg.modes[0].key;
    function strandRGB(j) {
      var m = colorMode;
      if (m === 'copper') return [0.72, 0.45, 0.20];
      if (m === 'current') return hot((data.amps[j] - aMin) / (aMax - aMin || 1));
      if (m === 'bundle') { var h = (groups[j] || 0) / gCount; return hslRGB(h, 0.62, 0.46 + (inner[j] || 0) * 0.10); }
      if (m === 'ring') { return viridis((groups[j] || 0) / (gCount - 1 || 1)); }
      return [0.6, 0.6, 0.6];
    }
    function strandCss(j) {
      var c = strandRGB(j);
      if (typeof c === 'string') return c;
      return 'rgb(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')';
    }
    function hslRGB(h, s, l) {
      var c = document.createElement('canvas').getContext('2d');
      c.fillStyle = hsl(h, s, l);
      var m = /(\d+),\s*(\d+)%?,\s*(\d+)%/.exec(c.fillStyle);
      return m ? [m[1] / 255, m[2] / 255, m[3] / 255] : [0.6, 0.6, 0.6];
    }

    var targetZ = cfg.z0 || 8, rotSpeed = 1, scanSpeed = 1, playing = false, done = false;
    function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
    function note(text, keep) {
      if (!loadEl) return;
      loadEl.style.display = 'flex';
      loadEl.innerHTML = '<span class="mono">' + text + '</span>';
      if (!keep) setTimeout(function () { if (done) loadEl.style.display = 'none'; }, 2600);
    }

    /* ---------- 后端 A:WebGL ---------- */
    function startWebGL() {
      var THREE = window.THREE;
      var renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputEncoding = THREE.sRGBEncoding;
      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      camera.position.set.apply(camera, cfg.closeCam.concat([cfg.z0 || 8]));
      scene.add(new THREE.HemisphereLight(0xffffff, 0x30343a, 0.85));
      var key = new THREE.DirectionalLight(0xffffff, 0.7); key.position.set(20, -30, 40); scene.add(key);
      var controls = new THREE.OrbitControls(camera, glCanvas);
      controls.enableDamping = true; controls.dampingFactor = 0.08;
      controls.autoRotate = true; controls.autoRotateSpeed = 0.9;
      controls.target.set(0, 0, cfg.z0 || 8);

      class SampledCurve extends THREE.Curve {
        constructor(arr) { super(); this.arr = arr; }
        getPoint(t, target) {
          target = target || new THREE.Vector3();
          var a = this.arr, x = t * (S - 1), i = Math.min(S - 2, Math.floor(x)), f = x - i;
          target.set(a[3*i] + f * (a[3*i+3] - a[3*i]),
                     a[3*i+1] + f * (a[3*i+4] - a[3*i+1]),
                     a[3*i+2] + f * (a[3*i+5] - a[3*i+2]));
          return target;
        }
      }
      var group = new THREE.Group(); scene.add(group);
      var meshes = [], mats = [], built = 0, fatal = false;
      function fillColors(j) {
        var geo = meshes[j].geometry, pos = geo.attributes.position, col = geo.attributes.color;
        if (!col) { col = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3); geo.setAttribute('color', col); }
        var c = strandRGB(j);
        if (typeof c === 'string') { var m = /(\d+),\s*(\d+),\s*(\d+)/.exec(c); c = m ? [m[1]/255, m[2]/255, m[3]/255] : [0.6,0.6,0.6]; }
        for (var k = 0; k < pos.count; k++) col.setXYZ(k, c[0], c[1], c[2]);
        col.needsUpdate = true;
      }
      function applyColors() { for (var j = 0; j < meshes.length; j++) fillColors(j); }
      var lastB = -1, lastP = Date.now();
      var wd = setInterval(function () {
        if (fatal) { clearInterval(wd); return; }
        if (built !== lastB) { lastB = built; lastP = Date.now(); return; }
        if (Date.now() - lastP > 8000) { clearInterval(wd); failOver('构建停滞(' + built + '/' + N + ')'); }
      }, 1000);
      function buildBatch() {
        if (fatal) return;
        try {
          var end = Math.min(N, built + 16);
          for (; built < end; built++) {
            var geo = new THREE.TubeGeometry(new SampledCurve(pts[built]), 180, R, 6, false);
            var mat = new THREE.MeshStandardMaterial({ metalness: 0.45, roughness: 0.5, color: 0xffffff, vertexColors: true });
            var mesh = new THREE.Mesh(geo, mat);
            mats.push(mat); meshes.push(mesh); group.add(mesh); fillColors(built);
          }
          if (pctEl) pctEl.textContent = Math.round(built / N * 100) + '%';
          if (built < N) { requestAnimationFrame(buildBatch); return; }
          clearInterval(wd);
          if (loadEl) loadEl.style.display = 'none';
          done = true;
        } catch (e) { failOver('几何构建异常:' + e.message); }
      }
      function failOver(reason) {
        if (fatal) return; fatal = true; clearInterval(wd);
        try { controls.dispose(); renderer.dispose(); } catch (e2) {}
        startSoftware(reason);
      }
      glCanvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); failOver('上下文丢失'); });
      function resize() {
        var box = stage.getBoundingClientRect();
        if (box.width < 4) return;
        renderer.setSize(box.width, box.height, false);
        camera.aspect = box.width / box.height; camera.updateProjectionMatrix();
      }
      var raf = 0;
      (function tick() {
        if (fatal) return;
        raf = requestAnimationFrame(tick);
        try { controls.update(); renderer.render(scene, camera); } catch (e) {}
      })();
      resize(); window.addEventListener('resize', resize);
      requestAnimationFrame(buildBatch);
      if (modeEl) modeEl.textContent = 'WebGL';
      return {
        setAutoRotate: function (on) { controls.autoRotate = on; },
        setRot: function () { controls.autoRotateSpeed = 0.9 * rotSpeed; },
        setView: function (z, pos) {
          controls.target.set(0, 0, z);
          if (pos) camera.position.set(pos[0], pos[1], z);
        },
        moveZ: function (dz) { controls.target.z += dz; camera.position.z += dz; },
        applyColors: applyColors
      };
    }

    /* ---------- 后端 B:2D 软件渲染 ---------- */
    function startSoftware(reason) {
      done = true;
      if (loadEl) loadEl.style.display = 'none';
      var cv = document.createElement('canvas');
      glCanvas.parentNode.replaceChild(cv, glCanvas);
      var ctx = cv.getContext('2d');
      if (!ctx) return;
      if (modeEl) { modeEl.textContent = '软件渲染'; modeEl.title = reason || ''; }
      var yaw = 0.65, pitch = 0.42, dist = cfg.softDist || 14, autoRot = true, drag = null;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      function resize() {
        var box = stage.getBoundingClientRect();
        if (box.width < 4) return;
        cv.width = box.width * dpr; cv.height = box.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      (function tick() {
        requestAnimationFrame(tick);
        if (autoRot) yaw += 0.004 * rotSpeed;
        var w = cv.width / dpr, h = cv.height / dpr;
        ctx.clearRect(0, 0, w, h);
        var f = 2.1 * Math.min(w, h);
        var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        var cx = w / 2, cyy = h / 2;
        ctx.lineCap = 'round';
        for (var j = 0; j < N; j++) {
          var a = pts[j];
          ctx.strokeStyle = strandCss(j);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          var started = false;
          for (var k = 0; k < S; k++) {
            var x = a[3*k], y = a[3*k+1], z = a[3*k+2] - targetZ;
            var X = x*cy - y*sy, Y = x*sy + y*cy;
            var Y2 = Y*cp - z*sp, Z2 = Y*sp + z*cp, wD = Z2 + dist;
            if (wD < 0.5) { started = false; continue; }
            var px = cx + f*X/wD, py = cyy - f*Y2/wD;
            if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      })();
      cv.addEventListener('pointerdown', function (e) {
        drag = { x: e.clientX, y: e.clientY, yaw: yaw, pitch: pitch };
        try { cv.setPointerCapture(e.pointerId); } catch (e2) {}
      });
      cv.addEventListener('pointermove', function (e) {
        if (!drag) return;
        yaw = drag.yaw - (e.clientX - drag.x) * 0.008;
        pitch = Math.max(-1.35, Math.min(1.35, drag.pitch + (e.clientY - drag.y) * 0.008));
      });
      cv.addEventListener('pointerup', function () { drag = null; });
      cv.addEventListener('wheel', function (e) {
        e.preventDefault();
        dist = Math.max(4, Math.min(600, dist * (e.deltaY > 0 ? 1.12 : 0.89)));
      }, { passive: false });
      resize(); window.addEventListener('resize', resize);
      if (reason) note('已切换软件渲染:' + reason);
      return {
        setAutoRotate: function (on) { autoRot = on; },
        setRot: function () { },
        setView: function (z) { targetZ = z; if (dist < 90) dist = 100; drawSection(); },
        moveZ: function () { },
        applyColors: function () { }
      };
    }

    /* ---------- 2D 截面 ---------- */
    var secCtx = secCanvas ? secCanvas.getContext('2d') : null;
    function drawSection() {
      if (!secCtx) return;
      var w = secCanvas.width, h = secCanvas.height;
      var scale = w / (xyMax * 2.3), cx = w / 2, cy = h / 2;
      secCtx.clearRect(0, 0, w, h);
      secCtx.fillStyle = css('--surface') || '#1a1a19';
      secCtx.fillRect(0, 0, w, h);
      secCtx.strokeStyle = css('--grid') || '#2c2c2a';
      secCtx.lineWidth = 1;
      for (var g = -2; g <= 2; g++) {
        secCtx.beginPath(); secCtx.moveTo(cx + g * scale, 0); secCtx.lineTo(cx + g * scale, h); secCtx.stroke();
        secCtx.beginPath(); secCtx.moveTo(0, cy + g * scale); secCtx.lineTo(w, cy + g * scale); secCtx.stroke();
      }
      var rr = Math.max(2.4, R * scale);
      for (var j = 0; j < N; j++) {
        var a = pts[j], best = 0, bd = 1e9;
        for (var k = 0; k < S; k++) {
          var d = Math.abs(a[3*k+2] - targetZ);
          if (d < bd) { bd = d; best = k; }
        }
        secCtx.fillStyle = strandCss(j);
        secCtx.beginPath();
        secCtx.arc(cx + a[3*best] * scale, cy - a[3*best+1] * scale, rr, 0, 6.2832);
        secCtx.fill();
      }
      if (zLabel) zLabel.textContent = targetZ.toFixed(1);
    }

    var backend = null;
    try {
      var probe = document.createElement('canvas');
      if (!probe.getContext('webgl2') && !probe.getContext('webgl')) throw new Error('WebGL 不可用');
      if (!window.THREE) throw new Error('three 未加载');
      backend = startWebGL();
    } catch (e) { backend = startSoftware(e.message); }

    /* ---------- 控件 ---------- */
    var $ = function (id) { return document.getElementById(cfg.prefix + id); };
    function setZ(z) {
      z = Math.max(0, Math.min(Z, z));
      var dz = z - targetZ; targetZ = z;
      if (backend) backend.moveZ(dz);
      var sl = $('-slider'); if (sl) sl.value = String(Math.round(z));
      drawSection();
    }
    var bR = $('-rotate');
    if (bR) bR.addEventListener('click', function () {
      var on = !bR.classList.contains('on');
      bR.classList.toggle('on', on);
      if (backend) backend.setAutoRotate(on);
    });
    var bC = $('-close'), bF = $('-full');
    if (bC) bC.addEventListener('click', function () {
      if (backend) backend.setView(6, cfg.closeCam); setZ(6);
    });
    if (bF) bF.addEventListener('click', function () {
      if (backend) backend.setView(Z / 2, cfg.fullCam); setZ(Z / 2);
    });
    var sel = $('-color');
    if (sel) sel.addEventListener('change', function () {
      colorMode = sel.value;
      if (backend) backend.applyColors();
      drawSection();
    });
    var sRot = $('-rotspeed');
    if (sRot) sRot.addEventListener('change', function () {
      rotSpeed = parseFloat(sRot.value) || 0;
      if (backend) backend.setRot();
    });
    var sScan = $('-scanspeed');
    if (sScan) sScan.addEventListener('change', function () { scanSpeed = parseFloat(sScan.value) || 1; });
    var sl = $('-slider');
    if (sl) sl.addEventListener('input', function () {
      playing = false;
      var b = $('-play'); if (b) { b.classList.remove('on'); b.textContent = '▶ 逐站扫描'; }
      setZ(parseFloat(sl.value));
    });
    var bP = $('-play');
    if (bP) bP.addEventListener('click', function () {
      playing = !playing;
      bP.classList.toggle('on', playing);
      bP.textContent = playing ? '⏸ 暂停' : '▶ 逐站扫描';
      if (playing && targetZ >= Z - 1) setZ(0);
    });
    var lastT = performance.now();
    (function scan(now) {
      requestAnimationFrame(scan);
      var dt = ((now || performance.now()) - lastT) / 1000; lastT = now || performance.now();
      if (!playing) return;
      setZ(targetZ + dt * (Z * scanSpeed / 12));
      if (targetZ >= Z - 0.5) {
        playing = false;
        var b = $('-play'); if (b) { b.classList.remove('on'); b.textContent = '▶ 逐站扫描'; }
      }
    })(performance.now());
    window.addEventListener('themechange', drawSection);
    drawSection();
  }

  window.MountMLViewer = mount;
})();
