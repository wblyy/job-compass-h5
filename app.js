/* ===== 岗位罗盘 H5 Demo · 手机端单手 4 步状态机与交互控制器 ===== */
(function () {
  'use strict';

  const SAMPLE_JDS = {
    good: '岗位：B端产品经理 22-30k 上海徐汇。核心职责：1. 把线下手工业务流程梳理成系统并推动从0到1落地；2. 跨部门权限与工单设计。要求：3年以上B端SaaS产品经验，有复杂流程拆解经验优先。',
    trap: '岗位：互联网产品经理 15-25k（底薪4.5k+高额提成）。核心职责：1. 每日外呼电销80通挖掘企业客户需求；2. 陌拜拓客签单按单提成。不限经验。'
  };

  const state = {
    screen: 'entry',          // 'entry' | 'step1' | 'step2' | 'step3' | 'step4'
    maxUnlockedStep: 0,       // 0..4
    scope: 'top3',            // 'top3' | 'shanghai' | 'all'
    actionableJobs: window.ACTIONABLE_JOBS.map(j => ({ ...j })),
    suppressedJobs: window.SUPPRESSED_JOBS.map(j => ({ ...j })),
    selectedIds: new Set(window.ACTIONABLE_JOBS.filter(j => j.defaultSelected).map(j => j.id)),
    expandedEvidenceIds: new Set(),
    suppressedExpanded: false,
    track: 'flow',            // 'flow' | 'perm'
    confirmedFactId: null,    // null | 'team_3_5' | 'solo_ic' | 'team_6_10'
    prepJobId: 'hx',
    tone: 'direct',           // 'direct' | 'gentle'
    selfSentIds: new Set(),   // Tracks roles user manually sent on BOSS (never auto-sent)
    pubFollowed: false,
    pubInitialized: false,
    digestPref: null
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2100);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {
      // Fallback for restricted WebView contexts
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    return true;
  }

  function enforceZeroSendGuard() {
    const sendEl = $('#sendCount');
    if (sendEl && sendEl.textContent !== '0') sendEl.textContent = '0';
    const lgZero = $('#lgZero');
    if (lgZero && lgZero.textContent !== '0') lgZero.textContent = '0';
  }

  function getTotalJobsCount() {
    return state.actionableJobs.length + state.suppressedJobs.length;
  }

  function getSelectedJobs() {
    const list = state.actionableJobs.filter(j => state.selectedIds.has(j.id));
    return list.length ? list : [state.actionableJobs[0]];
  }

  function getVisibleActionableJobs() {
    const base = state.scope === 'shanghai'
      ? state.actionableJobs.filter(j => j.meta.includes('上海') || j.company.includes('刚粘贴'))
      : state.actionableJobs;
    return [...base].sort((a, b) => b.score - a.score);
  }

  /* ---------- 导航与底部主按钮联动 ---------- */
  function goScreen(target) {
    state.screen = target;
    const stepIdx = target === 'entry' ? 0 : Number(target.replace('step', ''));
    if (stepIdx > state.maxUnlockedStep) {
      state.maxUnlockedStep = stepIdx;
    }

    $$('[data-screen]').forEach(sec => {
      sec.hidden = sec.dataset.screen !== target;
    });

    const bottomBar = $('#bottomBar');
    if (bottomBar) {
      bottomBar.hidden = target === 'step4';
    }

    $$('[data-step-nav]').forEach(btn => {
      const n = Number(btn.dataset.stepNav);
      btn.disabled = n > state.maxUnlockedStep;
      btn.classList.toggle('unlocked', n <= state.maxUnlockedStep && n !== stepIdx);
      btn.classList.toggle('active', n === stepIdx);
    });

    if (target === 'entry') renderEntryCounts();
    if (target === 'step1') renderStep1();
    if (target === 'step2') renderStep2();
    if (target === 'step3') renderStep3();
    if (target === 'step4') renderStep4();

    updatePrimaryCta();
    enforceZeroSendGuard();
    const appEl = $('#app');
    if (appEl) appEl.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function updatePrimaryCta() {
    const main = $('#primaryMain');
    const sub = $('#primarySub');
    const total = getTotalJobsCount();
    const selCount = getSelectedJobs().length;

    if (state.screen === 'entry') {
      main.textContent = `开始筛岗判断（${total} 个岗）`;
      sub.textContent = '免费分析 · 95 分封顶只排先后 · 不碰你求职账号';
    } else if (state.screen === 'step1') {
      main.textContent = `锁定这 ${selCount} 个目标岗 → 改方向版简历`;
      sub.textContent = `已替你拦下 ${state.suppressedJobs.length} 个挂羊头与硬伤岗`;
    } else if (state.screen === 'step2') {
      const trackLabel = state.track === 'flow' ? '0→1 流程线上化' : '跨部门权限与中台合并';
      main.textContent = `带这份简历 → 生成 ${selCount} 岗首句与追问卡`;
      sub.textContent = `当前主线：${trackLabel} · 原稿事实 0 编造`;
    } else if (state.screen === 'step3') {
      main.textContent = '收好今日弹药包 → 带走去 BOSS 投递';
      sub.textContent = '首句复制即用 · 4 段式缺口应答已就绪';
    } else if (state.screen === 'step4') {
      main.textContent = state.pubFollowed ? '打开微信服务号 · 继续练追问 / 看简历' : '发送到微信服务号 · 领简历 PDF 与练追问';
      sub.textContent = '也可点上方清单直接复制首句回 BOSS 沟通';
    }
  }

  /* ---------- Step 0: 首屏统计 ---------- */
  function renderEntryCounts() {
    const total = getTotalJobsCount();
    $('#poolSummaryText').textContent = `刚从 BOSS 收藏的 ${total} 个在招岗`;
  }

  /* ---------- Step 1: 筛岗判断渲染 ---------- */
  function renderStep1() {
    const total = getTotalJobsCount();
    const supCount = state.suppressedJobs.length;
    $('#totalScannedNum').textContent = String(total);
    $('#suppressedCountNum').textContent = String(supCount);
    $('#supBtnCount').textContent = String(supCount);

    $$('#scopeSeg .seg').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.scope === state.scope);
    });

    const visibleJobs = getVisibleActionableJobs();
    const tierList = $('#tierList');
    tierList.innerHTML = visibleJobs.map(job => {
      const isSelected = state.selectedIds.has(job.id);
      const isExpanded = state.expandedEvidenceIds.has(job.id);
      const barPct = Math.round((Math.min(95, job.score) / 95) * 100);
      return `
        <article class="job-card ${isSelected ? 'selected' : ''}" data-job-id="${escapeHtml(job.id)}" data-score="${job.score}" data-tier="${escapeHtml(job.tier)}">
          <div class="jc-top" data-toggle-select="${escapeHtml(job.id)}">
            <div class="jc-check-wrap">
              <span class="jc-check" aria-hidden="true">✓</span>
              <div class="jc-main">
                <div class="jc-badges">
                  <span class="tier-pill ${escapeHtml(job.tier)}">${escapeHtml(job.tierLabel)}</span>
                  <span class="rule-pill">${escapeHtml(job.ruleTag)}</span>
                </div>
                <div class="jc-title">${escapeHtml(job.company)} · ${escapeHtml(job.title)}</div>
                <div class="jc-meta">${escapeHtml(job.salary)} · ${escapeHtml(job.meta)}</div>
              </div>
            </div>
            <div class="score-ruler" title="纸面封顶 95 分">
              <div class="sr-num">${job.score}<small>/95</small></div>
              <div class="sr-bar"><i style="width:${barPct}%"></i></div>
            </div>
          </div>
          <p class="jc-summary">${escapeHtml(job.summary)}</p>
          <div class="jc-foot">
            <span class="jc-quote">${escapeHtml(job.matchedQuote)}</span>
            <button class="expand-evidence" type="button" data-expand-ev="${escapeHtml(job.id)}">
              ${isExpanded ? '收起依据' : '四维依据 ›'}
            </button>
          </div>
          <div class="jc-evidence" ${isExpanded ? '' : 'hidden'}>
            ${job.dims.map(d => `
              <div class="dim-row">
                <span class="dim-k">${escapeHtml(d.name)}</span>
                <span class="dim-v">${d.val}</span>
                <span class="dim-n">${escapeHtml(d.note)}</span>
              </div>
            `).join('')}
          </div>
        </article>
      `;
    }).join('');

    const supList = $('#suppressedList');
    supList.hidden = !state.suppressedExpanded;
    $('#toggleSuppressed').setAttribute('aria-expanded', String(state.suppressedExpanded));
    $('#supChevron').textContent = state.suppressedExpanded ? '收起列表 ‹' : '展开核查 ›';
    supList.innerHTML = state.suppressedJobs.map(s => `
      <div class="sup-item">
        <div class="si-top">
          <b>${escapeHtml(s.company)}</b>
          <span class="si-score">${s.score} / 95</span>
        </div>
        <div class="si-rule">${escapeHtml(s.capRule)} · ${escapeHtml(s.salary)}</div>
        <div class="si-reason">${escapeHtml(s.reason)}</div>
      </div>
    `).join('');
  }

  /* ---------- Step 2: 方向版简历与事实锁 ---------- */
  function getConfirmedOption() {
    if (!state.confirmedFactId) return null;
    return window.SEEKER_PROFILE.pendingFact.options.find(o => o.id === state.confirmedFactId) || null;
  }

  function renderStep2() {
    const trackObj = window.RESUME_TRACKS[state.track];
    $$('.track-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.track === state.track);
    });

    $('#factLockItems').innerHTML = window.SEEKER_PROFILE.lockedFacts.map(f => `
      <div class="fl-item"><span>${escapeHtml(f.label)}：</span><b>${escapeHtml(f.value)}</b></div>
    `).join('');

    $('#beforeLines').innerHTML = trackObj.beforeLines.map(l => `<li>${escapeHtml(l)}</li>`).join('');
    $('#afterFitTag').textContent = trackObj.fitFor;
    $('#afterHeadline').textContent = trackObj.afterHeadline;

    const confirmedOpt = getConfirmedOption();
    const lines = [...trackObj.afterLines];
    if (confirmedOpt) {
      lines.push(`【本人已确认补充】${confirmedOpt.resumeLine}`);
    }
    $('#afterLines').innerHTML = lines.map(l => `<li>${escapeHtml(l)}</li>`).join('');

    const pf = window.SEEKER_PROFILE.pendingFact;
    $('#pfQuestion').textContent = pf.question;
    $('#pfHint').textContent = pf.hint;
    $('#pfOpts').innerHTML = pf.options.map(opt => `
      <button class="pf-opt ${state.confirmedFactId === opt.id ? 'active' : ''}" type="button" data-fact-opt="${escapeHtml(opt.id)}">
        ${escapeHtml(opt.label)}
      </button>
    `).join('');

    const fb = $('#pfFeedback');
    if (confirmedOpt) {
      fb.hidden = false;
      fb.textContent = `✓ ${confirmedOpt.replyNote}`;
    } else {
      fb.hidden = true;
    }
  }

  /* ---------- Step 3: 首句招呼语与 P8 缺口对冲 ---------- */
  function renderStep3() {
    const selected = getSelectedJobs();
    if (!selected.some(j => j.id === state.prepJobId)) {
      state.prepJobId = selected[0].id;
    }
    const job = selected.find(j => j.id === state.prepJobId) || selected[0];

    $('#prepJobTabs').innerHTML = selected.map(j => `
      <button class="js-pill ${j.id === job.id ? 'active' : ''}" type="button" data-prep-job="${escapeHtml(j.id)}">
        ${escapeHtml(j.company)}<b>${j.score}</b>
      </button>
    `).join('');

    $('#prepJobHeading').textContent = `${job.company} · ${job.title}`;
    $('#prepScorePill').textContent = `${job.score} / 95`;

    $$('.tone-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tone === state.tone);
    });

    $('#outreachText').textContent = job.outreach[state.tone];
    $('#outreachWhy').textContent = `为什么这么写：${job.hookWhy}`;

    const copyBtn = $('#copyOutreachBtn');
    copyBtn.classList.remove('copied');
    copyBtn.textContent = '复制首句 · 去 BOSS 粘贴发送';

    $('#gapStepsList').innerHTML = job.gapBridge.map(g => `
      <div class="gap-step">
        <span class="gs-tag">${escapeHtml(g.step)}</span>
        <span class="gs-txt">${escapeHtml(g.text)}</span>
      </div>
    `).join('');

    $('#followUpList').innerHTML = job.followUps.map(f => `
      <div class="fq-item">
        <div class="fq-q">${escapeHtml(f.q)}</div>
        <div class="fq-a">${escapeHtml(f.a)}</div>
      </div>
    `).join('');
  }

  /* ---------- Step 4: 今日出击台账 ---------- */
  function renderStep4() {
    const selected = getSelectedJobs();
    $('#lgTotal').textContent = String(getTotalJobsCount());
    $('#lgCut').textContent = String(state.suppressedJobs.length);
    $('#lgReady').textContent = String(selected.length);
    enforceZeroSendGuard();

    $('#finalJobRows').innerHTML = selected.map(j => {
      const done = state.selfSentIds.has(j.id);
      return `
        <div class="final-row">
          <div class="fr-left">
            <b>${escapeHtml(j.company)} · ${escapeHtml(j.title)}（${j.score}/95）</b>
            <span>${escapeHtml(j.salary)} · ${escapeHtml(j.ruleTag)}</span>
          </div>
          <div class="fr-btns">
            <button class="fr-copy" type="button" data-final-copy="${escapeHtml(j.id)}">复制首句</button>
            <button class="fr-mark ${done ? 'done' : ''}" type="button" data-final-mark="${escapeHtml(j.id)}">
              ${done ? '✓ 已自投' : '记已投'}
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  /* ---------- 方向版完整简历生成与渲染 ---------- */
  function buildResumeData() {
    const trackObj = window.RESUME_TRACKS[state.track];
    const confirmedOpt = getConfirmedOption();
    const extraBullet = confirmedOpt
      ? confirmedOpt.resumeLine
      : '协作规模：待本人最终确认后写入（当前绝不默认虚构管理人数）。';

    const markdown = [
      `# ${window.SEEKER_PROFILE.name}｜${window.SEEKER_PROFILE.role}（${window.SEEKER_PROFILE.tenureYears}年 · ${window.SEEKER_PROFILE.city}）`,
      `> ${trackObj.afterHeadline}`,
      '',
      '## 核心工作经历（公司 / 时间 / 量化数字与原稿 100% 锁死）',
      ...trackObj.afterLines.map(l => `- ${l}`),
      `- ${extraBullet}`,
      '',
      '## 原稿事实核验说明',
      '- 星云企服（2024.04–2026.10）、知行教研（2022.03–2024.03）两段履历起止月份零改动',
      '- 31 个工单节点、交付周期 14→6 天、7 个部门权限重构、3 套流程合一均来自原稿实绩'
    ].join('\n');

    return { trackObj, extraBullet, markdown };
  }

  function openResumeModal() {
    const { trackObj, extraBullet } = buildResumeData();
    $('#modalResumeTitle').textContent = `陈默 · 方向版简历（${trackObj.tab.split('·')[1].trim()}）`;
    $('#resumePaperContent').innerHTML = `
      <h4>陈默 · B端 / SaaS 产品经理（4年 · 上海）</h4>
      <div class="rp-sub">${escapeHtml(trackObj.afterHeadline)}</div>
      <div class="rp-sec">
        <b>核心经历（${escapeHtml(trackObj.fitFor)}）</b>
        <p style="margin-top:4px">${trackObj.afterLines.map(l => escapeHtml(l)).join('<br>')}</p>
        <p style="margin-top:4px;color:#0E8A62">${escapeHtml(extraBullet)}</p>
      </div>
      <div class="rp-sec">
        <b>事实核验锁（0 编造）</b>
        <p style="margin-top:3px">星云企服（2024.04–2026.10）· 知行教研（2022.03–2024.03）｜原稿数字：31 个节点 / 14→6 天 / 7 部门 / 3 套合一</p>
      </div>
    `;
    $('#resumeModal').hidden = false;
  }

  /* ---------- 微信服务号会话流 ---------- */
  function appendPubBubble(role, html) {
    const chat = $('#pubChat');
    if (role === 'sys') {
      const div = document.createElement('div');
      div.className = 'pub-sys';
      div.textContent = html;
      chat.appendChild(div);
    } else {
      const row = document.createElement('div');
      row.className = `pub-row ${role === 'me' ? 'me' : 'bot'}`;
      row.innerHTML = `
        <div class="pub-avatar">${role === 'me' ? '默' : '北'}</div>
        <div class="pub-bubble">${html}</div>
      `;
      chat.appendChild(row);
    }
    chat.scrollTop = chat.scrollHeight;
  }

  function openPubView() {
    state.pubFollowed = true;
    $('#qrSheet').hidden = true;
    $('#pubView').hidden = false;
    $('#pubTopBtn').hidden = false;
    updatePrimaryCta();

    if (!state.pubInitialized) {
      state.pubInitialized = true;
      const selCount = getSelectedJobs().length;
      const trackName = state.track === 'flow' ? '0→1流程线上化版' : '跨部门权限中台版';
      appendPubBubble('sys', '已关注「岗位罗盘」服务号 · 档案已同步');
      appendPubBubble('bot', `
        <b>你的方向版简历与 ${selCount} 岗追问卡已备好：</b>
        <div class="pub-file-card" data-open-resume-from-pub="1">
          <div>
            <b>陈默_${escapeHtml(trackName)}.pdf</b>
            <span>✓ 原稿事实核验通过 · 点此查阅全文</span>
          </div>
          <span class="pub-file-tag">PDF</span>
        </div>
      `);
      appendPubBubble('bot', `
        <b>【1 对 1 真人追问演练 · 第 1/2 题】</b><br>
        针对你刚选的冲刺岗 <b>青藤医疗（61/95 · 硬缺口岗）</b>，HR 必问：<br>
        <span style="color:#0A5396">「你过去 4 年都在企服和教研，没摸过医院 HIS，凭什么接得住跨科室流程？」</span><br>
        <small style="color:#5A6679">请直接在下方输入你的原话（或点快捷草稿），我按面试官视角逐句给你挑刺。</small>
      `);
    }
  }

  function submitPubMockAnswer() {
    const input = $('#pubMockInput');
    const ans = input.value.trim();
    if (!ans) {
      showToast('请先输入一句你的回答');
      return;
    }
    input.value = '';
    appendPubBubble('me', escapeHtml(ans));

    const rev = window.evaluateMockAnswer(ans);
    appendPubBubble('bot', `
      <b>【逐句点评 · ${escapeHtml(rev.verdict)}】</b><br>
      <span style="color:#5A6679;font-size:12px">${escapeHtml(rev.quoted)}</span><br>
      <div style="margin-top:5px"><b>稳住的点：</b>${escapeHtml(rev.strengths.join('；'))}</div>
      <div style="margin-top:3px"><b>可补强的点：</b>${escapeHtml(rev.gaps.join('；'))}</div>
      <div style="margin-top:6px;padding:7px 8px;background:#F4F6F9;border-radius:6px;font-size:12px">${escapeHtml(rev.upgrade)}</div>
    `);

    if (!state.digestPref) {
      appendPubBubble('bot', `
        <b>顺手定个规矩：明早 8:30 怎么帮你盯 BOSS 新岗？</b>
        <div class="pub-digest-opts">
          <button class="pub-digest-btn" type="button" data-digest-opt="strict80">只推上海同城 >=80 分新岗（不打扰）</button>
          <button class="pub-digest-btn" type="button" data-digest-opt="include60">同城 >=80 分 + 稀缺强项拉回岗一并看</button>
          <button class="pub-digest-btn" type="button" data-digest-opt="pause">先不推送，等我投完今天这批再说</button>
        </div>
      `);
    }
  }

  /* ---------- 全局事件绑定 ---------- */
  function bindEvents() {
    // 顶栏返回首页 & 服务号胶囊
    $('#brandHome').addEventListener('click', () => goScreen('entry'));
    $('#pubTopBtn').addEventListener('click', () => openPubView());

    // 四步进度轨切换
    $('#stepRail').addEventListener('click', e => {
      const btn = e.target.closest('[data-step-nav]');
      if (!btn || btn.disabled) return;
      goScreen(`step${btn.dataset.stepNav}`);
    });

    // 底部主动作按钮
    $('#primaryBtn').addEventListener('click', () => {
      if (state.screen === 'entry') goScreen('step1');
      else if (state.screen === 'step1') goScreen('step2');
      else if (state.screen === 'step2') goScreen('step3');
      else if (state.screen === 'step3') goScreen('step4');
      else if (state.screen === 'step4') {
        if (state.pubFollowed) openPubView();
        else $('#qrSheet').hidden = false;
      }
    });

    // 粘贴 BOSS JD 抽屉
    $('#openPasteBtn').addEventListener('click', () => {
      $('#pasteSheet').hidden = false;
      $('#pasteInput').focus();
    });
    $$('[data-close-paste]').forEach(el => {
      el.addEventListener('click', () => { $('#pasteSheet').hidden = true; });
    });
    $$('[data-fill-sample]').forEach(btn => {
      btn.addEventListener('click', () => {
        $('#pasteInput').value = SAMPLE_JDS[btn.dataset.fillSample] || '';
      });
    });
    $('#runPasteBtn').addEventListener('click', () => {
      const raw = $('#pasteInput').value.trim();
      const res = window.scoreBossJd(raw);
      if (!res) {
        showToast('请先粘贴一段岗位描述');
        return;
      }
      const badge = $('#customAddedBadge');
      badge.hidden = false;
      badge.dataset.score = String(res.score);

      if (res.isSuppressed) {
        state.suppressedJobs.unshift({
          id: res.id,
          company: `${res.company} · ${res.title}`,
          salary: res.salary,
          score: res.score,
          capRule: res.ruleTag,
          reason: res.reason
        });
        badge.classList.add('warn');
        badge.textContent = `已识别坑岗：${res.title} · 压制至 ${res.score}/95（${res.ruleTag}）`;
        showToast(`触发压制规则：${res.score}/95，已归入拦截池`);
      } else {
        state.actionableJobs.unshift(res);
        state.selectedIds.add(res.id);
        state.prepJobId = res.id;
        badge.classList.remove('warn');
        badge.textContent = `已加入高优池：${res.title} · 评分 ${res.score}/95（${res.tierLabel}）`;
        showToast(`算分完成：${res.score}/95，已排入第一屏`);
      }
      $('#pasteSheet').hidden = true;
      renderEntryCounts();
      updatePrimaryCta();
    });

    // Step 1: 关键拍板 1（范围切换）+ 卡片勾选/展开 + 被压制列表展开
    $('#scopeSeg').addEventListener('click', e => {
      const btn = e.target.closest('[data-scope]');
      if (!btn) return;
      const sc = btn.dataset.scope;
      state.scope = sc;
      if (sc === 'top3') {
        const topIds = state.actionableJobs.slice(0, 3).map(j => j.id);
        // Ensure QingTeng (qt) stays included if in top actionable stretch demo
        state.selectedIds = new Set(topIds);
      } else if (sc === 'shanghai') {
        const shIds = state.actionableJobs
          .filter(j => j.meta.includes('上海') || j.company.includes('刚粘贴'))
          .map(j => j.id);
        state.selectedIds = new Set(shIds);
      } else {
        state.selectedIds = new Set(state.actionableJobs.map(j => j.id));
      }
      renderStep1();
      updatePrimaryCta();
    });

    $('#tierList').addEventListener('click', e => {
      const evBtn = e.target.closest('[data-expand-ev]');
      if (evBtn) {
        const id = evBtn.dataset.expandEv;
        if (state.expandedEvidenceIds.has(id)) state.expandedEvidenceIds.delete(id);
        else state.expandedEvidenceIds.add(id);
        renderStep1();
        return;
      }
      const selArea = e.target.closest('[data-toggle-select]');
      if (selArea) {
        const id = selArea.dataset.toggleSelect;
        if (state.selectedIds.has(id)) {
          if (state.selectedIds.size <= 1) {
            showToast('至少保留 1 个今日目标岗');
            return;
          }
          state.selectedIds.delete(id);
        } else {
          state.selectedIds.add(id);
        }
        renderStep1();
        updatePrimaryCta();
      }
    });

    $('#toggleSuppressed').addEventListener('click', () => {
      state.suppressedExpanded = !state.suppressedExpanded;
      renderStep1();
    });

    // Step 2: 方向切换 + 待确认事实 + 查看完整简历
    $$('.track-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.track = btn.dataset.track;
        renderStep2();
        updatePrimaryCta();
      });
    });

    $('#pfOpts').addEventListener('click', e => {
      const optBtn = e.target.closest('[data-fact-opt]');
      if (!optBtn) return;
      state.confirmedFactId = optBtn.dataset.factOpt;
      renderStep2();
      showToast('已按本人确认事实写入简历');
    });

    $('#inlineResumeBtn').addEventListener('click', () => openResumeModal());

    // Step 3: 岗位切换 + 语气切换 + 复制首句
    $('#prepJobTabs').addEventListener('click', e => {
      const btn = e.target.closest('[data-prep-job]');
      if (!btn) return;
      state.prepJobId = btn.dataset.prepJob;
      renderStep3();
    });

    $$('.tone-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.tone = btn.dataset.tone;
        renderStep3();
      });
    });

    $('#copyOutreachBtn').addEventListener('click', async () => {
      const txt = $('#outreachText').textContent || '';
      await copyText(txt);
      const btn = $('#copyOutreachBtn');
      btn.classList.add('copied');
      btn.textContent = '✓ 已复制首句 · 请切回 BOSS 粘贴发送（代按发送 0）';
      enforceZeroSendGuard();
      showToast('首句已复制，去 BOSS 聊天框直接粘贴');
    });

    // Step 4: 台账操作 + 二维码弹层 + 网页直看兜底
    $('#finalJobRows').addEventListener('click', async e => {
      const cp = e.target.closest('[data-final-copy]');
      if (cp) {
        const job = state.actionableJobs.find(j => j.id === cp.dataset.finalCopy);
        if (job) {
          await copyText(job.outreach[state.tone]);
          enforceZeroSendGuard();
          showToast(`已复制「${job.company}」定制首句`);
        }
        return;
      }
      const mk = e.target.closest('[data-final-mark]');
      if (mk) {
        const id = mk.dataset.finalMark;
        if (state.selfSentIds.has(id)) state.selfSentIds.delete(id);
        else state.selfSentIds.add(id);
        enforceZeroSendGuard();
        renderStep4();
      }
    });

    $('#openQrBtn').addEventListener('click', () => {
      if (state.pubFollowed) openPubView();
      else $('#qrSheet').hidden = false;
    });
    $$('[data-close-qr]').forEach(el => {
      el.addEventListener('click', () => { $('#qrSheet').hidden = true; });
    });
    $('#qrFollowBtn').addEventListener('click', () => openPubView());
    $('#qrSkipBtn').addEventListener('click', () => {
      $('#qrSheet').hidden = true;
      openResumeModal();
    });
    $('#directWebPreviewBtn').addEventListener('click', () => openResumeModal());

    // 服务号内事件
    $('#pubBackBtn').addEventListener('click', () => {
      $('#pubView').hidden = true;
      enforceZeroSendGuard();
    });
    $('#pubOpenResumeBtn').addEventListener('click', () => openResumeModal());
    $('#pubChat').addEventListener('click', e => {
      if (e.target.closest('[data-open-resume-from-pub]')) {
        openResumeModal();
        return;
      }
      const digBtn = e.target.closest('[data-digest-opt]');
      if (digBtn) {
        state.digestPref = digBtn.dataset.digestOpt;
        $$('.pub-digest-btn', $('#pubChat')).forEach(b => {
          b.classList.toggle('picked', b === digBtn);
        });
        const labelMap = {
          strict80: '已设定：明早 8:30 只推上海同城 >=80 分新岗，低于标准绝不打扰。',
          include60: '已设定：明早 8:30 推送 >=80 分主线岗与稀缺强项拉回岗。',
          pause: '已设定：本周暂停新岗推送，祝今天这几家沟通顺利。'
        };
        $('#pubBadge').textContent = '✓';
        appendPubBubble('sys', labelMap[state.digestPref] || '偏好已保存');
      }
    });

    $('#pubQuickDrafts').addEventListener('click', e => {
      const qBtn = e.target.closest('[data-quick-ans]');
      if (!qBtn) return;
      if (qBtn.dataset.quickAns === 'honest') {
        $('#pubMockInput').value = '医疗系统我确实没直接做过，但我上一段把7个部门31个线下节点做成工单系统，交付周期从14天压到6天，多角色审批流相通。请问你们目前更卡临床规则还是流程收口？';
      } else {
        $('#pubMockInput').value = '虽然我没做过医疗行业，但我学习能力很强、抗压能力好，相信进公司后很快能熟悉业务。';
      }
      $('#pubMockInput').focus();
    });

    $('#pubSendBtn').addEventListener('click', () => submitPubMockAnswer());
    $('#pubMockInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitPubMockAnswer();
      }
    });

    // 网页简历模态框事件
    $$('[data-close-modal]').forEach(el => {
      el.addEventListener('click', () => { $('#resumeModal').hidden = true; });
    });
    $('#webMockRunBtn').addEventListener('click', () => {
      const ans = $('#webMockInput').value.trim();
      const rev = window.evaluateMockAnswer(ans);
      const box = $('#webMockReview');
      box.hidden = false;
      box.innerHTML = `
        <b>点评结论：${escapeHtml(rev.verdict)}</b><br>
        <span>稳住：${escapeHtml(rev.strengths.join('；'))}</span><br>
        <span>待补：${escapeHtml(rev.gaps.join('；'))}</span><br>
        <div style="margin-top:4px;color:#0A5396">${escapeHtml(rev.upgrade)}</div>
      `;
    });
    $('#copyFullResumeBtn').addEventListener('click', async () => {
      const { markdown } = buildResumeData();
      await copyText(markdown);
      showToast('方向版简历全文（Markdown）已复制');
    });
  }

  // Note: Ensure pasting a custom JD keeps QingTeng ('qt') in default selected set so stretch role prep is immediately reachable
  const origDefaultIds = new Set(window.ACTIONABLE_JOBS.filter(j => j.defaultSelected).map(j => j.id));
  state.selectedIds = origDefaultIds;

  // Sync visualViewport height on mobile keyboards so chat composer never gets covered
  if (window.visualViewport) {
    const syncViewport = () => {
      document.documentElement.style.setProperty('--vvh', `${Math.round(window.visualViewport.height)}px`);
      const chat = $('#pubChat');
      if (chat && !$('#pubView').hidden) {
        chat.scrollTop = chat.scrollHeight;
      }
    };
    window.visualViewport.addEventListener('resize', syncViewport);
    syncViewport();
  }

  bindEvents();
  renderEntryCounts();
  updatePrimaryCta();
  enforceZeroSendGuard();
})();
