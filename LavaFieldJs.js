/*!
 * Copyright (c) 2026 Antonio Nappi. All rights reserved.
 *
 * This file is published for reference only, not for reuse. Copying,
 * redistributing, or incorporating it — in original or modified form,
 * in whole or in part — into another project without prior written
 * permission from the copyright holder is not permitted and constitutes
 * copyright infringement.
 *
 * For licensing requests, contact: antonionappiwork@gmail.com
 */

// Lava lamp: simulazione a metaball in WebGL, con fallback a video
// pre-registrato per chi non ha accelerazione hardware.
//
// Come funziona
// -------------
// Il campo di metaball è calcolato interamente sulla GPU: un solo
// triangolo copre lo schermo e un fragment shader valuta, per ogni pixel,
// la somma dei campi di N blob più quello della pozza alla base (vedi
// blobField()/poolField() nel FRAG qui sotto). La CPU si occupa solo della
// fisica: ogni blob attraversa un ciclo esplicito pozza → salita → discesa
// → pozza con tempi ed easing propri — non un'integrazione fisica vera,
// altrimenti potrebbe fermarsi in equilibrio — e la sua posizione/raggio
// vengono scritti in un uniform array che lo shader rilegge a ogni frame.
//
// Se WebGL non è disponibile, o il contesto restituito è renderizzato via
// software (SwiftShader, llvmpipe — capita quando l'accelerazione hardware
// è disattivata a livello di sistema/browser), il modulo rinuncia e mostra
// al suo posto uno dei video pre-registrati in LAVA_CLIPS, più un avviso
// che spiega come riattivare l'accelerazione hardware (vedi
// promptHwAccel()).
//
// Uso: nella pagina serve un <canvas data-lava></canvas> (e, per il
// fallback, un <video data-lava-fallback>) — il modulo si avvia da solo
// cercando quell'attributo. Nessuna dipendenza esterna.
//
// Note di compatibilità:
//   - highp obbligatorio: il campo (r^2/d^2)^2 satura mediump (fp16, max
//     65504) su molte GPU e il risultato sparisce del tutto.
//   - GLSL ES 1.00, così lo stesso shader gira sia su WebGL1 che WebGL2.
//   - niente fwidth(): l'antialiasing usa il gradiente analitico del campo.
//   - gli array uniform vanno cercati come "uBlobs[0]", non col nome nudo.
//
// File statico esterno (non inline): la CSP del sito è script-src 'self'.
(function () {
  var canvas = document.querySelector('[data-lava]');
  if (!canvas) return;

  // Tre registrazioni (1920x1080), ciascuna un loop con crossfade, mandate
  // in rotazione mescolata senza ripetizioni consecutive.
  var LAVA_CLIPS = [
    { webm: '/assets/lava/lava-1.webm', mp4: '/assets/lava/lava-1.mp4' },
    { webm: '/assets/lava/lava-2.webm', mp4: '/assets/lava/lava-2.mp4' },
    { webm: '/assets/lava/lava-3.webm', mp4: '/assets/lava/lava-3.mp4' },
  ];

  // Una pagina non può attivare l'accelerazione hardware del browser né
  // riavviarlo: sono impostazioni di sistema fuori dalla portata di uno
  // script. Mostriamo quindi spiegazione + percorso impostazioni copiabile.
  var hwAccelPrompted = false;
  function promptHwAccel() {
    if (hwAccelPrompted) return;
    hwAccelPrompted = true;
    var modal = document.querySelector('[data-hwaccel-modal]');
    if (!modal) return;
    var steps = document.querySelector('[data-hwaccel-steps]');
    var path = document.querySelector('[data-hwaccel-path]');
    var yesBtn = document.querySelector('[data-hwaccel-yes]');
    var noBtn = document.querySelector('[data-hwaccel-no]');
    var copiedNote = document.querySelector('[data-hwaccel-copied]');

    var ua = navigator.userAgent || '';
    var isFirefox = /Firefox/i.test(ua);
    var isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
    var settingsPath = isFirefox
      ? 'about:preferences#general'
      : 'chrome://settings/system'; // valido anche per Edge, Brave, Opera, Vivaldi

    if (path) path.textContent = settingsPath;
    if (steps) {
      steps.textContent = isSafari
        ? 'Safari accelera via GPU automaticamente quando il sistema lo permette — controlla in Preferenze di Sistema > Grafica, o negli aggiornamenti del sistema operativo.'
        : isFirefox
          ? 'Incolla l’indirizzo nella barra di Firefox, poi in "Prestazioni" togli la spunta a "Usa impostazioni consigliate" e attiva "Usa accelerazione hardware quando disponibile". Riavvia il browser.'
          : 'Incolla l’indirizzo nella barra del browser, attiva "Usa accelerazione hardware quando disponibile", poi usa il pulsante "Riavvia" che comparirà.';
    }

    function open() {
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
    }
    function close() {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }

    if (yesBtn) {
      yesBtn.addEventListener('click', function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(settingsPath).then(function () {
            if (copiedNote) copiedNote.hidden = false;
          }).catch(function () {});
        }
        if (steps) steps.hidden = false;
        if (path) path.hidden = false;
        yesBtn.hidden = true;
      });
    }
    if (noBtn) noBtn.addEventListener('click', close);
    var backdrop = modal.querySelector('.cv-modal-backdrop');
    if (backdrop) backdrop.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('open')) close();
    });

    // #an-intro ha z-index 9999, sopra i 200 di questo modal: se lo aprissimo
    // subito resterebbe nascosto dietro l'intro per due secondi.
    if (!document.getElementById('an-intro')) open();
    else {
      document.addEventListener('an-intro-done', open, { once: true });
      setTimeout(open, 4000);
    }
  }

  function give(reason) {
    if (window.console && console.warn) console.warn('[lava] ' + reason);
    promptHwAccel();
    var fallback = document.querySelector('[data-lava-fallback]');
    if (!fallback) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    canvas.hidden = true;
    fallback.hidden = false;

    var canWebm = !!fallback.canPlayType && fallback.canPlayType('video/webm; codecs="vp9"') !== '';

    // Ordine mescolato, ricalcolato a ogni esaurimento, senza ripetere la
    // stessa clip due volte di fila al giro nuovo.
    var order = [];
    var cursor = 0;
    var lastPlayed = -1;
    function reshuffle() {
      order = LAVA_CLIPS.map(function (_, idx) { return idx; });
      for (var i = order.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = order[i]; order[i] = order[j]; order[j] = t;
      }
      if (cursor > 0 && order[0] === lastPlayed) {
        var swapAt = 1 + Math.floor(Math.random() * (order.length - 1));
        var t2 = order[0]; order[0] = order[swapAt]; order[swapAt] = t2;
      }
      cursor = 0;
    }
    function playNext() {
      if (cursor >= order.length) reshuffle();
      var clip = LAVA_CLIPS[order[cursor]];
      lastPlayed = order[cursor];
      cursor++;
      fallback.src = canWebm ? clip.webm : clip.mp4;
      fallback.load();
      var p = fallback.play();
      if (p && p.catch) p.catch(function () {});
    }
    fallback.addEventListener('ended', playNext);

    var reveal = function () {
      fallback.classList.add('is-live');
      reshuffle();
      playNext();
    };
    if (!document.getElementById('an-intro')) reveal();
    else {
      document.addEventListener('an-intro-done', reveal, { once: true });
      setTimeout(reveal, 4000);
    }
  }

  // Nessun oggetto di opzioni al primo tentativo: certi driver rifiutano
  // l'intera creazione del contesto per una combinazione di attributi che
  // avrebbero potuto semplicemente ignorare.
  var names = ['webgl2', 'webgl', 'experimental-webgl'];
  var gl = null;
  var glName = '';
  for (var ci = 0; ci < names.length && !gl; ci++) {
    try {
      gl = canvas.getContext(names[ci]);
      if (gl) glName = names[ci];
    } catch (e) { /* prova il prossimo */ }
  }
  if (!gl) {
    var hasCtor = !!(window.WebGLRenderingContext || window.WebGL2RenderingContext);
    var probe = null;
    try { probe = document.createElement('canvas').getContext('2d'); } catch (e) {}
    return give(
      'nessun contesto WebGL (costruttori WebGL presenti: ' + hasCtor +
      ', contesto 2d funzionante: ' + !!probe +
      ') — probabilmente disattivato a livello di browser/GPU'
    );
  }

  // Un contesto che esiste non significa una GPU che lo guida: con
  // l'accelerazione hardware disattivata molti browser restituiscono
  // comunque un contesto WebGL, ma renderizzato via software (SwiftShader,
  // llvmpipe). Va trattato come se il contesto non esistesse.
  (function checkRenderer() {
    var info = gl.getExtension('WEBGL_debug_renderer_info');
    if (!info) return;
    var renderer = '';
    try { renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || ''); } catch (e) { return; }
    if (/swiftshader|llvmpipe|software|microsoft basic render|d3d11 warp/i.test(renderer)) {
      gl = null;
      give('contesto WebGL renderizzato via software (' + renderer + '), non accelerato');
    }
  })();
  if (!gl) return;

  var N = 8; // numero di blob

  var VERT = [
    'attribute vec2 aPos;',
    'void main() { gl_Position = vec4(aPos, 0.0, 1.0); }',
  ].join('\n');

  var FRAG = [
    'precision highp float;',
    '',
    'uniform vec2  uSize;      // dimensioni canvas in pixel',
    'uniform float uAspect;',
    'uniform float uTime;',
    'uniform vec4  uBlobs[' + N + '];  // xy = posizione, z = raggio, w = velocità verticale',
    'uniform vec3  uPool;      // x = centro, y = mezza larghezza, z = altezza',
    '',
    'const float THRESHOLD = 1.0;',
    'const float WOBBLE = 0.11;',
    '',
    'const vec3 EDGE = vec3(0.72, 1.00, 0.83);',
    'const vec3 CORE = vec3(0.09, 0.55, 0.28);',
    'const vec3 GLOW = vec3(0.29, 0.87, 0.50);',
    '',
    // Campo di un blob più il suo gradiente analitico, per una normale di
    // shading pulita. Il blob è un'ellisse stirata lungo il movimento con
    // una coda più lunga dietro (la cera che sale è una goccia, quella che
    // scende un gocciolamento); la caduta (r^2/d^2)^2 è più ripida della
    // metaball classica, così i blob restano distinti finché non sono
    // davvero vicini, poi si strozzano e si fondono.
    'vec3 blobField(vec2 p, vec4 b, float k) {',
    '  if (b.z <= 0.0) return vec3(0.0);',
    '  vec2 d = p - b.xy;',
    '  float vy = b.w;', // velocità di forma (shapeV), non quella grezza — vedi step()
    '  float speed = clamp(abs(vy) * 14.0, 0.0, 1.0);',
    '  float sy = 1.15 + 0.9 * speed;',
    '  float behind = smoothstep(-0.015, 0.015, -d.y * vy);', // smoothstep invece di sign(): niente scatti quando vy passa per zero
    '  sy *= 1.0 + 0.55 * speed * behind;',
    '  float a = atan(d.y, d.x);',
    '  float r = b.z * (1.0 + WOBBLE * sin(3.0 * a + k * 2.4 + uTime * 0.45)',
    '                       + WOBBLE * 0.6 * sin(5.0 * a - k * 1.7 - uTime * 0.28)',
    '                       + WOBBLE * 0.35 * sin(2.0 * a + k * 4.1 + uTime * 0.19));',
    '  float dy = d.y / sy;',
    '  float dd = max(d.x * d.x + dy * dy, 4e-4);', // floor alto per evitare picchi quando due blob si avvicinano molto
    '  float r2 = r * r;',
    '  float f = min((r2 * r2) / (dd * dd), 60.0);',
    '  vec2 g = -4.0 * f / dd * vec2(d.x, dy / sy);',
    '  return vec3(f, g);',
    '}',
    '',
    // La cera nella pozza alla base, un'unica ellisse larga nello stesso
    // campo, così i blob vi si fondono e se ne staccano gratuitamente.
    'vec3 poolField(vec2 p) {',
    '  vec2 d = vec2((p.x - uPool.x) / uPool.y, p.y / uPool.z);',
    '  float dd = max(dot(d, d), 4e-4);',
    '  float f = min(1.0 / (dd * dd), 60.0);',
    '  vec2 g = -4.0 * f / dd * vec2(d.x / uPool.y, d.y / uPool.z);',
    '  return vec3(f, g);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / uSize;',
    '  vec2 p = vec2(uv.x * uAspect, uv.y);',
    '',
    '  vec3 acc = poolField(p);',
    '  for (int i = 0; i < ' + N + '; i++) {',
    '    acc += blobField(p, uBlobs[i], float(i));',
    '  }',
    '',
    '  float f = acc.x;',
    '',
    '  float halo = clamp(f / THRESHOLD, 0.0, 1.0);', // alone: la cera appena sotto soglia illumina già il liquido intorno
    '  halo = halo * halo * halo * halo;',
    '',
    '  float gmag = length(acc.yz);',
    '  vec2 n = gmag > 1e-9 ? -acc.yz / gmag : vec2(0.0, 1.0);',
    '',
    '  float rho = clamp(pow(THRESHOLD / max(f, 1e-6), 0.25), 0.0, 1.0);', // distanza dal centro della feature locale (1 = pelle, 0 = nucleo)
    '  float body = smoothstep(0.0, 0.55, 1.0 - rho);',
    '',
    '  vec3 wax = mix(EDGE, CORE, body);',
    '',
    '  vec3 n3 = normalize(vec3(n * rho, sqrt(max(0.0, 1.0 - rho * rho))));', // normale sferica, illuminata dal basso
    '  float diffuse = 0.78 + 0.22 * clamp(dot(n3, normalize(vec3(0.0, -1.0, 0.45))), 0.0, 1.0);',
    '  float gloss = pow(max(0.0, dot(n3, normalize(vec3(-0.4, 0.75, 0.55)))), 14.0);',
    '  wax = wax * diffuse + EDGE * gloss * 0.25;',
    '',
    '  float aa = clamp(gmag / uSize.y, 1e-4, THRESHOLD * 0.5);', // antialiasing dal gradiente del campo, senza fwidth()
    '  float inside = smoothstep(THRESHOLD - aa, THRESHOLD + aa, f);',
    '',
    // Fascio di luce dall'alto verso il basso: stretto in cima, si allarga
    // scendendo, si affievolisce con la distanza.
    '  float dropFromTop = 1.0 - p.y;',
    '  float coneHalf = 0.05 + dropFromTop * 0.6;',
    '  float coneX = abs(p.x - uAspect * 0.52);',
    '  float cone = smoothstep(coneHalf, coneHalf * 0.2, coneX) * exp(-dropFromTop * 0.8);',
    '',
    '  vec3 color = mix(GLOW, wax, inside);',
    '  color += vec3(0.75, 1.0, 0.85) * cone * 0.09 * (1.0 - inside * 0.6);',
    '  color += EDGE * cone * inside * 0.4;',
    '  float alpha = inside + (1.0 - inside) * (halo * 0.16 + cone * 0.05);',
    '  gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));',
    '}',
  ].join('\n');

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      give('shader non compilato: ' + gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  var vs = compile(gl.VERTEX_SHADER, VERT);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    return give('programma non linkato: ' + gl.getProgramInfoLog(prog));
  }
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  var uSize = gl.getUniformLocation(prog, 'uSize');
  var uAspect = gl.getUniformLocation(prog, 'uAspect');
  var uTime = gl.getUniformLocation(prog, 'uTime');
  var uBlobs = gl.getUniformLocation(prog, 'uBlobs[0]') || gl.getUniformLocation(prog, 'uBlobs');
  var uPool = gl.getUniformLocation(prog, 'uPool');
  if (!uBlobs) return give('uniform uBlobs non trovata');

  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  // ---- ciclo della lampada -------------------------------------------------
  // Ogni blob attraversa esplicitamente pozza → salita → discesa → pozza
  // con tempi propri randomizzati (easing, non integrazione fisica), così
  // non può mai fermarsi in equilibrio. Parte (e torna) nella pozza alla
  // base, dove vive anche la metaball della pozza stessa.
  var POOL_TOP = 0.05;
  var POOL_DUR = [3.5, 9.5];    // secondi di riposo/riscaldamento prima del lancio
  var RISE_DUR = [13, 24];
  var FALL_DUR = [15, 27];
  var TAU_SHAPE = 1.4; // costante di rilassamento dello stiramento: insegue una velocità filtrata, non quella istantanea
  // Sopra i 900px i blob restano nella metà destra (il testo occupa la
  // sinistra); sotto, la corsia diventa larga quanto tutto lo schermo.
  // Ricalcolato in layout().
  var laneFrom = 0.46;

  function easeInOut(u) {
    return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  }
  function pick(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  var aspect = 1;
  var bandW = 0.1; // ricalcolato in layout()
  var blobs = [];
  // Ogni blob ha una propria fascia orizzontale nella corsia, in ordine
  // mescolato: uno spread garantito per costruzione, non affidato al caso.
  var order = [];
  for (var oi = 0; oi < N; oi++) order.push(oi);
  for (var oj = order.length - 1; oj > 0; oj--) {
    var pk = Math.floor(Math.random() * (oj + 1));
    var tmp = order[oj]; order[oj] = order[pk]; order[pk] = tmp;
  }
  for (var i = 0; i < N; i++) {
    blobs.push({
      x: -1,
      band: order[i],
      y: POOL_TOP,
      r: 0.08 + Math.random() * 0.08,
      vy: 0,
      shapeV: 0,
      state: 'pool',
      t: Math.random() * POOL_DUR[1],
      dur: pick(POOL_DUR),
      fromY: POOL_TOP,
      apex: POOL_TOP,
      breathPhase: Math.random() * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
    });
  }

  function layout() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, rect.width);
    var h = Math.max(1, rect.height);
    aspect = w / h;
    // window.LAVA_RENDER_SCALE viene impostata dal registratore offline che
    // produce il video di fallback: piena risoluzione lì, non serve reggere
    // 60fps dal vivo.
    var scale = typeof window.LAVA_RENDER_SCALE === 'number'
      ? window.LAVA_RENDER_SCALE
      : Math.min(window.devicePixelRatio || 1, 1.5) * 0.6;
    canvas.width = Math.max(2, Math.round(w * scale));
    canvas.height = Math.max(2, Math.round(h * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    laneFrom = w < 900 ? 0 : 0.46;
    var lo = aspect * laneFrom;
    bandW = Math.max(0.02, (aspect - lo) / N);
    for (var i = 0; i < N; i++) {
      var o = blobs[i];
      // Le fasce si sovrappongono del 30% ai lati, così blob vicini possono
      // comunque incontrarsi e fondersi.
      o.bandLo = lo + o.band * bandW - bandW * 0.3;
      o.bandHi = lo + (o.band + 1) * bandW + bandW * 0.3;
      if (o.x < 0) o.x = lo + (o.band + 0.5) * bandW;
      o.x = Math.min(Math.max(o.x, o.bandLo), o.bandHi);
    }
  }

  function step(dt, t) {
    for (var i = 0; i < N; i++) {
      var o = blobs[i];
      o.t += dt;
      var u, y0;

      if (o.state === 'pool') {
        o.y = POOL_TOP + Math.sin(t * 0.7 + o.phase) * 0.008;
        o.vy = 0;
        if (o.t >= o.dur) {
          o.state = 'rise';
          o.t = 0;
          o.fromY = POOL_TOP;
          o.apex = Math.random() < 0.72 ? 0.85 + Math.random() * 0.34 : 0.42 + Math.random() * 0.35;
          o.dur = pick(RISE_DUR);
        }
      } else if (o.state === 'rise') {
        u = Math.min(o.t / o.dur, 1);
        y0 = o.y;
        o.y = o.fromY + (o.apex - o.fromY) * easeInOut(u);
        o.vy = (o.y - y0) / Math.max(dt, 1e-4);
        if (u >= 1) {
          o.state = 'fall';
          o.t = 0;
          o.fromY = o.y;
          o.dur = pick(FALL_DUR);
        }
      } else {
        u = Math.min(o.t / o.dur, 1);
        y0 = o.y;
        o.y = o.fromY + (POOL_TOP - o.fromY) * easeInOut(u);
        o.vy = (o.y - y0) / Math.max(dt, 1e-4);
        if (u >= 1) {
          o.state = 'pool';
          o.t = 0;
          o.y = POOL_TOP;
          o.vy = 0;
          o.dur = pick(POOL_DUR);
        }
      }

      o.shapeV += (o.vy - o.shapeV) * Math.min(1, dt / TAU_SHAPE);

      // Oscillazione laterale scalata sulla larghezza reale della fascia.
      o.x += Math.sin(t * 0.1 + o.phase) * bandW * 0.5 * dt;
      if (o.x < o.bandLo) o.x = o.bandLo;
      if (o.x > o.bandHi) o.x = o.bandHi;
    }
  }

  var data = new Float32Array(N * 4);
  function draw(t) {
    for (var i = 0; i < N; i++) {
      var o = blobs[i];
      var breath = 1 + 0.05 * Math.sin(t * 0.5 + o.breathPhase);
      data[i * 4] = o.x;
      data[i * 4 + 1] = o.y;
      data[i * 4 + 2] = o.r * breath;
      data[i * 4 + 3] = o.shapeV;
    }
    gl.uniform2f(uSize, canvas.width, canvas.height);
    gl.uniform1f(uAspect, aspect);
    gl.uniform1f(uTime, t);
    gl.uniform4fv(uBlobs, data);
    // Pozza centrata sulla stessa corsia dei blob, un po' più larga per
    // sfumare oltre i suoi bordi.
    var laneCx = aspect * ((laneFrom + 1) / 2);
    var laneHw = aspect * ((1 - laneFrom) / 2) * 1.35;
    gl.uniform3f(uPool, laneCx, laneHw, POOL_TOP);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ---- loop di rendering ---------------------------------------------------
  // Gira solo se la hero è visibile e la tab è attiva.
  var reduced = window.__anPrefs
    ? window.__anPrefs.reducedMotion
    : !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var running = false;
  var started = false;
  var visible = true;
  var onScreen = true;
  var raf = 0;
  var last = 0;
  var clock = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
    last = now;
    clock += dt;
    step(dt, clock);
    draw(clock);
  }

  function sync() {
    if (reduced) return;
    var want = started && visible && onScreen;
    if (want === running) return;
    running = want;
    if (running) {
      last = 0;
      raf = requestAnimationFrame(frame);
    } else {
      cancelAnimationFrame(raf);
    }
  }

  document.addEventListener('visibilitychange', function () {
    visible = !document.hidden;
    sync();
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      onScreen = entries[0].isIntersecting;
      sync();
    }, { threshold: 0 }).observe(canvas);
  }

  var resizeRaf = 0;
  window.addEventListener('resize', function () {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(function () {
      layout();
      if (!running) draw(clock);
    });
  }, { passive: true });

  layout();
  // Pre-avanza la simulazione così la lampada è già in movimento quando
  // compare, invece di otto blob freddi appena accesi.
  for (var s = 0; s < 2400; s++) step(0.033, s * 0.033);

  var begun = false;
  function begin() {
    if (begun) return;
    begun = true;
    canvas.classList.add('is-live');
    started = true;
    if (reduced) draw(clock);
    else sync();
  }

  if (!document.getElementById('an-intro')) begin();
  else {
    document.addEventListener('an-intro-done', begin, { once: true });
    // Rete di sicurezza: se l'evento di fine intro non arriva mai, la
    // lampada parte comunque invece di restare invisibile per sempre.
    setTimeout(begin, 4000);
  }
})();
