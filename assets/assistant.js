/* ==========================================================================
   智能助理 assistant.js
   --------------------------------------------------------------------------
   右下角常驻入口 + 全站搜索导航面板
     · 490 个工具的中文 / 英文 / 别名混合检索
     · 分类导航、最近使用、快捷命令（充值 / 登录 / 积分 / 随机）
     · 键盘流：⌘K(Ctrl+K) 呼出 · ↑↓ 选择 · Enter 打开 · Esc 关闭
     · 与积分系统 window.JK 打通（余额显示、定价、充值 / 登录入口）
   依赖：assets/tools-index.js（window.__JK_INDEX__）
   ========================================================================== */
(function () {
  'use strict';

  var IDX = window.__JK_INDEX__;
  if (!IDX || !IDX.items || !IDX.items.length) return;

  /* ------------------------------ 图标 ------------------------------ */
  var P = {
    bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10"/><path d="M15 9.5c-.7-1-1.8-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 2 3 2 3 .8 3 2-1.3 2-3 2c-1.2 0-2.3-.5-3-1.5"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    dice: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    video: '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    briefcase: '<rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 16v-5"/><path d="M12 16V8"/><path d="M17 16v-8"/>',
    calc: '<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>',
    pen: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    gamepad: '<line x1="6" x2="10" y1="12" y2="12"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="15" x2="15.01" y1="13" y2="13"/><line x1="18" x2="18.01" y1="11" y2="11"/><rect width="20" height="12" x="2" y="6" rx="6"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
    qr: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M16 12h1"/><path d="M21 12v.01"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.29 1.29L3 12l5.8 1.9a2 2 0 0 1 1.29 1.29L12 21l1.9-5.8a2 2 0 0 1 1.29-1.29L21 12l-5.8-1.9a2 2 0 0 1-1.29-1.29Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>',
  };
  function ic(name, size) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="' + (size || 17) + '" height="' + (size || 17) +
      '" aria-hidden="true">' + (P[name] || P.sparkles) + '</svg>';
  }

  /* ---------------------- 中英别名词典（检索增强） ---------------------- */
  var EN2ZH = {
    compress: '压缩 减小 变小 太大 瘦身 压小 占空间', compressor: '压缩 减小', shrink: '压缩 缩小', reduce: '压缩 减小',
    convert: '转换 格式 转', converter: '转换 转换器 格式', conversion: '转换 格式',
    merge: '合并 合成 拼接 拼在一起 合在一起', merger: '合并 拼接', combine: '合并 合成', join: '合并 连接', concat: '拼接 合并',
    split: '拆分 分割 分离 切开 分成', separate: '分离 拆分',
    crop: '裁剪 裁切 截取', trim: '剪切 裁剪 截取 修剪', cut: '剪切 裁剪 切开 剪辑', cutter: '剪切 裁剪', clip: '剪辑 截取',
    resize: '改尺寸 调整大小 尺寸', scale: '缩放 尺寸', enlarge: '放大', upscale: '放大 高清 超分辨率',
    enhance: '增强 修复 画质', restore: '修复 还原 老照片', unblur: '去模糊 清晰',
    remove: '去除 移除 去掉 删除', remover: '去除 移除', erase: '擦除 去除 消除', delete: '删除 移除', strip: '去除 清除',
    background: '背景 底色', bg: '背景',
    watermark: '水印', censor: '打码 遮挡', redact: '涂黑 脱敏', anonymize: '匿名 脱敏',
    rotate: '旋转 转正', flip: '翻转 镜像', mirror: '镜像 翻转', reverse: '倒放 反转 逆向',
    speed: '变速 速度 加速 慢放', slow: '慢放 慢动作', fast: '加速', loop: '循环 重复',
    gif: '动图 gif', video: '视频 影片', audio: '音频 声音', music: '音乐 背景音乐', voice: '人声 配音 声音',
    sound: '声音 音效', noise: '噪音 降噪', vocal: '人声 歌声', stem: '音轨 分轨', acapella: '清唱 人声',
    subtitle: '字幕', srt: '字幕', caption: '字幕 说明文字', ass: '字幕',
    ocr: '文字识别 识别 提取文字', extract: '提取 抽取', extractor: '提取器 抽取',
    text: '文字 文本', pdf: 'pdf 文档 电子版', word: 'word 文档', doc: '文档', document: '文档', docx: 'word 文档',
    excel: '表格 excel', xlsx: '表格 excel', csv: '表格 csv 数据',
    image: '图片 图像', photo: '照片 图片', picture: '图片 图像', pic: '图片',
    jpg: '图片 jpg', jpeg: '图片 jpeg', png: '图片 png', webp: '图片 webp', svg: '矢量图 svg',
    avif: '图片 avif', heic: '图片 heic 苹果照片', icon: '图标', logo: '商标 标志 图标', favicon: '图标',
    qr: '二维码 扫码 码', barcode: '条形码 条码',
    calculator: '计算器 计算', calc: '计算器 计算', count: '计数 统计 字数', counter: '计数器 统计',
    timer: '计时器 定时', stopwatch: '秒表 计时', countdown: '倒计时', clock: '时钟 时间',
    game: '游戏 小游戏', puzzle: '拼图 益智', sudoku: '数独', chess: '棋 象棋 国际象棋', snake: '贪吃蛇',
    simulator: '模拟器 仿真 物理模拟', emulator: '模拟器 虚拟机 复古', screensaver: '屏保 屏幕保护',
    player: '播放器 播放', recorder: '录制 录音 录屏', record: '录制 录音 录屏', capture: '录制 截图 采集',
    screenshot: '截图 截屏', screenshoter: '截图',
    viewer: '查看器 预览 打开', editor: '编辑器 编辑', viewer3d: '3d 查看',
    generator: '生成器 生成', maker: '制作器 生成 制作', creator: '制作 生成', builder: '制作 生成',
    checker: '检测 检查 测试', check: '检测 检查 校验', test: '测试 检测 试验', detector: '检测 探测 识别',
    analyze: '分析 解析', analyzer: '分析器 分析', validator: '校验 验证', validate: '校验 验证',
    formatter: '格式化 排版 整理', format: '格式化 排版', beautify: '美化 格式化 整理', prettify: '格式化 美化',
    encoder: '编码', encode: '编码 加密', decoder: '解码', decode: '解码 解密',
    encrypt: '加密', decrypt: '解密 解锁', hash: '哈希 摘要', checksum: '校验和 校验', md5: 'md5 哈希',
    base64: 'base64 编码', json: 'json 数据', yaml: 'yaml 配置', xml: 'xml', markdown: 'markdown md 文档',
    html: 'html 网页', css: 'css 样式', url: 'url 网址 链接', link: '链接 网址', shortener: '短链 短网址',
    translate: '翻译 中英', translator: '翻译器 翻译',
    color: '颜色 调色 取色', colour: '颜色 调色', palette: '调色板 配色 色卡', gradient: '渐变 渐变色',
    font: '字体 艺术字', cursive: '花体字 艺术字',
    chart: '图表 统计图', graph: '图表 曲线图', plot: '绘图 图表 曲线', diagram: '图 示意图 图表',
    mindmap: '思维导图 脑图', flowchart: '流程图', whiteboard: '白板 画板', gantt: '甘特图 项目',
    invoice: '发票 开票', resume: '简历 求职', cv: '简历', business: '商务 商业',
    receipt: '收据 小票', template: '模板 样板', signature: '签名 签字', sign: '签名 签署',
    print: '打印 印刷', impose: '拼版 排版', booklet: '小册子 骑马钉', bates: '页码 编号', numbering: '编号 页码',
    collage: '拼图 拼贴 照片墙', mosaic: '马赛克 拼接', grid: '网格 九宫格',
    frame: '帧 画面', fps: '帧率 帧数', interpolation: '插帧 补帧 流畅',
    chroma: '抠图 绿幕 换背景', greenscreen: '绿幕 抠图', keying: '抠像 抠图',
    face: '人脸 面部 人脸', blur: '模糊 虚化', pixelate: '像素化 马赛克', dither: '抖动 复古像素',
    ascii: '字符画 ascii', 'cross': '十字绣', stitch: '十字绣 刺绣', perler: '拼豆 拼图豆',
    knitting: '编织 毛衣', quilt: '拼布 被子', diamond: '钻石画 钻画',
    '3d': '3d 三维 立体', stl: '3d模型 stl 打印', obj: '3d模型 obj', glb: '3d模型 glb', gltf: '3d模型 gltf',
    '3mf': '3d打印 3mf', gerber: 'pcb 电路 图纸', dxf: 'cad 图纸 dxf', step: '3d 图纸 step',
    laser: '激光 雕刻', engraving: '雕刻 激光', sticker: '贴纸 标签',
    unit: '单位 换算', currency: '汇率 货币 换算', converter2: '换算',
    bmi: '体重 身体质量 肥胖', calorie: '卡路里 热量 饮食', tdee: '代谢 消耗',
    loan: '贷款 月供', mortgage: '房贷 按揭', salary: '工资 薪资 个税', gpa: '绩点 成绩',
    percentage: '百分比 比例', age: '年龄 生日', date: '日期 时间', password: '密码 口令',
    random: '随机 抽奖 生成', picker: '随机 抽签', spinner: '转盘 随机',
    unit2: '单位', size: '大小 尺寸 体积', quality: '质量 画质 清晰度', bitrate: '码率 比特率',
    volume: '音量 大小', loudness: '响度 音量', lufs: '响度 标准化', normalize: '标准化 归一化',
    bpm: '节拍 速度', tuner: '调音器 校音 吉他', metronome: '节拍器 打点',
    keyboard: '键盘 按键', mouse: '鼠标', screen: '屏幕 显示器 坏点', mic: '麦克风 话筒 录音',
    speaker: '音箱 喇叭 声道', webcam: '摄像头 相机', camera: '相机 拍照 摄像',
    battery: '电池 电量', sensor: '传感器 陀螺仪', printer: '打印机', monitor: '显示器 屏幕', device: '设备 机型',
    assembler: '汇编 编程 运行', compiler: '编译器 编程 运行', playground: '在线运行 代码 编程',
    python: 'python 代码', javascript: 'javascript js 代码', typescript: 'typescript ts',
    sql: 'sql 数据库', regex: '正则 正则表达式', diff: '对比 差异 比较', compare: '对比 比较 差异',
    minify: '压缩 精简 瘦身', minifier: '压缩 精简',
    lorem: '占位文本 假文', slug: '别名 短名', plural: '复数 单数', readability: '可读性 阅读', grammar: '语法 校对 错别字',
    sort: '排序 整理', shuffle: '打乱 随机排序', list: '列表 清单', table: '表格 表', statistics: '统计 数据',
    ai: 'ai 人工智能 智能', scan: '扫描 识别', monitor2: '监控 检测', optimize: '优化 压缩', optimizer: '优化 压缩',
    to: '', mp3: 'mp3 音频', mp4: 'mp4 视频', mov: 'mov 视频', mkv: 'mkv 视频', avi: 'avi 视频', webm: 'webm 视频',
    wav: 'wav 音频', aac: 'aac 音频', flac: 'flac 无损', ogg: 'ogg 音频', opus: 'opus 音频',
    zip: 'zip 压缩包', ppt: 'ppt 演示 幻灯片', pptx: 'ppt 演示', epub: 'epu b 电子书',
    chemical: '化学 分子 结构式', smiles: '化学 分子式 结构', molecule: '分子 化学',
    gpx: 'gps 轨迹 地图', kml: '地图 轨迹 kml', sqlite: '数据库 sqlite', parquet: '数据 parquet 大数据',
  };

  /* ------------------------------ 基础工具 ------------------------------ */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }

  /* 站点根相对前缀：由脚本 src 推导，兼容根目录与 free-tools/ 子目录 */
  var BASE = (function () {
    var el = document.querySelector('script[src*="assistant.js"]');
    var src = el && el.getAttribute('src') ? el.getAttribute('src') : 'assets/assistant.js';
    return src.replace(/assets\/assistant\.js.*$/, '');
  })();
  function url(slug) { return BASE + 'free-tools/' + slug + '.html'; }
  function homeUrl() { return BASE + 'index.html'; }

  var CURRENT = (function () {
    var m = /(?:^|\/)free-tools\/([a-z0-9-]+)\.html/i.exec(location.pathname);
    return m ? m[1] : '';
  })();

  /* 最近使用 */
  var K_REC = 'jk_asst_recent_v1';
  function recent() {
    try { var a = JSON.parse(localStorage.getItem(K_REC) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function pushRecent(slug) {
    try {
      var a = recent().filter(function (x) { return x !== slug; });
      a.unshift(slug);
      localStorage.setItem(K_REC, JSON.stringify(a.slice(0, 8)));
    } catch (e) { /* 隐私模式忽略 */ }
  }

  function pick(slug) { pushRecent(slug); location.href = url(slug); }

  /* ------------------------------ 索引预处理 ------------------------------ */
  var CATS = IDX.cats || {};
  var ITEMS = IDX.items.map(function (it) {
    var cat = CATS[it.c] || { n: '其他', ic: 'sparkles', c1: '#cbd5e1', c2: '#64748b' };
    var alias = it.s.split('-').map(function (w) { return EN2ZH[w] || ''; }).filter(Boolean).join(' ');
    return {
      s: it.s, t: it.t, d: it.d, c: it.c, e: it.e, p: it.p, h: it.h,
      catName: cat.n, catIcon: cat.ic, c1: cat.c1, c2: cat.c2,
      nt: norm(it.t), nd: norm(it.d),
      ns: it.s.replace(/-/g, ' '),
      na: norm(alias),
      alias: alias,
    };
  });
  var BY_SLUG = {};
  ITEMS.forEach(function (it) { BY_SLUG[it.s] = it; });

  var CAT_ORDER = Object.keys(CATS).filter(function (k) { return k !== 'featured' && CATS[k].n; })
    .sort(function (a, b) { return (CATS[b].c || 0) - (CATS[a].c || 0); });

  function priceOf(it) {
    try { if (window.JK && window.JK.priceOf) return window.JK.priceOf(it.s, it.e); } catch (e) { /* noop */ }
    return it.p;
  }
  function costLabel(n) {
    return n === 0 ? '免费' : n === 5 ? '5 分 · AI' : n === 4 ? '4 分 · 重量' : n === 2 ? '2 分' : n + ' 分';
  }
  function costCls(n) { return n === 0 ? 'free' : n >= 5 ? 'ai' : n >= 4 ? 'low' : ''; }

  /* ------------------------------ 检索 ------------------------------ */
  function scoreOne(it, tok) {
    if (it.nt === tok) return 130;
    if (it.nt.indexOf(tok) === 0) return 76;
    if (it.nt.indexOf(tok) > 0) return 48;
    if (it.nd.indexOf(tok) >= 0) return 24;
    if (it.ns.indexOf(tok) >= 0) return 30;
    if (it.na.indexOf(tok) >= 0) return 20;
    if (norm(it.catName).indexOf(tok) >= 0) return 12;
    return 0;
  }

  /* 语义意图：中文短语 → 对应英文 slug 词，用于区分「去水印 / 加水印」这类反义需求 */
  var INTENT = [
    [/去|去除|移除|删除|消除|抹掉|擦掉/, /remove|erase|delete|strip|redact|censor|decrypt|unlock|vocal/, 34],
    [/加水印|添加|加上|插入|打码|加字|加字幕/, /add|insert|watermark|censor|caption|subtitle/, 26],
    [/转|转换|变成|转为|转格式/, /(-to-|-into-|convert|transform|transcode)/, 22],
    [/合并|拼接|合成|合在|连起来/, /merge|join|combine|concat|merger/, 26],
    [/拆分|分割|拆开|切成|分开/, /split|separate|extract/, 26],
    [/压缩|减小|变小|瘦身|压小/, /compress|shrink|reduce|minif|optimiz/, 26],
    [/放大|变大|高清|超分|变清晰/, /upscal|enlarge|resize|enhance|restor|unblur/, 26],
    [/裁剪|裁切|截取|剪切/, /crop|trim|cut|clip|snip/, 26],
  ];
  function intentBonus(it, tok) {
    var best = 0;
    for (var i = 0; i < INTENT.length; i++) {
      if (INTENT[i][0].test(tok) && INTENT[i][1].test(it.s)) best = Math.max(best, INTENT[i][2]);
    }
    return best;
  }

  /* 中文串按连续子串扩展匹配（解决「去水印」「转格式」这类组合词） */
  function scoreTok(it, tok) {
    if (!tok) return 0;
    var best = scoreOne(it, tok) + intentBonus(it, tok);
    if (/^[\u4e00-\u9fa5]{3,}$/.test(tok)) {
      for (var len = tok.length - 1; len >= 2; len--) {
        for (var i = 0; i + len <= tok.length; i++) {
          var sub = tok.substr(i, len);
          var s = scoreOne(it, sub) + intentBonus(it, sub);
          if (s > best) best = s;
        }
      }
    }
    return best;
  }

  function search(q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return [];
    var toks = q.split(/[\s,，、+]+/).filter(Boolean)
      .reduce(function (acc, t) {   // 中英连写切分：mp4转mp3 → mp4 / 转 / mp3
        return acc.concat(t.split(/(?<=[a-z0-9])(?=[\u4e00-\u9fa5])|(?<=[\u4e00-\u9fa5])(?=[a-z0-9])/i));
      }, []).filter(Boolean);
    var out = [];
    for (var i = 0; i < ITEMS.length; i++) {
      var it = ITEMS[i];
      var score = 0, strong = 0;
      for (var j = 0; j < toks.length; j++) {
        var s = scoreTok(it, toks[j]);
        if (s >= 30) strong++;
        score += s;
      }
      /* 整串语义（意图）加权，只加分不覆盖：避免「pdf文档转换」里的「转换」
         把只含 -to- 的无关工具也拉进结果 */
      score += Math.floor(scoreTok(it, norm(q)) * 0.4);
      // 保留条件：单词查询有像样命中即可；多词查询要求至少一次强命中或总分够高
      if (score < 20) continue;
      if (toks.length > 1 && strong === 0 && score < 60) continue;
      score += it.h ? 8 : 0;
      score += it.p === 0 ? 2 : 0;
      if (it.s === CURRENT) score += 4;
      out.push({ it: it, score: score });
    }
    out.sort(function (a, b) { return b.score - a.score || a.it.t.length - b.it.t.length; });
    return out.slice(0, 30).map(function (x) { return x.it; });
  }

  /* ======================================================================
     需求理解层：客户说的是大白话，不是关键词
     「我想把 pdf 文档转换成 word」→ 清洗 → 「pdf文档转换成word」
     → 识别方向 PDF → Word → 直接命中 pdf-to-word
     ====================================================================== */

  /* 1) 口语噪声：客套、疑问、量词，去掉之后剩下的才是真实需求 */
  var NOISE_RE = /(我想问一下|我想把|我想要|我想请|我想|我要把|我要|帮我找一下|帮我找|帮我把|能不能帮我|帮我|能不能|能否|可不可以|可以|怎么才能|怎么办|怎么|如何|怎样|什么样|请问|麻烦你|麻烦|有没有|有吗|我需要|给我来一个|给我|来一个|哪个工具可以|哪个工具|哪个|什么工具|用什么|在哪里|在哪|谁会|请你|请|把|将|让我|找一下|找|一下子|一下|一个|做个|弄个|搞个|太大了|太大|太小了|太小|好几份|好几张|几份|好几|几张|几|两张|两份|两个|工具|软件|在线|免费|网站|网页|这个|那个|想|出来|起来|的话|的话|的|地|得|了|吗|呢|啊|吧|哦|哈)/g;
  var PUNC_RE = /[，。！？、；：""''（）【】《》,.!?;:()"'\/\\|]/g;

  function cleanQ(q) {
    return String(q || '').toLowerCase()
      .replace(PUNC_RE, ' ')
      .replace(NOISE_RE, '')      // 直接删，别留空格——否则「图片上的字」会被切成「图片上 字」，短语就匹配不上了
      .replace(/\s+/g, ' ').trim();
  }

  /* 1.5) 大白话 → 工具词：客户不会说「橡皮擦」「规范化」，只会说「去掉水印」「声音太小」 */
  var SYN = [
    [/(去|去除|去掉|移除|删除|抹掉|擦掉|消除|抠掉|弄掉)(图片|照片|图|文件|上面|上|里)?的?水印/, '橡皮擦 移除对象 擦除'],
    [/拆(成|开|分)|分成|分割成|切成|切分|分开|拆散/, '拆分'],
    [/拼(在|到)?一起|拼成|拼图|拼接|拼版|合在(一起|一张)|九宫格|长图/, '拼贴 网格 照片墙'],
    [/声音(太)?(小|大|轻)|音量|响度|调大|调小|提高音量|太小声|听不清/, '响度 规范化 音量'],
    [/抠图|(去|去除|去掉|换|换掉|更换|抠)[^，。]{0,3}背景|背景(去|去掉|去除|透明|换掉|换|不要)/, '背景 移除 抠图'],
    [/图片(里|上|中)?的?(文字|字)|图转文|文字识别|图片识别|认字|扫描(成|为)?文字|ocr/, '文本 识别 ocr'],
    [/(录音|语音|音频|声音|会议|采访|电话)(转|成|变成|转成)?(文字|文本|字)|听写|转写/, '语音转文字 听写'],
    [/加字幕|配字幕|上字幕|做字幕|挂字幕|字幕/, '字幕'],
    [/证件照|一寸|二寸|护照照|签证照|简历照|社保照/, '证件照'],
    [/(转|换)个?格式|格式(转换|互换)|转换格式/, '转换'],
    [/文件太大|太大了|占空间|瘦身|减小体积|变小/, '压缩'],
    [/模糊|不清晰|变清晰|高清化|马赛克|放大一点|更清楚/, '放大 修复 超分'],
    [/黑底|白底|底色/, '背景'],
    [/(加|添加|打|加上|放上|弄|配)[^，。]{0,3}水印|防盗图|署名/, '添加水印'],
  ];
  function expand(q) {
    var extra = [];
    for (var i = 0; i < SYN.length; i++) if (SYN[i][0].test(q)) extra.push(SYN[i][1]);
    return extra.length ? (q + ' ' + extra.join(' ')) : q;
  }

  /* 1.6) 需求短语 → 直接指名工具：有些需求在工具名里根本没有对应字
     （客户说「去水印」，站内叫「图像橡皮擦」；说「提取视频里的声音」，站内是「MP4 转 MP3」） */
  var NEED = [
    {
      re: /(去|去除|去掉|移除|删除|抹掉|擦掉|消除|抠掉|弄掉)(图片|照片|图|文件|上面|上|里)?的?水印|水印(怎么|如何)?(去|去除|去掉|删除|移除|弄掉)/,
      top: ['image-eraser', 'remove-object-from-photo'], more: ['remove-text-from-image', 'face-retouch'],
      w: 130, label: '去除水印',
    },
    { re: /(加|添加|打|加上|放上|弄|配)[^，。]{0,3}水印|防盗图|署名/, top: ['add-watermark'], more: [], w: 130, label: '添加水印' },
    {
      re: /抠图|(去|去除|去掉|换|换掉|更换|抠|抹)[^，。]{0,3}背景|背景(去|去掉|去除|透明|换掉|换|不要)/,
      top: ['background-remover'], more: ['change-photo-background', 'blur-photo-background', 'add-background-to-photo', 'profile-picture-background'],
      w: 130, label: '去除 / 替换背景',
    },
    {
      re: /图片(里|上|中)?的?(文字|字)|图转文|文字识别|图片识别|认字|扫描(成|为)?文字|ocr/,
      top: ['image-to-text', 'ocr'], more: ['pdf-to-text', 'remove-text-from-image'],
      w: 120, label: '图片转文字',
    },
    {
      re: /(录音|语音|音频|声音|会议|采访|电话)(转|成|变成|转成)?(文字|文本|字)|听写|转写/,
      top: ['speech-to-text', 'audio-to-text'], more: ['subtitle-generator'],
      w: 120, label: '语音转文字',
    },
    {
      re: /加字幕|配字幕|上字幕|做字幕|挂字幕|(视频|片子|电影)(加|配|上)字幕/,
      top: ['add-subtitles-to-video', 'subtitle-generator'], more: ['subtitle-editor', 'subtitle-converter', 'subtitle-sync'],
      w: 120, label: '添加 / 编辑字幕',
    },
    {
      re: /(视频|影片|mp4|mov|电影|片子)[^，。]{0,8}(声音|音频|音乐|配乐|原声|bgm)|提取(声音|音频|音乐|配音|原声)|(声音|音频|音乐|原声)(提出来|取出来|提取|导出|弄出来|扒|抽)/,
      top: ['mp4-to-mp3', 'video-to-mp3'], more: ['audio-to-text'],
      w: 130, label: '提取视频里的声音',
    },
    {
      re: /拼(在|到)?一起|拼成|做成拼图|照片拼|图片拼|多张图|几张图|九宫格|长图拼接/,
      top: ['photo-collage-maker', 'photo-grid-maker'], more: ['heart-photo-collage', 'instagram-story-collage'],
      w: 120, label: '图片拼贴',
    },
    {
      re: /声音(太)?(小|大|轻)|音量|响度|调大|调小|提高音量|太小声|听不清|声音闷/,
      top: ['normalize-audio', 'loudness-meter'], more: ['audio-compressor'],
      w: 120, label: '调整音量 / 响度',
    },
    { re: /证件照|一寸|二寸|护照照|签证照|简历照|社保照/, top: ['passport-photo-maker'], more: ['profile-picture-background', 'face-retouch'], w: 130, label: '证件照制作' },
  ];
  function matchNeed(q) {
    var out = [];
    for (var i = 0; i < NEED.length; i++) if (NEED[i].re.test(q)) out.push(NEED[i]);
    return out;
  }
  function needBonus(it, needs) {
    var s = 0;
    for (var i = 0; i < needs.length; i++) {
      var n = needs[i];
      if (n.top.indexOf(it.s) >= 0) s += n.w;
      else if (n.more && n.more.indexOf(it.s) >= 0) s += Math.round(n.w * 0.35);
    }
    return s;
  }

  /* 1.7) 反义保护：客户说「去」，就别把「添加」排到前面 */
  var NEG = [
    [/(去|去除|去掉|移除|删除|抹掉|擦掉|消除|抠掉)/, /(^|-)add(-|$)|watermark|insert/, /(remove|erase|strip|delete|redact|censor)/, -70],
    [/(加|添加|加上|插入|打码)/, /(^|-)remove(-|$)|erase|strip|delete/, /(add|insert|caption|subtitle)/, -70],
  ];
  function negScore(it, q) {
    var s = 0;
    for (var i = 0; i < NEG.length; i++) {
      var n = NEG[i];
      if (n[0].test(q) && n[1].test(it.s) && !n[2].test(it.s)) s += n[3];
    }
    return s;
  }

  /* 2) 处理对象：客户嘴里的「PDF / 视频 / 图片」对应 slug 的哪一段 */
  var OBJ = [
    ['gif',       /gif|动图/,                                              /gif/],
    ['pdf',       /pdf/,                                                   /pdf/],
    ['word',      /word|docx/,                                             /word|docx/],
    ['excel',     /excel|xlsx/,                                            /excel|xlsx/],
    ['csv',       /csv/,                                                   /csv/],
    ['ppt',       /ppt|幻灯片|演示/,                                       /ppt|slide|presentation/],
    ['video',     /视频|影片|录像|mp4|mov|mkv|avi|webm|m4v/,               /video|mp4|mov|mkv|avi|webm|m4v/],
    ['audio',     /音频|声音|音乐|歌曲|mp3|wav|aac|flac|ogg|m4a/,          /audio|mp3|wav|aac|flac|ogg|m4a|sound|music|voice/],
    ['image',     /图片|图像|照片|相片|jpg|jpeg|png|webp|svg|heic|avif|bmp|tiff/, /image|photo|picture|jpg|jpeg|png|webp|svg|heic|avif|bmp|tiff/],
    ['text',      /文字|文本|txt/,                                         /text|txt|word-count/],
    ['zip',       /zip|压缩包|rar|7z|解压/,                                /zip|rar|7z|unzip/],
    ['font',      /字体|艺术字/,                                           /font/],
    ['qr',        /二维码|qr码|qr|条形码|条码/,                            /qr|barcode/],
    ['json',      /json/,                                                  /json/],
    ['markdown',  /markdown|md文档/,                                       /markdown/],
    ['epub',      /epub|电子书/,                                           /epub/],
    ['3d',        /3d|三维|立体|模型|stl|glb|gltf/,                        /3d|stl|glb|gltf/],
    ['url',       /网址|链接|url/,                                         /url|link/],
  ];
  var OBJ_ZH = {
    pdf: 'PDF', word: 'Word', excel: 'Excel', csv: 'CSV', ppt: 'PPT', video: '视频', audio: '音频',
    image: '图片', gif: 'GIF', text: '文字', zip: '压缩包', font: '字体', qr: '二维码', json: 'JSON',
    markdown: 'Markdown', epub: '电子书', '3d': '3D 模型', url: '链接',
  };
  var OBJ2CAT = {
    pdf: 'pdf', word: 'pdf', epub: 'pdf', excel: 'data', csv: 'data', ppt: 'business',
    video: 'video', gif: 'video', audio: 'audio', image: 'image', text: 'dev', zip: 'dev',
    font: 'codes', qr: 'codes', json: 'dev', markdown: 'dev', '3d': '3d', url: 'dev',
  };
  function objKey(text) {
    for (var i = 0; i < OBJ.length; i++) if (OBJ[i][1].test(text)) return OBJ[i][0];
    return '';
  }
  function objSlugRe(key) {
    for (var i = 0; i < OBJ.length; i++) if (OBJ[i][0] === key) return OBJ[i][2];
    return null;
  }
  function zh(key) { return OBJ_ZH[key] || key; }

  /* 3) 方向识别：word转pdf 和 pdf转word 必须分得开 */
  var PAIR_RE = /([\u4e00-\u9fa5a-z0-9]{1,12}?)\s*(?:转换成|转换为|转换|转成|转为|变换成|变成|变为|改成为|改成|改造为|做成|制作成|弄成|生成|输出为|输出|导出为|导出|保存为|另存为|存为|转)\s*([\u4e00-\u9fa5a-z0-9]{0,12})/;
  function parsePair(q) {
    var m = PAIR_RE.exec(String(q || '').toLowerCase());
    if (!m) return null;
    var a = objKey(m[1] || ''), b = objKey(m[2] || '');
    if (!a && !b) return null;
    // ra / rb：客户嘴里的原话（jpg / png），比归类后的 image 更精确
    var ra = (m[1] || '').replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
    var rb = (m[2] || '').replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
    return { from: a, to: b, ra: ra, rb: rb };
  }
  function pairBonus(it, p) {
    var s = it.s;
    if (p.from && p.to) {
      if (p.ra && p.rb) {
        if (s.indexOf(p.ra + '-to-' + p.rb) >= 0 || s.indexOf(p.ra + '2' + p.rb) >= 0) return 110;
        if (s.indexOf(p.ra) >= 0 && s.indexOf(p.rb) >= 0) return 74;
      }
      if (s.indexOf(p.from + '-to-' + p.to) >= 0 || s.indexOf(p.from + '2' + p.to) >= 0) return 100;
      if (s.indexOf(p.to + '-to-' + p.from) >= 0 || s.indexOf(p.to + '2' + p.from) >= 0) return -50;
      if (s.indexOf(p.from) >= 0 && s.indexOf(p.to) >= 0) return 60;
      if (s.indexOf(p.from) >= 0 && /(-to-|convert|transcode)/.test(s)) return 34;
      if (s.indexOf(p.to) >= 0) return 14;
      return 0;
    }
    if (p.from) {
      if (s.indexOf(p.from + '-to-') >= 0) return 40;
      if (s.indexOf(p.from) >= 0 && /(-to-|convert)/.test(s)) return 28;
      if (s.indexOf(p.from) >= 0) return 12;
    } else if (p.to) {
      if (s.indexOf('-to-' + p.to) >= 0) return 34;
      if (s.indexOf(p.to) >= 0) return 12;
    }
    return 0;
  }

  /* 1.8) 动作加权：客户说了「裁剪 / 压缩 / 拆分」，真干这活的工具必须压过同名的「XXX 转 PDF」 */
  var ACT = [
    [/(去|去除|去掉|移除|删除|抹掉|擦掉|消除|抠掉)/, /remove|erase|delete|strip|redact|censor|decrypt|unlock/, 45],
    [/(加水印|添加|加上|插入|打码)/, /add|insert|watermark|censor|caption|subtitle/, 36],
    [/(合并|拼接|合成|合在|连起来)/, /merge|join|combine|concat|merger/, 45],
    [/(拆分|分割|拆开|切成|分开)/, /split|separate|extract/, 45],
    [/(压缩|减小|变小|瘦身|压小)/, /compress|shrink|reduce|minif|optimiz/, 45],
    [/(放大|变大|高清|超分|变清晰|更清楚)/, /upscal|enlarge|resize|enhance|restor|unblur/, 45],
    [/(裁剪|裁切|截取|剪切)/, /crop|trim|cut|clip|snip/, 45],
    [/(旋转|翻转|摆正|扶正|倒过来)/, /rotate|flip|straighten/, 45],
    [/(识别|转成文字|提取文字|认字)/, /ocr|to-text|recogni|extract/, 40],
  ];
  function actScore(it, q) {
    for (var i = 0; i < ACT.length; i++) {
      if (ACT[i][0].test(q)) return ACT[i][1].test(it.s) ? ACT[i][2] : -18;
    }
    return 0;
  }

  /* 3.5) 领域约束：客户点名了「视频」，就别把 PDF 工具排到前面 */
  var MEDIA = ['video', 'gif', 'audio', 'image', 'pdf'];
  function objKeysIn(q) {
    var out = [];
    for (var i = 0; i < OBJ.length; i++) if (OBJ[i][1].test(q)) out.push(OBJ[i][0]);
    return out;
  }
  function objHit(it, key) {
    var re = objSlugRe(key);
    if (!re) return false;
    return re.test(it.ns) || OBJ_ZH_RE(key).test(it.nt);
  }
  function OBJ_ZH_RE(key) {
    for (var i = 0; i < OBJ.length; i++) if (OBJ[i][0] === key) return OBJ[i][1];
    return /(?!)/;
  }
  function domainScore(it, objs) {
    if (!objs.length) return 0;
    var hit = 0;
    for (var i = 0; i < objs.length; i++) if (objHit(it, objs[i])) hit++;
    if (hit) return 26 * hit;
    var qMedia = false, itMedia = false;
    for (var j = 0; j < MEDIA.length; j++) {
      if (objs.indexOf(MEDIA[j]) >= 0) qMedia = true;
      if (objHit(it, MEDIA[j])) itMedia = true;
    }
    if (qMedia && itMedia) return -46;   // 客户点名了别的领域，这个工具跨界了
    return -8;
  }

  /* 4) 兜底检索：只按「对象 + 动作」找，说不清的客套话不再拖累结果 */
  function looseSearch(q) {
    var pair = parsePair(q);
    var hits = [];
    for (var i = 0; i < OBJ.length; i++) if (OBJ[i][1].test(q)) hits.push(OBJ[i][0]);
    if (!pair && !hits.length) return [];
    var out = [];
    for (var k = 0; k < ITEMS.length; k++) {
      var it = ITEMS[k], sc = 0;
      if (pair) sc += pairBonus(it, pair);
      for (var j = 0; j < hits.length; j++) {
        var re = objSlugRe(hits[j]);
        if (re && re.test(it.s)) sc += 45;
        else if (re && re.test(it.ns)) sc += 30;
        else if (norm(it.catName).indexOf(hits[j]) >= 0) sc += 10;
      }
      sc += intentBonus(it, q);
      if (it.h) sc += 8;
      if (sc > 20) out.push({ it: it, score: sc });
    }
    out.sort(function (a, b) { return b.score - a.score || a.it.t.length - b.it.t.length; });
    return out.slice(0, 30).map(function (x) { return x.it; });
  }

  var ACT_ZH = ['去除', '添加', '格式转换', '合并', '拆分', '压缩', '放大 / 修复', '裁剪'];
  /* 5) 把理解结果翻译成一句人话，回显给客户看 */
  function describe(q) {
    var p = parsePair(q), bits = [];
    if (p) {
      if (p.from && p.to) bits.push(zh(p.from) + ' 转 ' + zh(p.to));
      else if (p.from) bits.push(zh(p.from) + ' 格式转换');
      else if (p.to) bits.push('转成 ' + zh(p.to));
    }
    var joined = bits.join('');
    for (var i = 0; i < INTENT.length; i++) {
      var a = ACT_ZH[i];
      if (!INTENT[i][0].test(q) || bits.indexOf(a) >= 0) continue;
      if (a === '格式转换' && /转|转换/.test(joined)) continue;   // 「PDF 转 Word · 格式转换」太啰嗦
      bits.push(a);
      break;
    }
    for (var j = 0; j < OBJ.length && bits.length < 2; j++) {
      if (OBJ[j][1].test(q) && (!p || (OBJ[j][0] !== p.from && OBJ[j][0] !== p.to))) { bits.push(zh(OBJ[j][0])); break; }
    }
    return bits.join(' · ');
  }

  function tokenize(q) {
    return String(q || '').trim().toLowerCase().split(/[\s,，、+]+/).filter(Boolean)
      .reduce(function (acc, t) {   // 中英连写切分：mp4转mp3 → mp4 / 转 / mp3
        return acc.concat(t.split(/(?<=[a-z0-9])(?=[\u4e00-\u9fa5])|(?<=[\u4e00-\u9fa5])(?=[a-z0-9])/i));
      }, []).filter(Boolean);
  }
  function needLabel(needs) {
    for (var i = 0; i < needs.length; i++) if (needs[i].label) return needs[i].label;
    return '';
  }

  /* 6) 统一打分：关键词 + 需求短语 + 方向 + 领域约束一次算完，再排一次序
        —— 之前是「严格检索有结果就直接返回」，需求层根本没机会纠偏 */
  function scorePass(qstr, ctx) {
    var toks = tokenize(qstr);
    if (!toks.length) return [];
    var out = [];
    for (var i = 0; i < ITEMS.length; i++) {
      var it = ITEMS[i], score = 0, strong = 0;
      for (var j = 0; j < toks.length; j++) {
        var s = scoreTok(it, toks[j]);
        if (s >= 30) strong++;
        score += s;
      }
      score += Math.floor(scoreTok(it, norm(qstr)) * 0.4);
      score += needBonus(it, ctx.needs);
      if (ctx.pair) score += pairBonus(it, ctx.pair);
      score += domainScore(it, ctx.objs);
      score += actScore(it, qstr);
      score += negScore(it, qstr);
      score += it.h ? 8 : 0;
      score += priceOf(it) === 0 ? 2 : 0;
      if (it.s === CURRENT) score += 4;
      if (score < 24) continue;
      if (toks.length > 1 && strong === 0 && score < 70) continue;
      out.push({ it: it, score: score });
    }
    out.sort(function (a, b) { return b.score - a.score || a.it.t.length - b.it.t.length; });
    return out;
  }

  function smartSearch(raw) {
    var q = String(raw || '').trim().toLowerCase();
    if (!q) return { list: [], via: '', guess: '' };
    var clean = cleanQ(q) || q;
    var body = expand(clean);
    var ctx = {
      pair: parsePair(clean) || parsePair(body) || parsePair(q),
      objs: objKeysIn(body),
      needs: matchNeed(clean),
    };
    var pass = scorePass(body, ctx);
    if (!pass.length && clean !== q) {
      pass = scorePass(q, { pair: parsePair(q), objs: objKeysIn(q), needs: matchNeed(q) });
    }
    if (!pass.length) {
      var fb = looseSearch(clean);
      if (!fb.length && clean !== q) fb = looseSearch(q);
      return { list: fb, via: clean !== q ? clean : '', guess: needLabel(ctx.needs) || describe(clean) };
    }
    var seen = {}, list = [];
    for (var i = 0; i < pass.length && list.length < 30; i++) {
      if (seen[pass[i].it.s]) continue;
      seen[pass[i].it.s] = 1;
      list.push(pass[i].it);
    }
    return {
      list: list,
      via: clean !== q ? clean : '',
      guess: needLabel(ctx.needs) || describe(body),
    };
  }

  /* 猜客户想逛哪个分类（需求没命中工具时的出路） */
  function guessCats(q) {
    var out = [];
    for (var i = 0; i < OBJ.length; i++) {
      if (OBJ[i][1].test(q)) {
        var c = OBJ2CAT[OBJ[i][0]];
        if (c && CATS[c] && out.indexOf(c) < 0) out.push(c);
      }
    }
    return out.slice(0, 3);
  }

  function hl(text, q) {
    var s = esc(text);
    var toks = String(q || '').trim().toLowerCase().split(/[\s,，、+]+/).filter(Boolean);
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.length < 1) continue;
      var pos = s.toLowerCase().indexOf(t);
      if (pos >= 0) {
        s = s.slice(0, pos) + '<mark>' + s.slice(pos, pos + t.length) + '</mark>' + s.slice(pos + t.length);
        break;
      }
    }
    return s;
  }

  /* ------------------------------ 命令 ------------------------------ */
  function JK() { return window.JK || null; }
  var CMDS = [
    {
      id: 'recharge', t: '充值 / 购买积分', d: '卡密兑换 · 套餐购买', ic: 'wallet', c1: '#ffb066', c2: '#ff7a45',
      keys: ['充值', '购买', '买积分', '卡密', '兑换', '套餐', '付费', '充值码', 'recharge'],
      run: function () { JK() && JK().openRecharge ? JK().openRecharge() : (location.href = homeUrl()); },
    },
    {
      id: 'login', t: '登录 / 注册', d: '注册送 20 积分，每日再领 3 分', ic: 'user', c1: '#7dd3fc', c2: '#0ea5e9',
      keys: ['登录', '注册', '登陆', '账号', '帐号', '手机号', '验证码', 'login', 'signin'],
      run: function () {
        var j = JK();
        if (j && j.isLogin && j.isLogin()) { j.openAccount ? j.openAccount() : j.openRecharge(); }
        else if (j && j.openLogin) j.openLogin();
      },
    },
    {
      id: 'account', t: '我的积分', d: '余额 · 每日领取 · 消费记录', ic: 'coin', c1: '#c4b5fd', c2: '#8b5cf6',
      keys: ['积分', '余额', '我的', '账户', '点数', '领积分', '签到', 'credit', 'account'],
      run: function () {
        var j = JK();
        if (j && j.openAccount) j.openAccount();
        else if (j && j.openLogin) j.openLogin();
      },
    },
    {
      id: 'free', t: '全部免费工具', d: '不消耗积分，随便用', ic: 'gift', c1: '#6ee7b7', c2: '#10b981',
      keys: ['免费', '不要积分', '0分', '免积分', 'free'],
    },
    {
      id: 'random', t: '随机逛逛', d: '从 490 个工具里挑一个', ic: 'dice', c1: '#fda4af', c2: '#f43f5e',
      keys: ['随机', '随便', '试试', '逛逛', 'random'],
      run: function () { pick(ITEMS[Math.floor(Math.random() * ITEMS.length)].s); },
    },
    {
      id: 'home', t: '回到首页', d: '看全部 17 个分类', ic: 'home', c1: '#a5b4fc', c2: '#6366f1',
      keys: ['首页', '主页', 'home', 'main', '返回'],
      run: function () { location.href = homeUrl(); },
    },
    {
      id: 'help', t: '使用帮助', d: '快捷键与搜索技巧', ic: 'help', c1: '#cbd5e1', c2: '#64748b',
      keys: ['帮助', '怎么用', '快捷键', 'help', '说明'],
    },
  ];

  function matchCmds(q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return [];
    return CMDS.filter(function (c) {
      for (var i = 0; i < c.keys.length; i++) {
        var k = c.keys[i];
        // 关键词以查询开头（充 → 充值 / ai → ai 工具），或查询里包含完整关键词（怎么充值 → 充值）
        if (k.indexOf(q) === 0 || (k.length >= 2 && q.indexOf(k) >= 0)) return true;
      }
      return false;
    });
  }

  /* ------------------------------ 渲染 ------------------------------ */
  var launch, panel, input, body, chipsBox, coinBtn, clearBtn, tipEl;
  var state = { open: false, mode: 'home', q: '', cat: '', sel: 0, rows: [] };

  function itemHtml(it, i, q) {
    var cur = it.s === CURRENT;
    return '<button class="jk-asst-item' + (i === state.sel ? ' sel' : '') + '" type="button" data-slug="' + esc(it.s) + '" data-i="' + i + '">' +
      '<span class="jk-asst-ic" style="background:linear-gradient(135deg,' + it.c1 + ',' + it.c2 + ')">' + ic(it.catIcon, 17) + '</span>' +
      '<span class="jk-asst-itxt"><b>' + hl(it.t, q) + '</b><span>' + esc(it.d || it.catName) + '</span></span>' +
      (cur ? '<span class="jk-asst-cur">当前</span>' : '') +
      '<span class="jk-asst-cost ' + costCls(priceOf(it)) + '">' + costLabel(priceOf(it)) + '</span>' +
      '</button>';
  }

  function cmdHtml(c, i) {
    return '<button class="jk-asst-item' + (i === state.sel ? ' sel' : '') + '" type="button" data-cmd="' + c.id + '" data-i="' + i + '">' +
      '<span class="jk-asst-ic" style="background:linear-gradient(135deg,' + c.c1 + ',' + c.c2 + ')">' + ic(c.ic, 17) + '</span>' +
      '<span class="jk-asst-itxt"><b>' + esc(c.t) + '</b><span>' + esc(c.d) + '</span></span>' +
      '<span class="jk-asst-cost">指令</span></button>';
  }

  function renderChips() {
    var html = '<button class="jk-asst-chip' + (state.cat === '' ? ' on' : '') + '" type="button" data-cat="">全部</button>';
    for (var i = 0; i < CAT_ORDER.length; i++) {
      var k = CAT_ORDER[i];
      html += '<button class="jk-asst-chip' + (state.cat === k ? ' on' : '') + '" type="button" data-cat="' + esc(k) + '">' +
        esc(CATS[k].n) + (CATS[k].c ? ' ' + CATS[k].c : '') + '</button>';
    }
    chipsBox.innerHTML = html;
  }

  function render() {
    var q = state.q;
    var html = '';
    state.rows = [];

    if (state.mode === 'help') {
      html += '<div class="jk-asst-help">' +
        '<div><b>直接说需求就行</b>：<code>把 PDF 转成 Word</code>、<code>视频太大了想压缩</code>、<code>给图片去个水印</code>、<code>把几张图拼在一起</code> —— 我会自己找对应工具并直接跳转。</div>' +
        '<div>也可以只输关键词，支持中英文混搜：<code>压缩 pdf</code>、<code>去水印</code>、<code>mp4 转 mp3</code></div>' +
        '<div>也可直接下指令：<code>充值</code>、<code>积分</code>、<code>随机</code>、<code>免费</code>、<code>首页</code></div>' +
        '<div>快捷键：<code>⌘K</code> / <code>Ctrl+K</code> 呼出，<code>↑</code><code>↓</code> 选择，<code>Enter</code> 打开，<code>Esc</code> 关闭</div>' +
        '<div>积分：注册送 20 分，每天登录再领 3 分；未登录每天可免费用 3 次。</div>' +
        '</div>';
      body.innerHTML = html;
      return;
    }

    if (q) {
      var cmds = matchCmds(q);
      if (!cmds.length) {                                  // 「我想充值」这类整句也要认出指令
        var cq = cleanQ(q);
        if (cq && cq !== q) cmds = matchCmds(cq);
      }
      var res = smartSearch(q);
      var list = res.list;
      if (state.cat) list = list.filter(function (it) { return it.c === state.cat; });

      state.rows = cmds.map(function (c) { return { cmd: c }; }).concat(list.map(function (it) { return { it: it }; }));
      if (!state.rows.length) {
        html += '<div class="jk-asst-empty"><b>没找到「' + esc(q) + '」</b>' +
          '直接说需求也行，比如「把 PDF 转成 Word」「视频太大了想压缩」<br>或者逛逛这些分类：</div>';
        var g = guessCats(q);
        if (g.length) {
          html += '<div class="jk-asst-sug">';
          g.forEach(function (c) {
            html += '<button class="jk-asst-chip" type="button" data-cat="' + esc(c) + '">' + esc(CATS[c].n) + ' ' + (CATS[c].c || '') + '</button>';
          });
          html += '</div>';
        }
      } else {
        if (res.via && res.via !== q) {
          html += '<div class="jk-asst-parse">理解为 <b>' + esc(res.guess || res.via) + '</b>' +
            '<span>按需求匹配，不是死抠关键词</span></div>';
        }
        if (cmds.length) html += '<div class="jk-asst-sec">可执行指令</div>';
        cmds.forEach(function (c, i) { html += cmdHtml(c, i); });
        if (list.length) html += '<div class="jk-asst-sec">找到 ' + list.length + ' 个工具</div>';
        list.forEach(function (it, i) { html += itemHtml(it, cmds.length + i, q); });
      }
      body.innerHTML = html;
      return;
    }

    /* 空查询：免费清单 */
    if (state.mode === 'free') {
      var fl = ITEMS.filter(function (it) { return priceOf(it) === 0; });
      state.rows = fl.map(function (it) { return { it: it }; });
      html += '<div class="jk-asst-sec">不消耗积分 · ' + fl.length + ' 个</div>';
      fl.forEach(function (it, i) { html += itemHtml(it, i, ''); });
      body.innerHTML = html;
      return;
    }

    /* 空查询：首页视图 */
    if (state.cat) {
      var cl = ITEMS.filter(function (it) { return it.c === state.cat; })
        .sort(function (a, b) { return (b.h - a.h) || (a.p - b.p); });
      state.rows = cl.map(function (it) { return { it: it }; });
      html += '<div class="jk-asst-sec">' + esc((CATS[state.cat] || {}).n || '分类') + ' · ' + cl.length + ' 个</div>';
      cl.forEach(function (it, i) { html += itemHtml(it, i, ''); });
      body.innerHTML = html;
      return;
    }

    var j = JK();
    var login = !!(j && j.isLogin && j.isLogin());
    var credits = j && j.acc ? (j.acc().credits || 0) : 0;
    var cmds2 = [{ cmd: CMDS[0] }, { cmd: CMDS[2] }, { cmd: CMDS[3] }, { cmd: CMDS[4] }];
    state.rows = cmds2;
    html += '<div class="jk-asst-grid">';
    cmds2.forEach(function (r, i) {
      var c = r.cmd;
      html += '<button class="jk-asst-card" type="button" data-cmd="' + c.id + '" data-i="' + i + '">' +
        '<span class="jk-asst-ic" style="background:linear-gradient(135deg,' + c.c1 + ',' + c.c2 + ')">' + ic(c.ic, 15) + '</span>' +
        esc(c.t) + '</button>';
    });
    html += '</div>';

    var rec = recent().map(function (s) { return BY_SLUG[s]; }).filter(Boolean);
    if (rec.length) {
      state.rows = state.rows.concat(rec.map(function (it) { return { it: it }; }));
      html += '<div class="jk-asst-sec">最近使用</div>';
      rec.forEach(function (it, i) { html += itemHtml(it, cmds2.length + i, ''); });
    }

    var hot = ITEMS.filter(function (it) { return it.h; }).slice(0, 8);
    if (!hot.length) hot = ITEMS.filter(function (it) { return it.p === 0; }).slice(0, 8);
    state.rows = state.rows.concat(hot.map(function (it) { return { it: it }; }));
    html += '<div class="jk-asst-sec">热门推荐</div>';
    hot.forEach(function (it, i) { html += itemHtml(it, cmds2.length + rec.length + i, ''); });

    if (!login || credits < 3) {
      html += '<div class="jk-asst-empty" style="padding:14px 18px">' +
        (login ? '当前余额 <b style="display:inline">' + credits + '</b> 分，余额不足时可随时充值' : '登录即送 <b style="display:inline">20</b> 积分，未登录每天也能免费用 3 次') +
        '</div>';
    }
    body.innerHTML = html;
  }

  function selMove(d) {
    var n = state.rows.length;
    if (!n) return;
    state.sel = (state.sel + d + n) % n;
    render();
    var el = body.querySelector('.jk-asst-item.sel');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function activate(i) {
    var row = state.rows[i];
    if (!row) return;
    if (row.cmd) {
      var c = row.cmd;
      if (c.id === 'help') { state.mode = 'help'; state.q = ''; input.value = ''; render(); return; }
      if (c.id === 'free') { state.mode = 'free'; state.cat = ''; state.q = ''; state.sel = 0; input.value = ''; renderChips(); render(); return; }
      if (c.run) c.run();
      if (c.id === 'recharge' || c.id === 'login' || c.id === 'account') close();
      return;
    }
    if (row.it) pick(row.it.s);
  }

  function onInput() {
    state.q = input.value.trim();
    state.sel = 0;
    state.mode = state.q ? 'search' : 'home';
    clearBtn.className = 'jk-asst-clear' + (state.q ? ' show' : '');
    panel.className = 'jk-asst-panel' + (state.open ? ' open' : '') + (state.q ? ' has-q' : '');
    render();
    body.scrollTop = 0;
  }

  function refreshCoin() {
    var j = JK();
    if (!j) { coinBtn.innerHTML = ic('coin', 14) + '<b>—</b>'; return; }
    if (j.isLogin && j.isLogin()) {
      var a = j.acc();
      coinBtn.innerHTML = ic('coin', 14) + '<b>' + (a.credits || 0) + '</b> 分';
      coinBtn.title = '点击查看我的积分';
    } else {
      coinBtn.innerHTML = ic('user', 14) + '<b>登录</b>';
      coinBtn.title = '登录即送 20 积分';
    }
  }

  function open() {
    state.open = true;
    panel.className = 'jk-asst-panel open';
    launch.setAttribute('aria-expanded', 'true');
    hideTip(true);
    refreshCoin();
    state.mode = 'home'; state.q = ''; state.cat = ''; state.sel = 0;
    input.value = '';
    renderChips();
    render();
    setTimeout(function () { try { input.focus(); } catch (e) { /* noop */ } }, 30);
  }
  function close() {
    state.open = false;
    panel.classList.remove('open');
    launch.setAttribute('aria-expanded', 'false');
  }
  function toggle() { state.open ? close() : open(); }

  function hideTip(forever) {
    if (tipEl) { tipEl.remove(); tipEl = null; }
    if (forever) { try { localStorage.setItem('jk_asst_tip_v1', '1'); } catch (e) { /* noop */ } }
  }

  /* ------------------------------ 构建 DOM ------------------------------ */
  function build() {
    launch = document.createElement('button');
    launch.className = 'jk-asst-launch';
    launch.type = 'button';
    launch.setAttribute('aria-label', '打开智能助理（快捷键 ⌘K）');
    launch.setAttribute('aria-expanded', 'false');
    launch.innerHTML = ic('bot', 27);

    panel = document.createElement('div');
    panel.className = 'jk-asst-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '智能助理 · 搜索导航');
    panel.innerHTML =
      '<div class="jk-asst-head">' +
        '<span class="jk-asst-logo">' + ic('bot', 19) + '</span>' +
        '<span class="jk-asst-htxt"><b>智能助理</b><span>' + ITEMS.length + ' 个工具 · 搜索与导航</span></span>' +
        '<button class="jk-asst-coin" type="button" title="我的积分"></button>' +
        '<button class="jk-asst-x" type="button" aria-label="关闭">' + ic('close', 16) + '</button>' +
      '</div>' +
      '<div class="jk-asst-search">' +
        ic('search', 17) +
        '<input class="jk-asst-input" type="text" autocomplete="off" spellcheck="false" ' +
          'placeholder="直接说需求：把 PDF 转成 Word / 视频太大想压缩" aria-label="搜索工具或描述需求">' +
        '<span class="jk-asst-kbd"><i>⌘</i><i>K</i></span>' +
        '<button class="jk-asst-clear" type="button" aria-label="清空">' + ic('close', 12) + '</button>' +
      '</div>' +
      '<div class="jk-asst-chips"></div>' +
      '<div class="jk-asst-body"></div>' +
      '<div class="jk-asst-foot">' +
        '<span><i>↑</i><i>↓</i> 选择</span><span><i>Enter</i> 打开</span><span><i>Esc</i> 关闭</span>' +
        '<button class="jk-asst-more" type="button">使用帮助</button>' +
      '</div>';

    document.body.appendChild(launch);
    document.body.appendChild(panel);

    input = $('.jk-asst-input', panel);
    body = $('.jk-asst-body', panel);
    chipsBox = $('.jk-asst-chips', panel);
    coinBtn = $('.jk-asst-coin', panel);
    clearBtn = $('.jk-asst-clear', panel);

    renderChips();
    refreshCoin();

    launch.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    $('.jk-asst-x', panel).addEventListener('click', close);
    $('.jk-asst-more', panel).addEventListener('click', function () {
      state.mode = 'help'; state.q = ''; input.value = ''; render();
    });
    coinBtn.addEventListener('click', function () {
      var j = JK();
      if (!j) return;
      if (j.isLogin && j.isLogin()) { j.openAccount ? j.openAccount() : j.openRecharge(); }
      else j.openLogin();
      close();
    });
    clearBtn.addEventListener('click', function () {
      input.value = ''; state.q = ''; state.cat = ''; state.mode = 'home'; onInput(); input.focus();
    });

    input.addEventListener('input', onInput);

    chipsBox.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.jk-asst-chip') : null;
      if (!b) return;
      state.cat = b.getAttribute('data-cat') || '';
      state.sel = 0;
      if (state.mode === 'help' || state.mode === 'free') state.mode = 'home';
      renderChips();
      render();
      body.scrollTop = 0;
    });

    body.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      var cat = e.target.closest('[data-cat]');
      if (cat) {                                   // 空状态里的「逛逛这些分类」
        state.cat = cat.getAttribute('data-cat') || '';
        state.q = ''; input.value = ''; state.sel = 0; state.mode = 'home';
        renderChips(); render(); body.scrollTop = 0;
        return;
      }
      var el = e.target.closest('[data-slug],[data-cmd]');
      if (!el) return;
      var i = parseInt(el.getAttribute('data-i') || '0', 10);
      activate(i);
    });

    panel.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    document.addEventListener('mousedown', function (e) {
      if (!state.open) return;
      if (panel.contains(e.target) || launch.contains(e.target)) return;
      close();
    });

    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); toggle(); return;
      }
      if (!state.open) {
        if (e.key === '/' && !typing) { e.preventDefault(); open(); }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); selMove(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); selMove(-1); return; }
      if (e.key === 'Enter') {
        if (e.target === input) { e.preventDefault(); activate(state.sel); }
        return;
      }
    });

    /* 积分变化时同步余额 */
    if (JK() && JK().onChange) JK().onChange(refreshCoin);

    /* 首次引导气泡 */
    var seen = true;
    try { seen = !!localStorage.getItem('jk_asst_tip_v1'); } catch (e) { /* noop */ }
    if (!seen) {
      tipEl = document.createElement('div');
      tipEl.className = 'jk-asst-tip';
      tipEl.innerHTML = '<button class="jk-tip-x" type="button" aria-label="关闭">×</button>' +
        '找工具直接问我，试试搜 <b>压缩 PDF</b> 或 <b>去水印</b>';
      document.body.appendChild(tipEl);
      tipEl.querySelector('.jk-tip-x').addEventListener('click', function () { hideTip(true); });
      setTimeout(function () { hideTip(false); }, 9000);
    }

    try { wireLegacy(); } catch (e) { /* 接线失败不影响助理本体 */ }
  }

  /* ================= 原站遗留交互接线：左侧栏 / 原生搜索框 =================
     克隆站里 React 事件没了，侧栏「打开菜单」「搜索」是死按钮，dock 面板只剩骨架屏；
     顶栏与首页大搜索框输入也无响应。这里全部接管：
       侧栏菜单按钮 → 展开 dock 分类导航（点击分类 = 助理内列出该分类工具）
       侧栏搜索按钮 / 原生搜索框聚焦 → 唤起智能助理并带入关键词            */
  var dockOn = false;
  function dockSet(on) {
    var dock = document.getElementById('ftsb-dock');
    if (!dock) return;
    dockOn = !!on;
    if (dockOn) {
      rebuildDock(dock);
      document.documentElement.setAttribute('data-ftsb-dock', 'on');   // 原站 CSS 就认这个开关
      dock.removeAttribute('inert');
    } else {
      document.documentElement.removeAttribute('data-ftsb-dock');
      dock.setAttribute('inert', '');
    }
  }
  function dockItem(k, c) {
    return '<button type="button" class="jk-dock-item" data-jk-cat="' + esc(k) + '">' +
      '<span class="jk-dock-ico" style="background:linear-gradient(135deg,' + c.c1 + ',' + c.c2 + ')">' + ic(c.ic, 14) + '</span>' +
      '<span class="jk-dock-name">' + esc(c.n) + '</span>' +
      '<span class="jk-dock-n">' + (c.c || '') + '</span></button>';
  }
  function rebuildDock(dock) {
    if (dock.getAttribute('data-jk-built') === '1') return;
    var inner = dock.querySelector('.frame_dockInner') || dock;
    var rows = '';
    for (var i = 0; i < CAT_ORDER.length; i++) {
      var k = CAT_ORDER[i], c = CATS[k];
      if (c && c.n) rows += dockItem(k, c);
    }
    inner.innerHTML =
      '<div class="jk-dock">' +
        '<div class="jk-dock-head"><b>全部分类</b><span>' + ITEMS.length + ' 个免费工具</span>' +
          '<button type="button" class="jk-dock-x" data-jk-dock-x aria-label="关闭菜单">' + ic('close', 14) + '</button></div>' +
        rows +
        '<a class="jk-dock-item jk-dock-home" href="' + BASE + 'index.html">' +
          '<span class="jk-dock-ico" style="background:linear-gradient(135deg,#a78bfa,#7c5cff)">' + ic('home', 14) + '</span>' +
          '<span class="jk-dock-name">免费工具 · 首页</span></a>' +
      '</div>';
    dock.setAttribute('data-jk-built', '1');
  }
  function openWith(q) {
    dockSet(false);
    open();
    state.q = String(q || '');
    state.cat = ''; state.mode = 'home'; state.sel = 0;
    input.value = state.q;
    renderChips(); render();
    setTimeout(function () { try { input.focus(); } catch (e) { /* noop */ } }, 30);
  }
  function openCat(k) {
    open();
    state.cat = k; state.q = ''; state.mode = 'home'; state.sel = 0;
    input.value = '';
    renderChips(); render();
    if (body) body.scrollTop = 0;
  }
  function wireLegacy() {
    var aside = document.querySelector('aside');
    var dock = document.getElementById('ftsb-dock');
    /* 侧栏「打开菜单」→ 展开 / 收起 dock */
    var menuBtn = aside && aside.querySelector('button[aria-controls="ftsb-panel"]');
    if (menuBtn && !menuBtn.getAttribute('data-jk-wired')) {
      menuBtn.setAttribute('data-jk-wired', '1');
      menuBtn.setAttribute('title', '打开分类导航');
      menuBtn.addEventListener('click', function (e) { e.stopPropagation(); dockSet(!dockOn); });
    }
    /* 侧栏「搜索工具」→ 智能助理 */
    var sBtn = aside && aside.querySelector('button[aria-label="搜索工具"]');
    if (sBtn && !sBtn.getAttribute('data-jk-wired')) {
      sBtn.setAttribute('data-jk-wired', '1');
      sBtn.setAttribute('title', '搜索工具（智能助理）');
      sBtn.addEventListener('click', function (e) { e.stopPropagation(); openWith(''); });
    }
    /* dock 内部点击：分类 / 关闭 */
    if (dock && !dock.getAttribute('data-jk-wired')) {
      dock.setAttribute('data-jk-wired', '1');
      dock.addEventListener('click', function (e) {
        if (!e.target.closest) return;
        if (e.target.closest('[data-jk-dock-x]')) { dockSet(false); return; }
        var it = e.target.closest('[data-jk-cat]');
        if (it) { openCat(it.getAttribute('data-jk-cat')); }
      });
    }
    /* 原生搜索框（顶栏小框 / 首页大框 / dock 内框）→ 聚焦唤起助理 */
    var sels = 'input[type="search"][aria-controls="ftsb-dock-list"], input[aria-controls="free-tools-results"]';
    var inputs = document.querySelectorAll(sels);
    for (var i = 0; i < inputs.length; i++) {
      (function (inp) {
        if (inp.getAttribute('data-jk-wired')) return;
        inp.setAttribute('data-jk-wired', '1');
        inp.setAttribute('placeholder', inp.getAttribute('placeholder') || '搜索工具…');
        inp.addEventListener('focus', function () { inp.blur(); openWith(''); });
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); inp.blur(); openWith(inp.value); }
        });
      })(inputs[i]);
    }
    /* 顶栏「搜索工具…」按钮（克隆时 React 事件丢了，原本是死按钮） */
    var hdrBtn = document.querySelector('header button[aria-label="搜索工具"]');
    if (hdrBtn && !hdrBtn.getAttribute('data-jk-wired')) {
      hdrBtn.setAttribute('data-jk-wired', '1');
      hdrBtn.addEventListener('click', function () { openWith(''); });
    }
    /* 顶部分类占位链接（视频音频/图片/PDF/文本与数据/计算器/小游戏）→ 助理内列出分类 */
    var NAV_CAT = { '视频音频': 'video', '图片': 'image', 'pdf': 'pdf', '文本与数据': 'data', '计算器': 'everyday', '小游戏': 'games' };
    var navLinks = document.querySelectorAll('header nav a[href="index.html"]');
    for (var j = 0; j < navLinks.length; j++) {
      (function (a) {
        var name = (a.textContent || '').trim();
        var k = NAV_CAT[name];
        if (!k || a.getAttribute('data-jk-wired')) return;
        a.setAttribute('data-jk-wired', '1');
        a.addEventListener('click', function (e) { e.preventDefault(); openCat(k); });
      })(navLinks[j]);
    }
    /* 语言选择器：全站只有中文，原站 14 语种菜单是死的 → 直接藏掉 */
    var langSel = document.querySelector('header select');
    if (langSel && langSel.parentElement) langSel.parentElement.style.display = 'none';
    /* 右上「登录」死链（/sign-in?redirect=…非法域名）→ 积分系统登录 */
    document.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      var a = e.target.closest('a[href*="sign-in"]');
      if (!a) return;
      e.preventDefault();
      var jk = JK();
      if (jk && jk.openLogin) jk.openLogin();
      else location.href = homeUrl();
    });
    /* 点别处收起 dock，Esc 也能关 */
    document.addEventListener('mousedown', function (e) {
      if (!dockOn || !aside) return;
      if (aside.contains(e.target)) return;
      dockSet(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dockOn) dockSet(false);
    });
  }

  /* 顶栏遗留的「登录」按钮（原站 /sign-in 死链）→ 唤起本站登录面板 */
  function wireLogin() {
    var els = document.querySelectorAll('[data-jk-login]');
    for (var i = 0; i < els.length; i++) {
      (function (el) {
        if (el.getAttribute('data-jk-wired')) return;
        el.setAttribute('data-jk-wired', '1');
        el.setAttribute('cursor', 'pointer');
        el.addEventListener('click', function (e) {
          e.preventDefault();
          var jk = JK();
          if (jk && jk.openLogin) jk.openLogin();
        });
      })(els[i]);
    }
  }

  /* 移动端顶栏「菜单」按钮（原站 React 抽屉没了，点了没反应）
     手机端没有左侧栏，这个按钮是唯一的导航入口 —— 直接唤起助理 */
  function wireMenu() {
    var els = document.querySelectorAll('button[aria-label="菜单"]');
    for (var i = 0; i < els.length; i++) {
      (function (el) {
        if (el.getAttribute('data-jk-wired')) return;
        el.setAttribute('data-jk-wired', '1');
        el.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          el.setAttribute('aria-expanded', 'true');
          openWith('');
        });
      })(els[i]);
    }
  }

  /* 支持 ?q=关键词 直接唤起助理（浏览器地址栏搜索 / 分享链接都能用） */
  function bootFromUrl() {
    try {
      var m = /[?&]q=([^&#]+)/.exec(location.search);
      if (!m) return;
      var q = decodeURIComponent(m[1].replace(/\+/g, ' '));
      if (!q.trim()) return;
      setTimeout(function () { openWith(q); }, 400);
    } catch (e) { /* ignore */ }
  }

  function init() {
    try { build(); } catch (e) { /* 不影响页面主流程 */ }
    try { wireLogin(); } catch (e) { /* ignore */ }
    try { wireMenu(); } catch (e) { /* ignore */ }
    try { bootFromUrl(); } catch (e) { /* ignore */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* 对外 API：页面上任何遗留控件都能唤起助理（open 可带初始关键词） */
  window.__JK_ASSIST__ = {
    open: function (q) { openWith(q); },
    close: function () { close(); },
    toggle: function () { toggle(); },
    openCat: function (k) { openCat(k); },
  };
})();
