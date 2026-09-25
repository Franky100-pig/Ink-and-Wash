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

  if (!window.Suminagashi) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">引擎未加载（Suminagashi 缺失）。请确认 lib/ 下的文件就位。</p>'
    return
  }

  const canvas = document.getElementById('stage')
  const engine = new window.Suminagashi(canvas)
  const INKS = window.INKS

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
    lastUserActivity: -1e9,  // 用户最近一次落笔的时间戳(ms)
    recentUser: [],          // 最近 ~3s 的用户落点，用于让 AI“绕开”
  }
  const YIELD_GRACE = 1500   // 用户停笔后，AI 要再等这么久才接手(ms)
  const RECENT_WINDOW = 3000 // 记录用户落点的时间窗(ms)
  let nextDropAt = performance.now() + state.aiPatience * 1000

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
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    state.drawing = true
    state.lastUV = null
    const uv = toUV(e)
    userStroke(uv)                 // 点一下也落一滴
    fadeHint()
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!state.drawing) return
    e.preventDefault()
    userStroke(toUV(e))
  })
  const stop = () => { state.drawing = false; state.lastUV = null }
  canvas.addEventListener('pointerup', stop)
  canvas.addEventListener('pointercancel', stop)
  canvas.addEventListener('pointerleave', stop)

  // ── “哑 AI”同伴 ──
  // 每隔一段时间，若用户已经安静（停笔超过 YIELD_GRACE），才落一笔。
  // 落点会避开用户最近的笔迹中心 —— 这就是“让位 / 退开留白”。
  function aiTick(now) {
    if (!state.aiOn) { nextDropAt = now + state.aiPatience * 1000; return }
    if (now < nextDropAt) return

    const sinceUser = now - state.lastUserActivity
    if (sinceUser < YIELD_GRACE) {
      // 用户还在画/刚停：这轮不打扰，等下一个周期再看
      nextDropAt = now + state.aiPatience * 1000
      return
    }

    // 选一个离用户最近笔迹尽量远的位置
    const now2 = performance.now()
    state.recentUser = state.recentUser.filter((p) => now2 - p.t < RECENT_WINDOW)

    // AI 自己换色：多数时候沿用当前色（保持一段连贯），偶尔换到另一种，
    // 于是随着时间推移画面颜色会自己流动起来——这就是“AI 自己换颜色”。
    if (Math.random() < 0.35) {
      let n = aiColorIdx
      while (n === aiColorIdx) n = Math.floor(Math.random() * AI_PALETTE.length)
      aiColorIdx = n
    }
    const ink = AI_PALETTE[aiColorIdx]
    // 1.4：与用户默认笔触同强度，AI 的墨不再天生偏淡（浓度滑块由引擎渲染端统一生效）
    // state.aiSize：用户可滑的“AI 笔触”大小，缩放落墨半径
    aiStroke(ink, 1.4, state.aiSize)

    nextDropAt = now + state.aiPatience * 1000
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
    engine.step(dt)
    engine.render(now)
    aiTick(now)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // ── UI 绑定 ──
  // 用 $() / on() 包一层：控件缺失时静默跳过。
  // 这样 selftest.html 可以只放一块画布就复用同一份 app.js。
  const $ = (id) => document.getElementById(id)
  const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn) }

  const inkButtons = Array.from(document.querySelectorAll('.ink'))
  function setInk(name) {
    state.userInk = name
    inkButtons.forEach((b) => b.classList.toggle('active', b.dataset.ink === name))
  }
  inkButtons.forEach((b) => on(b, 'click', () => setInk(b.dataset.ink)))
  setInk('sumi')

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
    aiToggle.textContent = 'AI 同伴：' + (state.aiOn ? '开' : '关')
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

  on($('clear'), 'click', () => engine.clear())

  on($('export'), 'click', () => {
    const btn = $('export')
    try {
      engine.render(performance.now())           // 确保截的是最新一帧
      const cv = engine.renderer.domElement
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const name = 'ink-quiet-' + ts + '.png'
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
          if (!blob) { fire(engine.captureDataURL()); return }
          const url = URL.createObjectURL(blob)
          fire(url)
          setTimeout(() => URL.revokeObjectURL(url), 5000)
        }, 'image/png')
      } else {
        fire(engine.captureDataURL())
      }
      if (btn) {
        const t = btn.textContent
        btn.textContent = '已保存 ✓'
        setTimeout(() => { if (btn) btn.textContent = t }, 1500)
      }
    } catch (err) {
      // 极端兜底：新标签页打开让用户另存为
      window.open(engine.captureDataURL(), '_blank')
    }
  })

  // 窗口尺寸变化：重算模拟分辨率
  let rt = 0
  window.addEventListener('resize', () => {
    clearTimeout(rt)
    rt = setTimeout(() => engine.resize(), 120)
  })

  // 提示语：用户一开始画就淡出
  const hint = $('hint')
  let hintGone = false
  function fadeHint() {
    if (hintGone || !hint) return
    hintGone = true
    hint.classList.add('gone')
    setTimeout(() => hint && hint.remove(), 1300)
  }
  setTimeout(fadeHint, 6000) // 没动手也 6 秒后淡出

  // 测试钩子：只给 selftest.html 用，正常打开页面时无副作用。
  window.__ink = { engine, state, aiTick }
})()
