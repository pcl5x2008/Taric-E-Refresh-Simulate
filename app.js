// ====== 模型常量（招式时间 / 成长参数）======
const BaseAS = 0.625;
const ASRatio = 0.625;
const WindupPct = 0.18;
const WindupMod = 0.25;
const QCastingTime = 0.25;

// md 文档中为 Q_CD_raw = 3
const Q_CD_raw = 3;

const GROW_AS_LV18 = 0.34;
const MAX_X = 10;

// ====== md 文档规定的模式系数 ======
// 标准模式：coeff = 0
// 纳沃利模式：coeff = 0.15
const STANDARD_COEFF = 0;
const NAVORI_COEFF = 0.15;

// x: 1(快) → 10(慢)  绿(140°) → 红(0°)，与全局 绿/红 配色一致
function xGradientColor(x) {
  const t = (x - 1) / (MAX_X - 1);
  const hue = 140 * (1 - t);
  return `hsl(${hue.toFixed(0)}, 72%, 56%)`;
}

let lastExtraHaste = null;
let lastPrevTierHaste = null;

function vibrate(ms = 8) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(ms);
  }
}

/**
 * 读取当前模式系数。
 *
 * md 规定：
 * - 标准模式 value = 0
 * - 纳沃利模式 value = 0.15
 *
 * 同时兼容旧版可能的：
 * - 标准模式 value = 1
 * - 纳沃利模式 value = 0.85
 */
function getModeCoeff() {
  const el = document.getElementById('mode');
  if (!el) return STANDARD_COEFF;

  const v = parseFloat(el.value);
  if (isNaN(v)) return STANDARD_COEFF;

  // 兼容旧版“保留比例”写法
  if (v === 1) return STANDARD_COEFF;
  if (v === 0.85) return NAVORI_COEFF;

  if (v < 0) return STANDARD_COEFF;
  return v;
}

/**
 * 纳沃利类额外减 CD。
 *
 * md 中公式项为：
 * (remain - CurrentWindup) * coeff
 *
 * 这里额外加了 Math.max(0, remain - CurrentWindup)，
 * 防止剩余 CD 小于前摇时出现“负向减少”这种不符合物理含义的情况。
 *
 * 如果你希望完全严格贴合 md 字面公式，可改成：
 * return coeff <= 0 ? 0 : (remain - currentWindup) * coeff;
 */
function extraCdReduce(remain, coeff, currentWindup) {
  if (coeff <= 0) return 0;
  return Math.max(0, remain - currentWindup) * coeff;
}

function clampNumber(id, min, max, def) {
  const el = document.getElementById(id);
  if (!el) return;

  let v = parseFloat(el.value);
  if (isNaN(v) || v < min) v = (def !== undefined && !isNaN(def)) ? def : min;
  if (v > max) v = max;

  el.value = v;

  const rng = document.getElementById(id + 'Range');
  if (rng) rng.value = v;
}

function runSimulation(params) {
  const { bonusAS, haste, baseHaste, level, eCdRaw, modeCoeff } = params;
  const growAS = level === 1 ? 0 : (GROW_AS_LV18 / 17) * (level - 1) * (0.7025 + 0.0175 * (level - 1));
  const TotalAS = Math.min((BaseAS + (bonusAS + growAS) * ASRatio) * 2, 3.003);
  const AttackTime = 1 / TotalAS;

  const BaseWindup = WindupPct / BaseAS;
  const CurrentWindup = BaseWindup + WindupMod * (AttackTime * WindupPct - BaseWindup);
  const CurrentBackswing = AttackTime - CurrentWindup;

  const TotalHaste = baseHaste + haste;
  const CDR = TotalHaste / (TotalHaste + 100);

  const Q_CD = Q_CD_raw * (1 - CDR);
  const E_CD = eCdRaw * (1 - CDR);
  const CDPA = 1 + haste / (haste + 100);

  const comboTimeArr = [0];
  const CD_initArr = [E_CD];
  const QRemainArr = [Q_CD];
  const QRemainTmpArr = [0];
  const nextAWaitArr = [0];

  let firstHit = null;
  let firstSwing = null;

  for (let x = 1; x <= MAX_X; x++) {
    const lastCA = x === 1 ? CurrentWindup : AttackTime;

    const qPrev = QRemainArr[x - 1];
    const qExtra = extraCdReduce(qPrev, modeCoeff, CurrentWindup);
    const qRemainTmp = Math.max(0, qPrev - lastCA - qExtra - CDPA);
    QRemainTmpArr[x] = qRemainTmp;

    QRemainArr[x] = (x % 2 === 0) ? Q_CD : qRemainTmp;
    const trigger = x <= 2 ? 0 : 1 - (x % 2);
    const qcdGap = (trigger !== 0) ? qRemainTmp : 0;
    const nextAW = (1 - (x % 2)) * Math.max(QCastingTime - CurrentBackswing, 0);
    nextAWaitArr[x] = nextAW;

    const ct = comboTimeArr[x - 1] + lastCA + qcdGap + nextAW;
    comboTimeArr[x] = ct;
    const lct = ct - comboTimeArr[x - 1];

    const cdPrev = CD_initArr[x - 1];
    const cdExtra = extraCdReduce(cdPrev, modeCoeff, CurrentWindup);
    const cd = cdPrev - lct - cdExtra - CDPA;
    CD_initArr[x] = cd;

    if (cd <= 0 && !firstHit) {
      firstHit = { x, time: ct, isHit: true };
    } else if (cd > 0 && cd <= CurrentBackswing && !firstSwing) {
      firstSwing = { x, time: ct + cd, isHit: false };
    }
  }

  let refresh = null;
  if (firstHit && firstSwing) {
    refresh = (firstHit.x <= firstSwing.x) ? firstHit : firstSwing;
  } else {
    refresh = firstHit || firstSwing || null;
  }

  return {
    TotalAS, AttackTime, CurrentWindup, CurrentBackswing, CDR, E_CD, CDPA, growAS,
    comboTimeArr, CD_initArr, QRemainTmpArr, nextAWaitArr, refresh
  };
}

function computeRank(x, isHit) {
  if (x === null) return null;
  return x * 2 + (isHit ? 0 : 1);
}

function calc() {
  const level = Math.min(18, Math.max(1, parseInt(document.getElementById('level').value, 10) || 9));
  const bonusAS = Math.min(150, Math.max(0, parseFloat(document.getElementById('bonusAS').value) || 0)) / 100;
  const baseHaste = Math.min(60, Math.max(0, parseFloat(document.getElementById('baseHaste').value) || 0));
  const haste = Math.min(150, Math.max(0, parseFloat(document.getElementById('haste').value) || 0));
  const modeCoeff = getModeCoeff();
  const eCdRaw = Math.min(16, Math.max(12, parseFloat(document.getElementById('eCdRaw')?.value) || 12));

  // 1. 核心仿真
  const sim = runSimulation({ bonusAS, haste, baseHaste, level, eCdRaw, modeCoeff });
  const { refresh, TotalAS, AttackTime, CurrentWindup, CurrentBackswing, CDR, E_CD, CDPA, growAS, CD_initArr, QRemainTmpArr, nextAWaitArr } = sim;

  const refreshX = refresh ? refresh.x : null;
  const refreshTime = refresh ? refresh.time : null;
  const isHit = refresh ? refresh.isHit : false;
  const currentRank = computeRank(refreshX, isHit);

  // 2. 额外攻速冗余：在当前刷新次数不变的前提下，还能浪费多少额外攻速
  let redundantAS = null;
  if (refreshX !== null) {
    const maxBonusAS = Math.max(0, (3.003 / 2 - BaseAS) / ASRatio - growAS);
    let lo = bonusAS, hi = Math.max(bonusAS + 0.001, maxBonusAS);
    while (hi - lo > 0.0001) {
      const mid = (lo + hi) / 2;
      const r = runSimulation({ bonusAS: mid, haste, baseHaste, level, eCdRaw, modeCoeff }).refresh;
      if (r && r.x === refreshX && r.isHit === isHit) lo = mid;
      else hi = mid;
    }
    redundantAS = Math.max(0, Math.min(lo - bonusAS, maxBonusAS - bonusAS));
  }

  // 3. 寻找下一档急速
  let extraHaste = null;
  if (refreshX !== null && currentRank !== null && currentRank > 2) {
    const maxH = Math.min(haste + 100, 150);
    for (let h = haste; h <= maxH; h++) {
      const r = runSimulation({ bonusAS, haste: h, baseHaste, level, eCdRaw, modeCoeff }).refresh;
      if (r && computeRank(r.x, r.isHit) < currentRank) {
        extraHaste = h - haste;
        break;
      }
    }
  }

  // 4. 寻找上一档急速
  let prevTierHaste = null;
  if (currentRank !== null && currentRank < 21) {
    const targetRank = currentRank + 1;
    for (let h = 0; h <= haste; h++) {
      const r = runSimulation({ bonusAS, haste: h, baseHaste, level, eCdRaw, modeCoeff }).refresh;
      if (r && computeRank(r.x, r.isHit) === targetRank) {
        prevTierHaste = h;
        break;
      }
    }
  }

  // 按钮状态
  lastExtraHaste = extraHaste;
  lastPrevTierHaste = prevTierHaste;

  const prevBtn = document.getElementById('prevTierBtn');
  if (prevBtn) {
    prevBtn.disabled = lastPrevTierHaste === null;
    prevBtn.textContent = '上一档:' + (lastPrevTierHaste !== null ? lastPrevTierHaste : 0) + '急速';
  }

  const applyBtn = document.getElementById('applyHasteBtn');
  if (applyBtn) {
    const canApply = extraHaste !== null && extraHaste > 0;
    applyBtn.disabled = !canApply;
    applyBtn.textContent = '下一档:' + (canApply ? Math.min(haste + extraHaste, 150) : 0) + '急速';
  }

  // 5. 渲染结果
  renderResults({ refreshX, refreshTime, isHit, CD_initArr, redundantAS, nextAWaitArr, QRemainTmpArr, extraHaste, TotalAS, AttackTime, CurrentWindup, CurrentBackswing, E_CD, eCdRaw, CDR, CDPA });
}

function renderResults(d) {
  const resultArea = document.getElementById('resultArea');
  if (!resultArea) return;

  if (d.refreshX !== null) {
    const waitTime = Math.max(0, d.CD_initArr[d.refreshX]).toFixed(3);
    const cond = d.isHit ? '命中立刻刷新' : `命中后${waitTime}s刷新`;
    const condCls = d.isHit ? 'badge-hit' : 'badge-swing';
    const extraLabel = d.isHit ? '少A一次还需' : '命中刷新还需';
    const extraVal = d.extraHaste !== null ? '+' + d.extraHaste + ' 急速' : (d.isHit ? '已无法减少' : '无法达成');

    resultArea.innerHTML = `
      <div class="result-hero">
        <div class="hero-left">
          <div class="hero-stat">
            <span class="hero-label">第</span>
            <span class="hero-number" style="color:${xGradientColor(d.refreshX)}">${d.refreshX}</span>
            <span class="hero-label">次</span>
          </div>
          <div class="hero-meta">
            <span class="badge-pill ${condCls}">${cond}</span>
            <span class="hero-time" style="color:${xGradientColor(d.refreshX)}">耗时 ${d.refreshTime.toFixed(3)}s</span>
          </div>
        </div>
        <div class="hero-right">
          <div class="hero-r-item">
            <div class="hero-r-label">额外攻速冗余</div>
            <div class="hero-r-value ${d.redundantAS !== null && d.redundantAS >= 0.1 ? 'green-text' : 'gold-text'}">${d.redundantAS !== null ? (Math.max(0, d.redundantAS) * 100).toFixed(1) : '-'}%</div>
          </div>
          <div class="hero-r-item">
            <div class="hero-r-label">Q 施法超出后摇</div>
            <div class="hero-r-sub ${d.nextAWaitArr[2] !== 0 ? 'gold-text' : ''}">${d.nextAWaitArr[2].toFixed(3)}s</div>
          </div>
          <div class="hero-r-item">
            <div class="hero-r-label">${extraLabel}</div>
            <div class="hero-r-value ${d.extraHaste !== null && d.extraHaste > 0 ? 'green-text' : 'red-text'}">${extraVal}</div>
          </div>
          <div class="hero-r-item">
            <div class="hero-r-label">QCD 在 AA 后剩余</div>
            <div class="hero-r-sub ${d.QRemainTmpArr[2] !== 0 ? 'gold-text' : ''}">${d.QRemainTmpArr[2].toFixed(3)}s</div>
          </div>
        </div>
      </div>
      <div class="result-grid">
        <div class="result-item">
          <div class="label">总攻速</div>
          <div class="value">${d.TotalAS.toFixed(3)} /s</div>
          <div class="detail">间隔 ${d.AttackTime.toFixed(3)}s</div>
        </div>
        <div class="result-item">
          <div class="label">前摇 / 后摇</div>
          <div class="value sm">${d.CurrentWindup.toFixed(3)}s / <span class="${d.CurrentBackswing <= 0.25 ? 'gold-text' : ''}">${d.CurrentBackswing.toFixed(3)}s</span></div>
        </div>
        <div class="result-item">
          <div class="label">E 冷却（实际）</div>
          <div class="value sm">${d.E_CD.toFixed(3)} s</div>
          <div class="detail">基础 ${d.eCdRaw}s · ${(d.CDR * 100).toFixed(1)}% CDR</div>
        </div>
        <div class="result-item">
          <div class="label">被动减 CD</div>
          <div class="value">${d.CDPA.toFixed(3)} s</div>
          <div class="detail">每次命中减 ${d.CDPA.toFixed(2)}s</div>
        </div>
      </div>
    `;
  } else {
    resultArea.innerHTML = `
      <div class="result-hero">
        <div class="hero-stat">
          <span class="hero-label" style="font-size:20px;color:var(--muted);">10 次连招内未触发刷新</span>
        </div>
      </div>
    `;
  }

  // 更新移动端底部 Bar 状态
  const sheetHeroNum = document.getElementById('sheetHeroNum');
  const sheetBadge = document.getElementById('sheetBadge');
  const sheetHeroTime = document.getElementById('sheetHeroTime');

  if (sheetHeroNum && sheetHeroTime && sheetBadge) {
    if (d.refreshX !== null) {
      const waitTime = Math.max(0, d.CD_initArr[d.refreshX]).toFixed(3);
      const dynamicColor = xGradientColor(d.refreshX);
      sheetHeroNum.textContent = d.refreshX;
      sheetHeroNum.style.color = dynamicColor;
      sheetHeroTime.textContent = `${d.refreshTime.toFixed(3)}s`;
      sheetHeroTime.style.color = dynamicColor;
      sheetBadge.textContent = d.isHit ? '命中立刻刷新' : `命中后${waitTime}s刷新`;
      sheetBadge.className = `badge-pill ${d.isHit ? 'badge-hit' : 'badge-swing'}`;
    } else {
      sheetHeroNum.textContent = '--';
      sheetHeroNum.style.color = 'var(--text)';
      sheetHeroTime.textContent = '-- s';
      sheetHeroTime.style.color = 'var(--muted)';
      sheetBadge.textContent = '未刷新';
      sheetBadge.className = 'badge-pill badge-none';
    }
  }
}

function setInput(id, val) {
  const num = document.getElementById(id);
  if (!num) return;

  const rng = document.getElementById(id + 'Range');

  num.value = val;
  if (rng) {
    rng.value = val;
    updateRangeTrack(rng);
  }
}

function feedbackAfterApply() {
  const resultArea = document.getElementById('resultArea');
  if (!resultArea) return;
  const hero = resultArea.querySelector('.result-hero');
  if (!hero) return;
  hero.classList.remove('flash');
  void hero.offsetWidth;
  hero.classList.add('flash');
  hero.addEventListener('animationend', () => {
    hero.classList.remove('flash');
  }, { once: true });

}

/**
 * 设置模式选择器。
 * 优先匹配 md 的 value：0 / 0.15
 * 如果页面里还是旧版 value：1 / 0.85，也能自动兼容。
 */
function setModeCoeff(coeff) {
  const el = document.getElementById('mode');
  if (!el) return;

  const values = [String(coeff)];

  if (coeff === STANDARD_COEFF) {
    values.push('1');
  }

  if (coeff === NAVORI_COEFF) {
    values.push('0.85');
  }

  if (el.options && el.options.length) {
    for (const val of values) {
      const opt = Array.from(el.options).find(
        (o) => parseFloat(o.value) === parseFloat(val)
      );
      if (opt) {
        el.value = opt.value;
        return;
      }
    }
  }

  el.value = String(coeff);
}

function applyExtraHaste() {
  if (lastExtraHaste === null || lastExtraHaste <= 0) return;

  const el = document.getElementById('haste');
  if (!el) return;

  const max = parseFloat(el.max) || 150;
  const cur = parseFloat(el.value) || 0;

  setInput('haste', Math.min(max, cur + lastExtraHaste));
  calc();
  feedbackAfterApply();
}

function dropToPrevTier() {
  if (lastPrevTierHaste === null) return;
  setInput('haste', lastPrevTierHaste);
  calc();
  feedbackAfterApply();
}

function applyPreset(type) {
  const desc = document.getElementById('presetDesc');

  if (!type) {
    if (desc) {
      desc.innerHTML = `<span class="line line-main">选择预设方案以查看详细说明</span>`;
    }
    return;
  }

  // 按 md 文档：E 基础冷却 12，标准模式
  setInput('eCdRaw', 12);
  setModeCoeff(STANDARD_COEFF);

  if (type === 'initZero') {
    setInput('level', 9);
    setInput('bonusAS', 0);
    setInput('haste', 0);
    setInput('baseHaste', 0);

    if (desc) {
      desc.innerHTML =
        `<span class="line line-main">初始（0%/0） —— ` +
        `<span class="hl">0%攻速</span> / ` +
        `<span class="hl2">0急速</span> / ` +
        `<span class="hl3">0基础急速</span></span>` +
        `<span class="line"><span class="tag-rune">符文</span>` +
        `<span class="line-label">无符文加成</span></span>` +
        `<span class="line"><span class="tag-item">装备</span>` +
        `<span class="line-label">无装备加成</span></span>`;
    }
  } else if (type === 'glacier') {
    setInput('level', 9);
    setInput('bonusAS', 30);
    setInput('haste', 62);
    setInput('baseHaste', 0);

    if (desc) {
      desc.innerHTML =
        `<span class="line line-main">冰川增幅（30%/62） —— ` +
        `<span class="hl">30%攻速</span> / ` +
        `<span class="hl2">62急速</span> / ` +
        `<span class="hl3">0基础急速</span></span>` +
        `<span class="line"><span class="tag-rune">符文</span>` +
        `<span class="line-label">冰川+多面手+超然+小急速 = 27急速</span></span>` +
        `<span class="line"><span class="tag-item">装备</span>` +
        `<span class="line-label">cd鞋+眼泪+燃烧宝石+音管 = 30%攻速 + 35急速</span></span>`;
    }
  } else if (type === 'lethal') {
    setInput('level', 9);
    setInput('bonusAS', 66);
    setInput('haste', 52);
    setInput('baseHaste', 15);

    if (desc) {
      desc.innerHTML =
        `<span class="line line-main">致命节奏（66%/52/15） —— ` +
        `<span class="hl">66%攻速</span> / ` +
        `<span class="hl2">52急速</span> / ` +
        `<span class="hl3">15基础急速</span></span>` +
        `<span class="line"><span class="tag-rune">符文</span>` +
        `<span class="line-label">致命节奏+传说急速+小急速 = 36%攻速 + 17急速 + 15基础急速</span></span>` +
        `<span class="line"><span class="tag-item">装备</span>` +
        `<span class="line-label">cd鞋+眼泪+燃烧宝石+音管 = 30%攻速 + 35急速</span></span>`;
    }
  }

  calc();
}

function updateRangeTrack(rangeEl) {
  const min = parseFloat(rangeEl.min) || 0;
  const max = parseFloat(rangeEl.max) || 100;
  const val = parseFloat(rangeEl.value) || 0;
  const percentage = ((val - min) / (max - min)) * 100;
  rangeEl.style.background = `linear-gradient(to right, var(--neon) 0%, var(--neon) ${percentage}%, var(--field-border) ${percentage}%, var(--field-border) 100%)`;
}

function bindInput(id) {
  const num = document.getElementById(id);
  const rng = document.getElementById(id + 'Range');
  if (!num) return;

  // 初始值 + 事件源标记
  num._prevVal = parseFloat(num.value);
  let inputSource = null;
  let srcTimer = null;

  // ── 键盘：上/左 = 减小，下/右 = 增大 ──
  num.addEventListener('keydown', (e) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    inputSource = 'keyboard';
    clearTimeout(srcTimer);
    srcTimer = setTimeout(() => { inputSource = null; }, 80);

    const step = parseFloat(num.step) || 1;
    const min = parseFloat(num.min);
    const max = parseFloat(num.max);
    const val = parseFloat(num.value) || 0;
    const dec = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
    const newVal = dec ? Math.max(min, val - step) : Math.min(max, val + step);
    if (newVal === val) return;
    num._prevVal = newVal;
    num.value = newVal;
    if (rng) { rng.value = newVal; updateRangeTrack(rng); }
    calc();
  });

  // ── 滚轮：上滚 = 减小，下滚 = 增大（数字框） ──
  num.addEventListener('wheel', (e) => {
    e.preventDefault();
    inputSource = 'wheel';
    clearTimeout(srcTimer);
    srcTimer = setTimeout(() => { inputSource = null; }, 80);

    const step = parseFloat(num.step) || 1;
    const min = parseFloat(num.min);
    const max = parseFloat(num.max);
    const val = parseFloat(num.value) || 0;
    const newVal = e.deltaY < 0 ? Math.max(min, val - step) : Math.min(max, val + step);
    if (newVal === val) return;
    num._prevVal = newVal;
    num.value = newVal;
    if (rng) { rng.value = newVal; updateRangeTrack(rng); }
    calc();
  }, { passive: false });

  // ── input：处理输入与原生上下箭头点击 ──
  num.addEventListener('input', function () {
    // 键盘/滚轮已经处理完毕，直接更新 prevVal
    if (inputSource === 'keyboard' || inputSource === 'wheel') {
      num._prevVal = parseFloat(this.value);
      return;
    }

    const currVal = parseFloat(this.value);
    if (isNaN(currVal)) return;

    const min = parseFloat(this.min);
    const max = parseFloat(this.max);

    // 只要数值在合法区间内，就同步给滑块并触发计算
    if (currVal >= min && currVal <= max) {
      num._prevVal = currVal;
      if (rng) {
        rng.value = currVal;
        updateRangeTrack(rng);
      }
      calc();
    }
  });

  // ── 拉条 ──
  if (rng) {
    updateRangeTrack(rng);
    rng.addEventListener('input', () => {
      num.value = rng.value;
      updateRangeTrack(rng);
      calc();
      vibrate(5);
    });

    // 滚轮：上滚 = 减小，下滚 = 增大（拉条）
    rng.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = parseFloat(num.step) || 1;
      const min = parseFloat(num.min);
      const max = parseFloat(num.max);
      const val = parseFloat(rng.value) || 0;
      const newVal = e.deltaY < 0 ? Math.max(min, val - step) : Math.min(max, val + step);
      if (newVal === val) return;
      rng.value = newVal;
      num.value = newVal;
      num._prevVal = newVal;
      updateRangeTrack(rng);
      calc();
    }, { passive: false });
  }
}

function initMobileBottomSheet() {
  const sheet = document.getElementById('mainInputCard');
  const handle = document.getElementById('sheetHandle');
  const handleText = document.getElementById('sheetHandleText');

  if (!sheet || !handle) return;

  function toggleSheet(expand) {
    const shouldExpand = expand !== undefined ? expand : !sheet.classList.contains('is-expanded');
    if (shouldExpand) {
      sheet.classList.add('is-expanded');
      handle.setAttribute('aria-expanded', 'true');
      if (handleText) handleText.textContent = '收起 ▼';
    } else {
      sheet.classList.remove('is-expanded');
      handle.setAttribute('aria-expanded', 'false');
      if (handleText) handleText.textContent = '展开 ▲';
    }
  }

  handle.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleSheet();
    vibrate(8);
  });
}

document.addEventListener('DOMContentLoaded', function () {
  const ids = ['bonusAS', 'baseHaste', 'haste', 'level', 'eCdRaw'];

  for (const id of ids) {
    bindInput(id);
  }

  for (const id of ids) {
    const num = document.getElementById(id);
    if (!num) continue;

    num.addEventListener('blur', function () {
      clampNumber(
        id,
        parseFloat(num.min),
        parseFloat(num.max),
        parseFloat(num.defaultValue)
      );
      calc();
    });

    num.addEventListener('focus', function () {
      this.select();
    });
  }

  const modeEl = document.getElementById('mode');
  if (modeEl) {
    modeEl.addEventListener('change', calc);
  }

  const presetSelect = document.getElementById('presetSelect');
  if (presetSelect) {
    presetSelect.addEventListener('change', function () {
      applyPreset(this.value);
    });

    presetSelect.addEventListener('click', function () {
      applyPreset(this.value);
    });
  }

  const applyBtn = document.getElementById('applyHasteBtn');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => { applyExtraHaste(); vibrate(12); });
  }

  const prevBtn = document.getElementById('prevTierBtn');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => { dropToPrevTier(); vibrate(12); });
  }

  // 作者署名：一键复制
  document.querySelectorAll('.chip-copy').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = btn.dataset.copy;
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      const old = btn.textContent;
      btn.textContent = '已复制 ✓';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = old; btn.classList.remove('copied'); }, 1400);
    });
  });

  initMobileBottomSheet();

  // 按 md 文档初始化默认状态：
  // Level = 9
  // E_CD_raw = 12
  // 标准模式 coeff = 0
  setInput('level', 9);
  setInput('eCdRaw', 12);
  setModeCoeff(STANDARD_COEFF);

  calc();
});