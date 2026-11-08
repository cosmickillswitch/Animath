/* Animath editor: stage, add palette, inspector, timeline, projects, export. */
(function () {
  'use strict';
  const A = window.Animath;
  const $ = s => document.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k);
    return el;
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Couldn’t save: storage is full or blocked.'); return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const uid = () => Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6);
  const clone = o => JSON.parse(JSON.stringify(o, (k, v) => k[0] === '_' ? undefined : v));
  const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
  const snap = v => Math.round(v * 20) / 20;
  function toast(msg) { const t = h('div', { class: 'toast', role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2600); }

  const ASPECTS = [['16:9', 'Landscape 16:9'], ['9:16', 'Portrait 9:16 (Shorts, Reels)'], ['1:1', 'Square 1:1'], ['4:5', 'Portrait 4:5'], ['4:3', 'Classic 4:3'], ['21:9', 'Cinema 21:9']];
  const BGS = [['#000000', 'Black (Manim)'], ['#1E1E24', 'Charcoal'], ['#0E1A2B', 'Navy'], ['#FBF8F1', 'Paper'], ['#FFFFFF', 'White']];
  const SWATCH = ['WHITE', 'GREY', 'BLUE', 'TEAL', 'GREEN', 'YELLOW', 'GOLD', 'ORANGE', 'RED', 'MAROON', 'PURPLE', 'PINK', 'INK'];
  const ratio = a => { const [w, hh] = a.split(':').map(Number); return w / hh; };
  const isLight = bg => { const c = A.color(bg).replace('#', ''); const n = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16); return ((n >> 16 & 255) * 0.3 + (n >> 8 & 255) * 0.59 + (n & 255) * 0.11) > 150; };

  // ---------- state ----------
  let scene = null, projId = null, sel = null, time = 0, playing = false, t0 = 0, guides = false, pps = 60;
  let hist = [], hi = -1, saveT = null, dirty = true;
  const stage = $('#stage'), sctx = stage.getContext('2d');

  function newScene(name) { return { v: 1, name: name || 'Untitled', aspect: '16:9', bg: '#000000', duration: 10, objects: [] }; }
  function makeObj(type, over = {}) {
    const T = A.TYPES[type];
    const n = scene.objects.filter(o => o.type === type).length + 1;
    const props = clone(T.defaults);
    if (isLight(scene.bg)) for (const k of ['color', 'axis']) if (props[k] === 'WHITE') props[k] = 'INK';
    const textish = ['text', 'math', 'title', 'truth'].includes(type);
    const o = {
      id: uid(), type, name: T.label + ' ' + n, start: round(time, 2), end: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1,
      props, anIn: { type: textish ? 'write' : type === 'sticker' ? 'grow' : 'create', dur: type === 'graph' ? 2 : 1, rate: 'smooth' },
      anOut: { type: 'fadeout', dur: 0.6, rate: 'smooth' }, emph: [], keys: {}, loop: type === 'sticker' ? 'bob' : 'none'
    };
    o.end = round(o.start + 4, 2);
    Object.assign(o, over);
    if (over.props) o.props = Object.assign(props, over.props);
    return o;
  }

  // ---------- persistence and undo ----------
  const index = () => store.get('animath.index', []);
  function saveNow() {
    if (!scene || !projId) return;
    store.set('animath.p.' + projId, clone(scene));
    const ix = index().filter(p => p.id !== projId);
    ix.unshift({ id: projId, name: scene.name, updated: Date.now() });
    store.set('animath.index', ix);
  }
  function commit() {
    const snapS = JSON.stringify(clone(scene));
    if (hist[hi] === snapS) return;
    hist = hist.slice(0, hi + 1); hist.push(snapS); if (hist.length > 80) hist.shift(); hi = hist.length - 1;
    clearTimeout(saveT); saveT = setTimeout(saveNow, 300);
    updUndo();
  }
  let commitT = null;
  const commitSoon = () => { clearTimeout(commitT); commitT = setTimeout(commit, 400); };
  function undo(d) {
    const j = hi + d;
    if (j < 0 || j >= hist.length) return;
    hi = j; scene = JSON.parse(hist[hi]);
    if (sel && !scene.objects.some(o => o.id === sel)) sel = null;
    clearTimeout(saveT); saveT = setTimeout(saveNow, 300);
    refreshAll(); updUndo();
  }
  function updUndo() { $('#undo').disabled = hi <= 0; $('#redo').disabled = hi >= hist.length - 1; }
  function openProject(id) {
    const s = store.get('animath.p.' + id, null);
    if (!s) return false;
    projId = id; scene = s; sel = null; time = 0; playing = false;
    store.set('animath.current', id);
    hist = [JSON.stringify(clone(scene))]; hi = 0; updUndo();
    refreshAll(); fillProjects();
    return true;
  }
  function createProject(s) {
    projId = uid(); scene = s; saveNow();
    openProject(projId);
  }
  function fillProjects() {
    const p = $('#proj'); p.textContent = '';
    for (const it of index()) p.append(h('option', { value: it.id }, it.name));
    p.value = projId;
  }

  // ---------- stage ----------
  function sizeStage() {
    const wrap = $('#stageWrap');
    const r = ratio(scene.aspect);
    const maxW = wrap.clientWidth - 20, maxH = narrow() ? Math.max(160, window.innerHeight * 0.36) : Math.max(140, wrap.clientHeight - 20);
    let w = maxW, hh = w / r;
    if (hh > maxH) { hh = maxH; w = hh * r; }
    stage.style.width = Math.floor(w) + 'px'; stage.style.height = Math.floor(hh) + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    stage.width = Math.round(w * dpr); stage.height = Math.round(hh * dpr);
    dirty = true;
  }
  function draw() {
    const W = stage.width, H = stage.height;
    A.render(sctx, scene, time, W, H);
    const ppu = H / 8;
    if (guides) {
      sctx.save(); sctx.strokeStyle = isLight(scene.bg) ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.12)'; sctx.lineWidth = 1;
      const uw = W / ppu / 2;
      for (let x = -Math.floor(uw); x <= uw; x++) { sctx.beginPath(); sctx.moveTo(W / 2 + x * ppu, 0); sctx.lineTo(W / 2 + x * ppu, H); sctx.stroke(); }
      for (let y = -4; y <= 4; y++) { sctx.beginPath(); sctx.moveTo(0, H / 2 - y * ppu); sctx.lineTo(W, H / 2 - y * ppu); sctx.stroke(); }
      sctx.strokeStyle = isLight(scene.bg) ? 'rgba(0,0,0,.3)' : 'rgba(255,255,255,.3)';
      sctx.beginPath(); sctx.moveTo(W / 2, 0); sctx.lineTo(W / 2, H); sctx.moveTo(0, H / 2); sctx.lineTo(W, H / 2); sctx.stroke();
      sctx.restore();
    }
    const o = selObj();
    if (o && o._hit && !playing) {
      const { st, bb } = o._hit;
      sctx.save();
      sctx.translate(W / 2 + st.x * ppu, H / 2 - st.y * ppu); sctx.rotate(-st.rotation); sctx.scale(st.scale * ppu, st.scale * ppu);
      sctx.strokeStyle = '#7C9CFF'; sctx.lineWidth = 1.5 / (st.scale * ppu); sctx.setLineDash([6 / (st.scale * ppu), 4 / (st.scale * ppu)]);
      const pad = 0.12 / st.scale;
      sctx.strokeRect(bb[0] - pad, bb[1] - pad, bb[2] - bb[0] + 2 * pad, bb[3] - bb[1] + 2 * pad);
      sctx.restore();
    }
    $('#time').textContent = fmtT(time) + ' / ' + fmtT(scene.duration);
    const ph = $('.tl-playhead'); if (ph) ph.style.left = (NAMEW + time * pps) + 'px';
  }
  const fmtT = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };
  function loop() {
    if (playing) {
      time = (performance.now() - t0) / 1000;
      if (time >= scene.duration) {
        if ($('#loopBtn').getAttribute('aria-pressed') === 'true') { t0 = performance.now(); time = 0; }
        else { time = scene.duration; setPlaying(false); }
      }
      draw(); followPlayhead();
    } else if (dirty) { draw(); dirty = false; }
    requestAnimationFrame(loop);
  }
  function setPlaying(on) {
    playing = on;
    if (on) { if (time >= scene.duration - 0.01) time = 0; t0 = performance.now() - time * 1000; }
    $('#play').textContent = on ? '❚❚' : '▶';
    $('#play').setAttribute('aria-label', on ? 'Pause' : 'Play');
    dirty = true;
    if (!on) renderInspector();
  }
  function setTime(t) { time = Math.max(0, Math.min(scene.duration, t)); dirty = true; if (!playing) renderInspectorValues(); }
  function followPlayhead() {
    const sc = $('.tl-scroll'); if (!sc) return;
    const x = NAMEW + time * pps;
    if (x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = x - NAMEW - 40;
    else if (x < sc.scrollLeft + NAMEW) sc.scrollLeft = Math.max(0, x - NAMEW - 40);
  }
  const selObj = () => scene.objects.find(o => o.id === sel) || null;
  function select(id) { sel = id; dirty = true; renderInspector(); renderTimeline(); }

  // drag objects on the stage
  let sdrag = null;
  stage.addEventListener('pointerdown', e => {
    const r = stage.getBoundingClientRect();
    const ppu = r.height / 8;
    const ux = (e.clientX - r.left - r.width / 2) / ppu, uy = -(e.clientY - r.top - r.height / 2) / ppu;
    const o = A.hitTest(scene, ux, uy);
    if (!o) { if (sel) select(null); return; }
    if (o.id !== sel) select(o.id);
    if (playing) return;
    sdrag = { o, ux, uy, x0: A.keyVal(o, 'x', time), y0: A.keyVal(o, 'y', time), moved: false };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', e => {
    if (!sdrag) return;
    const r = stage.getBoundingClientRect(), ppu = r.height / 8;
    const ux = (e.clientX - r.left - r.width / 2) / ppu, uy = -(e.clientY - r.top - r.height / 2) / ppu;
    let nx = sdrag.x0 + ux - sdrag.ux, ny = sdrag.y0 + uy - sdrag.uy;
    if (guides || e.shiftKey) { nx = Math.round(nx * 4) / 4; ny = Math.round(ny * 4) / 4; }
    if (!sdrag.moved && Math.hypot(ux - sdrag.ux, uy - sdrag.uy) < 0.05) return;
    sdrag.moved = true;
    setProp(sdrag.o, 'x', round(nx, 2)); setProp(sdrag.o, 'y', round(ny, 2));
    dirty = true; renderInspectorValues();
  });
  const endDrag = () => { if (sdrag && sdrag.moved) { commit(); renderTimeline(); } sdrag = null; };
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);

  // set a keyable property; if it has keyframes, set/insert a key at the playhead
  function setProp(o, p, v) {
    const k = o.keys[p];
    if (k && k.length) {
      const t = round(time, 2);
      const ex = k.find(q => Math.abs(q.t - t) < 0.026);
      if (ex) ex.v = v; else { k.push({ t, v }); k.sort((a, b) => a.t - b.t); }
    } else o[p] = v;
  }
  function toggleKey(o, p) {
    const t = round(time, 2);
    const k = o.keys[p] || (o.keys[p] = []);
    const i = k.findIndex(q => Math.abs(q.t - t) < 0.026);
    if (i >= 0) { k.splice(i, 1); if (!k.length) delete o.keys[p]; }
    else { k.push({ t, v: A.keyVal(o, p, time) }); k.sort((a, b) => a.t - b.t); }
    commit(); renderInspector(); renderTimeline(); dirty = true;
  }

  // ---------- add palette ----------
  const ADD = [
    ['Words', [['title', {}], ['text', {}], ['math', {}]]],
    ['Shapes', [['shape', { props: { shape: 'circle' } }, 'Circle', '◯'], ['shape', { props: { shape: 'square', fo: 0.3, fill: 'BLUE' } }, 'Square', '□'], ['shape', { props: { shape: 'polygon', n: 6, color: 'TEAL', fill: 'TEAL', fo: 0.2 } }, 'Polygon', '⬡'],
      ['shape', { props: { shape: 'arrow', color: 'WHITE' } }, 'Arrow', '→'], ['shape', { props: { shape: 'line', color: 'WHITE' } }, 'Line', '—'], ['shape', { props: { shape: 'dot', color: 'YELLOW' } }, 'Dot', '•'],
      ['shape', { props: { shape: 'star', n: 5, color: 'GOLD', fill: 'GOLD', fo: 0.6 } }, 'Star', '☆'], ['shape', { props: { shape: 'brace', w: 3, color: 'WHITE' } }, 'Brace', '⏟'], ['geom', {}]]],
    ['Maths & logic', [['graph', {}], ['graph', { props: { f1: 'x^2/2', l1: 'y = \\tfrac{x^2}{2}', f2: '', xmin: -4, xmax: 4, ymin: -1, ymax: 6, area: true, a: 0, b: 2 } }, 'Area', '∫'], ['venn', {}], ['venn', { props: { n: 3, shade: '(A ∩ B) ∪ C' } }, 'Venn 3', '⊛'], ['truth', {}],
      ['math', { props: { tex: '\\forall x \\, (P(x) \\to Q(x))' } }, 'Logic', '∀'], ['math', { props: { tex: 'A \\cup B = \\{ x \\mid x \\in A \\lor x \\in B \\}' } }, 'Set', '∪'], ['math', { props: { tex: '\\Box P \\to \\Diamond P' } }, 'Modal', '□']]],
    ['Stickers', ['star', 'heart', 'check', 'cross', 'bulb', 'speech', 'thought', 'sparkle', 'arrow', 'question', 'exclaim', 'pin', 'brain'].map(k => ['sticker', { props: { kind: k } }, k[0].toUpperCase() + k.slice(1), { star: '★', heart: '♥', check: '✓', cross: '✕', bulb: '💡', speech: '💬', thought: '💭', sparkle: '✦', arrow: '➜', question: '?', exclaim: '!', pin: '📍', brain: '🧠' }[k]])]
  ];
  function renderAdd() {
    const p = $('#addPanel'); p.textContent = '';
    for (const [group, items] of ADD) {
      p.append(h('div', { class: 'label' }, group));
      const g = h('div', { class: 'addgrid' });
      for (const [type, over, label, icon] of items) {
        const T = A.TYPES[type];
        g.append(h('button', { type: 'button', class: 'addbtn', onclick: () => addObj(type, over) }, h('span', { class: 'ic' }, icon || T.icon), h('span', {}, label || T.label)));
      }
      p.append(g);
    }
    p.append(h('p', { class: 'muted small' }, 'New objects start at the playhead and last 4 seconds. Drag them on the stage; drag their bars in the timeline.'));
  }
  function addObj(type, over) {
    const o = makeObj(type, clone(over || {}));
    if (o.end > scene.duration) scene.duration = Math.ceil(o.end);
    scene.objects.push(o);
    commit(); select(o.id); dirty = true;
    if (narrow()) showPanel('inspect');
  }

  // ---------- inspector ----------
  const narrow = () => matchMedia('(max-width: 899px)').matches;
  function colorField(val, onset, allowBlank) {
    const wrap = h('div', { class: 'swatches' });
    const cur = A.color(val) || '';
    const inp = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#ffffff', title: 'Custom colour', oninput: () => { onset(inp.value.toUpperCase()); mark(inp.value.toUpperCase()); } });
    function mark(v) { wrap.querySelectorAll('.sw').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v || A.color(b.dataset.v) === A.color(v))); }
    if (allowBlank) wrap.append(h('button', { type: 'button', class: 'sw blank', 'data-v': '', title: 'Default', onclick: () => { onset(''); mark(''); } }, '∅'));
    for (const s of SWATCH) wrap.append(h('button', { type: 'button', class: 'sw', 'data-v': s, title: s.toLowerCase(), style: 'background:' + A.color(s), onclick: () => { onset(s); mark(s); } }));
    wrap.append(inp);
    mark(val || '');
    return wrap;
  }
  function field(label, control, extra) { return h('label', { class: 'fld' }, h('span', { class: 'fl' }, label, extra || null), control); }
  function numInput(v, step, on) {
    const i = h('input', { type: 'number', step: step || 0.1, value: v, inputmode: 'decimal' });
    i.addEventListener('input', () => { const n = parseFloat(i.value); if (isFinite(n)) on(n); });
    return i;
  }
  function selectInput(opts, v, on) {
    const s = h('select', { onchange: () => on(s.value) }, opts.map(([k, l]) => h('option', { value: k }, l)));
    s.value = v; return s;
  }
  function section(title, open, ...kids) { return h('details', { class: 'sec', open: open ? true : false }, h('summary', {}, title), h('div', { class: 'secb' }, ...kids)); }
  const openSecs = new Set(['Content', 'Animate in', 'Position']);

  function renderInspector() {
    const box = $('#inspector'); box.textContent = '';
    const o = selObj();
    if (!o) { renderSceneSettings(box); return; }
    const T = A.TYPES[o.type];
    const changed = (rebuildTl) => { dirty = true; commitSoon(); if (rebuildTl) renderTimeline(); };
    box.append(h('div', { class: 'insp-head' },
      h('input', { class: 'name', value: o.name, 'aria-label': 'Object name', oninput: e => { o.name = e.target.value; changed(true); } }),
      h('button', { type: 'button', class: 'iconbtn', title: 'Send backward', 'aria-label': 'Send backward', onclick: () => move(-1) }, '↓'),
      h('button', { type: 'button', class: 'iconbtn', title: 'Bring forward', 'aria-label': 'Bring forward', onclick: () => move(1) }, '↑'),
      h('button', { type: 'button', class: 'iconbtn', title: 'Duplicate', 'aria-label': 'Duplicate', onclick: dup }, '⧉'),
      h('button', { type: 'button', class: 'iconbtn danger', title: 'Delete', 'aria-label': 'Delete', onclick: del }, '🗑')));

    // content
    const P = Object.assign({}, T.defaults, o.props);
    const content = [];
    for (const [key, label, kind, opt, when] of T.fields) {
      if (when && !when(P)) continue;
      const set = v => { o.props[key] = v; changed(); if (T.fields.some(f => f[4])) { renderInspectorSoon(); } };
      let c;
      if (kind === 'textarea') { c = h('textarea', { rows: key === 'tex' || key === 'text' ? 3 : 2, spellcheck: 'false' }); c.value = P[key]; c.addEventListener('input', () => { o.props[key] = c.value; changed(); validate(); }); }
      else if (kind === 'text') { c = h('input', { type: 'text', value: P[key], spellcheck: 'false' }); c.addEventListener('input', () => { o.props[key] = c.value; changed(); validate(); }); }
      else if (kind === 'num') c = numInput(P[key], opt, set);
      else if (kind === 'select') c = selectInput(opt.map(x => [String(x[0]), x[1]]), String(P[key]), v => set(isNaN(+v) || v === '' ? v : +v));
      else if (kind === 'bool') { c = h('input', { type: 'checkbox' }); c.checked = !!P[key]; c.addEventListener('change', () => set(c.checked)); content.push(h('label', { class: 'chk' }, c, ' ', label)); continue; }
      else if (kind === 'color') c = colorField(P[key], set, key === 'fill' && o.type === 'sticker');
      content.push(field(label, c));
    }
    const err = h('div', { class: 'err', hidden: true });
    content.push(err);
    function validate() {
      let msg = '';
      try {
        if (o.type === 'graph') { A.compileFn(o.props.f1 ?? P.f1); A.compileFn(o.props.f2 ?? P.f2); }
        if (o.type === 'venn') A.parseSet(o.props.shade ?? P.shade);
        if (o.type === 'truth') A.parseLogic(o.props.formula ?? P.formula);
      } catch (e) { msg = e.message; }
      err.hidden = !msg; err.textContent = msg;
    }
    validate();
    if (o.type === 'math' || o.type === 'text') content.push(h('p', { class: 'muted small' }, o.type === 'math' ? 'Supports \\frac, \\sqrt, ^ _, \\sum, \\int, Greek, \\forall \\exists \\land \\lor \\neg \\to, \\in \\cup \\cap \\subseteq, \\mathbb{R}, \\color{BLUE}{…}, \\text{…}, \\left( \\right).' : 'Put maths between dollar signs: The area is $\\pi r^2$.'));
    box.append(sec('Content', content));

    // position + keyframes
    const pos = [];
    const props = [['x', 'x', 0.1], ['y', 'y', 0.1], ['scale', 'Scale', 0.05], ['rotation', 'Rotation (°)', 5], ['opacity', 'Opacity', 0.05]];
    for (const [p, label, step] of props) {
      const k = o.keys[p] || [];
      const here = k.some(q => Math.abs(q.t - time) < 0.026);
      const kb = h('button', { type: 'button', class: 'keybtn' + (here ? ' on' : k.length ? ' some' : ''), title: here ? 'Remove keyframe here' : 'Add keyframe at playhead', 'aria-label': (here ? 'Remove' : 'Add') + ' ' + label + ' keyframe', onclick: e => { e.preventDefault(); toggleKey(o, p); } }, here ? '◆' : '◇');
      const inp = numInput(round(A.keyVal(o, p, time), 2), step, v => { setProp(o, p, v); dirty = true; commitSoon(); if (k.length) renderTimelineSoon(); });
      inp.dataset.prop = p;
      pos.push(h('div', { class: 'kfrow' }, h('span', { class: 'fl' }, label), inp, kb));
    }
    const kt = [...new Set(Object.values(o.keys).flat().map(q => q.t))].sort((a, b) => a - b);
    if (kt.length) {
      pos.push(h('div', { class: 'kchips' }, h('span', { class: 'muted small' }, 'Keyframes:'), kt.map(t => h('button', { type: 'button', class: 'chip', onclick: () => setTime(t) }, '◆ ' + t.toFixed(2) + 's')),
        h('button', { type: 'button', class: 'chip quiet', onclick: () => { o.keys = {}; commit(); renderInspector(); renderTimeline(); dirty = true; } }, 'Clear all')));
      pos.push(h('p', { class: 'muted small' }, 'With keyframes on a property, editing it (or dragging on the stage) sets a keyframe at the playhead.'));
    } else pos.push(h('p', { class: 'muted small' }, 'Tap ◇ to keyframe a property at the playhead, then move the playhead and change the value to animate it.'));
    box.append(sec('Position', pos));

    // timing
    box.append(sec('Timing', [h('div', { class: 'two' },
      field('Starts at (s)', numInput(o.start, 0.1, v => { o.start = Math.max(0, Math.min(v, o.end - 0.1)); changed(true); })),
      field('Ends at (s)', numInput(o.end, 0.1, v => { o.end = Math.max(v, o.start + 0.1); if (o.end > scene.duration) scene.duration = Math.ceil(o.end); changed(true); })))]));

    // in / out
    box.append(sec('Animate in', [
      field('Animation', selectInput(A.ANIM_IN, o.anIn.type, v => { o.anIn.type = v; changed(true); })),
      h('div', { class: 'two' }, field('Seconds', numInput(o.anIn.dur, 0.1, v => { o.anIn.dur = Math.max(0.05, v); changed(true); })),
        field('Easing', selectInput([['smooth', 'Smooth'], ['linear', 'Linear'], ['easeIn', 'Ease in'], ['easeOut', 'Ease out']], o.anIn.rate || 'smooth', v => { o.anIn.rate = v; changed(); })))]));
    const later = scene.objects.filter(x => x !== o);
    const outKids = [
      field('Animation', selectInput(A.ANIM_OUT, o.anOut.type, v => {
        o.anOut.type = v;
        if (v === 'transform' && !o.anOut.target) { const t = later.find(x => x.start >= o.end - 0.3) || later[0]; if (t) linkTransform(o, t); }
        changed(true); renderInspector();
      })),
      h('div', { class: 'two' }, field('Seconds', numInput(o.anOut.dur, 0.1, v => { o.anOut.dur = Math.max(0.05, v); changed(true); })),
        field('Easing', selectInput([['smooth', 'Smooth'], ['linear', 'Linear'], ['easeIn', 'Ease in'], ['easeOut', 'Ease out']], o.anOut.rate || 'smooth', v => { o.anOut.rate = v; changed(); })))];
    if (o.anOut.type === 'transform') {
      outKids.push(field('Into', selectInput([['', '— choose —'], ...later.map(x => [x.id, x.name])], o.anOut.target || '', v => { const t = scene.objects.find(x => x.id === v); if (t) linkTransform(o, t); else o.anOut.target = ''; changed(true); })));
      outKids.push(h('p', { class: 'muted small' }, 'Morphs this object into the other one, like Manim’s Transform. The other object is set to start as this one ends, with no animation of its own.'));
    }
    box.append(sec('Animate out', outKids));

    // emphasis
    const em = (o.emph || []).map((e, i) => h('div', { class: 'emrow' },
      selectInput(A.EMPH, e.type, v => { e.type = v; changed(true); }),
      h('label', { class: 'mini' }, 'at', numInput(e.t, 0.1, v => { e.t = v; changed(true); })),
      h('label', { class: 'mini' }, 'for', numInput(e.dur, 0.1, v => { e.dur = Math.max(0.1, v); changed(true); })),
      h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Remove emphasis', onclick: () => { o.emph.splice(i, 1); commit(); renderInspector(); renderTimeline(); dirty = true; } }, '✕')));
    box.append(sec('Emphasis', [...em, h('button', { type: 'button', class: 'btn', onclick: () => { const t = Math.max(o.start + (o.anIn.dur || 0), Math.min(time, o.end - 1)); o.emph.push({ type: 'indicate', t: round(t, 2), dur: 1 }); commit(); renderInspector(); renderTimeline(); dirty = true; } }, '+ Add at playhead')]));
    box.append(sec('Idle motion', [field('While on screen', selectInput(A.LOOPS, o.loop || 'none', v => { o.loop = v; changed(); }))]));
  }
  function sec(title, kids) {
    const d = section(title, openSecs.has(title), ...kids);
    d.addEventListener('toggle', () => { if (d.open) openSecs.add(title); else openSecs.delete(title); });
    return d;
  }
  let riT = null, rtT = null;
  const renderInspectorSoon = () => { clearTimeout(riT); riT = setTimeout(() => { const a = document.activeElement; const tag = a && a.tagName; if (tag === 'TEXTAREA' || (tag === 'INPUT' && a.type === 'text')) return; renderInspector(); }, 250); };
  const renderTimelineSoon = () => { clearTimeout(rtT); rtT = setTimeout(renderTimeline, 120); };
  function renderInspectorValues() {
    const o = selObj(); if (!o) return;
    document.querySelectorAll('#inspector .kfrow').forEach(row => {
      const inp = row.querySelector('input'), p = inp.dataset.prop;
      if (document.activeElement !== inp) inp.value = round(A.keyVal(o, p, time), 2);
      const k = o.keys[p] || [], here = k.some(q => Math.abs(q.t - time) < 0.026);
      const b = row.querySelector('.keybtn'); b.className = 'keybtn' + (here ? ' on' : k.length ? ' some' : ''); b.textContent = here ? '◆' : '◇';
    });
  }
  function linkTransform(o, t) {
    o.anOut.target = t.id;
    t.start = round(o.end, 2);
    if (t.end <= t.start) t.end = round(t.start + 3, 2);
    t.anIn = Object.assign({}, t.anIn, { type: 'appear' });
    if (t.end > scene.duration) scene.duration = Math.ceil(t.end);
  }
  function move(d) {
    const i = scene.objects.findIndex(o => o.id === sel), j = i + d;
    if (j < 0 || j >= scene.objects.length) return;
    const a = scene.objects; [a[i], a[j]] = [a[j], a[i]];
    commit(); renderTimeline(); dirty = true;
  }
  function dup() {
    const o = selObj(); if (!o) return;
    const c = clone(o); c.id = uid(); c.name = o.name + ' copy'; c.x = round(c.x + 0.5); c.y = round(c.y - 0.5);
    scene.objects.push(c); commit(); select(c.id);
  }
  function del() {
    const o = selObj(); if (!o) return;
    scene.objects = scene.objects.filter(x => x !== o);
    scene.objects.forEach(x => { if (x.anOut.target === o.id) { x.anOut.target = ''; x.anOut.type = 'fadeout'; } });
    commit(); select(null);
  }
  function renderSceneSettings(box) {
    box.append(h('div', { class: 'insp-head' }, h('b', {}, 'Scene')));
    box.append(field('Name', (() => { const i = h('input', { type: 'text', value: scene.name }); i.addEventListener('input', () => { scene.name = i.value; commitSoon(); fillProjectsSoon(); }); return i; })()));
    box.append(field('Aspect ratio', selectInput(ASPECTS, scene.aspect, v => { scene.aspect = v; $('#aspect').value = v; commit(); sizeStage(); })));
    box.append(field('Background', h('div', { class: 'row' }, selectInput([...BGS, ['custom', 'Custom…']], BGS.some(b => b[0] === scene.bg) ? scene.bg : 'custom', v => { if (v !== 'custom') { scene.bg = v; commit(); dirty = true; renderInspector(); } }),
      (() => { const c = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(scene.bg) ? scene.bg : '#000000' }); c.addEventListener('input', () => { scene.bg = c.value; dirty = true; commitSoon(); }); return c; })())));
    box.append(field('Length (seconds)', numInput(scene.duration, 1, v => { scene.duration = Math.max(1, v); commitSoon(); renderTimeline(); dirty = true; })));
    box.append(h('p', { class: 'muted small' }, 'Tap an object on the stage or in the timeline to edit it. The frame is 8 units tall with (0, 0) at the centre, as in Manim. Switch on ⌗ guides to see the grid; dragging snaps to quarter units while they’re on.'));
    box.append(h('div', { class: 'muted small keys' }, h('b', {}, 'Keys: '), 'Space play/pause · ← → step 0.1 s · Delete remove · Ctrl+Z / Ctrl+Shift+Z undo/redo · Ctrl+D duplicate'));
  }
  let fpT = null; const fillProjectsSoon = () => { clearTimeout(fpT); fpT = setTimeout(() => { saveNow(); fillProjects(); }, 500); };

  // ---------- timeline ----------
  const NAMEW = 112;
  function renderTimeline() {
    const tl = $('#timeline');
    const sc0 = tl.querySelector('.tl-scroll');
    const keepX = sc0 ? sc0.scrollLeft : 0, keepY = sc0 ? sc0.scrollTop : 0;
    tl.textContent = '';
    const D = scene.duration;
    const width = NAMEW + D * pps + 40;
    const inner = h('div', { class: 'tl-inner', style: 'width:' + width + 'px' });
    const ruler = h('div', { class: 'tl-ruler' }, h('div', { class: 'tl-corner' }, h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Zoom out', onclick: () => { pps = Math.max(15, pps / 1.4); renderTimeline(); } }, '−'), h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Zoom in', onclick: () => { pps = Math.min(300, pps * 1.4); renderTimeline(); } }, '+')));
    const step = pps > 90 ? 0.5 : pps > 35 ? 1 : 2;
    for (let t = 0; t <= D + 1e-9; t += step) ruler.append(h('span', { class: 'tick' + (t % (step * 2) ? ' minor' : ''), style: 'left:' + (NAMEW + t * pps) + 'px' }, t % (step * 2) ? '' : (Number.isInteger(t) ? t : t.toFixed(1)) + 's'));
    ruler.append(h('div', { class: 'tl-end', style: 'left:' + (NAMEW + D * pps) + 'px', title: 'Scene end' }));
    inner.append(ruler);
    scene.objects.slice().reverse().forEach(o => {
      const { inD, outD } = A.phases(o);
      const left = o.start * pps, w = Math.max(6, (o.end - o.start) * pps);
      const clip = h('div', { class: 'tl-clip t-' + o.type + (o.id === sel ? ' sel' : ''), 'data-id': o.id, 'data-mode': 'move', style: 'left:' + left + 'px;width:' + w + 'px' },
        h('div', { class: 'ph in', style: 'width:' + inD * pps + 'px', title: o.anIn.type }),
        h('div', { class: 'ph out', style: 'width:' + outD * pps + 'px', title: o.anOut.type }),
        h('span', { class: 'clabel' }, (o.anOut.type === 'transform' ? '⇢ ' : '') + o.name),
        h('div', { class: 'hd l', 'data-id': o.id, 'data-mode': 'left' }), h('div', { class: 'hd r', 'data-id': o.id, 'data-mode': 'right' }));
      (o.emph || []).forEach((e, i) => clip.append(h('div', { class: 'em', 'data-id': o.id, 'data-mode': 'emph', 'data-i': i, title: e.type, style: 'left:' + (e.t - o.start) * pps + 'px;width:' + Math.max(8, e.dur * pps) + 'px' })));
      const kt = [...new Set(Object.values(o.keys || {}).flat().map(q => q.t))];
      kt.forEach(t => clip.append(h('div', { class: 'kf', 'data-id': o.id, 'data-mode': 'key', 'data-t': t, title: 'Keyframe ' + t + 's', style: 'left:' + (t - o.start) * pps + 'px' })));
      const row = h('div', { class: 'tl-row' + (o.id === sel ? ' sel' : '') },
        h('button', { type: 'button', class: 'tl-name', onclick: () => select(o.id), title: o.name }, h('span', { class: 'ti' }, A.TYPES[o.type].icon), o.name),
        h('div', { class: 'tl-track' }, clip));
      inner.append(row);
    });
    if (!scene.objects.length) inner.append(h('div', { class: 'tl-empty' }, 'Add something from the Add panel to start.'));
    inner.append(h('div', { class: 'tl-playhead', style: 'left:' + (NAMEW + time * pps) + 'px' }));
    const scr = h('div', { class: 'tl-scroll' }, inner);
    tl.append(scr);
    scr.scrollLeft = keepX; scr.scrollTop = keepY;
    attachTimeline(scr);
  }
  let tdrag = null;
  function attachTimeline(scr) {
    scr.addEventListener('pointerdown', e => {
      const t = e.target;
      if (t.closest('.tl-name') || t.closest('button')) return;
      const r = scr.getBoundingClientRect();
      const x = e.clientX - r.left + scr.scrollLeft - NAMEW;
      const m = t.dataset.mode;
      if (m && t.dataset.id) {
        const o = scene.objects.find(q => q.id === t.dataset.id);
        if (!o) return;
        if (sel !== o.id) { sel = o.id; renderInspector(); dirty = true; }
        tdrag = { mode: m, o, x0: e.clientX, s0: o.start, e0: o.end, snap0: clone(o), i: +t.dataset.i, kt: +t.dataset.t, moved: false };
        scr.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (x >= 0) { tdrag = { mode: 'scrub' }; setTime(x / pps); scr.setPointerCapture(e.pointerId); }
    });
    scr.addEventListener('pointermove', e => {
      if (!tdrag) return;
      if (tdrag.mode === 'scrub') { const r = scr.getBoundingClientRect(); setTime((e.clientX - r.left + scr.scrollLeft - NAMEW) / pps); return; }
      const d = snap((e.clientX - tdrag.x0) / pps);
      if (!tdrag.moved && Math.abs(e.clientX - tdrag.x0) < 4) return;
      tdrag.moved = true;
      const o = tdrag.o, s = tdrag.snap0;
      if (tdrag.mode === 'move') {
        const dd = Math.max(-s.start, d);
        o.start = round(s.start + dd); o.end = round(s.end + dd);
        o.emph = s.emph.map(x => Object.assign({}, x, { t: round(x.t + dd) }));
        o.keys = Object.fromEntries(Object.entries(s.keys).map(([k, v]) => [k, v.map(q => ({ t: round(q.t + dd), v: q.v, ease: q.ease }))]));
      } else if (tdrag.mode === 'left') o.start = round(Math.max(0, Math.min(s.start + d, s.end - 0.2)));
      else if (tdrag.mode === 'right') o.end = round(Math.max(s.end + d, s.start + 0.2));
      else if (tdrag.mode === 'emph') o.emph[tdrag.i].t = round(Math.max(0, s.emph[tdrag.i].t + d));
      else if (tdrag.mode === 'key') {
        const nt = round(Math.max(0, tdrag.kt + d));
        o.keys = Object.fromEntries(Object.entries(s.keys).map(([k, v]) => [k, v.map(q => Math.abs(q.t - tdrag.kt) < 1e-6 ? { t: nt, v: q.v, ease: q.ease } : q).sort((a, b) => a.t - b.t)]));
      }
      if (o.end > scene.duration) scene.duration = Math.ceil(o.end);
      dirty = true;
      renderTimeline();
    });
    const up = () => {
      if (!tdrag) return;
      const td = tdrag; tdrag = null;
      if (td.mode === 'scrub') { renderInspector(); return; }
      if (!td.moved) { if (td.mode === 'key') setTime(td.kt); else if (td.mode === 'emph') setTime(td.o.emph[td.i].t); renderTimeline(); renderInspector(); if (narrow() && td.mode === 'move') {/* stay */} return; }
      // keep transform partners joined
      scene.objects.forEach(x => { if (x.anOut.type === 'transform' && x.anOut.target) { const t = scene.objects.find(y => y.id === x.anOut.target); if (t && (x === td.o || t === td.o)) { if (t === td.o) x.end = t.start; else { const len = t.end - t.start; t.start = x.end; t.end = round(t.start + len); } } } });
      commit(); renderTimeline(); renderInspector();
    };
    scr.addEventListener('pointerup', up); scr.addEventListener('pointercancel', up);
  }

  // ---------- panels on phones ----------
  function showPanel(p) {
    document.body.dataset.panel = p;
    document.querySelectorAll('.mtabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.p === p));
  }

  // ---------- export ----------
  function pickMime() {
    const c = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    if (typeof MediaRecorder === 'undefined') return null;
    return c.find(m => MediaRecorder.isTypeSupported(m)) || '';
  }
  function exportSize(short) {
    const r = ratio(scene.aspect);
    let W, H;
    if (r >= 1) { H = short; W = Math.round(short * r / 2) * 2; } else { W = short; H = Math.round(short / r / 2) * 2; }
    return [W, H];
  }
  function openExport() {
    setPlaying(false);
    const dlg = $('#exportDlg'); dlg.textContent = '';
    const mime = pickMime();
    const res = selectInput([['720', '720p'], ['1080', '1080p'], ['1440', '1440p'], ['2160', '4K (slow on phones)']], '1080', () => info());
    const fps = selectInput([['30', '30 fps'], ['60', '60 fps']], '30', () => {});
    const sz = h('p', { class: 'muted small' });
    function info() { const [W, H] = exportSize(+res.value); sz.textContent = W + ' × ' + H + ' · ' + scene.aspect + ' · ' + fmtT(scene.duration) + ' · ' + (mime ? (mime.includes('mp4') ? 'MP4' : 'WebM') : 'video recording isn’t supported in this browser'); }
    info();
    const prog = h('progress', { max: 1, value: 0, hidden: true });
    const status = h('p', { class: 'small', 'aria-live': 'polite' });
    let cancel = null;
    const go = h('button', { type: 'button', class: 'btn primary', disabled: !mime && mime !== '' ? true : false, onclick: async () => {
      go.disabled = true; prog.hidden = false;
      cancel = await recordVideo(+res.value, +fps.value, mime, (p, msg) => { prog.value = p; status.textContent = msg; }, () => { go.disabled = false; prog.hidden = true; });
    } }, '● Record video');
    const png = h('button', { type: 'button', class: 'btn', onclick: () => exportPNG(+res.value) }, '⤓ This frame as PNG');
    dlg.append(h('div', { class: 'dlg' },
      h('h2', {}, 'Export'),
      h('div', { class: 'two' }, field('Resolution', res), field('Frame rate', fps)), sz,
      h('p', { class: 'muted small' }, 'The video records in real time, so it takes as long as the scene. Keep the screen on and the app open until it finishes.'),
      prog, status,
      h('div', { class: 'row' }, go, png, h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn quiet', onclick: () => { if (cancel) cancel(); dlg.close(); } }, 'Close'))));
    dlg.showModal();
  }
  function slug() { return (scene.name || 'animation').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'animation'; }
  function download(name, blob) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 8000); }
  function exportPNG(short) {
    const [W, H] = exportSize(short);
    const c = h('canvas'); c.width = W; c.height = H;
    A.render(c.getContext('2d'), scene, time, W, H);
    c.toBlob(b => download(slug() + '-' + time.toFixed(1) + 's.png', b), 'image/png');
  }
  function recordVideo(short, fps, mime, onProg, onDone) {
    const [W, H] = exportSize(short);
    const c = h('canvas', { style: 'position:fixed;left:-99999px;top:0;width:10px;height:10px' }); c.width = W; c.height = H;
    document.body.append(c);
    const ctx = c.getContext('2d');
    A.render(ctx, scene, 0, W, H);
    const stream = c.captureStream(fps);
    let rec;
    try { rec = new MediaRecorder(stream, Object.assign(mime ? { mimeType: mime } : {}, { videoBitsPerSecond: Math.round(Math.min(40e6, W * H * fps * 0.12)) })); }
    catch (e) { onProg(0, 'This browser can’t record video: ' + e.message); onDone(); c.remove(); return null; }
    const chunks = [];
    let stopped = false, raf = 0;
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      cancelAnimationFrame(raf); c.remove();
      if (stopped === 'cancel') { onProg(0, 'Cancelled.'); onDone(); return; }
      const type = rec.mimeType || mime || 'video/webm';
      const blob = new Blob(chunks, { type });
      download(slug() + (type.includes('mp4') ? '.mp4' : '.webm'), blob);
      onProg(1, 'Done: ' + (blob.size / 1e6).toFixed(1) + ' MB saved to your downloads.');
      onDone();
    };
    rec.start(500);
    const start = performance.now();
    const D = scene.duration;
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      A.render(ctx, scene, Math.min(t, D), W, H);
      onProg(Math.min(1, t / D), 'Recording… ' + fmtT(Math.min(t, D)) + ' of ' + fmtT(D));
      if (t >= D + 0.25) { stopped = true; rec.stop(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (!stopped) { stopped = 'cancel'; rec.stop(); } };
  }

  // ---------- menu ----------
  function openMenu() {
    const dlg = $('#menuDlg'); dlg.textContent = '';
    const act = (label, fn, cls) => h('button', { type: 'button', class: 'btn ' + (cls || ''), onclick: () => { dlg.close(); fn(); } }, label);
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async () => {
      const f = fileIn.files[0]; if (!f) return;
      try { const s = JSON.parse(await f.text()); if (!s.objects) throw new Error('not an Animath project'); createProject(s); toast('Imported “' + s.name + '”'); } catch (e) { toast('Couldn’t import: ' + e.message); }
    } });
    dlg.append(h('div', { class: 'dlg' }, h('h2', {}, 'Project'), h('div', { class: 'menu' },
      act('+ New blank project', () => createProject(newScene('Untitled ' + (index().length + 1)))),
      act('+ New from the demo', () => createProject(demoScene())),
      act('⧉ Duplicate this project', () => { const s = clone(scene); s.name += ' copy'; createProject(s); }),
      act('⤓ Save project file (.json)', () => download(slug() + '.animath.json', new Blob([JSON.stringify(clone(scene), null, 1)], { type: 'application/json' }))),
      act('⤒ Open a project file', () => fileIn.click()),
      act('🗑 Delete this project', () => {
        if (!confirm('Delete “' + scene.name + '”? This can’t be undone.')) return;
        store.del('animath.p.' + projId);
        store.set('animath.index', index().filter(p => p.id !== projId));
        const next = index()[0];
        if (next) openProject(next.id); else createProject(demoScene());
      }, 'quiet')),
      h('p', { class: 'muted small' }, 'Projects are saved in this app on this device. Save a project file now and then as a backup.'),
      fileIn,
      h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn quiet', onclick: () => dlg.close() }, 'Close'))));
    dlg.showModal();
  }

  // ---------- demo ----------
  function demoScene() {
    const s = newScene('Demo');
    s.duration = 26;
    const save = scene; scene = s;
    const O = (type, over) => { time = over.start; const o = makeObj(type, over); s.objects.push(o); return o; };
    O('title', { name: 'Title', start: 0, end: 3.6, props: { title: 'Animath', subtitle: 'Manim-style animation, on your phone' }, anIn: { type: 'write', dur: 1.6, rate: 'linear' } });
    const e1 = O('math', { name: 'Euler', start: 3.6, end: 6.6, props: { tex: 'e^{i\\pi} + 1 = 0', size: 1.3 } });
    const e2 = O('math', { name: 'Basel', start: 6.6, end: 10, props: { tex: '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}', size: 1.1 }, emph: [{ type: 'circumscribe', t: 7.6, dur: 1.4 }] });
    e1.anOut = { type: 'transform', target: e2.id, dur: 1.2, rate: 'smooth' }; e2.anIn = { type: 'appear', dur: 0.5 };
    O('graph', { name: 'Graph', start: 10, end: 16, props: { f2: 'cos(x)', l2: '\\cos x', tracer: true }, anIn: { type: 'create', dur: 2.2, rate: 'smooth' } });
    O('venn', { name: 'Venn', start: 16, end: 21.5, x: -3.3, y: 0.2, scale: 0.85, props: { shade: 'A ∩ B' }, anIn: { type: 'create', dur: 1.5 } });
    O('truth', { name: 'Truth table', start: 16.6, end: 21.5, x: 3.4, y: 0, props: { formula: '(P -> Q) & P -> Q' }, emph: [{ type: 'indicate', t: 19.3, dur: 1 }] });
    O('sticker', { name: 'Star', start: 18.6, end: 21.5, x: 6, y: 3, scale: 0.6, props: { kind: 'sparkle' }, anIn: { type: 'spin', dur: 0.8 }, loop: 'pulse' });
    const sq = O('shape', { name: 'Square', start: 21.5, end: 23.2, x: -2, props: { shape: 'square', fill: 'BLUE', fo: 0.5, color: 'BLUE' } });
    const ci = O('shape', { name: 'Circle', start: 23.2, end: 26, x: -2, props: { shape: 'circle', color: 'PINK', fill: 'PINK', fo: 0.5 }, keys: { x: [{ t: 23.6, v: -2 }, { t: 25, v: 2 }] }, anOut: { type: 'fadeout', dur: 0.6 } });
    sq.anOut = { type: 'transform', target: ci.id, dur: 1, rate: 'smooth' }; ci.anIn = { type: 'appear', dur: 0.5 };
    scene = save; time = 0;
    return s;
  }

  // ---------- wiring ----------
  function refreshAll() {
    $('#aspect').value = scene.aspect;
    sizeStage(); renderInspector(); renderTimeline(); dirty = true;
    document.title = scene.name + ' · Animath';
  }
  $('#play').addEventListener('click', () => setPlaying(!playing));
  $('#toStart').addEventListener('click', () => { setPlaying(false); setTime(0); followPlayhead(); });
  $('#toEnd').addEventListener('click', () => { setPlaying(false); setTime(scene.duration); followPlayhead(); });
  $('#loopBtn').addEventListener('click', e => { const b = e.currentTarget; b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'); });
  $('#guides').addEventListener('click', e => { guides = !guides; e.currentTarget.setAttribute('aria-pressed', guides); dirty = true; });
  $('#aspect').append(...ASPECTS.map(([k, l]) => h('option', { value: k }, k)));
  $('#aspect').addEventListener('change', e => { scene.aspect = e.target.value; commit(); sizeStage(); if (!sel) renderInspector(); });
  $('#undo').addEventListener('click', () => undo(-1));
  $('#redo').addEventListener('click', () => undo(1));
  $('#exportBtn').addEventListener('click', openExport);
  $('#menuBtn').addEventListener('click', openMenu);
  $('#proj').addEventListener('change', e => openProject(e.target.value));
  document.querySelectorAll('.mtabs button').forEach(b => b.addEventListener('click', () => showPanel(b.dataset.p)));
  addEventListener('resize', () => sizeStage());
  if (window.ResizeObserver) new ResizeObserver(() => sizeStage()).observe($('#stageWrap'));
  addEventListener('keydown', e => {
    const tag = (document.activeElement || {}).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
    else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(e.shiftKey ? 1 : -1); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); undo(1); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); dup(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); del(); }
    else if (e.key === 'ArrowLeft') { setTime(time - 0.1); followPlayhead(); }
    else if (e.key === 'ArrowRight') { setTime(time + 0.1); followPlayhead(); }
    else if (e.key === 'Escape') select(null);
  });

  // fonts: KaTeX's Computer Modern fonts load from jsDelivr; re-measure once they arrive
  if (document.fonts) {
    const fams = ['KaTeX_Main', 'italic 20px KaTeX_Main', 'bold 20px KaTeX_Main', 'italic 20px KaTeX_Math', '20px KaTeX_AMS', 'italic 20px KaTeX_Size1', '20px KaTeX_Size1', '20px KaTeX_Caligraphic', '20px "IBM Plex Sans"', '20px "IBM Plex Mono"'];
    Promise.all(fams.map(f => document.fonts.load(f.includes('px') ? f : '20px ' + f).catch(() => null))).then(() => { A.fontsChanged(); dirty = true; if (selObj()) renderInspector(); });
  }

  renderAdd();
  showPanel('timeline');
  const cur = store.get('animath.current', null);
  if (!(cur && openProject(cur))) { const first = index()[0]; if (!(first && openProject(first.id))) createProject(demoScene()); }
  requestAnimationFrame(loop);
  window.AnimathEditor = { get scene() { return scene; }, setTime, select, addObj, demoScene, setPlaying, get time() { return time; } };
})();
