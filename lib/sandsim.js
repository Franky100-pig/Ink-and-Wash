/* 墨息 · Ink Quiet — 颗粒沙盒引擎（沙半 / Mode A）
 *
 * 纯手写元胞自动机（cellular automaton），零构建、离线、file:// 安全。
 *
 * 沙半是一个“物性沙盒”：材料按 Powder Game 式的物理互作，不是评分/过关游戏。
 * 五种材料：沙 / 火 / 水 / 云 / 炸弹颗粒。
 *   - 沙：下落、滑落（休止角）、沉入水。
 *   - 水：下落、铺开；碰到火 → 把火浇灭，自己变成蒸汽（云）。
 *   - 火：上浮（热气）、闪烁、无燃料会自己烧尽成烟（云）；碰到炸弹 → 引爆。
 *   - 云：上浮、随风飘；会下雨变成水，贴着水/火会凝水（被火烤则下雨灭火）。
 *   - 炸弹颗粒：像粉末一样下落，引信倒计时（约 3 秒）或碰到火即爆；
 *     爆心掏空、环带点燃，环内若还有炸弹则连锁。
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
  var EMPTY = 0, SAND = 1, FIRE = 2, WATER = 3, CLOUD = 4, BOMB = 5
  var TYPE_COUNT = 6

  // 字符串名 → 类型号（place 接受两种）
  var EL = { sand: SAND, fire: FIRE, water: WATER, cloud: CLOUD, bomb: BOMB }

  // 各元素的“填充密度”：落笔时每个候选格以该概率被填上（倒沙感 = 细流，不是整块盖章）
  var DENSITY = {}
  DENSITY[SAND] = 0.55
  DENSITY[WATER] = 0.55
  DENSITY[FIRE] = 0.6
  DENSITY[CLOUD] = 0.5
  DENSITY[BOMB] = 0.7

  // 颜色（sRGB 0-255）
  var PAPER = [239, 234, 224] // #efeae0 与 ink 半同纸色
  var COL = {}
  COL[EMPTY] = PAPER
  COL[SAND] = [217, 198, 154]  // #d9c69a
  COL[FIRE] = [235, 95, 30]    // 仅作占位；实际颜色由火温（life）在 LUT 里渐变
  COL[WATER] = [74, 127, 174]  // #4a7fae
  COL[CLOUD] = [223, 230, 236] // #dfe6ec 云白
  COL[BOMB] = [58, 47, 58]     // #3a2f3a 暗紫灰（炸药颗粒）

  // ── 可调参数（手感都在这里调）──
  var GRID_AREA = 22400   // 目标元胞总数（16:9 → ~200×112）
  var STEP = 1 / 60       // 固定子步长，帧率无关
  var MAX_SUBSTEPS = 3    // 单帧最多子步，防后台回来爆冲
  var SMOOTH = false      // 放大是否平滑：false = 像素颗粒感（刻意，与流体半的柔形成对照）
  var SHADE_AMP = 16      // 沙单粒明暗抖动幅度

  var SAND_SLIDE = 0.8    // 沙滑落概率（休止角）
  var SAND_SINK = 0.5     // 沙沉入水的概率
  var WATER_SPREAD = 0    // 预留（铺开逻辑在 trySpread 内）

  var FIRE_LIFE_MAX = 90  // 火寿命上限（≈1.5s）
  var FIRE_LIFE_MIN = 50
  var FIRE_RISE = 0.6     // 火上浮概率（热气）
  var FIRE_SMOKE = 0.5    // 烧尽后变烟（云）的概率，否则消散

  var CLOUD_RISE = 0.35   // 云上浮概率
  var CLOUD_DRIFT = 0.10  // 云随风飘概率
  var CLOUD_RAIN = 0.02   // 云下雨（下方变水）概率

  var BOMB_FUSE = 200     // 引信步数（≈3.3s @60fps）
  var BOMB_R = 6          // 爆炸半径
  var BOMB_CORE = 2       // 爆心空腔半径

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

  // 火温 → 颜色：m=0 将熄（暗红）→ m=128 橙 → m=255 灼白尖
  function fireColor(m) {
    var cold = [120, 30, 15], mid = [235, 95, 30], hot = [255, 215, 135]
    if (m < 128) {
      var t = m / 128
      return [lerp(cold[0], mid[0], t), lerp(cold[1], mid[1], t), lerp(cold[2], mid[2], t)]
    }
    var t2 = (m - 128) / 127
    return [lerp(mid[0], hot[0], t2), lerp(mid[1], hot[1], t2), lerp(mid[2], hot[2], t2)]
  }

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
    this.meta = null   // 沙：明暗抖动；火：火温(life 映射)
    this.life = null   // 火寿命 / 炸弹引信
    this.moved = null
    this.counts = null
    this.buildLUT()
    this.resize()
  }

  // ── 颜色查找表：索引 (type<<8)|meta → 像素 ──
  // 全部预计算，渲染热路径零分支、零分配。
  SandSim.prototype.buildLUT = function () {
    var LUT = new Uint32Array(TYPE_COUNT * 256)
    for (var t = 0; t < TYPE_COUNT; t++) {
      for (var m = 0; m < 256; m++) {
        var c = COL[t]
        var r = c[0], g = c[1], b = c[2]
        if (t === SAND) {
          var j = (m / 255 - 0.5) * 2 * SHADE_AMP
          r = clampByte(r + j); g = clampByte(g + j); b = clampByte(b + j)
        } else if (t === FIRE) {
          var fc = fireColor(m)
          r = fc[0]; g = fc[1]; b = fc[2]
        }
        LUT[(t << 8) | m] = packRGBA(clampByte(r), clampByte(g), clampByte(b), 255)
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

    var oldType = this.type, oldMeta = this.meta, oldLife = this.life
    var oldW = this.gridW, oldH = this.gridH
    var oldN = (oldW && oldH) ? oldW * oldH : 0

    this.gridW = gw
    this.gridH = gh
    var N = gw * gh
    this.type = new Uint8Array(N)
    this.meta = new Uint8Array(N)
    this.life = new Uint8Array(N)
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
          this.life[ni] = oldLife[oi]
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
        // 笔刷中心格必然落料（点击一定能看到材料在光标处），其余维持“细流”密度感
        if (!(dx === 0 && dy === 0) && this.rng() > density) continue
        var i = y * this.gridW + x
        if (this.canPlace(this.type[i], t)) {
          var m = 0
          if (t === SAND) m = (this.rng() * 255) | 0 // 沙：明暗抖动
          this.setCell(i, t, m)
          if (t === FIRE) {
            this.life[i] = FIRE_LIFE_MIN + ((this.rng() * (FIRE_LIFE_MAX - FIRE_LIFE_MIN)) | 0)
            this.meta[i] = clampByte(this.life[i] / FIRE_LIFE_MAX * 255)
          } else if (t === BOMB) {
            this.life[i] = BOMB_FUSE
          }
        }
      }
    }
  }

  // 沿线插值盖章（快速拖动 / 画线不断点）
  SandSim.prototype.placeLine = function (x0, y0, x1, y1, el, strength, radiusMul) {
    var d = Math.hypot(x1 - x0, y1 - y0)
    var steps = Math.max(1, Math.round(d * this.gridW))
    for (var s = 0; s <= steps; s++) {
      var k = s / steps
      this.place(lerp(x0, x1, k), lerp(y0, y1, k), el, strength, radiusMul)
    }
  }

  // 放置规则：空位可放；气体（云/火）可被覆盖
  SandSim.prototype.canPlace = function (target, el) {
    return target === EMPTY || target === CLOUD || target === FIRE || el === BOMB
  }

  // 改格类型并维护 counts（life/meta 随类型改变复位）
  SandSim.prototype.setCell = function (i, el, m) {
    this.counts[this.type[i]]--
    this.type[i] = el
    this.meta[i] = m
    this.life[i] = 0
    this.counts[el]++
  }

  SandSim.prototype.swapCells = function (a, b) {
    var t = this.type[a]; this.type[a] = this.type[b]; this.type[b] = t
    var m = this.meta[a]; this.meta[a] = this.meta[b]; this.meta[b] = m
    var l = this.life[a]; this.life[a] = this.life[b]; this.life[b] = l
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
    // 计时器（火寿命 / 炸弹引信）与“是否移动”解耦：每子步统一减一次，
    // 避免下落中的粒子因 parity 跳格而每两帧才走一次计时，导致引信被悄悄拉长。
    var N = this.gridW * this.gridH
    var type = this.type, life = this.life
    for (var c = 0; c < N; c++) {
      var tc = type[c]
      if ((tc === FIRE || tc === BOMB) && life[c] > 0) life[c]--
    }
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
    if (t === EMPTY) return
    if (t === SAND) { this.updateSand(i, x, y); return }
    if (t === WATER) { this.updateWater(i, x, y, wind); return }
    if (t === FIRE) { this.updateFire(i, x, y); return }
    if (t === CLOUD) { this.updateCloud(i, x, y, wind); return }
    if (t === BOMB) { this.updateBomb(i, x, y); return }
  }

  // ── 各材料行为 ──
  SandSim.prototype.updateSand = function (i, x, y) {
    this.moved[i] = this.parity
    if (this.tryFallPowder(i, x, y, SAND_SLIDE)) return
  }

  SandSim.prototype.updateWater = function (i, x, y, wind) {
    this.moved[i] = this.parity
    if (this.tryFallMobile(i, x, y)) return
    if (this.trySpread(i, x, y, wind)) return
  }

  // 火：上浮、闪烁、烧尽成烟；遇水熄灭（水变蒸汽）；遇炸弹→引爆
  // 寿命倒计时已统一在 update() 里每子步减一次，这里只读。
  SandSim.prototype.updateFire = function (i, x, y) {
    this.moved[i] = this.parity
    this.meta[i] = clampByte(this.life[i] / FIRE_LIFE_MAX * 255)
    if (this.life[i] <= 0) {
      if (this.rng() < FIRE_SMOKE) this.setCell(i, CLOUD, 0)
      else this.setCell(i, EMPTY, 0)
      return
    }
    if (this.hasNeighbor(i, WATER)) {
      this.setCell(i, EMPTY, 0)                 // 火被浇灭
      this.convertOneNeighbor(i, WATER, CLOUD)  // 水遇火变蒸汽（云）
      return
    }
    if (this.hasNeighbor(i, BOMB)) {
      var nb = this.findNeighbor(i, BOMB)
      if (nb >= 0) this.life[nb] = 0            // 引爆炸弹（推迟到炸弹自己的更新）
    }
    if (y > 0 && this.type[i - this.gridW] === EMPTY && this.rng() < FIRE_RISE) {
      this.swapCells(i, i - this.gridW); return
    }
    if (this.rng() < 0.2) { // 闪烁横移
      var sx = this.rng() < 0.5 ? -1 : 1
      var nx = x + sx
      if (nx >= 0 && nx < this.gridW) {
        var ni = i + sx
        if (this.type[ni] === EMPTY && this.moved[ni] !== this.parity) { this.swapCells(i, ni); return }
      }
    }
  }

  // 云：上浮、随风飘；下雨变水；贴水/火凝水（被火烤则下雨灭火）
  SandSim.prototype.updateCloud = function (i, x, y, wind) {
    this.moved[i] = this.parity
    if (this.hasNeighbor(i, FIRE)) {
      this.setCell(i, WATER, 0)                 // 被火烤 → 下雨
      var f = this.findNeighbor(i, FIRE); if (f >= 0) this.setCell(f, EMPTY, 0)
      return
    }
    if (this.hasNeighbor(i, WATER)) {
      this.setCell(i, WATER, 0)                 // 贴着水 → 并入（凝水）
      return
    }
    if (y > 0 && this.type[i - this.gridW] === EMPTY && this.rng() < CLOUD_RISE) {
      this.swapCells(i, i - this.gridW); return
    }
    if (this.rng() < CLOUD_DRIFT && wind !== 0) {
      var sx2 = wind > 0 ? 1 : -1
      var nx2 = x + sx2
      if (nx2 >= 0 && nx2 < this.gridW) {
        var ni2 = i + sx2
        if (this.type[ni2] === EMPTY && this.moved[ni2] !== this.parity) { this.swapCells(i, ni2); return }
      }
    }
    // 降雨：下方空 → 滴一滴水，云有概率被耗掉（慢慢散去）
    if (y + 1 < this.gridH && this.type[i + this.gridW] === EMPTY && this.rng() < CLOUD_RAIN) {
      this.setCell(i + this.gridW, WATER, 0)
      if (this.rng() < 0.5) this.setCell(i, EMPTY, 0)
    }
  }

  // 炸弹：引信倒计时或碰火即爆；否则像粉末一样下落
  // 引信倒计时已统一在 update() 里每子步减一次，这里只读。
  SandSim.prototype.updateBomb = function (i, x, y) {
    this.moved[i] = this.parity
    if (this.life[i] <= 0 || this.hasNeighbor(i, FIRE)) { this.detonate(i); return }
    if (this.tryFallPowder(i, x, y, 0.7)) return
  }

  // 爆炸：爆心掏空、环带点燃；环内炸弹连锁（life 置 0，下一帧起爆）
  SandSim.prototype.detonate = function (i) {
    var gw = this.gridW, gh = this.gridH
    var cx = i % gw, cy = (i / gw) | 0
    var R = BOMB_R
    var snap = []
    for (var dy = -R; dy <= R; dy++) {
      var ny = cy + dy; if (ny < 0 || ny >= gh) continue
      for (var dx = -R; dx <= R; dx++) {
        var nx = cx + dx; if (nx < 0 || nx >= gw) continue
        var d2 = dx * dx + dy * dy; if (d2 > R * R) continue
        snap.push({ ni: ny * gw + nx, t: this.type[ny * gw + nx], dist: Math.sqrt(d2) })
      }
    }
    for (var k = 0; k < snap.length; k++) {
      var r = snap[k]
      if (r.t === EMPTY) continue
      if (r.dist < BOMB_CORE) { this.setCell(r.ni, EMPTY, 0); continue } // 爆心空腔（冲击波掏空）
      this.setCell(r.ni, FIRE, 0)                                        // 环带点燃
      this.life[r.ni] = FIRE_LIFE_MIN + ((this.rng() * (FIRE_LIFE_MAX - FIRE_LIFE_MIN)) | 0)
      this.meta[r.ni] = clampByte(this.life[r.ni] / FIRE_LIFE_MAX * 255)
    }
  }

  // 水 / 火（作为可落气体）的下方下落 + 对角下坠；可穿过云
  SandSim.prototype.tryFallMobile = function (i, x, y) {
    if (y + 1 >= this.gridH) return false
    var b = i + this.gridW
    var tb = this.type[b]
    if (tb === EMPTY || tb === CLOUD) { this.swapCells(i, b); return true }
    return false
  }

  // 沙 / 炸弹 的下落（可沉入水）+ 对角滑落（休止角）；可穿过云
  SandSim.prototype.tryFallPowder = function (i, x, y, slideProb) {
    if (y + 1 >= this.gridH) return false
    var b = i + this.gridW
    var tb = this.type[b]
    if (tb === EMPTY || tb === CLOUD) { this.swapCells(i, b); return true }
    if (tb === WATER && this.rng() < SAND_SINK) { this.swapCells(i, b); return true } // 沉入水
    if (this.rng() < slideProb) {
      var order = this.rng() < 0.5 ? [-1, 1] : [1, -1]
      for (var k = 0; k < 2; k++) {
        var sx = order[k]
        var nx = x + sx
        if (nx < 0 || nx >= this.gridW) continue
        var d = b + sx
        var td = this.type[d]
        if (td === EMPTY || td === CLOUD) { this.swapCells(i, d); return true }
      }
    }
    return false
  }

  // 水水平铺开（1-3 格，随风偏置）
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

  SandSim.prototype.hasNeighbor = function (i, t) {
    var x = i % this.gridW, y = (i / this.gridW) | 0
    if (x > 0 && this.type[i - 1] === t) return true
    if (x < this.gridW - 1 && this.type[i + 1] === t) return true
    if (y > 0 && this.type[i - this.gridW] === t) return true
    if (y < this.gridH - 1 && this.type[i + this.gridW] === t) return true
    return false
  }

  SandSim.prototype.findNeighbor = function (i, t) {
    var x = i % this.gridW, y = (i / this.gridW) | 0
    if (x > 0 && this.type[i - 1] === t) return i - 1
    if (x < this.gridW - 1 && this.type[i + 1] === t) return i + 1
    if (y > 0 && this.type[i - this.gridW] === t) return i - this.gridW
    if (y < this.gridH - 1 && this.type[i + this.gridW] === t) return i + this.gridW
    return -1
  }

  // 把第一个匹配的邻格从 from 改成 to
  SandSim.prototype.convertOneNeighbor = function (i, from, to) {
    var n = this.findNeighbor(i, from)
    if (n >= 0) this.setCell(n, to, 0)
  }

  // ── 渲染：网格 → LUT → 离屏 → 放大绘制 ──
  SandSim.prototype.render = function (/* time */) {
    var buf = this.buf32
    var N = this.gridW * this.gridH
    var LUT = this.LUT
    var type = this.type, meta = this.meta
    for (var i = 0; i < N; i++) {
      buf[i] = LUT[(type[i] << 8) | meta[i]]
    }
    this.offCtx.putImageData(this.imgData, 0, 0)
    var ctx = this.ctx
    ctx.imageSmoothingEnabled = SMOOTH
    ctx.drawImage(this.off, 0, 0, this.gridW, this.gridH, 0, 0, this.dispW, this.dispH)
  }

  SandSim.prototype.clear = function () {
    this.type.fill(0); this.meta.fill(0); this.life.fill(0)
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
    this.type = this.meta = this.life = this.moved = this.counts = null
    this.buf32 = null
  }

  window.SandSim = SandSim
  window.SAND = { EMPTY: EMPTY, SAND: SAND, FIRE: FIRE, WATER: WATER, CLOUD: CLOUD, BOMB: BOMB }
  window.SAND_ELEMENTS = {
    sand: '#d9c69a', fire: '#e8642a', water: '#4a7fae', cloud: '#dfe6ec', bomb: '#3a2f3a'
  }
})()
