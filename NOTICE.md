# NOTICE — 第三方代码与许可

本项目（墨息 · Ink Quiet）在 `lib/` 下复用了两份以 MIT 许可证发布的代码。
按 MIT 要求，保留其版权声明与许可文本如下。

---

## 1. 水墨流体引擎 `lib/suminagashi.js`

改编自 **fisheryv/healing**（希音 · A Digital Sanctuary for ADHD Minds）：

> https://github.com/fisheryv/healing

原文件 `src/src/suminagashi.js` 的版权与许可（MIT）：

```
Copyright (c) 2026 Fisher

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

改编内容：将原 ESM `import * as THREE from 'three'` 改为使用全局 `THREE`（UMD），
并将 `Suminagashi` / `INKS` / `INK_KEYS` 暴露为全局；新增 `clear()` 方法。
其余模拟逻辑（Navier–Stokes 流体解算、和纸减法混色）保持原样。

> 礼貌提示：此项目为作者本人（Fisher）的同学所作。商用或公开分发前，建议先告知作者并致谢。

---

## 2. three.js `lib/three.min.js`

> Copyright 2010-2022 Three.js Authors
> SPDX-License-Identifier: MIT

three.js 以 UMD 形式本地化打包，用于离线运行，不向任何服务器发起请求。

---

## 本项目本身的许可

本项目交互层（`src/app.js`、`index.html`、`styles.css`）以 MIT 发布。

---

## 3. 沙盒引擎 `lib/sandsim.js`（原创）

本文件为 **Franky100-pig** 的原创实现，MIT 许可：

```
Copyright (c) 2026 Franky100-pig

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
```

设计思路仅参考 MIT 项目 **neon-sand** 与 **SandGears**（思路借鉴，无代码复用）。
**明确未使用** Sandboxels（R74n Content License，All Rights Reserved，禁止复制代码，
作者可随时要求撤下）——本沙盒引擎完全独立从头实现。
