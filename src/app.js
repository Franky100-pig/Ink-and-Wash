/* 墨息 · Ink Quiet — 离线沙盒疗愈（水墨半）
 *
 * 渲染底座：window.Suminagashi（改编自 fisheryv/healing，MIT）。
 * 本文件负责“交互”——也就是 IDEAS.md 里反复说的那件事：
 *   AI 在画，但笔权永远在用户手里；用户落笔，AI 立刻让位。
 *
 * 设计纪律（来自 IDEAS.md v3）：
 *   - 不评分、不过关、不失败、不爆炸。
 *   - AI 只出“意图”（往哪落、多干多湿），真正的笔触交给流体物理。
 *   - AI 的墨不表达情绪，只回应节奏；不打扰、不覆盖用户的笔。
 */

(function () {
  'use strict'

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
  }

  try {

  // ── 中英双语 UI（字不多，直接上字典；不持久化——隐私承诺：什么都不存）──
  const I18N = {
    zh: {
      modeInk: '墨', modeSand: '沙', modeFine: '精',
      modeTipInk: '墨：AI 同伴陪你画，随时可打断它',
      modeTipSand: '沙：九种材料的物理沙盒',
      modeTipFine: '精：无 AI，细笔、少扩散，自己创作',
      hide: '隐藏', hideTip: '隐藏工具栏（快捷键 C）',
      brush: '笔触', density: '浓度', patience: 'AI 耐心', aiBrush: 'AI 笔触',
      clear: '归零', save: '存图', saved: '已保存 ✓',
      aiOn: 'AI 同伴：开', aiOff: 'AI 同伴：关',
      hintInk: '落笔，或让 AI 先画。你随时可以打断它。',
      hintSand: '倒一把沙，或让 AI 慢慢堆一座小丘。你随时可以打断它。',
      hintFine: '静心细画。AI 已让位，画布全归你。',
      inkSumi: '松烟墨', inkShu: '朱', inkMatsuba: '松叶', inkAi: 'AI 的蓝', inkWhite: '白（减淡 / 留白）',
      matSand: '沙（下落 / 沉水）', matFire: '火（上浮 / 烧尽 / 引爆炸弹 / 点燃植物）',
      matWater: '水（下落 / 浇灭火 → 蒸汽）', matCloud: '云（上浮 / 下雨 / 凝水）',
      matBomb: '炸弹颗粒（引信 / 碰火即爆）', matSeed: '种子（落水边发芽）',
      matPlant: '植物（生长 / 遇火燃烧）', matSnow: '雪（慢落堆积 / 遇火化水）',
      matSteam: '蒸汽（上升 / 凝回水滴）',
      ariaBar: '画具', ariaMode: '物态', ariaInks: '你的墨色', ariaMats: '你的材料',
      immersive: '按 C 呼出工具栏',
      langTitle: '切换语言 / Language',
    },
    en: {
      modeInk: 'Ink', modeSand: 'Sand', modeFine: 'Fine',
      modeTipInk: 'Ink: an AI companion paints with you — interrupt anytime',
      modeTipSand: 'Sand: a physics sandbox with 9 materials',
      modeTipFine: 'Fine: no AI, fine brush, minimal spread — create on your own',
      hide: 'Hide', hideTip: 'Hide the toolbar (shortcut: C)',
      brush: 'Brush', density: 'Density', patience: 'AI patience', aiBrush: 'AI brush',
      clear: 'Clear', save: 'Save PNG', saved: 'Saved ✓',
      aiOn: 'AI companion: on', aiOff: 'AI companion: off',
      hintInk: 'Paint, or let the AI start. You can interrupt it anytime.',
      hintSand: 'Pour some sand, or let the AI pile a little dune. You can interrupt it anytime.',
      hintFine: 'Paint finely. The AI steps aside — the canvas is all yours.',
      inkSumi: 'Pine soot', inkShu: 'Vermilion', inkMatsuba: 'Pine needle', inkAi: 'AI blue', inkWhite: 'White (lighten / blank)',
      matSand: 'Sand (falls / sinks in water)', matFire: 'Fire (rises / burns out / detonates bombs / ignites plants)',
      matWater: 'Water (falls / douses fire → steam)', matCloud: 'Cloud (rises / rains / condenses)',
      matBomb: 'Bomb grains (fuse / explodes on fire)', matSeed: 'Seed (sprouts near water)',
      matPlant: 'Plant (grows / burns)', matSnow: 'Snow (slow piles / melts by fire)',
      matSteam: 'Steam (rises / condenses back to water)',
      ariaBar: 'Tools', ariaMode: 'Mode', ariaInks: 'Your inks', ariaMats: 'Your materials',
      immersive: '按 C 呼出工具栏',
      immersive: 'Press C to show the toolbar',
      langTitle: '切换语言 / Language',
    },
  }

  if (!window.Suminagashi) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">引擎未加载（Suminagashi 缺失）。请确认 lib/ 下的文件就位。</p>'
    window.__ink = { initError: 'Suminagashi not loaded' }
    return
  }

  const canvas = document.getElementById('stage')
  let engine = null
  let initError = ''
  try {
    engine = new window.Suminagashi(canvas)
  } catch (e) {
    initError = String(e && e.message || e)
    console.error('Suminagashi init failed:', e)
  }
  const INKS = window.INKS
  // 沙盒引擎（叠加在墨画布之上的 2D 层）。缺失则沙模式不可用，但墨模式照常。
  const sandCanvas = document.getElementById('sand-stage')
  let sand = null
  if (window.SandSim && sandCanvas) {
    try { sand = new window.SandSim(sandCanvas) } catch (e) { console.error('SandSim init failed:', e) }
  }

  if (!engine) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">WebGL 上下文不可用，无法启动水墨引擎。<br>错误：' + escapeHtml(initError) + '</p>'
    window.__ink = { initError }
    return
  }

  // AI 自己的调色盘（不含白色——白色是用户的橡皮，AI 不碰）。
  // AI 会自己在这些颜色里慢慢换，让画面颜色流动但不喧哗。
  const AI_PALETTE = [INKS.sumi, INKS.ai, INKS.shu, INKS.matsuba]
  let aiColorIdx = 1 // 起始用那一抹安静的蓝

  // ── 状态 ──
  const state = {
    drawing: false,
    lastUV: null,            // 上一笔的归一化坐标 {x,y}
    userInk: 'sumi',         // 用户当前墨色
    strength: 1.4,           // 笔触强度（影响扩散/流动，也带一点底色）
    concentration: 1.0,      // 浓度倍率（纯墨色深浅，不影响扩散）
    aiOn: true,
    aiPatience: 4.0,         // AI 两次落笔之间的秒数（=“耐心”旋钮）
    aiSize: 1.0,             // AI 笔触大小（缩放落墨半径；用户可滑）
    mode: 'ink',             // 当前物态：'ink' 或 'sand'
    userEl: 'sand',          // 沙模式下用户当前材料
    lang: 'zh',              // UI 语言：'zh' 或 'en'（不持久化）
    lastUserActivity: -1e9,  // 用户最近一次落笔的时间戳(ms)
    recentUser: [],          // 最近 ~3s 的用户落点，用于让 AI“绕开”
  }
  const YIELD_GRACE = 1500   // 用户停笔后，AI 要再等这么久才接手(ms)
  const RECENT_WINDOW = 3000 // 记录用户落点的时间窗(ms)
  let nextDropAt = performance.now() + state.aiPatience * 1000
  let aiPour = null           // 沙模式 AI 的“倒沙/堆丘”连浇状态（由 advanceAiPour 每帧推进）
  let lastSample = 0          // 上次感知整张纸明暗的时间戳(ms)
  let canvasDark = 0          // 整张纸平均暗度：0=纸白，1=全黑（供 AI 自我收敛）

  // ── 坐标：屏幕像素 → 归一化 UV（y 翻转，因为 WebGL 原点在左下）──
  function toUV(e) {
    const r = canvas.getBoundingClientRect()
    let x = (e.clientX - r.left) / r.width
    let y = 1 - (e.clientY - r.top) / r.height
    x = Math.min(1, Math.max(0, x))
    y = Math.min(1, Math.max(0, y))
    return { x, y }
  }

  function markActivity(uv) {
    const now = performance.now()
    state.lastUserActivity = now
    state.recentUser.push({ x: uv.x, y: uv.y, t: now })
    if (state.recentUser.length > 60) state.recentUser.shift()
  }

  // 用户落一笔（连续笔触：沿方向注入墨 + 速度，墨会顺着笔迹流动）
  function userStroke(uv) {
    let dx = 0, dy = 0
    if (state.lastUV) {
      dx = uv.x - state.lastUV.x
      dy = uv.y - state.lastUV.y
    }
    const len = Math.hypot(dx, dy)
    if (len > 1e-5) { dx /= len; dy /= len } else {
      const a = Math.random() * Math.PI * 2
      dx = Math.cos(a); dy = Math.sin(a)
    }
    const color = INKS[state.userInk] || INKS.sumi
    engine.strokeInk(uv.x, uv.y, color, state.strength, dx, dy, 0.85)
    markActivity(uv)
    state.lastUV = uv
  }

  // ── 指针事件（鼠标 + 触摸统一）──
  // 同一套事件，按当前模式分发：墨模式走流体笔触，沙模式走倒沙放置。
  function pointerAct(uv, first) {
    if (state.mode === 'ink' || state.mode === 'fine') {
      userStroke(uv)
    } else if (sand) {
      const ny = 1 - uv.y           // 沙用顶→底坐标（UV 的 y=1 在顶部，需翻转）
      if (first || !state.lastUV) sand.place(uv.x, ny, state.userEl, state.strength, 1)
      else sand.placeLine(state.lastUV.x, 1 - state.lastUV.y, uv.x, ny, state.userEl, state.strength, 1)
      markActivity(uv)
    }
    state.lastUV = uv
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    state.drawing = true
    state.lastUV = null
    pointerAct(toUV(e), true)
    fadeHint()
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!state.drawing) return
    e.preventDefault()
    pointerAct(toUV(e), false)
  })
  const stop = () => { state.drawing = false; state.lastUV = null }
  canvas.addEventListener('pointerup', stop)
  canvas.addEventListener('pointercancel', stop)
  canvas.addEventListener('pointerleave', stop)

  // ── “哑 AI”同伴（两模式共用一套让位规则）──
  // 每隔 patience 秒，若用户已安静（停笔超过 YIELD_GRACE），才行动一次。
  // 落点会避开用户最近的笔迹 → 这就是“让位 / 退开留白”。
  function aiTick(now) {
    if (state.mode === 'fine') { nextDropAt = now + state.aiPatience * 1000; return }
    if (!state.aiOn) { nextDropAt = now + state.aiPatience * 1000; return }
    if (now < nextDropAt) return
    const sinceUser = now - state.lastUserActivity
    if (sinceUser < YIELD_GRACE) {
      // 用户还在画/刚停：这轮不打扰，等下一个周期再看
      nextDropAt = now + state.aiPatience * 1000
      return
    }
    if (state.mode === 'ink') aiTickInk(now)
    else aiTickSandStart(now)
  }

  // 墨模式 AI：感知明暗自我收敛（暗了少画/提亮），并自己换色画一小段笔触
  function aiTickInk(now) {
    if (now - lastSample > 1000) { lastSample = now; sampleDarkness() }
    const dark = canvasDark

    // 偏暗收敛：太黑就少画，或直接用白色把过黑处刷开一点，别让画面闷死。
    if (dark > 0.62) {
      if (Math.random() < 0.55) { nextDropAt = now + state.aiPatience * 1000; return } // 这轮跳过，少画
      aiStroke(INKS.white, 1.4, state.aiSize)   // 白色把过黑处提亮
      nextDropAt = now + state.aiPatience * 1000
      return
    }
    if (dark > 0.42) {
      if (Math.random() < 0.5) { aiStroke(INKS.white, 1.4, state.aiSize); nextDropAt = now + state.aiPatience * 1000; return }
    }

    // AI 自己换色：多数时候沿用当前色（保持一段连贯），偶尔换到另一种，
    // 于是随着时间推移画面颜色会自己流动起来——这就是“AI 自己换颜色”。
    if (Math.random() < 0.35) {
      let n = aiColorIdx
      while (n === aiColorIdx) n = Math.floor(Math.random() * AI_PALETTE.length)
      aiColorIdx = n
    }
    const ink = AI_PALETTE[aiColorIdx]
    // 1.4：与用户默认笔触同强度；state.aiSize：用户可滑的“AI 笔触”大小
    aiStroke(ink, 1.4, state.aiSize)

    nextDropAt = now + state.aiPatience * 1000
  }

  // 沙模式 AI：开始一次“倒沙/堆丘”连浇（具体落粒由 advanceAiPour 每帧推进）
  function aiTickSandStart(now) {
    if (!sand) { nextDropAt = now + state.aiPatience * 1000; return }
    if (sand.fullness() > 0.35) { nextDropAt = now + state.aiPatience * 1000; return } // 盒子太满就收手，避免糊成一团
    const spot = pickYieldSpot()  // 屏幕 UV，已避开用户最近处
    let sx, sy
    if (Math.random() < 0.5) {
      // 底部左右角落堆丘，把中心留给用户
      sx = Math.random() < 0.5 ? (0.08 + Math.random() * 0.2) : (0.72 + Math.random() * 0.2)
      sy = 0.1 + Math.random() * 0.2
    } else { sx = spot.x; sy = spot.y }
    aiPour = { x: sx, y: 1 - sy, el: chooseSandEl(), until: now + 1800 + Math.random() * 1000 }
    nextDropAt = now + state.aiPatience * 1000
  }

  // 沙模式 AI 每帧推进一次连浇；用户刚动则让位（本帧不浇）
  function advanceAiPour(now) {
    if (state.mode !== 'sand' || !sand || !state.aiOn) { aiPour = null; return }
    if (!aiPour) return
    if (now - state.lastUserActivity < YIELD_GRACE) return  // 用户刚动 → 让位
    if (now >= aiPour.until) { aiPour = null; return }
    const n = Math.max(1, Math.round(state.aiSize * 3))
    for (let k = 0; k < n; k++) sand.place(aiPour.x, aiPour.y, aiPour.el, 1, state.aiSize)
  }

  function chooseSandEl() {
    const r = Math.random()
    if (r < 0.28) return 'sand'
    if (r < 0.45) return 'water'
    if (r < 0.57) return 'cloud'
    if (r < 0.66) return 'fire'
    if (r < 0.78) return 'snow'
    if (r < 0.87) return 'steam'
    if (r < 0.96) return 'seed'
    return 'bomb' // 炸弹权重低，AI 不会乱炸
  }

  // 采样整张纸的平均明暗：0=纸白，1=全黑。约每秒调一次，用来让 AI 自我收敛，
  // 避免“墨永久不褪”后整张被盖成黑的。drawImage 直接读刚渲染的那一帧。
  function sampleDarkness() {
    try {
      const gl = engine.renderer.domElement
      engine.render(performance.now())   // 确保截到最新一帧
      const c = document.createElement('canvas')
      c.width = 64; c.height = 64
      const ctx = c.getContext('2d')
      ctx.drawImage(gl, 0, 0, c.width, c.height)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let sum = 0
      for (let i = 0; i < d.length; i += 4) {
        const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255
        sum += lum
      }
      const avg = sum / (d.length / 4)   // 空白宣纸约 0.92
      canvasDark = 1 - avg
    } catch (e) {
      // 采样失败就沿用上次的值，不打断作画
    }
  }

  // AI 每轮画一小段连续笔触（多节缓慢转向的短划），而不是孤零零一滴，
  // 这样看起来才像在“画”，而不是偶尔点一下。每节都避开用户的笔迹中心（让位/留白）。
  // size：落墨半径倍率（由“AI 笔触”滑块控制，越大笔越粗）。
  function aiStroke(ink, strength, size) {
    const start = pickYieldSpot()
    let x = start.x, y = start.y
    let ang = Math.random() * Math.PI * 2
    const segs = 7            // 一节短划 ≈ 一笔里的一小段
    const stepLen = 0.045     // 每节在 UV 空间里挪动的距离
    for (let i = 0; i < segs; i++) {
      ang += (Math.random() - 0.5) * 0.9   // 轻微转向，走出柔和曲线而非直线
      const dx = Math.cos(ang), dy = Math.sin(ang)
      const nx = Math.min(1, Math.max(0, x + dx * stepLen))
      const ny = Math.min(1, Math.max(0, y + dy * stepLen))
      engine.strokeInk(nx, ny, ink, strength, dx, dy, size)
      x = nx; y = ny
    }
  }

  function pickYieldSpot() {
    if (state.recentUser.length === 0) {
      return { x: 0.15 + Math.random() * 0.7, y: 0.15 + Math.random() * 0.7 }
    }
    let cx = 0, cy = 0
    for (const p of state.recentUser) { cx += p.x; cy += p.y }
    cx /= state.recentUser.length; cy /= state.recentUser.length
    // 试若干次，挑离用户中心最远、又不在边角的点
    let best = null, bestD = -1
    for (let i = 0; i < 12; i++) {
      const x = 0.1 + Math.random() * 0.8
      const y = 0.1 + Math.random() * 0.8
      const d = Math.hypot(x - cx, y - cy)
      if (d > bestD) { bestD = d; best = { x, y } }
    }
    return best || { x: 0.5, y: 0.5 }
  }

  // ── 主循环：模拟一直推进，墨才会持续洇开、呼吸 ──
  let last = performance.now()
  function frame(now) {
    let dt = (now - last) / 1000
    last = now
    if (dt > 0.05) dt = 0.05        // 切后台回来不要炸
    if (state.mode !== 'sand' || !sand) {
      engine.step(dt)
      engine.render(now)
    } else {
      sand.step(dt)
      sand.render(now)
    }
    aiTick(now)
    if (state.mode === 'sand') advanceAiPour(now)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // ── UI 绑定 ──
  // 用 $() / on() 包一层：控件缺失时静默跳过。
  // 这样 selftest.html 可以只放一块画布就复用同一份 app.js。
  const $ = (id) => document.getElementById(id)
  const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn) }

  // 提示语元素：提前到 UI 绑定前定义，避免 setMode 在初始化期同步调用时访问 const hint 触发 TDZ 报错
  const hint = $('hint')
  let hintGone = false

  const inkButtons = Array.from(document.querySelectorAll('#ink-group .ink'))
  function setInk(name) {
    state.userInk = name
    inkButtons.forEach((b) => b.classList.toggle('active', b.dataset.ink === name))
  }
  inkButtons.forEach((b) => on(b, 'click', () => setInk(b.dataset.ink)))
  setInk('sumi')

  // 沙元素选择（复用 .ink 圆点样式）
  const sandButtons = Array.from(document.querySelectorAll('#sand-group .ink'))
  function setEl(name) {
    state.userEl = name
    sandButtons.forEach((b) => b.classList.toggle('active', b.dataset.el === name))
  }
  sandButtons.forEach((b) => on(b, 'click', () => setEl(b.dataset.el)))
  setEl('sand')

  // 墨 / 沙 模式切换（“同一个场，两种物态”：换笔 + 换物理，不是换程序）
  const modeBtns = Array.from(document.querySelectorAll('.mode-btn'))
  // 精细创作（fine art）：笔触更细、扩散更少、AI 完全让位；退出后恢复墨模式原参数。
  const FINE_PARAMS = { SPLAT_RADIUS: 0.00035, SPLAT_VELOCITY: 0.1, CURL: 2 }
  let savedEngineParams = null
  let savedAiOn = true
  function setMode(m) {
    // ── 精细模式进出：引擎参数与 AI 状态的切换 ──
    if (m === 'fine' && state.mode !== 'fine') {
      savedEngineParams = {
        SPLAT_RADIUS: engine.config.SPLAT_RADIUS,
        SPLAT_VELOCITY: engine.config.SPLAT_VELOCITY,
        CURL: engine.config.CURL,
      }
      engine.config.SPLAT_RADIUS = FINE_PARAMS.SPLAT_RADIUS
      engine.config.SPLAT_VELOCITY = FINE_PARAMS.SPLAT_VELOCITY
      engine.config.CURL = FINE_PARAMS.CURL
      savedAiOn = state.aiOn
      state.aiOn = false
      if (aiToggle) {
        aiToggle.classList.remove('on'); aiToggle.classList.add('off')
        aiToggle.setAttribute('aria-pressed', 'false')
      }
    }
    if (m !== 'fine' && state.mode === 'fine' && savedEngineParams) {
      engine.config.SPLAT_RADIUS = savedEngineParams.SPLAT_RADIUS
      engine.config.SPLAT_VELOCITY = savedEngineParams.SPLAT_VELOCITY
      engine.config.CURL = savedEngineParams.CURL
      state.aiOn = savedAiOn
      if (aiToggle) {
        aiToggle.classList.toggle('on', state.aiOn)
        aiToggle.classList.toggle('off', !state.aiOn)
        aiToggle.setAttribute('aria-pressed', String(state.aiOn))
      }
    }
    state.mode = m
    document.body.classList.toggle('mode-sand', m === 'sand')
    document.body.classList.toggle('mode-ink', m !== 'sand')
    document.body.classList.toggle('mode-fine', m === 'fine')
    modeBtns.forEach((b) => {
      const on2 = b.dataset.mode === m
      b.classList.toggle('active', on2)
      b.setAttribute('aria-selected', String(on2))
    })
    if (m === 'sand' && sand) sand.render(performance.now())  // 切回时立刻恢复沙画
    const hintKey = m === 'sand' ? 'hintSand' : (m === 'fine' ? 'hintFine' : 'hintInk')
    setHint(I18N[state.lang][hintKey])
    state.drawing = false
    state.lastUV = null
  }
  modeBtns.forEach((b) => on(b, 'click', () => setMode(b.dataset.mode)))
  setMode('ink')

  // ── 中/EN 切换 ──
  function applyLang() {
    const dict = I18N[state.lang] || I18N.zh
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const k = el.getAttribute('data-i18n')
      if (dict[k] != null) el.textContent = dict[k]
    })
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const k = el.getAttribute('data-i18n-title')
      if (dict[k] != null) { el.title = dict[k]; el.setAttribute('aria-label', dict[k]) }
    })
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const k = el.getAttribute('data-i18n-aria')
      if (dict[k] != null) el.setAttribute('aria-label', dict[k])
    })
    if (aiToggle) aiToggle.textContent = state.aiOn ? dict.aiOn : dict.aiOff
    const langBtn = $('lang')
    if (langBtn) langBtn.textContent = state.lang === 'zh' ? 'EN' : '中文'
    const hintKey = state.mode === 'sand' ? 'hintSand' : (state.mode === 'fine' ? 'hintFine' : 'hintInk')
    if (!hintGone) setHint(dict[hintKey])
  }
  on($('lang'), 'click', () => {
    state.lang = state.lang === 'zh' ? 'en' : 'zh'
    applyLang()
  })

  // ── 沉浸模式：按 C 隐藏 / 呼出工具栏；画面空白时显示一行淡说明 ──
  function isCanvasEmpty() {
    try {
      if (state.mode === 'sand' && sand) return sand.fullness() < 0.005
      engine.render(performance.now())
      const gl = engine.renderer.domElement
      const c = document.createElement('canvas')
      c.width = 64; c.height = 64
      const ctx = c.getContext('2d')
      ctx.drawImage(gl, 0, 0, 64, 64)
      const d = ctx.getImageData(0, 0, 64, 64).data
      let dark = 0
      for (let i = 0; i < d.length; i += 4) {
        const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114
        if (lum < 200) dark++
      }
      return dark / (d.length / 4) < 0.02   // 空白宣纸 ≈ 0，有墨明显 > 0
    } catch (e) { return false }
  }
  let immersiveTimer = 0
  // force=true: show the way back for a few seconds right after hiding, even if
  // the canvas already has work on it (otherwise the shortcut is undiscoverable)
  function updateImmersiveNote(force) {
    const note = $('immersive-note')
    if (!note) return
    if (!document.body.classList.contains('bar-hidden')) { note.classList.remove('show'); return }
    if (force) note.classList.add('show')
    else note.classList.toggle('show', isCanvasEmpty())
    clearTimeout(immersiveTimer)
    immersiveTimer = setTimeout(() => updateImmersiveNote(false), force ? 3000 : 1500)
  }
  function toggleBarHidden() {
    document.body.classList.toggle('bar-hidden')
    updateImmersiveNote(true)
  }
  on(window, 'keydown', (e) => {
    if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) toggleBarHidden()
    if (e.key === 'Escape') {   // always a way back
      document.body.classList.remove('bar-hidden')
      updateImmersiveNote(false)
    }
  })
  on($('hide'), 'click', toggleBarHidden)

  on($('brush'), 'input', (e) => {
    state.strength = parseFloat(e.target.value)
  })

  on($('concentration'), 'input', (e) => {
    state.concentration = parseFloat(e.target.value)
    engine.inkGain = state.concentration   // 渲染端统一生效：整张纸（含 AI 与已落的墨）立刻变浓/变淡
  })

  const aiToggle = $('ai-toggle')
  on(aiToggle, 'click', () => {
    state.aiOn = !state.aiOn
    if (!aiToggle) return
    aiToggle.classList.toggle('on', state.aiOn)
    aiToggle.classList.toggle('off', !state.aiOn)
    aiToggle.setAttribute('aria-pressed', String(state.aiOn))
    aiToggle.textContent = state.aiOn ? I18N[state.lang].aiOn : I18N[state.lang].aiOff
  })

  const patience = $('patience')
  const patienceVal = $('patience-val')
  on(patience, 'input', (e) => {
    state.aiPatience = parseFloat(e.target.value)
    if (patienceVal) patienceVal.textContent = state.aiPatience + 's'
    nextDropAt = performance.now() + state.aiPatience * 1000
  })

  on($('ai-size'), 'input', (e) => {
    state.aiSize = parseFloat(e.target.value)
  })

  on($('clear'), 'click', () => {
    // 归零：清空画布，并取消沙模式下 AI 正在进行的连浇，让它成为一次真正的重置
    if (state.mode === 'sand' && sand) { sand.clear(); aiPour = null }
    else engine.clear()
  })

  on($('export'), 'click', () => {
    const btn = $('export')
    try {
      const useSand = (state.mode === 'sand' && sand)
      if (useSand) sand.render(performance.now())      // 确保截的是最新一帧
      else engine.render(performance.now())
      const cv = useSand ? sand.canvas : engine.renderer.domElement
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const name = (useSand ? 'ink-quiet-sand-' : 'ink-quiet-') + ts + '.png'
      const fire = (href) => {
        const a = document.createElement('a')
        a.href = href
        a.download = name
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
      // 优先 toBlob + 对象 URL：对 file:// 与 Safari 更稳（大画布也不会因 data URL 过长失败）
      if (cv.toBlob) {
        cv.toBlob((blob) => {
          if (!blob) { fire(useSand ? sand.captureDataURL() : engine.captureDataURL()); return }
          const url = URL.createObjectURL(blob)
          fire(url)
          setTimeout(() => URL.revokeObjectURL(url), 5000)
        }, 'image/png')
      } else {
        fire(useSand ? sand.captureDataURL() : engine.captureDataURL())
      }
      if (btn) {
        const t = btn.textContent
        btn.textContent = I18N[state.lang].saved
        setTimeout(() => { if (btn) btn.textContent = t }, 1500)
      }
    } catch (err) {
      // 极端兜底：新标签页打开让用户另存为
      try { window.open((state.mode === 'sand' && sand) ? sand.captureDataURL() : engine.captureDataURL(), '_blank') } catch (e2) {}
    }
  })

  // 窗口尺寸变化：两个引擎都重算模拟分辨率
  let rt = 0
  window.addEventListener('resize', () => {
    clearTimeout(rt)
    rt = setTimeout(() => { engine.resize(); if (sand) sand.resize() }, 120)
  })

  // 提示语：用户一开始画就淡出
  function setHint(text) { if (hint && !hintGone) hint.textContent = text }
  function fadeHint() {
    if (hintGone || !hint) return
    hintGone = true
    hint.classList.add('gone')
    setTimeout(() => hint && hint.remove(), 1300)
  }
  setTimeout(fadeHint, 6000) // 没动手也 6 秒后淡出

  // 测试钩子：只给 selftest.html 用，正常打开页面时无副作用。
  window.__ink = { engine, sand, state, aiTick, advanceAiPour, setMode }

  } catch (fatal) {
    // 任何初始化期异常都暴露给 selftest，而不是让页面静默崩溃
    window.__ink = { initError: String(fatal && fatal.stack || fatal.message || fatal) }
    console.error('app.js 初始化失败：', fatal)
  }
})()
