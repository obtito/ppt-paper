/* q3-viewer.js —— 问题三 484 股完整换位编织的交互式三维查看器(双后端 + 自愈)
 *
 * 数据:window.Q3_BRAID(data/q3-braid.js,源自 litz_topology_explanation/render_data.json)
 *   coeff484[slot] = [[x0,y0],[x1,y1],[x2,y2],[x3,y3]] —— 每槽一条三次多项式(mm)
 *   第 j 股在轴向 z(mm) 处占据槽 idx = floor((j + z/q)) mod N,局部参数 t = frac
 *   x(t) = ((c3·t + c2)·t + c1)·t + c0 —— 与 export_mesh.py 完全一致的求值方式
 *
 * 渲染:优先 WebGL(three r140 UMD);任何阶段失败(上下文不可用 / 几何构建异常 /
 * 渲染异常 / 6 秒无进展)自动切换 2D Canvas 软件渲染,并把原因显示在徽标 title 里。
 */
(function () {
  'use strict';

  var stage = document.querySelector('#q3viewer-panel .v-stage');
  var glCanvas = document.getElementById('q3gl');
  var loadEl = document.getElementById('q3load');
  var pctEl = document.getElementById('q3pct');
  var modeEl = document.getElementById('q3mode');
  var zLabel = document.getElementById('q3z');
  var secCanvas = document.getElementById('q3sec');
  if (!stage || !glCanvas) return;

  function setBadge(mode, reason) {
    if (!modeEl) return;
    modeEl.textContent = mode;
    if (reason) { modeEl.title = reason; console.warn('[q3-viewer]', reason); }
  }
  function note(text, keep) {
    if (!loadEl) return;
    loadEl.style.display = 'flex';
    loadEl.innerHTML = '<span class="mono">' + text + '</span>';
    if (!keep) setTimeout(function () { loadEl.style.display = 'none'; }, 3200);
  }
  // 任何未捕获脚本错误都浮出到加载层,不再静默卡死
  window.addEventListener('error', function (e) {
    if (backendDone) return;
    note('脚本异常:' + (e.message || 'unknown'), true);
  });

  var D = window.Q3_BRAID;
  if (!D) { note('轨迹数据(data/q3-braid.js)未加载', true); return; }
  if (!window.THREE) { startSoftware('three.js 未加载,直接软件渲染'); return; }

  var P = D.parameters;
  var N = P.N, C = D.coeff484, q = P.station_advance_mm, Z_TOTAL = P.period_mm;
  var R_TUBE = P.diameter_um / 2000;
  var LOOP = (P.closeup && P.closeup.loop_indices) || [462, 463];

  /* ---------- 三种拓扑的轨迹生成 ----------
   * full : 完整换位 —— COMSOL 实测 484 股轨迹(coeff484 原始数据)
   * rigid: 整体扭转(演示) —— 槽位固定 + 整体旋转(周期 250 mm,对应 Q3 对照设置)
   * shell: 壳层交换(演示) —— 槽位在各自方格网壳层内逐站位轮换,径向履历固定
   * 演示拓扑共用实测槽位布局,用于教学对照,非 N=400 实际求解几何 */
  var TOPO = 'full';
  var SLOT_POS = C.map(function (c) { return [c[0][0], c[0][1]]; });   // 每槽静态坐标(mm)
  var GRID_SP = P.grid_spacing_um / 1000;
  var SHELLS = [];
  (function () {
    var map = {};
    for (var s = 0; s < N; s++) {
      var sh = Math.round(Math.max(Math.abs(SLOT_POS[s][0]), Math.abs(SLOT_POS[s][1])) / GRID_SP);
      (map[sh] = map[sh] || []).push(s);
    }
    Object.keys(map).map(Number).sort(function (a, b) { return a - b; }).forEach(function (sh) {
      map[sh].sort(function (a, b) {
        return Math.atan2(SLOT_POS[a][1], SLOT_POS[a][0]) - Math.atan2(SLOT_POS[b][1], SLOT_POS[b][0]);
      });
      SHELLS.push(map[sh]);
    });
  })();
  var shellOf = new Array(N), posInShell = new Array(N);
  SHELLS.forEach(function (L, si) {
    L.forEach(function (s, i) { shellOf[s] = si; posInShell[s] = i; });
  });
  var TWIST_PERIOD = 250;   // 整体扭转演示周期(mm)

  function strandXYtopo(j, z) {
    if (TOPO === 'full') return strandXY(j, z);
    if (TOPO === 'rigid') {
      var p = SLOT_POS[j], a = 2 * Math.PI * z / TWIST_PERIOD;
      var ca = Math.cos(a), sa = Math.sin(a);
      return [p[0] * ca - p[1] * sa, p[0] * sa + p[1] * ca];
    }
    var L = SHELLS[shellOf[j]] || [j];
    var k = (posInShell[j] + Math.floor(z / q)) % L.length;
    return [SLOT_POS[L[k]][0], SLOT_POS[L[k]][1]];
  }

  /* ---------- 槽位渐变:viridis 按股号渐变 + 温和循环 ----------
   * CYCLES=色谱在整束内扫过的次数:1=上一版单程,3=当前(增强一点),16=极端版 */
  var VIRIDIS = [
    [0.267, 0.005, 0.329], [0.267, 0.224, 0.514], [0.194, 0.408, 0.557],
    [0.129, 0.569, 0.549], [0.208, 0.718, 0.475], [0.565, 0.843, 0.263],
    [0.993, 0.906, 0.144]
  ];
  var CYCLES = 5;
  function slotRGB(x) {
    var t = ((x / N) * CYCLES % 1 + 1) % 1;   // 循环扫过整段色谱
    var p = t * (VIRIDIS.length - 1), i = Math.min(VIRIDIS.length - 2, Math.floor(p)), f = p - i;
    var a = VIRIDIS[i], b = VIRIDIS[i + 1];
    var c = [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
    // 对比度增强:绕中点拉伸(暗更暗、亮更亮)+ 饱和度提升
    var K = 1.35, SAT = 1.25, out = [];
    for (var m = 0; m < 3; m++) out.push(Math.min(1, Math.max(0, 0.5 + (c[m] - 0.5) * K)));
    var l = 0.299 * out[0] + 0.587 * out[1] + 0.114 * out[2];
    return [Math.min(1, Math.max(0, l + (out[0] - l) * SAT)),
            Math.min(1, Math.max(0, l + (out[1] - l) * SAT)),
            Math.min(1, Math.max(0, l + (out[2] - l) * SAT))];
  }
  // 第 j 股在轴向 z 处占用的槽位号
  function slotAt(j, z) { return ((Math.floor(j + z / q) % N) + N) % N; }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  function strandXY(j, z) {
    var u = j + z / q, fl = Math.floor(u), idx = ((fl % N) + N) % N, s = u - fl, c = C[idx];
    return [((c[3][0] * s + c[2][0]) * s + c[1][0]) * s + c[0][0],
            ((c[3][1] * s + c[2][1]) * s + c[1][1]) * s + c[0][1]];
  }

  var colorMode = 'slot', targetZ = 8, playing = false, backendDone = false;
  var rotSpeed = 1, scanSpeed = 1;   // 自转 / 扫描各自独立倍速

  /* ---------- 预采样:每股 S 个 3D 点(mm),拓扑切换时重采样 ---------- */
  var S = 140, pts = [];
  function resample() {
    pts = [];
    for (var j = 0; j < N; j++) {
      var a = new Float32Array(3 * S);
      for (var k = 0; k < S; k++) {
        var z = k / (S - 1) * Z_TOTAL, xy = strandXYtopo(j, z);
        a[3 * k] = xy[0]; a[3 * k + 1] = xy[1]; a[3 * k + 2] = z;
      }
      pts.push(a);
    }
  }
  try { resample(); } catch (e) { note('轨迹采样异常:' + e.message, true); return; }

  var COPPER = '#b87333', DIMC = 'rgba(122,127,134,0.55)', HI_A = '#3987e5', HI_B = '#eb6834';
  var GHOST = 'rgba(148,155,162,0.07)';   // 软件渲染的幽灵描边(更透明)

  // 透视模式高亮集合:等距 6 股 + 换位环路对,共 8 股
  var FOCUS = (function () {
    var set = [], K = 6, step = Math.floor(N / K);
    for (var i = 0; i < K; i++) set.push(i * step);
    set.push(LOOP[0], LOOP[1]);
    return set;
  })();
  function isFocus(j) { return FOCUS.indexOf(j) >= 0; }
  function slotCss(j) {
    var c = slotRGB(j);
    return 'rgb(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')';
  }
  // 2D 截面面板用:透视模式下保持槽位渐变(截面图不变)
  function strandColor(j) {
    if (colorMode === 'copper') return COPPER;
    if (colorMode === 'pair') {
      if (j === LOOP[0]) return HI_A;
      if (j === LOOP[1]) return HI_B;
      return DIMC;
    }
    return slotCss(j);
  }
  // 软件 3D 渲染用:透视模式 = 幽灵股 + 高亮股
  function strandColor3D(j) {
    if (colorMode === 'focus') return isFocus(j) ? slotCss(j) : GHOST;
    return strandColor(j);
  }

  /* ---------- 公共 UI 引用 ---------- */
  var btnRotate = document.getElementById('q3-rotate');
  var btnPlay = document.getElementById('q3-play');
  var btnClose = document.getElementById('q3-close');
  var btnFull = document.getElementById('q3-full');
  var selColor = document.getElementById('q3-color');
  var selRot = document.getElementById('q3-rotspeed');
  var selScan = document.getElementById('q3-scanspeed');
  var selTopo = document.getElementById('q3-topo');
  var slider = document.getElementById('q3-slider');
  var backend = null;

  function setZ(z) {
    z = Math.max(0, Math.min(Z_TOTAL, z));
    var dz = z - targetZ;
    targetZ = z;
    if (backend && backend.moveZ) backend.moveZ(dz);
    if (slider) slider.value = String(Math.round(z));
    drawSection();
  }

  /* ================================================================
   * 后端 A:WebGL
   * ================================================================ */
  function startWebGL() {
    var THREE = window.THREE;
    var renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 4000);
    camera.position.set(7, -11, 8);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x30343a, 0.85));
    var key = new THREE.DirectionalLight(0xffffff, 0.7); key.position.set(20, -30, 40); scene.add(key);
    var rim = new THREE.DirectionalLight(0x88bbff, 0.25); rim.position.set(-30, 20, -10); scene.add(rim);

    var controls = new THREE.OrbitControls(camera, glCanvas);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.autoRotate = true; controls.autoRotateSpeed = 0.9 * rotSpeed;
    controls.target.set(0, 0, targetZ);

    // r140 的 THREE.Curve 是 ES6 类,必须用 class extends 继承(.call() 会抛 TypeError)
    class SampledCurve extends THREE.Curve {
      constructor(arr) { super(); this.arr = arr; }
      getPoint(t, target) {
        target = target || new THREE.Vector3();
        var a = this.arr, x = t * (S - 1), i = Math.min(S - 2, Math.floor(x)), f = x - i;
        target.set(
          a[3 * i] + f * (a[3 * i + 3] - a[3 * i]),
          a[3 * i + 1] + f * (a[3 * i + 4] - a[3 * i + 1]),
          a[3 * i + 2] + f * (a[3 * i + 5] - a[3 * i + 2]));
        return target;
      }
    }

    var group = new THREE.Group(); scene.add(group);
    var mats = [], meshes = [], built = 0, fatal = false;

    // ---- 顶点色:颜色写在几何属性里,模式切换时重填 ----
    var RGB = {
      copper: [0xb8 / 255, 0x73 / 255, 0x33 / 255],
      gray:   [0x9a / 255, 0xa2 / 255, 0xac / 255],
      dim:    [0x5a / 255, 0x61 / 255, 0x68 / 255],
      hiA:    [0x39 / 255, 0x87 / 255, 0xe5 / 255],
      hiB:    [0xeb / 255, 0x68 / 255, 0x34 / 255]
    };
    function fillColors(j, fn) {
      var geo = meshes[j].geometry;
      var pos = geo.attributes.position;
      var col = geo.attributes.color;
      if (!col) {
        col = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
        geo.setAttribute('color', col);
      }
      for (var k = 0; k < pos.count; k++) {
        var c = fn(pos.getZ(k));
        col.setXYZ(k, c[0], c[1], c[2]);
      }
      col.needsUpdate = true;
    }
    function uniformC(rgb) { return function () { return rgb; }; }
    function flowC(j) { return function (z) { return slotRGB(slotAt(j, z)); }; }
    // 看门狗:仅在「无进展」时触发(每批完成即重置),避免慢机器上误杀
    var lastBuilt = -1, lastProgress = Date.now();
    var watchdog = setInterval(function () {
      if (fatal) { clearInterval(watchdog); return; }
      if (built !== lastBuilt) { lastBuilt = built; lastProgress = Date.now(); return; }
      if (Date.now() - lastProgress > 8000) {
        clearInterval(watchdog);
        failOver('WebGL 构建停滞(' + built + '/' + N + ')');
      }
    }, 1000);

    function applyColors() {
      for (var j = 0; j < meshes.length; j++) {
        var m = mats[j];
        var ghost = colorMode === 'focus' && !isFocus(j);   // 透视模式:非高亮股 → 全透明体 + 灰色线框描边
        m.transparent = ghost;
        m.wireframe = ghost;
        m.opacity = ghost ? 0.35 : 1;
        m.depthWrite = !ghost;
        m.emissive.setHex(0);
        if (colorMode === 'slot') {
          fillColors(j, uniformC(slotRGB(j)));                // viridis 按股号固定渐变
        } else if (colorMode === 'copper') {
          fillColors(j, uniformC(RGB.copper));
        } else if (colorMode === 'pair') {
          fillColors(j, uniformC(j === LOOP[0] ? RGB.hiA : j === LOOP[1] ? RGB.hiB : RGB.dim));
        } else {   // focus
          if (ghost) fillColors(j, uniformC(RGB.gray));
          else {
            var c = slotRGB(j);
            fillColors(j, uniformC(c));
            m.emissive.setRGB(c[0] * 0.35, c[1] * 0.35, c[2] * 0.35);   // 高亮股加自发光
          }
        }
      }
    }
    function buildBatch() {
      if (fatal) return;
      try {
        var end = Math.min(N, built + 40);
        for (; built < end; built++) {
          var geo = new THREE.TubeGeometry(new SampledCurve(pts[built]), 110, R_TUBE, 5, false);
          var mat = new THREE.MeshStandardMaterial({ metalness: 0.45, roughness: 0.5, color: 0xffffff, vertexColors: true });
          var mesh = new THREE.Mesh(geo, mat);
          mats.push(mat); meshes.push(mesh);
          group.add(mesh);
          fillColors(built, uniformC(slotRGB(built)));   // 初始槽位渐变(按股号)
        }
        if (pctEl) pctEl.textContent = Math.round(built / N * 100) + '%';
        if (built < N) { requestAnimationFrame(buildBatch); return; }
        clearInterval(watchdog);
        if (loadEl) loadEl.style.display = 'none';
        backendDone = true;
        applyColors();
      } catch (e) { failOver('几何构建异常:' + e.message); }
    }
    function failOver(reason) {
      if (fatal) return;
      fatal = true;
      clearInterval(watchdog);
      // 留给软件后端接管
      cancelAnimationFrame(raf);
      try { controls.dispose(); renderer.dispose(); } catch (e2) {}
      startSoftware(reason);
    }
    glCanvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault(); failOver('WebGL 上下文丢失');
    });

    function resize() {
      var box = stage.getBoundingClientRect();
      if (box.width < 4 || box.height < 4) return;
      renderer.setSize(box.width, box.height, false);
      camera.aspect = box.width / box.height;
      camera.updateProjectionMatrix();
    }
    var raf = 0, renderFails = 0;
    function tick() {
      if (fatal) return;
      raf = requestAnimationFrame(tick);
      try {
        controls.update();
        renderer.render(scene, camera);
        renderFails = 0;
      } catch (e) {
        if (++renderFails > 3) failOver('渲染异常:' + e.message);
      }
    }

    resize();
    window.addEventListener('resize', resize);
    requestAnimationFrame(buildBatch);
    requestAnimationFrame(tick);
    setBadge('WebGL');
    // 拓扑切换:清空旧几何并重建
    function rebuildAll() {
      if (fatal) return;
      for (var i = 0; i < meshes.length; i++) {
        group.remove(meshes[i]);
        meshes[i].geometry.dispose();
      }
      meshes = []; mats = []; built = 0;
      if (loadEl) {
        loadEl.style.display = 'flex';
        loadEl.innerHTML = '<span class="mono">构建 484 股几何</span><b id="q3pct" class="mono">0%</b>';
        pctEl = document.getElementById('q3pct');
      }
      requestAnimationFrame(buildBatch);
    }
    return {
      setAutoRotate: function (on) { controls.autoRotate = on; },
      setRotSpeed: function () { controls.autoRotateSpeed = 0.9 * rotSpeed; },
      setView: function (z, pos) {
        controls.target.set(0, 0, z);
        if (pos) camera.position.set(pos[0], pos[1], z);
      },
      moveZ: function (dz) { controls.target.z += dz; camera.position.z += dz; },
      applyColors: applyColors,
      rebuild: rebuildAll
    };
  }

  /* ================================================================
   * 后端 B:2D Canvas 软件渲染
   * ================================================================ */
  function startSoftware(reason) {
    backendDone = true;
    if (loadEl) loadEl.style.display = 'none';
    var cv = document.createElement('canvas');
    cv.className = glCanvas.className;
    glCanvas.parentNode.replaceChild(cv, glCanvas);
    var ctx = cv.getContext('2d');
    if (!ctx) { note('连 2D 画布都不可用,无法渲染', true); return; }
    setBadge('软件渲染', reason || '');

    var yaw = 0.65, pitch = 0.42, dist = 26, autoRot = true;
    var drag = null, dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      var box = stage.getBoundingClientRect();
      if (box.width < 4) return;
      cv.width = box.width * dpr; cv.height = box.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    var CHUNK = 6;   // 备用:软件渲染分段长
    function draw() {
      var w = cv.width / dpr, h = cv.height / dpr;
      ctx.clearRect(0, 0, w, h);
      var f = 2.1 * Math.min(w, h);
      var cy = Math.cos(yaw), sy = Math.sin(yaw);
      var cp = Math.cos(pitch), sp = Math.sin(pitch);
      var cx = w / 2, cyy = h / 2;
      ctx.lineCap = 'round';
      function pathRange(a, k0, k1) {
        ctx.beginPath();
        var started = false;
        for (var k = k0; k <= k1; k++) {
          var x = a[3 * k], y = a[3 * k + 1], z = a[3 * k + 2] - targetZ;
          var X = x * cy - y * sy, Y = x * sy + y * cy;
          var Y2 = Y * cp - z * sp, Z2 = Y * sp + z * cp;
          var wD = Z2 + dist;
          if (wD < 0.5) { started = false; continue; }
          var px = cx + f * X / wD, py = cyy - f * Y2 / wD;
          if (!started) { ctx.moveTo(px, py); started = true; }
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      for (var j = 0; j < N; j++) {
        var a = pts[j];
        ctx.strokeStyle = strandColor3D(j);
        ctx.lineWidth = (colorMode === 'focus' && isFocus(j)) ? 2 : 1;
        pathRange(a, 0, S - 1);
      }
    }
    (function tick() {
      requestAnimationFrame(tick);
      if (autoRot) yaw += 0.004 * rotSpeed;
      draw();
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
      dist = Math.max(6, Math.min(1200, dist * (e.deltaY > 0 ? 1.12 : 0.89)));
    }, { passive: false });

    resize();
    window.addEventListener('resize', resize);
    backend = {
      setAutoRotate: function (on) { autoRot = on; },
      setRotSpeed: function () { },
      setView: function (z, pos) {
        targetZ = z;
        if (pos) dist = Math.max(26, Math.hypot(pos[0], pos[1]) * 0.9);
        drawSection();
      },
      moveZ: function () { },
      applyColors: function () { },
      rebuild: function () { }   // 软件渲染直接读 pts,重采样后即生效
    };
    if (reason) note('已切换软件渲染:' + reason);
  }

  /* ---------- 启动:探测 → WebGL → (失败)软件 ---------- */
  try {
    var probe = document.createElement('canvas');
    var glc = (probe.getContext('webgl2') || probe.getContext('webgl') || probe.getContext('experimental-webgl'));
    if (!glc) throw new Error('WebGL 上下文不可用');
    backend = startWebGL();
  } catch (e) {
    startSoftware(e && e.message);
  }

  /* ---------- 2D 截面小图 ---------- */
  var secCtx = secCanvas ? secCanvas.getContext('2d') : null;
  function drawSection() {
    if (!secCtx) return;
    var w = secCanvas.width, h = secCanvas.height;
    var scale = w / 5.6, cx2 = w / 2, cy2 = h / 2;
    secCtx.clearRect(0, 0, w, h);
    secCtx.fillStyle = css('--surface') || '#1a1a19';
    secCtx.fillRect(0, 0, w, h);
    secCtx.strokeStyle = css('--grid') || '#2c2c2a';
    secCtx.lineWidth = 1;
    for (var g = -2; g <= 2; g++) {
      secCtx.beginPath(); secCtx.moveTo(cx2 + g * scale, 0); secCtx.lineTo(cx2 + g * scale, h); secCtx.stroke();
      secCtx.beginPath(); secCtx.moveTo(0, cy2 + g * scale); secCtx.lineTo(w, cy2 + g * scale); secCtx.stroke();
    }
    var rr = Math.max(2.4, R_TUBE * scale);
    for (var j = 0; j < N; j++) {
      var xy = strandXYtopo(j, targetZ);
      secCtx.fillStyle = strandColor(j);
      secCtx.beginPath();
      secCtx.arc(cx2 + xy[0] * scale, cy2 - xy[1] * scale, rr, 0, 6.2832);
      secCtx.fill();
      if (colorMode === 'pair' && (j === LOOP[0] || j === LOOP[1])) {
        secCtx.strokeStyle = '#ffffff'; secCtx.lineWidth = 1.5; secCtx.stroke();
      }
    }
    if (zLabel) zLabel.textContent = targetZ.toFixed(1);
  }

  /* ---------- 交互件 ---------- */
  if (btnRotate) btnRotate.addEventListener('click', function () {
    var on = !btnRotate.classList.contains('on');
    btnRotate.classList.toggle('on', on);
    if (backend && backend.setAutoRotate) backend.setAutoRotate(on);
  });
  if (btnClose) btnClose.addEventListener('click', function () {
    if (backend && backend.setView) backend.setView(8, [7, -11]);
    setZ(8);
  });
  if (btnFull) btnFull.addEventListener('click', function () {
    if (backend && backend.setView) backend.setView(Z_TOTAL / 2, [130, -235]);
    setZ(Z_TOTAL / 2);
  });
  if (selColor) selColor.addEventListener('change', function () {
    colorMode = selColor.value;
    if (backend && backend.applyColors) backend.applyColors();
    drawSection();
  });
  if (selRot) selRot.addEventListener('change', function () {
    rotSpeed = parseFloat(selRot.value) || 1;
    if (backend && backend.setRotSpeed) backend.setRotSpeed();
  });
  if (selScan) selScan.addEventListener('change', function () {
    scanSpeed = parseFloat(selScan.value) || 1;
  });
  if (selTopo) selTopo.addEventListener('change', function () {
    TOPO = selTopo.value;
    try { resample(); } catch (e) { note('拓扑采样异常:' + e.message, true); return; }
    if (backend && backend.rebuild) backend.rebuild();
    drawSection();
  });
  if (btnPlay) btnPlay.addEventListener('click', function () {
    playing = !playing;
    btnPlay.classList.toggle('on', playing);
    btnPlay.textContent = playing ? '⏸ 暂停' : '▶ 逐站扫描';
    if (playing && targetZ >= Z_TOTAL - 1) setZ(0);
  });
  if (slider) slider.addEventListener('input', function () {
    playing = false;
    if (btnPlay) { btnPlay.classList.remove('on'); btnPlay.textContent = '▶ 逐站扫描'; }
    setZ(parseFloat(slider.value));
  });

  /* ---------- 扫描动画 ---------- */
  var lastT = performance.now();
  (function scanTick(now) {
    requestAnimationFrame(scanTick);
    var dt = ((now || performance.now()) - lastT) / 1000;
    lastT = now || performance.now();
    if (!playing) return;
    setZ(targetZ + dt * (Z_TOTAL * scanSpeed / 16));
    if (targetZ >= Z_TOTAL - 0.5) {
      playing = false;
      if (btnPlay) { btnPlay.classList.remove('on'); btnPlay.textContent = '▶ 逐站扫描'; }
    }
  })(performance.now());

  window.addEventListener('themechange', drawSection);
  drawSection();
})();
