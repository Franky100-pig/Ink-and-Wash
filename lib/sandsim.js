/* 墨息 · Ink Quiet — 颗粒沙盒引擎（沙半 / Mode A）
 *
 * 纯手写元胞自动机（cellular automaton），零构建、离线、file:// 安全。
 * 设计纪律（来自 IDEAS.md v3）：不评分、不过关、不失败、不爆炸；元素中性。
 * 已确认例外：雾会消散（雾的本性就是短暂），其余元素永久保留。
 *
 * 许可：本文件为原创实现 © 2026 Franky100-pig，MIT。
 *   - 仅参考 MIT 项目的“思路”（neon-sand、SandGears），未复制任何代码。
 *   - 严禁参考/复制 Sandboxels（R74n Content License，All Rights Reserved）。
 *
 * API 刻意镜像 lib/suminagashi.js 的形状，让 app.js 把两个引擎当同类对待：
 *   place / placeLine / step / render / clear / resize / captureDataURL / dispose
 *   另加 fullness() / countOf() / cellAt() / reseed() 供 AI 与测试使用。
 *
 * 坐标约定：place(nx, ny, ...) 中 nx∈[0,1] 左→右，ny∈[0,1] 顶→底（2D 自然坐标）。
 *   渲染时网格第 0 行在画布顶部，重力使元素向下（行号增大）落。
 */
;(function () {
  'use strict'

  // ── 元素类型 ──
  var EMPTY = 0, SAND = 1, WATER = 2, STONE = 3, DUST = 4, INK = 5, FOG = 6
  var TYPE_COUNT = 7

  // 字符串名 → 类型号（place 接受两种）
  var EL = { sand: SAND, water: WATER, stone: STONE, dust: DUST, ink: INK, fog: FOG }

  // 各元素的“填充密度”：落笔时每个候选格以该概率被填上（倒沙感 = 细流，不是整块盖章）
  var DENSITY = {}
  DENSITY[SAND] = 0.55
  DENSITY[WATER] = 0.55
  DENSITY[DUST] = 0.55
  DENSITY[STONE] = 1.0 // 石：实心块
  DENSITY[INK] = 0.35  // 墨：滴落
  DENSITY[FOG] = 0.30  // 雾：丝缕

  // 颜色（sRGB 0-255）
  var PAPER = [239, 234, 224] // #efeae0 与 ink 半同纸色
  var COL = {}
  COL[EMPTY] = PAPER
  COL[SAND] = [217, 198, 154] // #d9c69a
  COL[WATER] = [74, 127, 174]  // #4a7fae
  COL[STONE] = [138, 133, 124] // #8a857c
  COL[DUST] = [184, 169, 136]  // #b8a988
  COL[INK] = [26, 26, 31]      // #1a1a1f
  COL[FOG] = [195, 201, 201]   // #c3c9c9

  // ── 可调参数（手感都在这里调）──
  var GRID_AREA = 22400   // 目标元胞总数（16:9 → ~200×112）
  var STEP = 1 / 60       // 固定子步长，帧率无关
  var MAX_SUBSTEPS = 3    // 单帧最多子步，防后台回来爆冲
  var SMOOTH = false      // 放大是否平滑：false = 像素颗粒感（刻意，与流体半的柔形成对照）
  var SHADE_AMP = 16      // 沙/尘/石 单粒明暗抖动幅度
  var FOG_ALPHA = 0.5     // 雾最大不透明度（叠在纸色上）
  var FOG_FADE = 0.22     // 雾每子步消散概率（寿命 ~20s）
  var FOG_CONDENSE = 0.03 // 雾贴着水/石时，每子步凝成水珠的概率（露）
  var WET_PROB = 0.30     // 沙/尘 遇水变湿的概率（小概率，避免一下全湿）
  var DRY_PROB = 0.004    // 湿沙/湿尘 周围无水时，每子步变干的概率
  var INK_TINT = 200      // 墨化入水后，水的“墨量”（越大越黑）

  // mulberry32：确定性 PRNG（reseed 让测试可复现）
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0
      var t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v) }
  function lerp(a, b, t) { return a + (b - a) * t }
  function clampByte(v) { return v < 0 ? 0 : (v > 255 ? 255 : v | 0) }

  // 小端 ImageData 的 Uint32 像素 = (a<<24)|(b<<16)|(g<<8)|r
  function packRGBA(r, g, b, a) {
    return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
  }

  function SandSim(canvas, opts) {
    opts = opts || {}
    this.canvas = canvas
    this.off = document.createElement('canvas')      // 离屏：网格分辨率
    this.offCtx = this.off.getContext('2d')
    this.ctx = canvas.getContext('2d')               // 显示画布（放大目标）
    this.seed = opts.seed || 12345
    this.rng = mulberry32(this.seed)
    this.simTime = 0
    this.tick = 0
    this.parity = 0
    this.acc = 0
    this.gridW = 0
    this.gridH = 0
    this.type = null
    this.meta = null
    this.stain = null
    this.moved = null
    this.counts = null
    this.buildLUT()
    this.resize()
  }

  // ── 颜色查找表：索引 (type<<9)|(stain<<8)|meta → 像素 ──
  // 全部预计算，渲染热路径零分支、零分配。
  SandSim.prototype.buildLUT = function () {
    // 索引 (type<<10)|(wet<<9)|(stain<<8)|meta；wet 为独立位（湿沙/湿尘压暗）
    var LUT = new Uint32Array(TYPE_COUNT * 2 * 2 * 256)
    for (var t = 0; t < TYPE_COUNT; t++) {
      for (var wet = 0; wet < 2; wet++) {
        for (var s = 0; s < 2; s++) {
          for (var m = 0; m < 256; m++) {
            var c = COL[t]
            var r = c[0], g = c[1], b = c[2]
            if (t === SAND || t === DUST || t === STONE) {
              var j = (m / 255 - 0.5) * 2 * SHADE_AMP
              r = clampByte(r + j); g = clampByte(g + j); b = clampByte(b + j)
              if (wet && (t === SAND || t === DUST)) { // 湿：压暗 + 略偏潮土色
                r = lerp(r, 92, 0.30); g = lerp(g, 80, 0.30); b = lerp(b, 58, 0.30)
              }
              if (s === 1) { // 被墨染：向墨色压暗（仅外观，不改行为）
                r = lerp(r, COL[INK][0], 0.6)
                g = lerp(g, COL[INK][1], 0.6)
                b = lerp(b, COL[INK][2], 0.6)
              }
            } else if (t === WATER) {
              var a = m / 255 // 墨量：水被墨晕开后逐步变深
              r = lerp(r, COL[INK][0], a)
              g = lerp(g, COL[INK][1], a)
              b = lerp(b, COL[INK][2], a)
            } else if (t === FOG) {
              var fa = (m / 255) * FOG_ALPHA // 雾寿命 → 叠在纸色上的不透明度
              r = lerp(PAPER[0], r, fa)
              g = lerp(PAPER[1], g, fa)
              b = lerp(PAPER[2], b, fa)
            }
            LUT[(t << 10) | (wet << 9) | (s << 8) | m] = packRGBA(clampByte(r), clampByte(g), clampByte(b), 255)
          }
        }
      }
    }
    this.LUT = LUT
  }

  // ── 尺寸：按视口宽高比推导网格；保留旧内容（最近邻重采样）──
  SandSim.prototype.resize = function () {
    var cssW = window.innerWidth || this.canvas.clientWidth || 800
    var cssH = window.innerHeight || this.canvas.clientHeight || 450
    var dpr = Math.min(window.devicePixelRatio || 1, 2)
    var aspect = cssW / cssH
    var gh = Math.round(Math.sqrt(GRID_AREA / aspect))
    var gw = Math.round(gh * aspect)
    if (gw < 120) { gw = 120; gh = Math.round(gw / aspect) }
    if (gw > 320) { gw = 320; gh = Math.round(gw / aspect) }

    var oldType = this.type, oldMeta = this.meta, oldStain = this.stain, oldWet = this.wet
    var oldW = this.gridW, oldH = this.gridH
    var oldN = (oldW && oldH) ? oldW * oldH : 0

    this.gridW = gw
    this.gridH = gh
    var N = gw * gh
    this.type = new Uint8Array(N)
    this.meta = new Uint8Array(N)
    this.stain = new Uint8Array(N)
    this.wet = new Uint8Array(N)
    this.moved = new Uint8Array(N)
    this.counts = new Uint32Array(TYPE_COUNT)
    this.counts[EMPTY] = N

    if (oldN) {
      for (var y = 0; y < gh; y++) {
        var oy = Math.min(oldH - 1, Math.floor((y / gh) * oldH))
        for (var x = 0; x < gw; x++) {
          var ox = Math.min(oldW - 1, Math.floor((x / gw) * oldW))
          var oi = oy * oldW + ox
          var ni = y * gw + x
          this.type[ni] = oldType[oi]
          this.meta[ni] = oldMeta[oi]
          this.stain[ni] = oldStain[oi]
          this.wet[ni] = oldWet ? oldWet[oi] : 0
        }
      }
      for (var i = 0; i < N; i++) this.counts[this.type[i]]++
    }

    // 离屏与显示缓冲
    this.off.width = gw
    this.off.height = gh
    this.imgData = this.offCtx.createImageData(gw, gh)
    this.buf32 = new Uint32Array(this.imgData.data.buffer)
    this.canvas.width = Math.max(1, Math.round(cssW * dpr))
    this.canvas.height = Math.max(1, Math.round(cssH * dpr))
    this.dispW = this.canvas.width
    this.dispH = this.canvas.height
  }

  // ── 放置 ──
  // nx,ny ∈[0,1]（自然坐标）；el 可为字符串或类型号；strength 影响笔半径；radiusMul 额外倍率
  SandSim.prototype.place = function (nx, ny, el, strength, radiusMul) {
    var t = (typeof el === 'string') ? (EL[el] || SAND) : el
    strength = strength || 1
    radiusMul = radiusMul || 1
    var r = clamp(Math.round(strength * 3 * radiusMul), 1, 9)
    var density = DENSITY[t] || 0.5
    var gx = Math.floor(clamp(nx, 0, 1) * this.gridW)
    var gy = Math.floor(clamp(ny, 0, 1) * this.gridH)
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue
        var x = gx + dx, y = gy + dy
        if (x < 0 || x >= this.gridW || y < 0 || y >= this.gridH) continue
        // 笔刷中心格必然落料（点击一定能看到墨/沙在光标处），其余维持“细流”密度感
        if (!(dx === 0 && dy === 0) && this.rng() > density) continue
        var i = y * this.gridW + x
        if (this.canPlace(this.type[i], t)) {
          var m = 0
          if (t === FOG) m = 255
          else if (t === WATER) m = 0
          else m = (this.rng() * 255) | 0 // 沙/尘/石/墨：明暗抖动
          this.setCell(i, t, m)
        }
      }
    }
  }

  // 沿线插值盖章（快速拖动 / 画石线不断点）
  SandSim.prototype.placeLine = function (x0, y0, x1, y1, el, strength, radiusMul) {
    var d = Math.hypot(x1 - x0, y1 - y0)
    var steps = Math.max(1, Math.round(d * this.gridW))
    for (var s = 0; s <= steps; s++) {
      var k = s / steps
      this.place(lerp(x0, x1, k), lerp(y0, y1, k), el, strength, radiusMul)
    }
  }

  // 放置规则：空位可放；雾被任何东西挤开；石（用户主动画）可覆盖一切
  SandSim.prototype.canPlace = function (target, el) {
    return target === EMPTY || target === FOG || el === STONE
  }

  // 改格类型并维护 counts（stain 随类型改变复位）
  SandSim.prototype.setCell = function (i, el, m) {
    this.counts[this.type[i]]--
    this.type[i] = el
    this.meta[i] = m
    this.stain[i] = 0
    this.wet[i] = 0
    this.counts[el]++
  }

  SandSim.prototype.swapCells = function (a, b) {
    var t = this.type[a]; this.type[a] = this.type[b]; this.type[b] = t
    var m = this.meta[a]; this.meta[a] = this.meta[b]; this.meta[b] = m
    var s = this.stain[a]; this.stain[a] = this.stain[b]; this.stain[b] = s
    var w = this.wet[a]; this.wet[a] = this.wet[b]; this.wet[b] = w
    this.moved[a] = this.parity
    this.moved[b] = this.parity
  }

  // ── 模拟一步（固定子步长）──
  SandSim.prototype.step = function (dt) {
    if (dt > 0.05) dt = 0.05
    this.acc += dt
    var n = 0
    while (this.acc >= STEP && n < MAX_SUBSTEPS) {
      this.update()
      this.acc -= STEP
      n++
    }
  }

  SandSim.prototype.update = function () {
    this.parity ^= 1
    this.simTime += STEP
    this.tick++
    var wind = Math.sin(this.simTime * 0.07) + Math.sin(this.simTime * 0.023) * 0.5 // ~[-1.5,1.5]
    var dir = (this.tick & 1) ? 1 : -1 // 每步交替水平扫描方向，去方向偏置
    for (var y = this.gridH - 1; y >= 0; y--) {
      if (dir === 1) {
        for (var x = 0; x < this.gridW; x++) this.cellUpdate(x, y, wind)
      } else {
        for (var x = this.gridW - 1; x >= 0; x--) this.cellUpdate(x, y, wind)
      }
    }
  }

  SandSim.prototype.cellUpdate = function (x, y, wind) {
    var i = y * this.gridW + x
    if (this.moved[i] === this.parity) return
    var t = this.type[i]
    if (t === EMPTY || t === STONE) return
    if (t === FOG) { this.updateFog(i, x, y, wind); return }

    if (t === INK) {
      // 遇水：晕开成带墨的水（水被染深）
      if (this.rng() < 0.10 && this.hasNeighbor(i, WATER)) { this.setCell(i, WATER, INK_TINT); return }
      this.stainNeighbors(i) // 触碰沙/石/尘 → 永久染色（外观）
      // 干墨似慢水：下落
      if (this.rng() < 0.6) { if (this.tryFallMobile(i, x, y)) return }
      else if (this.rng() < 0.5) { if (this.trySpread(i, x, y, wind)) return }
      return
    }
    if (t === WATER) {
      if (this.tryFallMobile(i, x, y)) return
      if (this.trySpread(i, x, y, wind)) return
      return
    }
    if (t === SAND) {
      if (this.wet[i] === 1) {
        // 湿沙：只直落、不滑、不沉水（堆出沙丘/沙堡，落在水面上也不沉）
        if (!this.hasNeighbor(i, WATER) && this.rng() < DRY_PROB) this.wet[i] = 0
        if (this.tryFallPowderWet(i, x, y)) return
        return
      }
      // 干沙遇水 → 变湿（湿了就不再往水里沉）
      if (this.rng() < WET_PROB && this.hasNeighbor(i, WATER)) { this.wet[i] = 1; return }
      if (this.tryFallPowder(i, x, y, 0.85)) return
      return
    }
    if (t === DUST) {
      if (this.wet[i] === 1) {
        // 湿尘：成团变重 → 不浮水、不飘、更快直落
        if (!this.hasNeighbor(i, WATER) && this.rng() < DRY_PROB) this.wet[i] = 0
        if (this.rng() < 0.85) { if (this.tryFallPowderWet(i, x, y)) return }
        return
      }
      // 干尘遇水 → 变湿
      if (this.rng() < WET_PROB && this.hasNeighbor(i, WATER)) { this.wet[i] = 1; return }
      // 浮于水：下方是水则上浮
      if (y > 0 && this.type[i - this.gridW] === WATER && this.rng() < 0.2) { this.swapCells(i, i - this.gridW); return }
      if (this.rng() < 0.3) { if (this.tryFallPowder(i, x, y, 0.15)) return } // 更陡的休止角
      // 随风横向轻飘
      if (this.rng() < 0.06 && wind !== 0) {
        var sx = wind > 0 ? 1 : -1
        var nx = x + sx
        if (nx >= 0 && nx < this.gridW) {
          var ni = i + sx
          if (this.type[ni] === EMPTY && this.moved[ni] !== this.parity) { this.swapCells(i, ni); return }
        }
      }
      return
    }
  }

  // 水 / 干墨 的下落 + 对角下坠
  SandSim.prototype.tryFallMobile = function (i, x, y) {
    if (y + 1 >= this.gridH) return false
    var b = i + this.gridW
    var tb = this.type[b]
    if (tb === EMPTY || tb === FOG || tb === DUST) { this.swapCells(i, b); return true }
    // 对角
    var order = this.rng() < 0.5 ? [-1, 1] : [1, -1]
    for (var k = 0; k < 2; k++) {
      var sx = order[k]
      var nx = x + sx
      if (nx < 0 || nx >= this.gridW) continue
      var d = b + sx
      var td = this.type[d]
      if (td === EMPTY || td === FOG) { this.swapCells(i, d); return true }
    }
    return false
  }

  // 沙 / 尘 的下落（可沉入水）+ 对角滑落（休止角）
  SandSim.prototype.tryFallPowder = function (i, x, y, slideProb) {
    if (y + 1 >= this.gridH) return false
    var b = i + this.gridW
    var tb = this.type[b]
    if (tb === EMPTY || tb === FOG || tb === DUST) { this.swapCells(i, b); return true }
    if (tb === WATER && this.rng() < 0.35) { this.swapCells(i, b); return true } // 缓慢沉入水
    if (this.rng() < slideProb) {
      var order = this.rng() < 0.5 ? [-1, 1] : [1, -1]
      for (var k = 0; k < 2; k++) {
        var sx = order[k]
        var nx = x + sx
        if (nx < 0 || nx >= this.gridW) continue
        var d = b + sx
        var td = this.type[d]
        if (td === EMPTY || td === FOG || td === DUST) { this.swapCells(i, d); return true }
      }
    }
    return false
  }

  // 湿沙/湿尘：只直落、不滑落、不沉入水（堆出稳定形状，歇在水面上）
  SandSim.prototype.tryFallPowderWet = function (i, x, y) {
    if (y + 1 >= this.gridH) return false
    var b = i + this.gridW
    var tb = this.type[b]
    if (tb === EMPTY || tb === FOG || tb === DUST) { this.swapCells(i, b); return true }
    return false
  }

  // 水/墨 水平铺开（1-3 格，随风偏置）
  SandSim.prototype.trySpread = function (i, x, y, wind) {
    var dir = wind > 0 ? 1 : (wind < 0 ? -1 : (this.rng() < 0.5 ? 1 : -1))
    var maxStep = 1 + (this.rng() < 0.5 ? 1 : 0) + (this.rng() < 0.3 ? 1 : 0)
    var cur = i, cx = x
    for (var s = 0; s < maxStep; s++) {
      var nx = cx + dir
      if (nx < 0 || nx >= this.gridW) break
      var ni = cur + dir
      if (this.type[ni] === EMPTY && this.moved[ni] !== this.parity) { this.swapCells(cur, ni); cur = ni; cx = nx }
      else break
    }
    return cur !== i
  }

  SandSim.prototype.updateFog = function (i, x, y, wind) {
    // 雾贴着水/石（冷却面）→ 不升不散，慢慢凝成水珠（露）；这是对“雾短暂”的安静例外
    var onSurface = this.hasNeighbor(i, WATER) || this.hasNeighbor(i, STONE)
    if (onSurface) {
      if (this.rng() < FOG_CONDENSE) { this.setCell(i, WATER, 0); return }
      return
    }
    if (this.meta[i] > 0 && this.rng() < FOG_FADE) this.meta[i]--
    if (this.meta[i] <= 0) { this.setCell(i, EMPTY, 0); return }
    if (this.rng() < 0.12 && y > 0) { // 上升
      var up = i - this.gridW
      if (this.type[up] === EMPTY && this.moved[up] !== this.parity) { this.swapCells(i, up); return }
    }
    if (this.rng() < 0.1 && wind !== 0) { // 随风飘
      var sx = wind > 0 ? 1 : -1
      var nx = x + sx
      if (nx >= 0 && nx < this.gridW) {
        var ni = i + sx
        if (this.type[ni] === EMPTY && this.moved[ni] !== this.parity) { this.swapCells(i, ni); return }
      }
    }
  }

  SandSim.prototype.hasNeighbor = function (i, t) {
    var x = i % this.gridW, y = (i / this.gridW) | 0
    if (x > 0 && this.type[i - 1] === t) return true
    if (x < this.gridW - 1 && this.type[i + 1] === t) return true
    if (y > 0 && this.type[i - this.gridW] === t) return true
    if (y < this.gridH - 1 && this.type[i + this.gridW] === t) return true
    return false
  }

  // 触碰沙/石/尘 → 以概率染色（仅外观，行为不变）
  SandSim.prototype.stainNeighbors = function (i) {
    var x = i % this.gridW, y = (i / this.gridW) | 0
    var nb = []
    if (x > 0) nb.push(i - 1)
    if (x < this.gridW - 1) nb.push(i + 1)
    if (y > 0) nb.push(i - this.gridW)
    if (y < this.gridH - 1) nb.push(i + this.gridW)
    for (var k = 0; k < nb.length; k++) {
      var n = nb[k]
      var nt = this.type[n]
      if ((nt === SAND || nt === STONE || nt === DUST) && this.stain[n] === 0 && this.rng() < 0.05) {
        this.stain[n] = 1
      }
    }
  }

  // ── 渲染：网格 → LUT → 离屏 → 放大绘制 ──
  SandSim.prototype.render = function (/* time */) {
    var buf = this.buf32
    var N = this.gridW * this.gridH
    var LUT = this.LUT
    var type = this.type, meta = this.meta, stain = this.stain, wet = this.wet
    for (var i = 0; i < N; i++) {
      buf[i] = LUT[(type[i] << 10) | (wet[i] << 9) | (stain[i] << 8) | meta[i]]
    }
    this.offCtx.putImageData(this.imgData, 0, 0)
    var ctx = this.ctx
    ctx.imageSmoothingEnabled = SMOOTH
    ctx.drawImage(this.off, 0, 0, this.gridW, this.gridH, 0, 0, this.dispW, this.dispH)
  }

  SandSim.prototype.clear = function () {
    this.type.fill(0); this.meta.fill(0); this.stain.fill(0); this.wet.fill(0)
    this.counts.fill(0)
    this.counts[EMPTY] = this.gridW * this.gridH
  }

  SandSim.prototype.fullness = function () {
    var N = this.gridW * this.gridH
    return 1 - this.counts[EMPTY] / N
  }
  SandSim.prototype.countOf = function (el) { return this.counts[el] || 0 }

  // 调试/测试用：取某归一化坐标处的类型
  SandSim.prototype.cellAt = function (nx, ny) {
    var x = Math.floor(clamp(nx, 0, 1) * this.gridW)
    var y = Math.floor(clamp(ny, 0, 1) * this.gridH)
    return this.type[y * this.gridW + x]
  }
  SandSim.prototype.reseed = function (seed) {
    this.seed = seed
    this.rng = mulberry32(seed)
  }
  SandSim.prototype.captureDataURL = function () { return this.canvas.toDataURL('image/png') }
  SandSim.prototype.dispose = function () {
    this.type = this.meta = this.stain = this.wet = this.moved = this.counts = null
    this.buf32 = null
  }

  window.SandSim = SandSim
  window.SAND = { EMPTY: EMPTY, SAND: SAND, WATER: WATER, STONE: STONE, DUST: DUST, INK: INK, FOG: FOG }
  window.SAND_ELEMENTS = {
    sand: '#d9c69a', water: '#4a7fae', stone: '#8a857c', dust: '#b8a988', ink: '#1a1a1f', fog: '#c3c9c9'
  }
})()
