// ====== 模型常量（招式时间 / 成长参数）======
const BaseAS = 0.625;
const ASRatio = 0.625;
const WindupPct = 0.18;
const WindupMod = 0.25;
const QCastingTime = 0.25;
const Q_CD_raw_const = 3;
const GROW_AS_LV18 = 0.34;
const MAX_X = 10;

// x: 1(快) → 10(慢)  绿(140°) → 红(0°)，与全局 绿/红 配色一致
function xGradientColor(x) {
  const t = (x - 1) / (MAX_X - 1);
  const hue = 140 * (1 - t);
  return `hsl(${hue.toFixed(0)}, 72%, 56%)`;
}

let lastExtraHaste = null;

function clampNumber(id, min, max, def) {
  const el = document.getElementById(id);
  let v = parseFloat(el.value);
  if (isNaN(v) || v < min) v = def !== undefined ? def : min;
  if (v > max) v = max;
  el.value = v;
  const rng = document.getElementById(id + 'Range');
  if (rng) rng.value = v;
}

function calc() {
  let Level = parseFloat(document.getElementById('level').value);
  if (isNaN(Level) || Level < 1) Level = 1;
  if (Level > 18) Level = 18;
  let bASraw = parseFloat(document.getElementById('bonusAS').value);
  if (isNaN(bASraw) || bASraw < 0) bASraw = 0;
  if (bASraw > 150) bASraw = 150;
  const bonusAS = bASraw / 100;
  let baseHaste = parseFloat(document.getElementById('baseHaste').value);
  if (isNaN(baseHaste) || baseHaste < 0) baseHaste = 0;
  if (baseHaste > 60) baseHaste = 60;
  let haste = parseFloat(document.getElementById('haste').value);
  if (isNaN(haste) || haste < 0) haste = 0;
  if (haste > 150) haste = 150;
  const coeff = parseFloat(document.getElementById('mode').value);
  let E_CD_raw = parseFloat(document.getElementById('eCdRaw').value);
  if (isNaN(E_CD_raw) || E_CD_raw < 12) E_CD_raw = 12;
  if (E_CD_raw > 16) E_CD_raw = 16;

  const growAS = Level === 1 ? 0 : GROW_AS_LV18 / 17 * (Level - 1) * (0.7025 + 0.0175 * (Level - 1));

  const TotalAS = Math.min((BaseAS + (bonusAS + growAS) * ASRatio) * 2, 3.003);
  const AttackTime = 1 / TotalAS;
  const BaseWindup = WindupPct / BaseAS;
  const CurrentWindup = BaseWindup + WindupMod * (AttackTime * WindupPct - BaseWindup);
  const CurrentBackswing = AttackTime - CurrentWindup;

  const TotalHaste = baseHaste + haste;
  const CDR = TotalHaste / (TotalHaste + 100);
  const Q_CD = Q_CD_raw_const * (1 - CDR);
  const E_CD = E_CD_raw * (1 - CDR);
  const CDPA = 1 + haste / (haste + 100);

  const comboTimeArr = [0];
  const CD_initArr = [E_CD];
  const QRemainArr = [Q_CD];
  const QRemainTmpArr = [0];
  const nextAWaitArr = [0];
  const hitRefresh = [];
  const swingRefresh = [];
  const finalTime = [];

  for (let x = 1; x <= MAX_X; x++) {
    const lastCA = x === 1 ? CurrentWindup : AttackTime;

    const qRemainTmp = Math.max(0, (QRemainArr[x - 1] - lastCA) * coeff - CDPA);
    QRemainTmpArr[x] = qRemainTmp;

    let qr;
    if (x % 2 === 0) {
      qr = Q_CD;
    } else {
      qr = qRemainTmp;
    }
    QRemainArr[x] = qr;

    const trigger = (x <= 2) ? 0 : (1 - (x % 2));
    let qcdGap = 0;
    if (trigger !== 0) {
      qcdGap = qRemainTmp;
    }

    const nextAW = (1 - (x % 2)) * Math.max(QCastingTime - CurrentBackswing, 0);
    nextAWaitArr[x] = nextAW;

    const ct = comboTimeArr[x - 1] + lastCA + qcdGap + nextAW;
    comboTimeArr[x] = ct;

    const lct = ct - comboTimeArr[x - 1];

    const cd = (CD_initArr[x - 1] - lct) * coeff - CDPA;
    CD_initArr[x] = cd;

    let hitR = 0, swingR = 0, ft = null;
    if (cd <= 0) {
      hitR = 1;
      ft = comboTimeArr[x];
    } else if (cd <= CurrentBackswing) {
      swingR = 1;
      ft = comboTimeArr[x] + cd;
    }
    hitRefresh[x] = hitR;
    swingRefresh[x] = swingR;
    finalTime[x] = ft;
  }

  let firstHitX = null, firstHitTime = null, firstSwingX = null, firstSwingTime = null;
  for (let x = 1; x <= MAX_X; x++) {
    if (hitRefresh[x] === 1 && firstHitX === null) { firstHitX = x; firstHitTime = finalTime[x]; }
    if (swingRefresh[x] === 1 && firstSwingX === null) { firstSwingX = x; firstSwingTime = finalTime[x]; }
  }

  let refreshX = null, refreshTime = null, isHit = false;
  if (firstHitX !== null && firstSwingX !== null) {
    if (firstHitX <= firstSwingX) { refreshX = firstHitX; refreshTime = firstHitTime; isHit = true; }
    else { refreshX = firstSwingX; refreshTime = firstSwingTime; isHit = false; }
  } else if (firstHitX !== null) { refreshX = firstHitX; refreshTime = firstHitTime; isHit = true; }
  else if (firstSwingX !== null) { refreshX = firstSwingX; refreshTime = firstSwingTime; isHit = false; }

  function simulate(bAS, h) {
    const totalH = baseHaste + h;
    const cdr = totalH / (totalH + 100);
    const tAS = Math.min((BaseAS + (bAS + growAS) * ASRatio) * 2, 3.003);
    const at = 1 / tAS;
    const bw = WindupPct / BaseAS;
    const cw = bw + WindupMod * (at * WindupPct - bw);
    const cbs = at - cw;
    const qcd = Q_CD_raw_const * (1 - cdr);
    const ecd = E_CD_raw * (1 - cdr);
    const cdpa = 1 + h / (h + 100);
    let qr = qcd, ct = 0, cd = ecd;
    for (let i = 1; i <= MAX_X; i++) {
      const lca = i === 1 ? cw : at;
      const qPrev = qr;
      if (i % 2 === 0) qr = qcd;
      else qr = Math.max(0, (qPrev - lca) * coeff - cdpa);
      const tr = (i <= 2) ? 0 : (1 - (i % 2));
      let qg = 0;
      if (tr !== 0) qg = Math.max(0, (qPrev - lca) * coeff - cdpa);
      const nw = (1 - (i % 2)) * Math.max(QCastingTime - cbs, 0);
      const prev = ct;
      ct = ct + lca + qg + nw;
      const lct = ct - prev;
      cd = (cd - lct) * coeff - cdpa;
      if (cd <= 0) return { x: i, isHit: true };
      if (cd > 0 && cd <= cbs) return { x: i, isHit: false };
    }
    return null;
  }

  let redundantAS = null;
  if (refreshX !== null) {
    const maxBonusAS = Math.max(0, (3.003 / 2 - BaseAS) / ASRatio - growAS);
    let lo = bonusAS, hi = Math.max(bonusAS + 0.001, maxBonusAS), mid;
    while (hi - lo > 0.0001) {
      mid = (lo + hi) / 2;
      const r = simulate(mid, haste);
      if (r !== null && r.x === refreshX) lo = mid;
      else hi = mid;
    }
    redundantAS = Math.max(0, Math.min(lo - bonusAS, maxBonusAS - bonusAS));
  }

  function cdConditionAtX(bAS, h, targetX) {
    const totalH = baseHaste + h;
    const cdr = totalH / (totalH + 100);
    const tAS = Math.min((BaseAS + (bAS + growAS) * ASRatio) * 2, 3.003);
    const at = 1 / tAS;
    const bw = WindupPct / BaseAS;
    const cw = bw + WindupMod * (at * WindupPct - bw);
    const cbs = at - cw;
    const qcd = Q_CD_raw_const * (1 - cdr);
    const ecd = E_CD_raw * (1 - cdr);
    const cdpa = 1 + h / (h + 100);
    let qr = qcd, ct = 0, cd = ecd;
    for (let i = 1; i <= targetX; i++) {
      const lca = i === 1 ? cw : at;
      const qPrev = qr;
      if (i % 2 === 0) qr = qcd;
      else qr = Math.max(0, (qPrev - lca) * coeff - cdpa);
      const tr = (i <= 2) ? 0 : (1 - (i % 2));
      let qg = 0;
      if (tr !== 0) qg = Math.max(0, (qPrev - lca) * coeff - cdpa);
      const nw = (1 - (i % 2)) * Math.max(QCastingTime - cbs, 0);
      const prev = ct;
      ct = ct + lca + qg + nw;
      const lct = ct - prev;
      cd = (cd - lct) * coeff - cdpa;
    }
    if (cd <= 0) return 1;
    if (cd > 0 && cd <= cbs) return 0;
    return null;
  }

  let extraHaste = null;
  if (isHit && refreshX !== null && refreshX > 1) {
    const curX = simulate(bonusAS, haste);
    const hiMax = simulate(bonusAS, haste + 500);
    if (curX !== null && curX.x <= refreshX && hiMax !== null && hiMax.x < refreshX) {
      let lo = haste, hi = haste + 500, mid;
      while (hi - lo > 0.01) {
        mid = (lo + hi) / 2;
        const r = simulate(bonusAS, mid);
        if (r !== null && r.x < refreshX) hi = mid;
        else lo = mid;
      }
      extraHaste = Math.max(0, Math.ceil(hi - haste));
    }
  } else if (!isHit && refreshX !== null) {
    const cMax = cdConditionAtX(bonusAS, haste + 500, refreshX);
    if (cMax === 1) {
      let lo = haste, hi = haste + 500, mid;
      while (hi - lo > 0.01) {
        mid = (lo + hi) / 2;
        const r = cdConditionAtX(bonusAS, mid, refreshX);
        if (r === 1) hi = mid;
        else lo = mid;
      }
      extraHaste = Math.max(0, Math.ceil(hi - haste));
    }
  }

  lastExtraHaste = extraHaste;
  const applyBtn = document.getElementById('applyHasteBtn');
  if (applyBtn) applyBtn.disabled = (extraHaste === null || extraHaste <= 0);

  let resultHtml = '';
  if (refreshX !== null) {
    const waitTime = Math.max(0, CD_initArr[refreshX]).toFixed(3);
    const cond = isHit ? '命中立刻刷新' : `命中后${waitTime}s刷新`;
    const condCls = isHit ? 'badge-hit' : 'badge-swing';
    const condTextCls = isHit ? 'green-text' : 'gold-text';
    const condValCls = isHit ? 'green' : 'gold';
    const extraLabel = isHit ? '少A一次还需' : '命中刷新还需';
    const extraVal = extraHaste !== null ? '+' + extraHaste + ' 急速' : (isHit ? '已无法减少' : '无法达成');
    const extraNote = isHit ? `当前 ${refreshX} 次 → 目标 ${Math.max(1, refreshX - 1)} 次` : '';

    resultHtml += `
      <div class="result-hero">
        <div class="hero-left">
          <div class="hero-stat">
            <span class="hero-label">第</span>
            <span class="hero-number" style="color:${xGradientColor(refreshX)}">${refreshX}</span>
            <span class="hero-label">次</span>
          </div>
          <div class="hero-meta">
            <span class="badge-pill ${condCls}">${cond}</span>
            <span class="hero-time ${condTextCls}">耗时 ${refreshTime.toFixed(3)}s</span>
          </div>
        </div>
        <div class="hero-right">
          <div class="hero-r-item">
            <div class="hero-r-label">额外攻速冗余</div>
            <div class="hero-r-value ${redundantAS !== null && redundantAS >= 0.1 ? 'green-text' : 'gold-text'}">${redundantAS !== null ? (Math.max(0, redundantAS) * 100).toFixed(1) : '-'}%</div>
          </div>
          <div class="hero-r-item">
            <div class="hero-r-label">Q 施法超出后摇</div>
            <div class="hero-r-sub ${nextAWaitArr[2] !== 0 ? 'gold-text' : ''}">${nextAWaitArr[2].toFixed(3)}s</div>
          </div>
          <div class="hero-r-item">
            <div class="hero-r-label">${extraLabel}</div>
            <div class="hero-r-value ${extraHaste !== null && extraHaste > 0 ? 'green-text' : 'red-text'}">${extraVal}</div>
          </div>
          <div class="hero-r-item">
            <div class="hero-r-label">QCD 在 AA 后剩余</div>
            <div class="hero-r-sub ${QRemainTmpArr[2] !== 0 ? 'gold-text' : ''}">${QRemainTmpArr[2].toFixed(3)}s</div>
          </div>
        </div>
      </div>

      <div class="result-grid">
        <div class="result-item">
          <div class="label">总攻速</div>
          <div class="value">${TotalAS.toFixed(3)} /s</div>
          <div class="detail">间隔 ${AttackTime.toFixed(3)}s</div>
        </div>
        <div class="result-item">
          <div class="label">前摇 / 后摇</div>
          <div class="value sm">${CurrentWindup.toFixed(3)}s / <span class="${CurrentBackswing <= 0.25 ? 'gold-text' : ''}">${CurrentBackswing.toFixed(3)}s</span></div>
        </div>
        <div class="result-item">
          <div class="label">E 冷却（实际）</div>
          <div class="value sm">${E_CD.toFixed(3)} s</div>
          <div class="detail">基础 ${E_CD_raw}s · ${(CDR * 100).toFixed(1)}% CDR</div>
        </div>
        <div class="result-item">
          <div class="label">被动减 CD</div>
          <div class="value">${CDPA.toFixed(3)} s</div>
          <div class="detail">每次命中减 ${CDPA.toFixed(2)}s</div>
        </div>
      </div>`;
  } else {
    resultHtml += `<div class="result-hero"><div class="hero-stat"><span class="hero-label" style="font-size:20px;color:var(--muted);">10 次连招内未触发刷新</span></div></div>`;
  }
  document.getElementById('resultArea').innerHTML = resultHtml;
}

function setInput(id, val) {
  const num = document.getElementById(id);
  const rng = document.getElementById(id + 'Range');
  num.value = val;
  if (rng) rng.value = val;
}

function applyExtraHaste() {
  if (lastExtraHaste === null || lastExtraHaste <= 0) return;
  const el = document.getElementById('haste');
  const max = parseFloat(el.max) || 150;
  const cur = parseFloat(el.value) || 0;
  setInput('haste', Math.min(max, cur + lastExtraHaste));
  calc();
}

function applyPreset(type) {
  if (!type) { document.getElementById('presetDesc').innerHTML = '<span class="line line-main">选择预设方案以查看详细说明</span>'; return; }
  setInput('eCdRaw', 12);
  setInput('mode', 1);
  const desc = document.getElementById('presetDesc');
  if (type === 'initZero') {
    setInput('level', 9);
    setInput('bonusAS', 0);
    setInput('haste', 0);
    setInput('baseHaste', 0);
    desc.innerHTML = '<span class="line line-main">初始（0%/0） —— <span class="hl">0%攻速</span> / <span class="hl2">0急速</span> / <span class="hl3">0基础急速</span></span>' +
      '<span class="line"><span class="tag-rune">符文</span><span class="line-label">无符文加成</span></span>' +
      '<span class="line"><span class="tag-item">装备</span><span class="line-label">无装备加成</span></span>';
  } else if (type === 'glacier') {
    setInput('level', 9);
    setInput('bonusAS', 30);
    setInput('haste', 62);
    setInput('baseHaste', 0);
    desc.innerHTML =       '<span class="line line-main">冰川增幅（30%/62） —— <span class="hl">30%攻速</span> / <span class="hl2">62急速</span> / <span class="hl3">0基础急速</span></span>' +
      '<span class="line"><span class="tag-rune">符文</span><span class="line-label">冰川+多面手+超然+小急速 = 27急速</span></span>' +
      '<span class="line"><span class="tag-item">装备</span><span class="line-label">cd鞋+眼泪+燃烧宝石+音管 = 30%攻速 + 35急速</span></span>';
  } else if (type === 'lethal') {
    setInput('level', 9);
    setInput('bonusAS', 66);
    setInput('haste', 52);
    setInput('baseHaste', 15);
    desc.innerHTML =       '<span class="line line-main">致命节奏（66%/52/15） —— <span class="hl">66%攻速</span> / <span class="hl2">52急速</span> / <span class="hl3">15基础急速</span></span>' +
      '<span class="line"><span class="tag-rune">符文</span><span class="line-label">致命节奏+传说急速+小急速 = 36%攻速 + 17急速 + 15基础急速</span></span>' +
      '<span class="line"><span class="tag-item">装备</span><span class="line-label">cd鞋+眼泪+燃烧宝石+音管 = 30%攻速 + 35急速</span></span>';
  }
  calc();
}

function bindInput(id) {
  const num = document.getElementById(id);
  const rng = document.getElementById(id + 'Range');
  if (num) num.addEventListener('input', () => { if (rng) rng.value = num.value; calc(); });
  if (rng) rng.addEventListener('input', () => { num.value = rng.value; calc(); });
}

document.addEventListener('DOMContentLoaded', function () {
  const ids = ['bonusAS', 'baseHaste', 'haste', 'level', 'eCdRaw'];
  for (const id of ids) bindInput(id);

  for (const id of ids) {
    const num = document.getElementById(id);
    if (num) {
      num.addEventListener('blur', function () {
        clampNumber(id, parseFloat(num.min), parseFloat(num.max), parseFloat(num.defaultValue));
        calc();
      });
      num.addEventListener('focus', function () { this.select(); });
    }
  }

  document.getElementById('mode').addEventListener('change', calc);
  document.getElementById('presetSelect').addEventListener('change', function () { applyPreset(this.value); });
  document.getElementById('presetSelect').addEventListener('click', function () { applyPreset(this.value); });
  document.getElementById('applyHasteBtn').addEventListener('click', applyExtraHaste);

  calc();
});