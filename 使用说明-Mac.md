# 嘉Jaykou工具台 · macOS 版

490 个免费在线工具，纯静态，无需后端。

---

## 一、怎么启动

**双击 `启动网站.command`**

- 会自动起本地服务并打开浏览器，地址形如 `http://localhost:8080/`
- 停止服务：回到终端窗口按 `Ctrl+C`，或直接关掉窗口
- 端口被占用会自动往后找 8081、8082……，实际端口以窗口显示为准

> **第一次双击如果被 macOS 拦下**（提示"无法打开，因为来自身份不明的开发者"）：
> 右键 `启动网站.command` → 选「打开」→ 再点一次「打开」即可。
> 这是 Gatekeeper 对未签名脚本的常规提示，不是文件有问题。

> **如果双击提示"Permission denied"（没有执行权限）**：
> 在「终端」里进入本目录，执行一次：
> ```
> chmod +x 启动网站.command
> ```
> （个别解压工具不还原 Unix 权限位时会出现，执行过一次即可永久解决）

> **不要直接双击 `index.html`**
> 浏览器在 `file://` 下会拒绝加载 WebAssembly，结果是视频压缩、格式转换、
> 音频处理、3D 预览、AI 类工具全部打不开。必须走 `启动网站.command`。

---

## 二、需要什么环境

脚本按 `python3 → ruby → php` 依次尝试，找到一个就用。

| 环境 | 状态 | 说明 |
|---|---|---|
| python3 | 推荐 | macOS 12+ 需装 Xcode 命令行工具（`xcode-select --install`）或去 python.org 装 |
| ruby | 兜底 | macOS 多数版本自带，但 MIME 覆盖不全，个别 AI 工具可能受限 |
| php | 兜底 | 新版 macOS 已移除，装了才能用 |

建议装 python3，体验最完整。

---

## 三、积分与充值

注册送 20 积分，每天首次登录再领 3 积分；轻量工具 1 分/次，标准 2 分/次，
音视频 4 分/次，AI 类 5 分/次，同一工具 30 分钟内反复使用只计一次。
游戏、计时器、仪表类工具永久免费。

本仓库是**公开版**，`assets/credits.js` 里不含任何密钥与摘要算法。
如需开启在线充值，把 `assets/credits.js` 顶部的 `REDEEM_API` 填成你自己的
校验服务地址（密钥只留在服务端），详见 README 的「在线充值」一节。

---

## 四、目录说明

```
嘉Jaykou工具台/
├─ index.html                 首页
├─ free-tools/                490 个工具，一工具一页
├─ assets/
│  ├─ impl/                   11 个自研引擎（ai/av/calc/game/gen/image/pdf/text/viewer3d）
│  ├─ vendor/                 33 MB，ffmpeg-core.wasm 等第三方引擎
│  ├─ media/                  454 张工具配图
│  ├─ fonts/ thumbs/          字体与缩略图
│  ├─ credits.js              积分制额度系统（前端记账，不含密钥）
├─ 启动网站.command      ← Mac 启动入口
├─ serve_mac.py  serve_mac.rb  本地服务脚本，被上面调用，勿删
├─ 使用说明-Mac.md       ← 本文件
├─ 启动网站.bat  serve.ps1     Windows 启动入口，Mac 上用不到，可删
```

---

## 五、想放到公网上

整个目录传到任意静态托管即可上线：Vercel、Netlify、GitHub Pages、
腾讯云 COS、阿里云 OSS 都行，不需要后端。

上线前记得把 `sitemap.xml` 和 `robots.txt` 里的
`qq499797400-cpu.github.io/jaykou-tools-site` 换成你自己的域名（两个文件批量替换）。

**商用前建议处理的三个遗留项：**

1. 积分账本存在浏览器本地 —— 换设备或清缓存会丢失，懂技术的人也能自行改写，建议接后端账本
2. 登录验证码是演示模式 —— 验证码直接显示在界面上，正式运营要接真实短信通道
3. 右上角登录、注册送积分等文案与线上支付尚未接入

---

## 六、本包与 Windows 版的区别

| | Windows 版 | 本 Mac 版 |
|---|---|---|
| 启动 | `启动网站.bat` → `serve.ps1` | `启动网站.command` → `serve_mac.py` / `serve_mac.rb` |
| 在线充值 | 配置 `REDEEM_API` | 同左 |
| 网站本体 | 完全相同 | 完全相同 |

网站内容（490 个工具 + 引擎 + 图库）两版完全一致，可以自由互换。
