/* ==========================================================================
   engine-calc.js — 计算器 / 数据 / 计时 引擎
   配置驱动：表单计算器 + 图表 + 计时器 + 随机 + 时钟 + 节拍器
   ========================================================================== */
(function () {
  'use strict';
  const E = {};
  window.TOOL_ENGINES = window.TOOL_ENGINES || {};

  const num = (v, d) => { const n = parseFloat(v); return isNaN(n) ? (d ?? 0) : n; };
  const money = (n, c) => (c || '$') + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const r2 = n => Math.round(n * 100) / 100;
  const pct = n => (Math.round(n * 100) / 100) + '%';

  /* ---------- 安全表达式求值 ---------- */
  function evaluator(expr) {
    const clean = String(expr)
      .replace(/\^/g, '**')
      .replace(/[×✕]/g, '*').replace(/[÷]/g, '/')
      .replace(/√/g, 'sqrt').replace(/π/g, '(PI)')
      .replace(/\bln\(/g, 'log(')
      .replace(/\blog10\(/g, 'log10(')
      .replace(/\bmod\b/g, '%');
    if (!/^[\d+\-*/().,%\sA-Za-z_*]*$/.test(clean)) throw new Error('只允许数字、运算符和函数');
    const fn = new Function('x', 'PI', 'E', 'with(Math){return (' + clean + ')}');
    return x => fn(x, Math.PI, Math.E);
  }

  /* ---------- 周期表（分子量） ---------- */
  const AW = {
    H: 1.008, He: 4.003, Li: 6.94, Be: 9.012, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.18,
    Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948, K: 39.098, Ca: 40.078,
    Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38,
    Ga: 69.723, Ge: 72.63, As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798, Rb: 85.468, Sr: 87.62, Y: 88.906, Zr: 91.224,
    Nb: 92.906, Mo: 95.95, Tc: 98, Ru: 101.07, Rh: 102.91, Pd: 106.42, Ag: 107.87, Cd: 112.41, In: 114.82, Sn: 118.71,
    Sb: 121.76, Te: 127.6, I: 126.9, Xe: 131.29, Cs: 132.91, Ba: 137.33, La: 138.91, Ce: 140.12, Pr: 140.91, Nd: 144.24,
    Pm: 145, Sm: 150.36, Eu: 151.96, Gd: 157.25, Tb: 158.93, Dy: 162.5, Ho: 164.93, Er: 167.26, Tm: 168.93, Yb: 173.05,
    Lu: 174.97, Hf: 178.49, Ta: 180.95, W: 183.84, Re: 186.21, Os: 190.23, Ir: 192.22, Pt: 195.08, Au: 196.97, Hg: 200.59,
    Tl: 204.38, Pb: 207.2, Bi: 208.98, Po: 209, At: 210, Rn: 222, Fr: 223, Ra: 226, Ac: 227, Th: 232.04, Pa: 231.04,
    U: 238.03, Np: 237, Pu: 244, Am: 243, Cm: 247, Bk: 247, Cf: 251, Es: 252, Fm: 257, Md: 258, No: 259, Lr: 266
  };
  function molWeight(formula) {
    const f = String(formula).replace(/\s/g, '');
    let i = 0;
    function parseGroup() {
      let total = 0, stack = [];
      while (i < f.length) {
        const c = f[i];
        if (c === '(' || c === '[') { i++; stack.push(parseGroup()); }
        else if (c === ')' || c === ']') { i++; const m = /^\d+/.exec(f.slice(i)); const mult = m ? +m[0] : 1; if (m) i += m[0].length; return stack.reduce((a, b) => a + b, 0) * mult + total; }
        else if (/[A-Z]/.test(c)) {
          let sym = c; i++;
          if (/[a-z]/.test(f[i] || '')) { sym += f[i]; i++; }
          const m = /^\d+/.exec(f.slice(i)); const mult = m ? +m[0] : 1; if (m) i += m[0].length;
          if (!(sym in AW)) throw new Error('未知元素：' + sym);
          total += AW[sym] * mult;
        } else if (c === '·' || c === '*') { i++; const m = /^\d+/.exec(f.slice(i)); if (m) i += m[0].length; total += parseGroup(); }
        else i++;
      }
      return total + stack.reduce((a, b) => a + b, 0);
    }
    const w = parseGroup();
    if (!w) throw new Error('无法解析该化学式');
    return w;
  }

  /* ---------- 统计 ---------- */
  const stat = {
    mean: a => a.reduce((x, y) => x + y, 0) / a.length,
    median: a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; },
    sd: (a, sample) => { const m = stat.mean(a); const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - (sample ? 1 : 0)); return Math.sqrt(v); },
    variance: (a, sample) => stat.sd(a, sample) ** 2,
    q: (a, p) => { const s = [...a].sort((x, y) => x - y); const pos = (s.length - 1) * p; const b = Math.floor(pos); return s[b] + (s[b + 1] !== undefined ? (pos - b) * (s[b + 1] - s[b]) : 0); },
    mode: a => { const m = {}; a.forEach(x => m[x] = (m[x] || 0) + 1); const mx = Math.max(...Object.values(m)); return Object.entries(m).filter(([, c]) => c === mx).map(([v]) => +v); }
  };

  /* ---------- 财务 ---------- */
  function amortize(P, annual, years) {
    const r = annual / 100 / 12, n = years * 12;
    if (r === 0) return { monthly: P / n, total: P, interest: 0 };
    const m = P * r / (1 - Math.pow(1 + r, -n));
    return { monthly: m, total: m * n, interest: m * n - P };
  }

  /* ---------- 时钟助手 ---------- */
  const ZONES = ['UTC', 'America/New_York', 'America/Los_Angeles', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Africa/Cairo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland'];

  /* ---------- 定义表 ---------- */
  const F = {}; // slug -> {title, fields, compute}
  const field = (id, label, value, opts) => Object.assign({ id, label, value: String(value), type: 'number' }, opts || {});
  const R = (label, value) => [label, value];

  F['age-calculator'] = {
    title: '年龄', cta: '计算年龄',
    fields: [field('bd', '出生日期', '1996-04-15', { type: 'date' }), field('to', '计算日期', new Date().toISOString().slice(0, 10), { type: 'date' })],
    compute: v => {
      const b = new Date(v.bd), t = new Date(v.to);
      if (isNaN(b) || isNaN(t)) throw new Error('请填写两个日期');
      if (t < b) throw new Error('第二个日期早于第一个日期');
      let y = t.getFullYear() - b.getFullYear(), m = t.getMonth() - b.getMonth(), d = t.getDate() - b.getDate();
      if (d < 0) { m--; d += new Date(t.getFullYear(), t.getMonth(), 0).getDate(); }
      if (m < 0) { y--; m += 12; }
      const days = Math.floor((t - b) / 86400000);
      const nxt = new Date(t.getFullYear(), b.getMonth(), b.getDate());
      if (nxt < t) nxt.setFullYear(nxt.getFullYear() + 1);
      return [R('年龄', `${y} 年 ${m} 个月 ${d} 天`), R('总天数', days.toLocaleString()), R('总周数', Math.floor(days / 7).toLocaleString()),
      R('总小时数', (days * 24).toLocaleString()), R('下次生日', nxt.toDateString() + `（${Math.ceil((nxt - t) / 86400000)} 天后）`)];
    }
  };
  F['bmi-calculator'] = {
    title: 'BMI', cta: '计算 BMI',
    fields: [field('h', '身高', 175, { unit: 'cm' }), field('w', '体重', 70, { unit: 'kg' })],
    compute: v => {
      const m = num(v.h) / 100, bmi = num(v.w) / (m * m);
      const cat = bmi < 18.5 ? '偏瘦' : bmi < 25 ? '健康体重' : bmi < 30 ? '超重' : '肥胖';
      const hi = 18.5 * m * m, hh = 24.9 * m * m;
      return [R('BMI', r2(bmi)), R('类别', cat), R('该身高的健康范围', `${r2(hi)} – ${r2(hh)} kg`), R('提示', 'BMI 未考虑肌肉量与身体成分，仅作粗略参考。')];
    }
  };
  const bmrFields = [field('sex', '性别', 'male', { type: 'select', options: [['male', '男'], ['female', '女']] }), field('age', '年龄', 30, { unit: '岁' }), field('h', '身高', 175, { unit: 'cm' }), field('w', '体重', 70, { unit: 'kg' }),
  field('act', '活动水平', '1.55', { type: 'select', options: [['1.2', '久坐'], ['1.375', '轻度（每周 1–3 天）'], ['1.55', '中度（每周 3–5 天）'], ['1.725', '高度（每周 6–7 天）'], ['1.9', '极高强度']] })];
  function bmr(v) {
    const s = v.sex === 'male' ? 5 : -161;
    return 10 * num(v.w) + 6.25 * num(v.h) - 5 * num(v.age) + s;
  }
  F['calorie-calculator'] = {
    title: '每日卡路里', cta: '计算卡路里',
    fields: bmrFields.slice(),
    compute: v => {
      const b = bmr(v), tdee = b * num(v.act, 1.55);
      return [R('维持体重（TDEE）', Math.round(tdee) + ' 千卡/天'), R('轻度减重（0.25 kg/周）', Math.round(tdee - 250) + ' 千卡/天'), R('减重（0.5 kg/周）', Math.round(tdee - 500) + ' 千卡/天'), R('增重（0.25 kg/周）', Math.round(tdee + 250) + ' 千卡/天'), R('基础代谢（BMR）', Math.round(b) + ' 千卡/天'), R('维持热量下的宏量营养', `蛋白质 ${Math.round(num(v.w) * 1.8)} g · 碳水 ${Math.round(tdee * .45 / 4)} g · 脂肪 ${Math.round(tdee * .3 / 9)} g`)];
    }
  };
  F['tdee-calculator'] = F['calorie-calculator'];
  F['percentage-calculator'] = {
    title: '百分比', cta: '计算',
    fields: [field('a', '数值 A', 25), field('b', '数值 B', 200)],
    compute: v => {
      const a = num(v.a), b = num(v.b);
      return [R(`${b} 的 ${a}%`, r2(a * b / 100)), R(`${a} 是 ${b} 的百分之多少`, pct(a / b * 100)), R(`${a} 增加 ${b}%`, r2(a * (1 + b / 100))), R(`${a} 减少 ${b}%`, r2(a * (1 - b / 100))), R('A→B 变化百分比', pct((b - a) / a * 100))];
    }
  };
  F['date-calculator'] = {
    title: '日期', cta: '计算',
    fields: [field('a', '开始日期', new Date().toISOString().slice(0, 10), { type: 'date' }), field('b', '结束日期', new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), { type: 'date' }), field('n', '增加 / 减少天数', 30)],
    compute: v => {
      const a = new Date(v.a), b = new Date(v.b);
      if (isNaN(a) || isNaN(b)) throw new Error('请填写两个日期');
      const diff = Math.round((b - a) / 86400000);
      const shifted = new Date(a); shifted.setDate(shifted.getDate() + num(v.n));
      const wd = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
      return [R('相差天数', diff.toLocaleString()), R('周数', r2(diff / 7)), R('月数（约）', r2(diff / 30.44)), R('工作日（约）', Math.round(diff / 7 * 5)), R(`开始日期 ${num(v.n) >= 0 ? '+' : ''}${num(v.n)} 天`, shifted.toDateString()), R('星期几', wd[b.getDay()])];
    }
  };
  F['salary-calculator'] = {
    title: '薪资', cta: '计算',
    fields: [field('amt', '金额', 25), field('period', '计薪单位', 'hour', { type: 'select', options: [['hour', '小时'], ['day', '天'], ['week', '周'], ['month', '月'], ['year', '年']] }), field('hrs', '每周小时数', 40), field('days', '每周工作天数', 5)],
    compute: v => {
      const a = num(v.amt), p = v.period, hrs = num(v.hrs, 40), days = num(v.days, 5);
      const perHour = { hour: a, day: a / hrs * (hrs / days) / (hrs / days), week: a / hrs, month: a * 12 / (hrs * 52), year: a / (hrs * 52) }[p];
      const hourly = p === 'hour' ? a : p === 'day' ? a / (hrs / days) : p === 'week' ? a / hrs : p === 'month' ? a * 12 / (hrs * 52) : a / (hrs * 52);
      const weekly = hourly * hrs, monthly = weekly * 52 / 12, yearly = weekly * 52, daily = hourly * (hrs / days);
      return [R('时薪', money(r2(hourly))), R('日薪', money(r2(daily))), R('周薪', money(r2(weekly))), R('月薪', money(r2(monthly))), R('年薪', money(r2(yearly)))];
    }
  };
  F['hourly-to-salary-calculator'] = {
    title: '时薪转年薪', cta: '转换',
    fields: [field('rate', '时薪', 25), field('hrs', '每周小时数', 40), field('weeks', '每年带薪周数', 52)],
    compute: v => {
      const h = num(v.rate), hpw = num(v.hrs, 40), w = num(v.weeks, 52);
      const yearly = h * hpw * w;
      return [R('年薪', money(r2(yearly))), R('月薪', money(r2(yearly / 12))), R('双周薪', money(r2(yearly / 26))), R('周薪', money(r2(h * hpw))), R('日薪（8 小时）', money(r2(h * 8)))];
    }
  };
  F['take-home-pay-calculator'] = {
    title: '税后到手', cta: '计算',
    fields: [field('gross', '税前收入', 60000, { unit: '每年' }), field('tax', '个人所得税', 20, { unit: '%' }), field('pension', '退休金', 5, { unit: '%' }), field('other', '其他扣款', 0, { unit: '每年' })],
    compute: v => {
      const g = num(v.gross), tax = g * num(v.tax) / 100, pen = g * num(v.pension) / 100, oth = num(v.other);
      const net = g - tax - pen - oth;
      return [R('税前', money(g)), R('个人所得税', '-' + money(tax)), R('退休金', '-' + money(pen)), R('其他', '-' + money(oth)), R('每年到手', money(r2(net))), R('每月到手', money(r2(net / 12))), R('每周到手', money(r2(net / 52))), R('实际税率', pct((g - net) / g * 100))];
    }
  };
  function loanFields(withDown) {
    const f = [field('amount', '贷款金额', 250000), field('rate', '年利率', 5.5, { unit: '% / 年' }), field('years', '期限', 25, { unit: '年' })];
    if (withDown) f.unshift(field('price', '房屋总价', 300000), field('down', '首付', 50000));
    return f;
  }
  const loanCalc = withDown => v => {
    let P = num(v.amount);
    if (withDown) P = num(v.price) - num(v.down);
    const { monthly, total, interest } = amortize(P, num(v.rate), num(v.years));
    const rows = [];
    if (withDown) rows.push(R('贷款金额', money(P)), R('首付', money(num(v.down)) + '（' + pct(num(v.down) / num(v.price) * 100) + '）'));
    rows.push(R('月供', money(r2(monthly))), R('总还款', money(r2(total))), R('总利息', money(r2(interest))), R('利息占比', pct(interest / total * 100)));
    return rows;
  };
  F['loan-calculator'] = { title: '贷款月供', cta: '计算月供', fields: loanFields(false), compute: loanCalc(false) };
  F['mortgage-calculator'] = { title: '房贷', cta: '计算房贷', fields: loanFields(true), compute: loanCalc(true) };
  F['gpa-calculator'] = {
    title: 'GPA', cta: '计算 GPA',
    fields: [field('c1', '课程 1 学分', 3), field('g1', '课程 1 成绩', '4', { type: 'select', options: [['4', 'A (4.0)'], ['3.7', 'A− (3.7)'], ['3.3', 'B+ (3.3)'], ['3', 'B (3.0)'], ['2.7', 'B− (2.7)'], ['2.3', 'C+ (2.3)'], ['2', 'C (2.0)'], ['1', 'D (1.0)'], ['0', 'F (0.0)']] }), field('c2', '课程 2 学分', 4), field('g2', '课程 2 成绩', '3.3', { type: 'select', options: [['4', 'A (4.0)'], ['3.7', 'A− (3.7)'], ['3.3', 'B+ (3.3)'], ['3', 'B (3.0)'], ['2.7', 'B− (2.7)'], ['2.3', 'C+ (2.3)'], ['2', 'C (2.0)'], ['1', 'D (1.0)'], ['0', 'F (0.0)']] }), field('c3', '课程 3 学分', 3), field('g3', '课程 3 成绩', '3.7', { type: 'select', options: [['4', 'A (4.0)'], ['3.7', 'A− (3.7)'], ['3.3', 'B+ (3.3)'], ['3', 'B (3.0)'], ['2.7', 'B− (2.7)'], ['2.3', 'C+ (2.3)'], ['2', 'C (2.0)'], ['1', 'D (1.0)'], ['0', 'F (0.0)']] })],
    compute: v => {
      let cred = 0, pts = 0;
      for (const i of [1, 2, 3]) { const c = num(v['c' + i]); cred += c; pts += c * num(v['g' + i]); }
      return [R('GPA', r2(pts / cred) + ' / 4.0'), R('总学分', cred), R('加权绩点', r2(pts)), R('评级', pts / cred >= 3.5 ? '优秀' : pts / cred >= 3 ? '良好' : pts / cred >= 2 ? '合格' : '待提高')];
    }
  };
  const nums = (v, id) => String(v[id] || '').split(/[\s,;]+/).map(parseFloat).filter(n => !isNaN(n));
  F['standard-deviation-calculator'] = {
    title: '标准差', cta: '计算', textarea: 'nums',
    fields: [Object.assign(field('nums', '数字（逗号或空格分隔）', '12, 15, 11, 18, 22, 14, 16'), { type: 'textarea' })],
    compute: v => {
      const a = nums(v, 'nums');
      if (a.length < 2) throw new Error('至少输入两个数字');
      return [R('数量', a.length), R('平均值', r2(stat.mean(a))), R('样本标准差', r2(stat.sd(a, true))), R('总体标准差', r2(stat.sd(a))), R('方差（样本）', r2(stat.variance(a, true))), R('最小 / 最大', r2(Math.min(...a)) + ' / ' + r2(Math.max(...a))), R('极差', r2(Math.max(...a) - Math.min(...a)))];
    }
  };
  F['statistics-calculator'] = {
    title: '统计', cta: '汇总', textarea: 'nums',
    fields: [Object.assign(field('nums', '数字（逗号或空格分隔）', '3, 7, 8, 5, 12, 14, 21, 13, 18'), { type: 'textarea' })],
    compute: v => {
      const a = nums(v, 'nums');
      if (a.length < 2) throw new Error('至少输入两个数字');
      const s = [...a].sort((x, y) => x - y);
      return [R('数量', a.length), R('总和', r2(a.reduce((x, y) => x + y, 0))), R('平均值', r2(stat.mean(a))), R('中位数', r2(stat.median(a))), R('众数', stat.mode(a).join(', ') || '无'), R('样本标准差', r2(stat.sd(a, true))), R('最小 / 最大', r2(s[0]) + ' / ' + r2(s[s.length - 1])), R('Q1 / Q3', r2(stat.q(a, .25)) + ' / ' + r2(stat.q(a, .75))), R('IQR', r2(stat.q(a, .75) - stat.q(a, .25))), R('偏度（约）', r2((stat.mean(a) - stat.median(a)) / (stat.sd(a, true) || 1)))];
    }
  };
  const pairs = (v, id) => String(v[id] || '').split('\n').map(l => l.trim().split(/[\s,;]+/).map(parseFloat)).filter(p => p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1]));
  F['linear-regression-calculator'] = {
    title: '线性回归', cta: '拟合直线', textarea: 'xy',
    fields: [Object.assign(field('xy', '数据对 — 每行一个：x y', '1 2\n2 4.1\n3 6.2\n4 7.9\n5 10.3\n6 12'), { type: 'textarea' })],
    compute: v => {
      const p = pairs(v, 'xy');
      if (p.length < 2) throw new Error('至少输入两行数据');
      const n = p.length, sx = p.reduce((a, b) => a + b[0], 0), sy = p.reduce((a, b) => a + b[1], 0);
      const sxy = p.reduce((a, b) => a + b[0] * b[1], 0), sxx = p.reduce((a, b) => a + b[0] ** 2, 0);
      const syy = p.reduce((a, b) => a + b[1] ** 2, 0);
      const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      const inter = (sy - slope * sx) / n;
      const r = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
      const rows = [R('方程', `y = ${r2(slope)}x ${inter >= 0 ? '+' : '−'} ${Math.abs(r2(inter))}`), R('斜率', r2(slope)), R('截距', r2(inter)), R('R²', r2(r * r)), R('相关系数 r', r2(r)), R('解读', Math.abs(r) > .9 ? '极强' : Math.abs(r) > .7 ? '强' : Math.abs(r) > .5 ? '中等' : Math.abs(r) > .3 ? '弱' : '极弱')];
      const xbar = sx / n;
      rows.push(R('x̄ + 1 处预测值', r2(slope * (xbar + 1) + inter)));
      return rows;
    }
  };
  F['quadratic-equation-solver'] = {
    title: '二次方程求解', cta: '求解',
    fields: [field('a', 'a', 1), field('b', 'b', -3), field('c', 'c', 2)],
    compute: v => {
      const a = num(v.a), b = num(v.b), c = num(v.c);
      if (a === 0) throw new Error('a 不能为 0 — 这是一次方程：x = ' + r2(-c / b));
      const d = b * b - 4 * a * c;
      const vx = -b / (2 * a), vy = a * vx * vx + b * vx + c;
      const rows = [R('判别式', r2(d)), R('顶点', `${r2(vx)}, ${r2(vy)}`)];
      if (d > 0) rows.push(R('根 1', r2((-b + Math.sqrt(d)) / (2 * a))), R('根 2', r2((-b - Math.sqrt(d)) / (2 * a))), R('根的情况', '两个不同实根'));
      else if (d === 0) rows.push(R('根', r2(vx)), R('根的情况', '一个二重实根'));
      else {
        const re = -b / (2 * a), im = Math.sqrt(-d) / (2 * a);
        rows.push(R('根 1', `${r2(re)} + ${r2(im)}i`), R('根 2', `${r2(re)} − ${r2(im)}i`), R('根的情况', '两个共轭复根'));
      }
      return rows;
    }
  };
  F['derivative-calculator'] = {
    title: '导数', cta: '求导',
    fields: [Object.assign(field('f', 'x 的多项式（如 3x^3 - 5x^2 + 2x - 7）', '3x^3 - 5x^2 + 2x - 7'), { type: 'text' }), field('at', '在 x = 处求值', 2)],
    compute: v => {
      const src = String(v.f).replace(/\s+/g, '').replace(/-/g, '+-');
      const terms = src.split('+').filter(Boolean);
      const d = [], orig = [];
      let ok = false;
      for (const t of terms) {
        const m = /^(-?\d*\.?\d*)(x(?:\^(\d+))?)?$/.exec(t);
        if (!m) continue;
        ok = true;
        const coef = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : parseFloat(m[1]);
        const pow = m[2] ? (m[3] ? +m[3] : 1) : 0;
        orig.push([coef, pow]);
        if (pow > 0) d.push([coef * pow, pow - 1]);
      }
      if (!ok) throw new Error('本工具仅支持多项式求导，如 3x^3 - 5x^2 + 2x - 7');
      const fmt = arr => arr.filter(([c]) => c !== 0).map(([c, p]) => (p === 0 ? `${r2(c)}` : `${r2(c)}x${p > 1 ? '^' + p : ''}`)).join(' + ').replace(/\+ -/g, '− ') || '0';
      const at = num(v.at);
      const val = d.reduce((s, [c, p]) => s + c * Math.pow(at, p), 0);
      return [R('f(x)', fmt(orig)), R("f'(x)", fmt(d)), R(`f'(${at})`, r2(val)), R('说明', '多项式求导：每项 n·xᵏ 变为 n·k·xᵏ⁻¹。')];
    }
  };
  F['molecular-weight-calculator'] = {
    title: '摩尔质量', cta: '计算',
    fields: [Object.assign(field('formula', '化学式', 'C6H12O6'), { type: 'text' }), field('mol', '数量', 1, { unit: 'mol' })],
    compute: v => {
      const w = molWeight(v.formula);
      const counts = {};
      const f = String(v.formula).replace(/\s/g, '');
      const re = /([A-Z][a-z]?)(\d*)/g; let m;
      while ((m = re.exec(f))) counts[m[1]] = (counts[m[1]] || 0) + (+(m[2] || 1));
      const rows = [R('摩尔质量', r2(w) + ' g/mol'), R(num(v.mol) + ' mol 对应质量', r2(w * num(v.mol)) + ' g')];
      Object.entries(counts).forEach(([el, c]) => rows.push(R(el + ' × ' + c, r2(AW[el] * c) + ' g/mol')));
      return rows;
    }
  };
  F['scientific-calculator'] = {
    title: '表达式', cta: '求值',
    fields: [Object.assign(field('expr', '表达式（用 * 表示乘、^ 表示幂，支持 sqrt、sin、cos、log、abs）', 'sqrt(2)*sin(PI/4) + 3^2'), { type: 'text' }), field('x', 'x 的值（可选）', 0)],
    compute: v => {
      const fn = evaluator(v.expr);
      const val = fn(num(v.x));
      if (!isFinite(val)) throw new Error('结果不是有限数');
      return [R('结果', r2(val) + ''), R('取整', Math.round(val)), R('十六进制', Math.round(val).toString(16)), R('说明', '可用函数：sqrt、sin、cos、tan、log、abs、exp、pow、min、max、round、floor、ceil')];
    }
  };
  F['ic50-calculator'] = {
    title: 'IC50', cta: '拟合曲线', textarea: 'data',
    fields: [Object.assign(field('data', '剂量–响应 — 每行一个：浓度 响应', '0.1 95\n0.3 92\n1 85\n3 70\n10 45\n30 22\n100 8'), { type: 'textarea' }), field('bottom', '下平台', 0), field('top', '上平台', 100)],
    compute: v => {
      const p = pairs(v, 'data').map(([c, r]) => [c, (r - num(v.bottom)) / (num(v.top) - num(v.bottom))]).filter(([c]) => c > 0);
      if (p.length < 4) throw new Error('至少输入四个剂量–响应数据点');
      // 网格搜索 Hill 曲线（最小二乘）
      let best = null;
      for (let li = Math.log10(Math.min(...p.map(x => x[0]))) - 1; li < Math.log10(Math.max(...p.map(x => x[0]))) + 1; li += 0.02) {
        for (let h = 0.3; h <= 4; h += 0.05) {
          const ic = Math.pow(10, li);
          let sse = 0;
          for (const [c, y] of p) { const pred = 1 / (1 + Math.pow(c / ic, h)); sse += (pred - y) ** 2; }
          if (!best || sse < best.sse) best = { sse, ic, h };
        }
      }
      const r2v = 1 - best.sse / p.reduce((s, [, y]) => s + (y - p.reduce((a, b) => a + b[1], 0) / p.length) ** 2, 0);
      return [R('IC50', r2(best.ic) + '（与浓度单位相同）'), R('log IC50', r2(Math.log10(best.ic))), R('Hill 斜率', r2(best.h)), R('R²', r2(r2v)), R('说明', '基于给定数据点的四参数 logistic 拟合，完全本地计算。')];
    }
  };
  F['currency-converter'] = {
    title: '汇率换算', cta: '转换',
    fields: [field('amount', '金额', 100), field('from', '原币', 'USD', { type: 'select', options: [['USD', 'USD'], ['EUR', 'EUR'], ['GBP', 'GBP'], ['CNY', 'CNY'], ['JPY', 'JPY'], ['AUD', 'AUD'], ['CAD', 'CAD'], ['INR', 'INR']] }), field('to', '目标币', 'CNY', { type: 'select', options: [['CNY', 'CNY'], ['USD', 'USD'], ['EUR', 'EUR'], ['GBP', 'GBP'], ['JPY', 'JPY'], ['AUD', 'AUD'], ['CAD', 'CAD'], ['INR', 'INR']] }), Object.assign(field('rate', '汇率（1 单位“原币” = 多少“目标币”）— 可改为今日汇率', 7.25), { type: 'number', step: '0.0001' })],
    compute: v => {
      const a = num(v.amount), r = num(v.rate, 1);
      return [R(`${a} ${v.from}`, `${r2(a * r)} ${v.to}`), R('使用汇率', `1 ${v.from} = ${r} ${v.to}`), R('反向汇率', `1 ${v.to} = ${r2(1 / r)} ${v.from}`), R('说明', '汇率不实时获取 — 输入当前汇率即可离线转换，数据不会离开浏览器。')];
    }
  };
  ['eur-to-usd', 'gbp-to-usd', 'usd-to-eur', 'usd-to-gbp', 'usd-to-cny', 'cny-to-usd', 'usd-to-jpy', 'usd-to-inr'].forEach(s => {
    const from = s.split('-to-')[0].toUpperCase(), to = s.split('-to-')[1].toUpperCase();
    const defaults = { 'EURUSD': 1.09, 'GBPUSD': 1.27, 'USDCNY': 7.25, 'USDJPY': 150, 'USDINR': 84, 'USDGBP': 0.79, 'USDEUR': 0.92, 'CNYUSD': 0.138 };
    F[s] = {
      title: `${from} → ${to}`, cta: 'Convert',
      fields: [field('amount', `${from} 金额`, 100), Object.assign(field('rate', `汇率（1 ${from} = ? ${to}）`, defaults[from + to] || 1), { step: '0.0001' })],
      compute: v => {
        const a = num(v.amount), r = num(v.rate, 1);
        return [R(`${to} 金额`, r2(a * r) + ' ' + to), R('汇率', `1 ${from} = ${r} ${to}`), R('反向汇率', `1 ${to} = ${r2(1 / r)} ${from}`), R('1000 兑换', r2(1000 * r) + ' ' + to), R('说明', '可将汇率修改为当前值 — 无网络请求，工具可离线使用。')];
      }
    };
  });
  F['graph-to-data'] = F['plot-digitizer'] = F['bar-graph-to-data'] = {
    title: '图表转数据', cta: '生成数据', textarea: 'xy',
    fields: [Object.assign(field('xy', '粘贴数据点，每行一个：x y（可从图表上读取）', '1 4\n2 7\n3 9\n4 15\n5 19'), { type: 'textarea' })],
    compute: v => {
      const p = pairs(v, 'xy');
      if (!p.length) throw new Error('至少添加一个数据点');
      const json = JSON.stringify(p.map(([x, y]) => ({ x, y })));
      return [R('数据点', p.length), R('CSV', p.map(x => x.join(',')).join(' | ')), R('JSON', json), R('Y 范围', r2(Math.min(...p.map(x => x[1]))) + ' – ' + r2(Math.max(...p.map(x => x[1]))))];
    }
  };
  F['anova-calculator'] = {
    title: '单因素方差分析', cta: '运行 ANOVA', textarea: 'g',
    fields: [Object.assign(field('g', '分组 — 每行一组，数值用逗号分隔', '5,7,6,8,6\n8,9,7,10,9\n4,5,6,5,4'), { type: 'textarea' })],
    compute: v => {
      const groups = String(v.g).split('\n').map(l => l.split(/[\s,;]+/).map(parseFloat).filter(n => !isNaN(n))).filter(g => g.length > 1);
      if (groups.length < 2) throw new Error('至少输入两组数据');
      const all = groups.flat(), N = all.length, k = groups.length;
      const gm = stat.mean(all);
      const ssb = groups.reduce((s, g) => s + g.length * (stat.mean(g) - gm) ** 2, 0);
      const ssw = groups.reduce((s, g) => s + g.reduce((t, x) => t + (x - stat.mean(g)) ** 2, 0), 0);
      const dfb = k - 1, dfw = N - k;
      const msb = ssb / dfb, msw = ssw / dfw, Fv = msb / msw;
      const p = fPValue(Fv, dfb, dfw);
      return [R('组数 / N', `${k} / ${N}`), R('总均值', r2(gm)), R('组间平方和', r2(ssb)), R('组内平方和', r2(ssw)), R('F 统计量', r2(Fv)), R('自由度', `${dfb}, ${dfw}`), R('p 值', p < .0001 ? '< 0.0001' : r2(p)), R('结论', p < .05 ? '组间差异显著（p < 0.05）' : '未检测到显著差异（p ≥ 0.05）')];
    }
  };
  F['t-test-calculator'] = {
    title: 't 检验', cta: '运行检验',
    fields: [Object.assign(field('a', 'A 组', '5.1, 4.9, 5.4, 5.0, 5.2, 5.3'), { type: 'textarea' }), Object.assign(field('b', 'B 组', '4.8, 4.7, 5.0, 4.6, 4.9, 4.8'), { type: 'textarea' }), field('type', '检验类型', 'ind', { type: 'select', options: [['ind', '独立样本（Welch）'], ['paired', '配对样本']] })],
    compute: v => {
      const a = String(v.a).split(/[\s,;]+/).map(parseFloat).filter(n => !isNaN(n));
      const b = String(v.b).split(/[\s,;]+/).map(parseFloat).filter(n => !isNaN(n));
      if (a.length < 2 || b.length < 2) throw new Error('两组都至少需要两个数字');
      let t, df;
      if (v.type === 'paired') {
        if (a.length !== b.length) throw new Error('配对检验要求数量相等');
        const d = a.map((x, i) => x - b[i]);
        const md = stat.mean(d), sdd = stat.sd(d, true);
        t = md / (sdd / Math.sqrt(d.length)); df = d.length - 1;
      } else {
        const va = stat.variance(a, true), vb = stat.variance(b, true);
        t = (stat.mean(a) - stat.mean(b)) / Math.sqrt(va / a.length + vb / b.length);
        df = (va / a.length + vb / b.length) ** 2 / ((va / a.length) ** 2 / (a.length - 1) + (vb / b.length) ** 2 / (b.length - 1));
      }
      const p = tPValue(Math.abs(t), df);
      const se = stat.mean(a) - stat.mean(b);
      return [R('A 组均值', r2(stat.mean(a))), R('B 组均值', r2(stat.mean(b))), R('差值', r2(se)), R('t', r2(t)), R('自由度', r2(df)), R('p（双尾）', p < .0001 ? '< 0.0001' : r2(p)), R('结论', p < .05 ? '在 p < 0.05 水平上统计显著' : '在 p < 0.05 水平上不显著')];
    }
  };
  // 分布近似
  function tPValue(t, df) {
    const x = df / (df + t * t);
    return Math.max(0, Math.min(1, betainc(df / 2, 0.5, x)));
  }
  function fPValue(F, d1, d2) {
    const x = d2 / (d2 + d1 * F);
    return Math.max(0, Math.min(1, betainc(d2 / 2, d1 / 2, x)));
  }
  function betainc(a, b, x) { // 正则不完全贝塔函数（连分式）
    if (x <= 0) return 0; if (x >= 1) return 1;
    const lbeta = lgamma(a) + lgamma(b) - lgamma(a + b);
    const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
    let f = 1, c = 1, d = 0;
    for (let i = 0; i <= 200; i++) {
      const m = i >> 1;
      let num;
      if (i === 0) num = 1;
      else if (i % 2 === 0) num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
      else num = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
      d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30;
      c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d; f *= c * d;
      if (Math.abs(1 - c * d) < 1e-10) break;
    }
    const res = front * (f - 1);
    return x < (a + 1) / (a + b + 2) ? res : 1 - betainc(b, a, 1 - x);
  }
  function lgamma(z) {
    const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let x = z, y = z, tmp = x + 5.5;
    tmp -= (x + .5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += g[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  /* ---------- 特殊模式 ---------- */
  const SPECIAL = {
    'random-number-generator': { mode: 'random', kind: 'number' },
    'dice-roller': { mode: 'random', kind: 'dice' },
    'flip-a-coin': { mode: 'random', kind: 'coin' },
    'spin-the-wheel': { mode: 'random', kind: 'wheel' },
    'countdown-timer': { mode: 'timer', kind: 'countdown' },
    'online-timer': { mode: 'timer', kind: 'countdown' },
    'timer-video-generator': { mode: 'timer', kind: 'countdown' },
    'stopwatch': { mode: 'timer', kind: 'stopwatch' },
    'online-timer-app': { mode: 'timer', kind: 'countdown' },
    'pomodoro-timer': { mode: 'timer', kind: 'pomodoro' },
    'world-clock': { mode: 'clock' },
    'metronome': { mode: 'metronome' },
    'unit-circle': { mode: 'unitcircle' },
    'function-grapher': { mode: 'graph', expr: 'sin(x)' },
    'graphing-calculator': { mode: 'graph', expr: 'x^2 - 3' },
    'curve-fitting': { mode: 'graph', expr: '0.5x^2', fit: true },
    'online-calculator': { mode: 'basic' },
    'scientific-calculator-app': { mode: 'basic', sci: true },
    'age-in-days': { mode: 'timer', kind: 'countdown' },
  };

  /* ---------- 渲染 ---------- */
  function fieldHtml(f) {
    const common = `id="cf_${f.id}" data-fid="${f.id}"`;
    if (f.type === 'textarea') return `<div class="col" style="margin-bottom:10px"><div class="plabel" style="margin-top:0">${f.label}</div><textarea ${common} style="min-height:120px">${f.value}</textarea></div>`;
    if (f.type === 'select') return `<div class="fld" style="margin-bottom:10px"><div class="plabel" style="margin-top:0">${f.label}</div><select ${common}>${f.options.map(o => `<option value="${o[0]}" ${String(f.value) === String(o[0]) ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>`;
    return `<div class="fld" style="margin-bottom:10px"><div class="plabel" style="margin-top:0">${f.label}${f.unit ? ` <span style="color:#737373;font-weight:400">(${f.unit})</span>` : ''}</div><input type="${f.type}" ${common} value="${f.value}" ${f.step ? `step="${f.step}"` : ''}></div>`;
  }
  function readFields(host, fields) {
    const v = {};
    fields.forEach(f => { const el = host.querySelector(`#cf_${f.id}`); v[f.id] = el ? el.value : f.value; });
    return v;
  }

  E.mount = function (host, cfg, slug) {
    const key = F[slug] ? slug : Object.keys(F).find(k => slug.startsWith(k));
    const def = F[key];
    const sp = SPECIAL[slug] || SPECIAL[key];
    if (sp) return mountSpecial(host, sp, slug);
    if (!def) return mountSpecial(host, { mode: 'todo' }, slug);

    const fieldsHtml = def.fields.map(fieldHtml).join('');
    host.innerHTML = `
      <div class="tool-body wide">
        <div class="stage">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">${fieldsHtml}</div>
          <div id="cOut" style="margin-top:14px"></div>
        </div>
        <div class="pane">
          <div class="ptitle">${def.title}</div>
          <div class="pdesc">所有计算均在你的设备上完成 — 不会向任何地方发送数据。</div>
          <button class="btn-lime btn-run" id="cGo">${def.cta || '计算'}</button>
          <button class="btn-ghost btn-sm" id="cCopy" style="width:100%;justify-content:center;margin-top:10px">复制结果</button>
          <div class="runnote">输入即实时更新结果。</div>
        </div>
      </div>`;
    const $ = s => host.querySelector(s);
    let last = [];
    function run() {
      try {
        const v = readFields(host, def.fields);
        last = def.compute(v);
        $('#cOut').innerHTML = `<div class="resultbox">${last.map(r => `<div class="row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}</div>`;
      } catch (e) {
        $('#cOut').innerHTML = `<div class="warnbox" style="display:block">${e.message}</div>`;
      }
    }
    host.addEventListener('input', run);
    host.addEventListener('change', run);
    $('#cGo').addEventListener('click', run);
    $('#cCopy').addEventListener('click', () => window.copyText(last.map(r => r[0] + ': ' + r[1]).join('\n')));
    run();
  };

  /* ---------- 特殊工具 ---------- */
  function mountSpecial(host, sp, slug) {
    const $ = s => host.querySelector(s);
    if (sp.mode === 'random') {
      const kinds = {
        number: `<div class="fieldrow" style="gap:10px"><div class="fld"><div class="plabel">最小值</div><input type="number" id="rMin" value="1"></div><div class="fld"><div class="plabel">最大值</div><input type="number" id="rMax" value="100"></div><div class="fld"><div class="plabel">数量</div><input type="number" id="rN" value="1"></div></div>
          <div class="chk" id="rUniq"><span class="box">✓</span> 不允许重复</div>`,
        dice: `<div class="plabel">骰子</div><select id="dSides"><option value="6">d6</option><option value="4">d4</option><option value="8">d8</option><option value="10">d10</option><option value="12">d12</option><option value="20">d20</option><option value="100">d100</option></select>
          <div class="plabel">数量</div><input type="number" id="dN" value="2">`,
        coin: `<div class="plabel">硬币数量</div><input type="number" id="cN" value="1">`,
        wheel: `<div class="plabel">选项 — 每行一个</div><textarea id="wList" style="min-height:180px">披萨
寿司
汉堡
塔可
沙拉
面条</textarea>`
      };
      host.innerHTML = `
        <div class="tool-body wide">
          <div class="stage">
            <div class="canvaswrap" id="rStage" style="min-height:260px;flex-direction:column;gap:16px">
              <div id="rResult" style="font-size:64px;font-weight:800;letter-spacing:-2px;color:var(--lime);text-align:center;line-height:1.1">—</div>
              <div id="rExtra" style="color:#a3a3a3;font-size:14px"></div>
            </div>
          </div>
          <div class="pane">
            <div class="ptitle">${({ number: '随机数', dice: '掷骰子', coin: '抛硬币', wheel: '幸运转盘' })[sp.kind]}</div>
            <div class="pdesc">使用设备自带的随机源（可用时使用 crypto.getRandomValues）。</div>
            ${kinds[sp.kind]}
            <button class="btn-lime btn-run" id="rGo">开始</button>
            <div class="runnote">再次点击获取新结果。</div>
          </div>
        </div>`;
      const rnd = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; };
      $('#rGo').addEventListener('click', () => {
        if (sp.kind === 'number') {
          const min = Math.ceil(+$('#rMin').value || 0), max = Math.floor(+$('#rMax').value || 1);
          const n = Math.max(1, Math.min(500, +$('#rN').value || 1));
          const uniq = $('#rUniq').classList.contains('on');
          if (min > max) { window.toast('最小值不能大于最大值'); return; }
          let out = [];
          if (uniq && max - min + 1 < n) { window.toast('该范围内的数字不够'); return; }
          while (out.length < n) { const v = min + Math.floor(rnd() * (max - min + 1)); if (!uniq || !out.includes(v)) out.push(v); }
          $('#rResult').textContent = out.join('  ');
          $('#rExtra').textContent = out.length > 1 ? `总和 ${out.reduce((a, b) => a + b, 0)} · 平均 ${r2(out.reduce((a, b) => a + b, 0) / out.length)}` : '';
        } else if (sp.kind === 'dice') {
          const sides = +$('#dSides').value, n = Math.max(1, Math.min(50, +$('#dN').value || 1));
          const rolls = Array.from({ length: n }, () => 1 + Math.floor(rnd() * sides));
          $('#rResult').textContent = rolls.join('  ');
          $('#rExtra').textContent = `${n}d${sides} · 总计 ${rolls.reduce((a, b) => a + b, 0)}`;
        } else if (sp.kind === 'coin') {
          const n = Math.max(1, Math.min(1000, +$('#cN').value || 1));
          const flips = Array.from({ length: n }, () => rnd() < .5 ? 'H' : 'T');
          const h = flips.filter(x => x === 'H').length;
          $('#rResult').textContent = n === 1 ? (flips[0] === 'H' ? '正面' : '反面') : flips.join(' ');
          $('#rExtra').textContent = n > 1 ? `${h} 正面 · ${n - h} 反面` : '';
        } else {
          const opts = $('#wList').value.split('\n').map(s => s.trim()).filter(Boolean);
          if (!opts.length) { window.toast('请先添加一些选项'); return; }
          let i = 0, spins = 12 + Math.floor(rnd() * 8);
          const tick = () => {
            $('#rResult').textContent = opts[Math.floor(rnd() * opts.length)];
            $('#rResult').style.opacity = .5 + .5 * (i / spins);
            if (++i < spins) setTimeout(tick, 60 + i * 22);
            else { $('#rResult').style.opacity = 1; $('#rResult').textContent = opts[Math.floor(rnd() * opts.length)]; }
          };
          tick();
        }
      });
      $('#rUniq')?.addEventListener('click', () => $('#rUniq').classList.toggle('on'));
      $('#rGo').click();
      return;
    }

    if (sp.mode === 'timer') {
      const start = sp.kind === 'stopwatch' ? 0 : (sp.kind === 'pomodoro' ? 25 * 60 : 5 * 60);
      host.innerHTML = `
        <div class="tool-body wide">
          <div class="stage">
            <div class="canvaswrap" style="min-height:300px;flex-direction:column;gap:18px">
              <div id="tDisp" style="font-size:76px;font-weight:800;letter-spacing:-3px;font-variant-numeric:tabular-nums">00:00.0</div>
              <div style="color:#8a8a8a" id="tLabel">${sp.kind === 'pomodoro' ? '专注时段' : sp.kind === 'stopwatch' ? '正向计时' : '倒计时中'}</div>
            </div>
          </div>
          <div class="pane">
            <div class="ptitle">${sp.kind === 'stopwatch' ? '秒表' : sp.kind === 'pomodoro' ? '番茄钟' : '计时器'}</div>
            <div class="pdesc">在页面内运行，保持标签页打开即可，无需服务器。</div>
            <div class="fieldrow" style="margin-bottom:10px"><div class="fld"><div class="plabel" style="margin-top:0">分钟</div><input type="number" id="tMin" value="${Math.floor(start / 60)}"></div><div class="fld"><div class="plabel" style="margin-top:0">秒</div><input type="number" id="tSec" value="${start % 60}"></div></div>
            <div class="shapes" id="tPresets" style="margin-bottom:6px">${[1, 3, 5, 10, 15, 25, 45, 60].map(m => `<button class="shape" data-m="${m}">${m} 分钟</button>`).join('')}</div>
            <button class="btn-lime btn-run" id="tStart">开始</button>
            <button class="btn-ghost btn-sm" id="tReset" style="width:100%;justify-content:center;margin-top:10px">重置</button>
            <div class="chk on" id="tBeep"><span class="box">✓</span> 结束时响铃</div>
          </div>
        </div>`;
      let remain = start, running = false, raf = null, last = 0;
      const disp = () => {
        const t = Math.max(0, remain);
        const m = Math.floor(t / 60), s = t - m * 60;
        $('#tDisp').textContent = `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
        document.title = `${$('#tDisp').textContent} — 计时器`;
      };
      function tick(ts) {
        if (!running) return;
        if (!last) last = ts;
        const dt = (ts - last) / 1000; last = ts;
        remain += (sp.kind === 'stopwatch' ? dt : -dt);
        disp();
        if (sp.kind !== 'stopwatch' && remain <= 0) {
          running = false; remain = 0; disp();
          $('#tLabel').textContent = '时间到';
          if ($('#tBeep').classList.contains('on')) {
            try {
              const ctx = new (window.AudioContext || window.webkitAudioContext)();
              [0, .25, .5].forEach(d => {
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
                g.gain.setValueAtTime(.001, ctx.currentTime + d);
                g.gain.exponentialRampToValueAtTime(.35, ctx.currentTime + d + .02);
                g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + d + .2);
                o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + .22);
              });
            } catch (e) { }
          }
          $('#tStart').textContent = '开始';
          return;
        }
        raf = requestAnimationFrame(tick);
      }
      $('#tStart').addEventListener('click', () => {
        running = !running;
        if (running) {
          if (sp.kind !== 'stopwatch') { remain = (+$('#tMin').value || 0) * 60 + (+$('#tSec').value || 0); }
          last = 0; $('#tStart').textContent = '暂停'; $('#tLabel').textContent = sp.kind === 'stopwatch' ? '正向计时' : '计时中…';
          raf = requestAnimationFrame(tick);
        } else { $('#tStart').textContent = '继续'; cancelAnimationFrame(raf); }
      });
      $('#tReset').addEventListener('click', () => {
        running = false; cancelAnimationFrame(raf); last = 0;
        remain = sp.kind === 'stopwatch' ? 0 : (+$('#tMin').value || 0) * 60 + (+$('#tSec').value || 0);
        $('#tStart').textContent = '开始'; disp();
      });
      $('#tPresets').addEventListener('click', e => {
        const b = e.target.closest('.shape'); if (!b) return;
        $('#tMin').value = b.dataset.m; $('#tSec').value = 0;
        remain = +b.dataset.m * 60; disp(); running = false; cancelAnimationFrame(raf);
        $('#tStart').textContent = '开始';
      });
      disp();
      return;
    }

    if (sp.mode === 'clock') {
      host.innerHTML = `
        <div class="tool-body single">
          <div class="stage">
            <div id="clkGrid" class="statgrid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))"></div>
          </div>
        </div>`;
      const paint = () => {
        const now = new Date();
        $('#clkGrid').innerHTML = ZONES.map(z => {
          let t;
          try { t = new Intl.DateTimeFormat('en-GB', { timeZone: z, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short', day: '2-digit', month: 'short' }).format(now); } catch (e) { t = '—'; }
          const [time, , date] = t.split(', ');
          return `<div class="stat"><b style="font-size:24px">${time || t}</b><span>${z.replace('_', ' ')} · ${date || ''}</span></div>`;
        }).join('');
      };
      paint(); setInterval(paint, 1000);
      return;
    }

    if (sp.mode === 'metronome') {
      host.innerHTML = `
        <div class="tool-body single"><div class="stage">
          <div class="canvaswrap" style="min-height:200px;flex-direction:column;gap:18px">
            <div id="mBeat" style="width:76px;height:76px;border-radius:50%;background:#222;transition:background .08s"></div>
            <div id="mBpmv" style="font-size:44px;font-weight:800;letter-spacing:-1px">120 BPM</div>
          </div>
          <div class="plabel">速度</div><input type="range" id="mBpm" min="30" max="240" value="120">
          <div class="shapes" style="margin-top:12px" id="mPresets">${[[60, 'Largo'], [90, 'Andante'], [120, 'Allegro'], [160, 'Presto']].map(([b, n]) => `<button class="shape" data-b="${b}">${b} · ${n}</button>`).join('')}</div>
          <div class="plabel">每小节拍数</div><select id="mBar"><option>4</option><option>3</option><option>2</option><option>6</option></select>
          <button class="btn-lime btn-run" id="mGo" style="max-width:300px;margin:18px auto 0">开始</button>
        </div></div>`;
      let ctx = null, timer = null, beat = 0, running = false;
      function click(accent) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = accent ? 1400 : 900;
        o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(.35, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .07);
        o.start(); o.stop(ctx.currentTime + .08);
        const el = $('#mBeat');
        el.style.background = accent ? '#d7f452' : '#ffffff';
        setTimeout(() => el.style.background = '#222', 80);
      }
      const start = () => {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        const beatMs = 60000 / (+$('#mBpm').value || 120);
        const bar = +$('#mBar').value || 4;
        stop();
        running = true; $('#mGo').textContent = '停止';
        const loop = () => {
          if (!running) return;
          click(beat % bar === 0); beat++;
          timer = setTimeout(loop, beatMs);
        };
        loop();
      };
      const stop = () => { running = false; clearTimeout(timer); $('#mGo').textContent = '开始'; };
      $('#mGo').addEventListener('click', () => running ? stop() : start());
      $('#mBpm').addEventListener('input', () => {
        $('#mBpmv').textContent = $('#mBpm').value + ' BPM';
        const pct = (+$('#mBpm').value - 30) / 210 * 100;
        $('#mBpm').style.background = `linear-gradient(to right,var(--lime) 0%,var(--lime) ${pct}%,var(--card3) ${pct}%)`;
        if (running) start();
      });
      $('#mPresets').addEventListener('click', e => {
        const b = e.target.closest('.shape'); if (!b) return;
        $('#mBpm').value = b.dataset.b; $('#mBpm').dispatchEvent(new Event('input'));
      });
      $('#mBpm').dispatchEvent(new Event('input'));
      return;
    }

    if (sp.mode === 'unitcircle') {
      host.innerHTML = `
        <div class="tool-body wide"><div class="stage">
          <div class="canvaswrap"><canvas id="ucC" width="560" height="560"></canvas></div>
        </div><div class="pane">
          <div class="ptitle">角度</div><div class="pdesc">拖动滑块或点击圆盘。</div>
          <input type="range" id="ucA" min="0" max="720" value="45" step="1">
          <div class="plabel">度数</div><input type="number" id="ucD" value="45">
          <div class="outbox" id="ucOut">—</div>
        </div></div>`;
      const c = $('#ucC'), ctx = c.getContext('2d');
      function draw(deg) {
        const R = 200, cx = c.width / 2, cy = c.height / 2;
        const rad = deg * Math.PI / 180;
        const x = Math.cos(rad), y = Math.sin(rad);
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(30, cy); ctx.lineTo(c.width - 30, cy); ctx.moveTo(cx, 30); ctx.lineTo(cx, c.height - 30); ctx.stroke();
        ctx.strokeStyle = '#3a3a3a';
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
        for (let a = 0; a < 360; a += 15) {
          const r2a = a * Math.PI / 180, big = a % 90 === 0;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(r2a) * R, cy - Math.sin(r2a) * R);
          ctx.lineTo(cx + Math.cos(r2a) * (R - (big ? 16 : 8)), cy - Math.sin(r2a) * (R - (big ? 16 : 8)));
          ctx.strokeStyle = big ? '#666' : '#333'; ctx.stroke();
          if (big) { ctx.fillStyle = '#8a8a8a'; ctx.font = '13px Inter'; ctx.textAlign = 'center'; ctx.fillText(a + '°', cx + Math.cos(r2a) * (R + 20), cy - Math.sin(r2a) * (R + 20) + 4); }
        }
        const px = cx + x * R, py = cy - y * R;
        ctx.strokeStyle = '#d7f452'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
        ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, cy); ctx.moveTo(px, py); ctx.lineTo(cx, py); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#d7f452'; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
        const norm = ((deg % 360) + 360) % 360;
        const r2r = norm * Math.PI / 180;
        $('#ucOut').innerHTML = `<div class="row"><span>角度</span><b>${norm}°</b></div>
          <div class="row"><span>弧度</span><b>${(norm * Math.PI / 180).toFixed(4)} rad</b></div>
          <div class="row"><span>cos</span><b>${Math.cos(r2r).toFixed(4)}</b></div>
          <div class="row"><span>sin</span><b>${Math.sin(r2r).toFixed(4)}</b></div>
          <div class="row"><span>tan</span><b>${Math.abs(Math.cos(r2r)) < 1e-9 ? '未定义' : Math.tan(r2r).toFixed(4)}</b></div>`;
      }
      $('#ucA').addEventListener('input', e => { $('#ucD').value = e.target.value; draw(+e.target.value); });
      $('#ucD').addEventListener('input', e => { $('#ucA').value = e.target.value; draw(+e.target.value); });
      draw(45);
      return;
    }

    if (sp.mode === 'graph') {
      host.innerHTML = `
        <div class="tool-body wide"><div class="stage">
          <div class="canvaswrap"><canvas id="gC" width="760" height="520"></canvas></div>
        </div><div class="pane">
          <div class="ptitle">函数</div><div class="pdesc">绘制 y = f(x)。支持 x、sin、cos、sqrt、abs、log、exp。</div>
          <div class="plabel" style="margin-top:0">f(x)</div><input type="text" id="gExpr" value="${sp.expr}">
          <div class="fieldrow"><div class="fld"><div class="plabel">x 最小值</div><input type="number" id="gX0" value="-10"></div><div class="fld"><div class="plabel">x 最大值</div><input type="number" id="gX1" value="10"></div></div>
          <div class="outbox" id="gOut">—</div>
          <button class="btn-ghost btn-sm" id="gPng" style="width:100%;justify-content:center;margin-top:10px">下载 PNG</button>
        </div></div>`;
      const c = $('#gC'), ctx = c.getContext('2d');
      function draw() {
        let fn;
        try { fn = evaluator($('#gExpr').value); } catch (e) { $('#gOut').textContent = e.message; return; }
        const x0 = +$('#gX0').value, x1 = +$('#gX1').value;
        const W = c.width, H = c.height, pad = 40;
        const samples = [];
        for (let px = 0; px <= W - pad * 2; px += 1) {
          const x = x0 + (x1 - x0) * px / (W - pad * 2);
          let y; try { y = fn(x); } catch (e) { y = NaN; }
          samples.push([x, y]);
        }
        const ys = samples.map(s => s[1]).filter(y => isFinite(y));
        let y0 = Math.min(...ys), y1 = Math.max(...ys);
        if (!isFinite(y0) || !isFinite(y1)) { y0 = -1; y1 = 1; }
        if (y1 - y0 < 1e-6) { y0 -= 1; y1 += 1; }
        const padY = (y1 - y0) * .1; y0 -= padY; y1 += padY;
        const X = x => pad + (x - x0) / (x1 - x0) * (W - pad * 2);
        const Y = y => H - pad - (y - y0) / (y1 - y0) * (H - pad * 2);
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#0d0d0d'; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = '#242424'; ctx.lineWidth = 1; ctx.font = '11px Inter'; ctx.fillStyle = '#666';
        const xStep = niceStep((x1 - x0) / 10), yStep = niceStep((y1 - y0) / 8);
        for (let x = Math.ceil(x0 / xStep) * xStep; x <= x1; x += xStep) {
          ctx.beginPath(); ctx.moveTo(X(x), pad); ctx.lineTo(X(x), H - pad); ctx.strokeStyle = Math.abs(x) < 1e-9 ? '#4a4a4a' : '#222'; ctx.stroke();
          ctx.fillText(String(+x.toFixed(2)), X(x) + 3, H - pad + 14);
        }
        for (let y = Math.ceil(y0 / yStep) * yStep; y <= y1; y += yStep) {
          ctx.beginPath(); ctx.moveTo(pad, Y(y)); ctx.lineTo(W - pad, Y(y)); ctx.strokeStyle = Math.abs(y) < 1e-9 ? '#4a4a4a' : '#222'; ctx.stroke();
          ctx.fillText(String(+y.toFixed(2)), 4, Y(y) - 4);
        }
        ctx.strokeStyle = '#d7f452'; ctx.lineWidth = 2.4; ctx.beginPath();
        let started = false;
        samples.forEach(([x, y]) => {
          if (!isFinite(y) || Math.abs(y) > 1e6) { started = false; return; }
          const px = X(x), py = Y(y);
          if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        });
        ctx.stroke();
        const finite = samples.filter(s => isFinite(s[1]));
        $('#gOut').innerHTML = `<div class="row"><span>绘图范围</span><b>x ∈ [${x0}, ${x1}]</b></div>
          <div class="row"><span>y 最小 / 最大</span><b>${r2(Math.min(...finite.map(s => s[1])))} / ${r2(Math.max(...finite.map(s => s[1])))}</b></div>
          <div class="row"><span>过零点（约）</span><b>${countZeros(samples)}</b></div>`;
      }
      function countZeros(s) {
        let n = 0;
        for (let i = 1; i < s.length; i++) if (isFinite(s[i - 1][1]) && isFinite(s[i][1]) && s[i - 1][1] * s[i][1] < 0) n++;
        return n;
      }
      function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))); const n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
      host.addEventListener('input', draw);
      $('#gPng').addEventListener('click', () => c.toBlob(b => window.downloadBlob(b, slug + '.png')));
      draw();
      return;
    }

    if (sp.mode === 'basic') {
      host.innerHTML = `
        <div class="tool-body wide"><div class="stage">
          <div class="ioout" id="bcDisp" style="min-height:90px;font-size:34px;text-align:right;padding:18px">0</div>
          <div class="ioout" id="bcHist" style="font-size:12.5px;color:#8a8a8a;max-height:160px;overflow:auto;margin-top:10px">历史记录显示在这里。</div>
        </div><div class="pane">
          <div class="ptitle">计算器</div>
          <div class="pdesc">输入表达式后按回车。支持 sqrt、sin、cos、log、^ 和 %。</div>
          <input type="text" id="bcIn" placeholder="例如 12 * (3 + 4) / 2" style="font-family:var(--mono)">
          <div class="shapes" style="margin-top:14px">${['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '(', ')', '+', '^', 'sqrt(', 'PI'].map(k => `<button class="shape" data-k="${k}">${k}</button>`).join('')}</div>
          <button class="btn-lime btn-run" id="bcEq">=</button>
          <div class="runnote">不会发送到任何服务器，这是纯本地表达式求值器。</div>
        </div></div>`;
      let hist = [];
      const evalIt = () => {
        const v = $('#bcIn').value.trim();
        if (!v) return;
        try {
          const val = evaluator(v)(0);
          if (!isFinite(val)) throw new Error('不是有限数');
          $('#bcDisp').textContent = r2(val);
          hist.unshift(v + ' = ' + r2(val));
          $('#bcHist').textContent = hist.slice(0, 20).join('\n');
        } catch (e) { $('#bcDisp').textContent = '错误'; }
      };
      $('#bcEq').addEventListener('click', evalIt);
      $('#bcIn').addEventListener('keydown', e => { if (e.key === 'Enter') evalIt(); });
      host.addEventListener('click', e => {
        const b = e.target.closest('#bcIn') ? null : e.target.closest('[data-k]');
        if (b) { $('#bcIn').value += b.dataset.k; $('#bcIn').focus(); }
      });
      return;
    }

    host.innerHTML = `<div class="tool-body single"><div class="stage"><div class="soon">${window.icon('calc')} <span>该计算器尚未接入 — 页面其余部分均可用。</span></div></div></div>`;
  };
  window.TOOL_ENGINES.calc = E;
})();
