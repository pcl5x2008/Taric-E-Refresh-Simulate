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

  // md 规定：标准 0，纳沃利 0.15
  const coeff = getModeCoeff();

  // md 基础参数中 E_CD_raw = 12。
  // 这里保留输入框灵活性，但默认/预设会强制到 12。
  // 若要完全锁死，可删除下面读取逻辑，直接 const E_CD_raw = 12;
  let E_CD_raw = 12;
  const eCdEl = document.getElementById('eCdRaw');
  if (eCdEl) {
    const v = parseFloat(eCdEl.value);
    if (!isNaN(v)) E_CD_raw = v;
  }
  if (E_CD_raw < 12) E_CD_raw = 12;
  if (E_CD_raw > 16) E_CD_raw = 16;

  // 9级自然成长攻速成长
  const growAS =
    Level === 1
      ? 0
      : (GROW_AS_LV18 / 17) *
        (Level - 1) *
        (0.7025 + 0.0175 * (Level - 1));

  // 面板属性与普攻耗时计算
  const TotalAS = Math.min((BaseAS + (bonusAS + growAS) * ASRatio) * 2, 3.003);
  const AttackTime = 1 / TotalAS;

  const BaseWindup = WindupPct / BaseAS;
  const CurrentWindup =
    BaseWindup + WindupMod * (AttackTime * WindupPct - BaseWindup);
  const CurrentBackswing = AttackTime - CurrentWindup;

  // 技能急速与被动减 CD
  const TotalHaste = baseHaste + haste;
  const CDR = TotalHaste / (TotalHaste + 100);

  const Q_CD = Q_CD_raw * (1 - CDR);
  const E_CD = E_CD_raw * (1 - CDR);

  // 被动强化攻击减 CD 量
  const CDPA = 1 + haste / (haste + 100);

  // 连招仿真数组
  const comboTimeArr = [0];
  const CD_initArr = [E_CD];
  const QRemainArr = [Q_CD];
  const QRemainTmpArr = [0];
  const nextAWaitArr = [0];

  const hitRefresh = [];
  const swingRefresh = [];
  const finalTime = [];

  for (let x = 1; x <= MAX_X; x++) {
    // Last_ComboAttack(x)
    const lastCA = x === 1 ? CurrentWindup : AttackTime;

    // QRemain_tmp(x)
    const qPrev = QRemainArr[x - 1];
    const qExtra = extraCdReduce(qPrev, coeff, CurrentWindup);
    const qRemainTmp = Math.max(
      0,
      qPrev - lastCA - qExtra - CDPA
    );

    QRemainTmpArr[x] = qRemainTmp;

    // QRemain(x)
    let qr;
    if (x % 2 === 0) {
      qr = Q_CD;
    } else {
      qr = qRemainTmp;
    }
    QRemainArr[x] = qr;

    // Trigger(x)
    const trigger = x <= 2 ? 0 : 1 - (x % 2);

    // QCdGap(x)
    let qcdGap = 0;
    if (trigger !== 0) {
      qcdGap = qRemainTmp;
    }

    // nextAWait(x)
    const nextAW =
      (1 - (x % 2)) * Math.max(QCastingTime - CurrentBackswing, 0);
    nextAWaitArr[x] = nextAW;

    // comboTime(x)
    const ct = comboTimeArr[x - 1] + lastCA + qcdGap + nextAW;
    comboTimeArr[x] = ct;

    // Last_comboTime(x)
    const lct = ct - comboTimeArr[x - 1];

    // CD_init(x)
    const cdPrev = CD_initArr[x - 1];
    const cdExtra = extraCdReduce(cdPrev, coeff, CurrentWindup);
    const cd = cdPrev - lct - cdExtra - CDPA;
    CD_initArr[x] = cd;

    // 刷新条件
    let hitR = 0;
    let swingR = 0;
    let ft = null;

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

  // 找最早命中刷新 / 后摇刷新
  let firstHitX = null;
  let firstHitTime = null;
  let firstSwingX = null;
  let firstSwingTime = null;

  for (let x = 1; x <= MAX_X; x++) {
    if (hitRefresh[x] === 1 && firstHitX === null) {
      firstHitX = x;
      firstHitTime = finalTime[x];
    }
    if (swingRefresh[x] === 1 && firstSwingX === null) {
      firstSwingX = x;
      firstSwingTime = finalTime[x];
    }
  }

  let refreshX = null;
  let refreshTime = null;
  let isHit = false;

  if (firstHitX !== null && firstSwingX !== null) {
    if (firstHitX <= firstSwingX) {
      refreshX = firstHitX;
      refreshTime = firstHitTime;
      isHit = true;
    } else {
      refreshX = firstSwingX;
      refreshTime = firstSwingTime;
      isHit = false;
    }
  } else if (firstHitX !== null) {
    refreshX = firstHitX;
    refreshTime = firstHitTime;
    isHit = true;
  } else if (firstSwingX !== null) {
    refreshX = firstSwingX;
    refreshTime = firstSwingTime;
    isHit = false;
  }

  /**
   * 用于二分搜索的仿真函数。
   * 返回最早触发刷新的次数与类型。
   */
  function simulate(bAS, h) {
    const totalH = baseHaste + h;
    const cdr = totalH / (totalH + 100);

    const tAS = Math.min((BaseAS + (bAS + growAS) * ASRatio) * 2, 3.003);
    const at = 1 / tAS;

    const bw = WindupPct / BaseAS;
    const cw = bw + WindupMod * (at * WindupPct - bw);
    const cbs = at - cw;

    const qcd = Q_CD_raw * (1 - cdr);
    const ecd = E_CD_raw * (1 - cdr);
    const cdpa = 1 + h / (h + 100);

    let qr = qcd;
    let ct = 0;
    let cd = ecd;

    for (let i = 1; i <= MAX_X; i++) {
      const lca = i === 1 ? cw : at;

      const qPrev = qr;
      const qExtra = extraCdReduce(qPrev, coeff, cw);
      const qTmp = Math.max(0, qPrev - lca - qExtra - cdpa);

      if (i % 2 === 0) {
        qr = qcd;
      } else {
        qr = qTmp;
      }

      const tr = i <= 2 ? 0 : 1 - (i % 2);

      let qg = 0;
      if (tr !== 0) {
        qg = qTmp;
      }

      const nw =
        (1 - (i % 2)) * Math.max(QCastingTime - cbs, 0);

      const prev = ct;
      ct = ct + lca + qg + nw;
      const lct = ct - prev;

      const cdPrev = cd;
      const cdExtra = extraCdReduce(cdPrev, coeff, cw);
      cd = cdPrev - lct - cdExtra - cdpa;

      if (cd <= 0) {
        return { x: i, isHit: true };
      }
      if (cd > 0 && cd <= cbs) {
        return { x: i, isHit: false };
      }
    }

    return null;
  }

  // 额外攻速冗余：在当前刷新次数不变的前提下，还能浪费多少额外攻速
  let redundantAS = null;

  if (refreshX !== null) {
    const maxBonusAS = Math.max(
      0,
      (3.003 / 2 - BaseAS) / ASRatio - growAS
    );

    let lo = bonusAS;
    let hi = Math.max(bonusAS + 0.001, maxBonusAS);
    let mid;

    while (hi - lo > 0.0001) {
      mid = (lo + hi) / 2;
      const r = simulate(mid, haste);

      if (r !== null && r.x === refreshX && r.isHit === isHit) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    // 整数验证：从 hi 向下遍历，找到满足条件的最大整数值
    let verifiedAS = lo;
    for (let h = Math.ceil(hi); h >= Math.floor(lo); h--) {
      const r = simulate(h, haste);
      if (r !== null && r.x === refreshX && r.isHit === isHit) {
        verifiedAS = h;
        break;
      }
    }

    redundantAS = Math.max(
      0,
      Math.min(verifiedAS - bonusAS, maxBonusAS - bonusAS)
    );
  }

  /**
   * 检查指定次数 x 结束时 E 的状态：
   * 1  = 命中立刻刷新
   * 0  = 后摇内刷新
   * null = 未进入刷新条件
   */
  function cdConditionAtX(bAS, h, targetX) {
    const totalH = baseHaste + h;
    const cdr = totalH / (totalH + 100);

    const tAS = Math.min((BaseAS + (bAS + growAS) * ASRatio) * 2, 3.003);
    const at = 1 / tAS;

    const bw = WindupPct / BaseAS;
    const cw = bw + WindupMod * (at * WindupPct - bw);
    const cbs = at - cw;

    const qcd = Q_CD_raw * (1 - cdr);
    const ecd = E_CD_raw * (1 - cdr);
    const cdpa = 1 + h / (h + 100);

    let qr = qcd;
    let ct = 0;
    let cd = ecd;

    for (let i = 1; i <= targetX; i++) {
      const lca = i === 1 ? cw : at;

      const qPrev = qr;
      const qExtra = extraCdReduce(qPrev, coeff, cw);
      const qTmp = Math.max(0, qPrev - lca - qExtra - cdpa);

      if (i % 2 === 0) {
        qr = qcd;
      } else {
        qr = qTmp;
      }

      const tr = i <= 2 ? 0 : 1 - (i % 2);

      let qg = 0;
      if (tr !== 0) {
        qg = qTmp;
      }

      const nw =
        (1 - (i % 2)) * Math.max(QCastingTime - cbs, 0);

      const prev = ct;
      ct = ct + lca + qg + nw;
      const lct = ct - prev;

      const cdPrev = cd;
      const cdExtra = extraCdReduce(cdPrev, coeff, cw);
      cd = cdPrev - lct - cdExtra - cdpa;
    }

    if (cd <= 0) return 1;
    if (cd > 0 && cd <= cbs) return 0;
    return null;
  }

  function prevTierFloorHaste(bAS, h, refreshX, isHit) {
    if (refreshX === null) return null;
    let tX, tIsHit;
    if (isHit) {
      tX = refreshX;
      tIsHit = false;
    } else if (refreshX < 10) {
      tX = refreshX + 1;
      tIsHit = true;
    } else {
      return null;
    }
    let lo = 0, hi = h, mid;
    while (hi - lo > 0.01) {
      mid = (lo + hi) / 2;
      const r = simulate(bAS, mid);
      if (r !== null && (r.x < tX || (r.x === tX && (!tIsHit || r.isHit)))) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    let candidate = Math.floor(hi);
    const target = { x: tX, isHit: tIsHit };
    let r = simulate(bAS, candidate);
    if (r && r.x === target.x && r.isHit === target.isHit) {
      // use candidate
    } else {
      candidate = Math.ceil(hi);
      r = simulate(bAS, candidate);
      if (!r || r.x !== target.x || r.isHit !== target.isHit) {
        return null;
      }
    }
    return Math.max(0, candidate);
  }

  // 计算"少A一次 / 命中刷新"所需额外急速
  let extraHaste = null;

  if (isHit && refreshX !== null && refreshX > 1) {
    const curX = simulate(bonusAS, haste);
    const hiMax = simulate(bonusAS, haste + 500);

    if (
      curX !== null &&
      curX.x <= refreshX &&
      hiMax !== null &&
      hiMax.x < refreshX
    ) {
      let lo = haste;
      let hi = haste + 500;
      let mid;

      while (hi - lo > 0.005) {
        mid = (lo + hi) / 2;
        const r = simulate(bonusAS, mid);

        if (r !== null && r.x < refreshX) {
          hi = mid;
        } else {
          lo = mid;
        }
      }

      // 整数验证：从 lo 向上遍历，找到满足条件的最小整数值
      extraHaste = null;
      for (let h = Math.ceil(lo); h <= Math.ceil(hi) + 2; h++) {
        const r = simulate(bonusAS, h);
        if (r && r.x < refreshX) {
          extraHaste = Math.max(0, h - haste);
          break;
        }
      }
    }
  } else if (!isHit && refreshX !== null) {
    const cMax = cdConditionAtX(bonusAS, haste + 500, refreshX);

    if (cMax === 1) {
      let lo = haste;
      let hi = haste + 500;
      let mid;

      while (hi - lo > 0.005) {
        mid = (lo + hi) / 2;
        const r = cdConditionAtX(bonusAS, mid, refreshX);

        if (r === 1) {
          hi = mid;
        } else {
          lo = mid;
        }
      }

      // 整数验证：从 lo 向上遍历，找到满足条件的最小整数值
      extraHaste = null;
      for (let h = Math.ceil(lo); h <= Math.ceil(hi) + 2; h++) {
        const r = cdConditionAtX(bonusAS, h, refreshX);
        if (r === 1) {
          extraHaste = Math.max(0, h - haste);
          break;
        }
      }
    }
  }

  lastExtraHaste = extraHaste;
  lastPrevTierHaste = prevTierFloorHaste(bonusAS, haste, refreshX, isHit);
  const prevBtn = document.getElementById('prevTierBtn');
  if (prevBtn) {
    prevBtn.disabled = lastPrevTierHaste === null;
    prevBtn.textContent = '上一档:' + (lastPrevTierHaste !== null ? lastPrevTierHaste : 0) + '急速';
  }

  const applyBtn = document.getElementById('applyHasteBtn');
  if (applyBtn) {
    const canApply = extraHaste !== null && extraHaste > 0;
    applyBtn.disabled = !canApply;
    applyBtn.textContent = '下一档:' + (canApply ? (haste + extraHaste) : 0) + '急速';
  }

  // 渲染结果
  let resultHtml = '';

  if (refreshX !== null) {
    const waitTime = Math.max(0, CD_initArr[refreshX]).toFixed(3);

    const cond = isHit ? '命中立刻刷新' : `命中后${waitTime}s刷新`;
    const condCls = isHit ? 'badge-hit' : 'badge-swing';
    const condTextCls = isHit ? 'green-text' : 'gold-text';

    const extraLabel = isHit ? '少A一次还需' : '命中刷新还需';
    const extraVal =
      extraHaste !== null
        ? '+' + extraHaste + ' 急速'
        : isHit
          ? '已无法减少'
          : '无法达成';

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
            <div class="hero-r-value ${
              redundantAS !== null && redundantAS >= 0.1
                ? 'green-text'
                : 'gold-text'
            }">
              ${redundantAS !== null ? (Math.max(0, redundantAS) * 100).toFixed(1) : '-'}%
            </div>
          </div>

          <div class="hero-r-item">
            <div class="hero-r-label">Q 施法超出后摇</div>
            <div class="hero-r-sub ${nextAWaitArr[2] !== 0 ? 'gold-text' : ''}">
              ${nextAWaitArr[2].toFixed(3)}s
            </div>
          </div>

          <div class="hero-r-item">
            <div class="hero-r-label">${extraLabel}</div>
            <div class="hero-r-value ${
              extraHaste !== null && extraHaste > 0
                ? 'green-text'
                : 'red-text'
            }">
              ${extraVal}
            </div>
          </div>

          <div class="hero-r-item">
            <div class="hero-r-label">QCD 在 AA 后剩余</div>
            <div class="hero-r-sub ${QRemainTmpArr[2] !== 0 ? 'gold-text' : ''}">
              ${QRemainTmpArr[2].toFixed(3)}s
            </div>
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
          <div class="value sm">
            ${CurrentWindup.toFixed(3)}s /
            <span class="${CurrentBackswing <= 0.25 ? 'gold-text' : ''}">
              ${CurrentBackswing.toFixed(3)}s
            </span>
          </div>
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
      </div>
    `;
  } else {
    resultHtml += `
      <div class="result-hero">
        <div class="hero-stat">
          <span class="hero-label" style="font-size:20px;color:var(--muted);">
            10 次连招内未触发刷新
          </span>
        </div>
      </div>
    `;
  }

  const resultArea = document.getElementById('resultArea');
  if (resultArea) {
    resultArea.innerHTML = resultHtml;
  }
}

function setInput(id, val) {
  const num = document.getElementById(id);
  if (!num) return;

  const rng = document.getElementById(id + 'Range');

  num.value = val;
  if (rng) rng.value = val;
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
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (window.matchMedia('(max-width: 900px)').matches) {
    resultArea.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest'
    });
  }
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

function bindInput(id) {
  const num = document.getElementById(id);
  const rng = document.getElementById(id + 'Range');

  if (num) {
    num.addEventListener('input', () => {
      if (rng) rng.value = num.value;
      calc();
    });
  }

  if (rng && num) {
    rng.addEventListener('input', () => {
      num.value = rng.value;
      calc();
    });
  }
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
    applyBtn.addEventListener('click', applyExtraHaste);
  }

  const prevBtn = document.getElementById('prevTierBtn');
  if (prevBtn) {
    prevBtn.addEventListener('click', dropToPrevTier);
  }

  // 按 md 文档初始化默认状态：
  // Level = 9
  // E_CD_raw = 12
  // 标准模式 coeff = 0
  setInput('level', 9);
  setInput('eCdRaw', 12);
  setModeCoeff(STANDARD_COEFF);

  calc();
});