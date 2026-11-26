export const UI_SCRIPT: string = `
    // ==================== [CONFIG] ====================
    var EMOJI_MAP = {
      idle: '🐱',
      happy: '😸',
      thinking: '🤔',
      sleepy: '😪',
      caring: '🥰'
    };

    var chatEl = document.getElementById('chat');
    var inputEl = document.getElementById('input');
    var sendBtn = document.getElementById('sendBtn');
    var petEmojiEl = document.getElementById('petEmoji');
    var petStatsEl = document.getElementById('petStats');
    var petAffectionValEl = document.getElementById('petAffectionVal');
    var petAffectionFillEl = document.getElementById('petAffectionFill');
    var petEnergyValEl = document.getElementById('petEnergyVal');
    var petEnergyFillEl = document.getElementById('petEnergyFill');
    var petActivityBadgeEl = document.getElementById('petActivityBadge');
    var petActivityTextEl = document.getElementById('petActivityText');
    var petBoredomChipEl = document.getElementById('petBoredomChip');
    var petBoredomTextEl = document.getElementById('petBoredomText');
    var petBoredomFillEl = document.getElementById('petBoredomFill');
    var petStatusNoteEl = document.getElementById('petStatusNote');
    var quickPatBtnEl = document.getElementById('quickPatBtn');
    var quickFeedBtnEl = document.getElementById('quickFeedBtn');
    var quickSleepBtnEl = document.getElementById('quickSleepBtn');
    var quickRefreshBtnEl = document.getElementById('quickRefreshBtn');
    var petStageEl = document.getElementById('petStage');
    var modalEl = document.getElementById('settingsModal');
    var tokenInput = document.getElementById('tokenInput');
    var uidInput = document.getElementById('uidInput');
    var lastUserActivityAt = Date.now();

    function markUserActivity() {
      lastUserActivityAt = Date.now();
    }

    function detectPlatform() {
      var ua = navigator.userAgent || '';
      if (/Mac/i.test(ua) && !/Android/i.test(ua)) return 'macos';
      if (/Windows/i.test(ua)) return 'windows';
      return 'android';
    }

    function isMobileTouchDevice() {
      var ua = navigator.userAgent || '';
      return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    }

    function getConfig() {
      return {
        token: localStorage.getItem('pet_bff_token') || '',
        uid: localStorage.getItem('pet_user_id') || 'zero_main'
      };
    }

    function loadLocalLog() {
      try {
        return JSON.parse(localStorage.getItem('pet_ui_log') || '[]');
      } catch (e) {
        return [];
      }
    }

    function saveLocalLog(list) {
      localStorage.setItem('pet_ui_log', JSON.stringify(list.slice(-30)));
    }

    // ==================== [UI_RENDER] ====================
    var VALID_MOODS = ['idle', 'happy', 'thinking', 'sleepy', 'caring'];

    function normalizeMood(mood) {
      var m = String(mood || '').toLowerCase();
      return VALID_MOODS.indexOf(m) >= 0 ? m : 'idle';
    }

    function setPetMood(mood) {
      var m = normalizeMood(mood);
      if (!petEmojiEl) return;
      petEmojiEl.textContent = EMOJI_MAP[m] || '🐱';
      VALID_MOODS.forEach(function (k) {
        petEmojiEl.classList.remove('mood-' + k);
      });
      petEmojiEl.classList.add('mood-' + m);
    }

    function triggerAvatarBounce() {
      if (!petEmojiEl) return;
      petEmojiEl.classList.add('bounce');
      setTimeout(function () {
        petEmojiEl.classList.remove('bounce');
      }, 520);
    }

    function triggerQuickAvatarReaction(tempEmoji) {
      if (!petEmojiEl) return;
      if (tempEmoji) {
        petEmojiEl.textContent = tempEmoji;
      }
      petEmojiEl.classList.remove('quick-react');
      void petEmojiEl.offsetWidth;
      petEmojiEl.classList.add('quick-react');
      setTimeout(function () {
        petEmojiEl.classList.remove('quick-react');
      }, 560);
    }

    function getHongKongHour() {
      try {
        var hourStr = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Hong_Kong',
          hour: '2-digit',
          hour12: false
        }).format(new Date());
        var parsed = parseInt(hourStr, 10);
        if (!isNaN(parsed)) return parsed % 24;
      } catch (e) {}
      return (new Date().getUTCHours() + 8) % 24;
    }

    function applyTimeBasedTheme() {
      var hkHour = getHongKongHour();
      document.body.classList.remove('theme-day', 'theme-dusk', 'theme-night');
      if (hkHour >= 7 && hkHour < 18) {
        document.body.classList.add('theme-day');
      } else if (hkHour >= 18 && hkHour < 23) {
        document.body.classList.add('theme-dusk');
      } else {
        document.body.classList.add('theme-night');
      }
    }

    function formatTime(ts) {
      if (!ts) return '';
      if (typeof ts === 'string' && ts.length === 5 && ts.charAt(2) === ':') {
        return ts;
      }
      var d = new Date(ts);
      if (isNaN(d.getTime())) return '';
      var hh = String(d.getHours()).padStart(2, '0');
      var mm = String(d.getMinutes()).padStart(2, '0');
      return hh + ':' + mm;
    }

    function renderMessage(role, text, metaText, timestamp) {
      var wrap = document.createElement('div');
      wrap.className = 'msg ' + role;
      var bubble = document.createElement('div');
      bubble.className = 'bubble';

      var textEl = document.createElement('div');
      textEl.className = 'bubble-text';
      textEl.textContent = text;
      bubble.appendChild(textEl);

      var timeStr = formatTime(timestamp);
      if (timeStr) {
        bubble.classList.add('has-time');
        var timeEl = document.createElement('div');
        timeEl.className = 'bubble-time';
        timeEl.textContent = timeStr;
        bubble.appendChild(timeEl);
      }

      wrap.appendChild(bubble);
      if (metaText) {
        var meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = metaText;
        wrap.appendChild(meta);
      }
      chatEl.appendChild(wrap);
      chatEl.scrollTop = chatEl.scrollHeight;
      return wrap;
    }

    function openSettings() {
      var cfg = getConfig();
      tokenInput.value = cfg.token;
      uidInput.value = cfg.uid;
      modalEl.classList.add('open');
    }

    document.getElementById('settingsBtn').onclick = openSettings;
    document.getElementById('closeModalBtn').onclick = function () {
      modalEl.classList.remove('open');
    };
    document.getElementById('clearUiBtn').onclick = function () {
      localStorage.removeItem('pet_ui_log');
      chatEl.innerHTML = '';
      modalEl.classList.remove('open');
    };
    document.getElementById('saveSettingsBtn').onclick = function () {
      localStorage.setItem('pet_bff_token', tokenInput.value.trim());
      localStorage.setItem('pet_user_id', uidInput.value.trim() || 'zero_main');
      modalEl.classList.remove('open');
      if (typeof window.refreshUpgradeStatusOnce === 'function') {
        window.refreshUpgradeStatusOnce();
      }
      if (typeof window.syncPetStateFromServer === 'function') {
        window.syncPetStateFromServer();
      }
    };

    // ==================== [CHAT_API] ====================
    async function sendInteractionRequest(contentText, contextLabel) {
      var cfg = getConfig();
      var res = await fetch('/v1/pet/interact', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + cfg.token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id: cfg.uid,
          device: {
            platform: detectPlatform(),
            context: contextLabel || 'PWA 專屬介面'
          },
          input: {
            type: 'text',
            content: contentText
          }
        })
      });
      return await res.json();
    }

    async function sendMessage() {
      var text = inputEl.value.trim();
      if (!text) return;

      var cfg = getConfig();
      if (!cfg.token) {
        openSettings();
        return;
      }

      markUserActivity();
      inputEl.value = '';
      inputEl.style.height = 'auto';
      sendBtn.disabled = true;

      var userTime = Date.now();
      var log = loadLocalLog();
      log.push({ role: 'user', text: text, meta: '', time: userTime });
      saveLocalLog(log);
      renderMessage('user', text, '', userTime);

      var loadingEl = renderMessage('bot', '思考中...', '', null);
      setPetMood('thinking');

      try {
        var data = await sendInteractionRequest(text, 'PWA 專屬介面');
        loadingEl.remove();

        var reply = data.reply || JSON.stringify(data);
        var emotion = (data.action && data.action.emotion) ? data.action.emotion : 'idle';
        setPetMood(emotion);
        triggerAvatarBounce();

        if (data.pet_state) {
          var rawExtra = (data.pet_state.extra && typeof data.pet_state.extra === 'object') ? data.pet_state.extra : {};
          var interactExtra = {
            boredom: 0,
            activity: '搖住尾巴開心地陪喺主人身邊 ✨'
          };
          if (typeof rawExtra.activity === 'string' && rawExtra.activity.trim() && rawExtra.boredom === 0) {
            interactExtra.activity = rawExtra.activity.trim();
          }
          if (typeof window.syncPetStatsFromBackend === 'function') {
            window.syncPetStatsFromBackend(
              data.pet_state.affection,
              data.pet_state.energy,
              interactExtra,
              data.pet_state.status_note || '',
              emotion
            );
          } else {
            petStatsEl.textContent = '好感度 ' + data.pet_state.affection + ' ｜ 活力 ' + data.pet_state.energy + ' ｜ 無聊度 0%';
          }
          setTimeout(function () {
            if (typeof window.triggerLifecycleTick === 'function') {
              window.triggerLifecycleTick(true);
            }
          }, 650);
        }

        var metaParts = [];
        if (data.meta && data.meta.model_used) metaParts.push(data.meta.model_used);
        if (data.meta && data.meta.tools_used && data.meta.tools_used.length > 0) {
          metaParts.push('工具: ' + data.meta.tools_used.join(', '));
          if (data.meta.tools_used.indexOf('request_self_upgrade') >= 0 && typeof window.onSelfUpgradeTriggered === 'function') {
            window.onSelfUpgradeTriggered(text);
          }
        }
        var metaStr = metaParts.join(' · ');

        var botTime = Date.now();
        var updatedLog = loadLocalLog();
        updatedLog.push({ role: 'bot', text: reply, meta: metaStr, time: botTime });
        saveLocalLog(updatedLog);
        renderMessage('bot', reply, metaStr, botTime);
      } catch (err) {
        loadingEl.remove();
        renderMessage('bot', '⚠️ 連線失敗：' + err.message, '', Date.now());
      } finally {
        sendBtn.disabled = false;
        inputEl.focus();
      }
    }

    // ==================== [UPGRADE_POLLING] ====================
    var pollTimer = null;
    var isLogCabinOpen = false;
    var isUpgradeActive = false;
    var cachedGhRunInfo = { url: '', fetchedAt: 0, data: null };
    var upgradeBtnEl = document.getElementById('upgradeBtn');
    var upgradeBar = document.getElementById('upgradeBar');
    var upgradeTitle = document.getElementById('upgradeTitle');
    var upgradeVerdictDetailEl = document.getElementById('upgradeVerdictDetail');
    var upgradeLogs = document.getElementById('upgradeLogs');
    var upgradeLink = document.getElementById('upgradeLink');
    var titleProgressSlotEl = document.getElementById('titleProgressSlot');
    var cabinProgressSlotEl = document.getElementById('cabinProgressSlot');
    var upgradeProgressContainerEl = document.getElementById('upgradeProgressContainer');
    var upgradeProgressStatusEl = document.getElementById('upgradeProgressStatus');
    var upgradeProgressPercentEl = document.getElementById('upgradeProgressPercent');
    var upgradeProgressFillEl = document.getElementById('upgradeProgressFill');

    function getValidGhForState(st, ghInfo) {
      if (!ghInfo || !ghInfo.status) return null;
      if (st && st.actions_url) {
        var parsedSt = parseGitHubRunTarget(st.actions_url);
        if (parsedSt.runId && ghInfo.id && String(ghInfo.id) === String(parsedSt.runId)) {
          return ghInfo;
        }
      }
      if (st && st.started_at && ghInfo.status === 'completed' && ghInfo.updatedAt) {
        var stStartMs = Date.parse(st.started_at);
        var ghUpdMs = Date.parse(ghInfo.updatedAt);
        if (!isNaN(stStartMs) && !isNaN(ghUpdMs) && ghUpdMs < stStartMs - 60000) {
          return null;
        }
      }
      return ghInfo;
    }

    function resolveUpgradeVerdict(st, ghInfo) {
      if (!st || typeof st !== 'object' || !st.status || st.status === 'idle') {
        return { verdict: 'idle', isSuccess: false, isError: false, isRejected: false, isActive: false, conclusion: '' };
      }
      var s = String(st.status || '').toLowerCase();
      var stepLower = String(st.step || '').toLowerCase();
      var stConclusion = String(st.conclusion || '').toLowerCase();
      var logsArr = Array.isArray(st.logs) ? st.logs : [];
      var joinedLogs = logsArr.join(' ');
      var validGh = getValidGhForState(st, ghInfo);

      var rejectLogRe = /(rejected|reject_upgrade|安全閘門|拒絕修改|拒絕升級|受保護|核心模組|核心功能|白名單|不在可編輯|PROTECTED_CORE)/i;
      var codeErrLogRe = /(error\s+TS\d+|型別檢查.*失敗|型別錯誤|語法錯誤|語法驗證.*失敗|SyntaxError|TypeError|沙盒驗證.*失敗|安全掃描.*失敗|編譯失敗)/i;
      var mergedLogRe = /(升級已自動合併至\s*main|已自動合併至\s*main)/i;

      var hasKvRejectSignal = s === 'rejected' || stepLower === 'rejected' || rejectLogRe.test(String(st.error || '')) || rejectLogRe.test(joinedLogs);
      var hasKvCodeErrSignal = codeErrLogRe.test(String(st.error || '')) || codeErrLogRe.test(joinedLogs);
      var hasKvMergedSignal = s === 'merged' || stepLower === 'merged' || mergedLogRe.test(joinedLogs);

      if (hasKvRejectSignal || (validGh && validGh.isRejected && validGh.status === 'completed' && validGh.conclusion !== 'success')) {
        return { verdict: 'rejected', isSuccess: false, isError: true, isRejected: true, isActive: false, conclusion: (validGh && validGh.conclusion) || 'rejected' };
      }
      if (validGh && validGh.status === 'completed' && validGh.conclusion !== 'success') {
        var ghConcl = validGh.conclusion || 'failure';
        var ghVerdict = (ghConcl === 'cancelled' || ghConcl === 'canceled')
          ? 'cancelled'
          : (ghConcl === 'timed_out' ? 'timed_out' : 'failure');
        return { verdict: ghVerdict, isSuccess: false, isError: true, isRejected: false, isActive: false, conclusion: ghConcl };
      }
      if (s === 'cancelled' || s === 'canceled' || stepLower === 'cancelled' || stepLower === 'canceled') {
        return { verdict: 'cancelled', isSuccess: false, isError: true, isRejected: false, isActive: false, conclusion: 'cancelled' };
      }
      if (s === 'failed' || s === 'error' || stepLower === 'failed' || stepLower === 'error' || hasKvCodeErrSignal) {
        return { verdict: 'failure', isSuccess: false, isError: true, isRejected: false, isActive: false, conclusion: (validGh && validGh.conclusion) || 'failure' };
      }
      if ((s === 'completed' || s === 'merged' || s === 'success') && stConclusion && stConclusion !== 'success') {
        var stVerdict = stConclusion === 'cancelled' ? 'cancelled' : (stConclusion === 'timed_out' ? 'timed_out' : 'failure');
        return { verdict: stVerdict, isSuccess: false, isError: true, isRejected: false, isActive: false, conclusion: stConclusion };
      }
      if (validGh && validGh.status === 'completed' && validGh.conclusion === 'success') {
        return { verdict: 'success', isSuccess: true, isError: false, isRejected: false, isActive: false, conclusion: 'success' };
      }
      if (hasKvMergedSignal && !st.error) {
        if (!validGh || validGh.status !== 'completed' || validGh.conclusion === 'success') {
          return { verdict: 'success', isSuccess: true, isError: false, isRejected: false, isActive: false, conclusion: 'success' };
        }
      }
      if (s === 'timed_out' || st.is_stale) {
        return { verdict: 'timed_out', isSuccess: false, isError: true, isRejected: false, isActive: false, conclusion: 'timed_out' };
      }
      if (s === 'completed') {
        if (stConclusion === 'success') {
          return { verdict: 'success', isSuccess: true, isError: false, isRejected: false, isActive: false, conclusion: 'success' };
        }
        return { verdict: 'failure', isSuccess: false, isError: true, isRejected: false, isActive: false, conclusion: stConclusion || 'unknown' };
      }
      if (s === 'pr_created') {
        return { verdict: 'pr_created', isSuccess: false, isError: false, isRejected: false, isActive: true, conclusion: (validGh && validGh.conclusion) || '' };
      }
      if (s === 'queued' || s === 'waiting' || s === 'pending' || s === 'requested') {
        return { verdict: 'queued', isSuccess: false, isError: false, isRejected: false, isActive: true, conclusion: '' };
      }
      if (s === 'running' || s === 'in_progress') {
        return { verdict: 'running', isSuccess: false, isError: false, isRejected: false, isActive: true, conclusion: '' };
      }
      return { verdict: 'failure', isSuccess: false, isError: true, isRejected: false, isActive: false, conclusion: s };
    }

    function isUpgradeStatusInProgress(st, ghInfo) {
      var v = resolveUpgradeVerdict(st, ghInfo);
      return v.isActive;
    }

    function updateProgressBarUI(percentVal, statusLabel, stateType) {
      var pct = Math.max(0, Math.min(100, Math.round(Number(percentVal) || 0)));
      upgradeProgressPercentEl.textContent = pct + '%';
      upgradeProgressStatusEl.textContent = statusLabel || '升級狀態：待機中';
      upgradeProgressFillEl.style.width = pct + '%';
      upgradeProgressFillEl.className = 'upgrade-progress-fill ' + (stateType || 'idle');
    }

    function computeUpgradeProgressInfo(st, ghInfo) {
      var v = resolveUpgradeVerdict(st, ghInfo);
      if (v.verdict === 'idle') {
        return { percent: 0, label: '升級狀態：待機中', state: 'idle' };
      }

      var explicitPct = (st && typeof st.progress === 'number') ? st.progress : (st && typeof st.percent === 'number' ? st.percent : null);
      var logs = (st && Array.isArray(st.logs)) ? st.logs : [];
      var joinedLogs = logs.join(' ');

      if (v.verdict === 'success') {
        return { percent: 100, label: '🎉 升級成功並已完成', state: 'success' };
      }
      if (v.verdict === 'rejected') {
        return { percent: 100, label: '🚫 升級請求被安全閘門拒絕', state: 'error' };
      }
      if (v.verdict === 'cancelled') {
        return { percent: 100, label: '⚠️ 升級任務已取消', state: 'error' };
      }
      if (v.verdict === 'timed_out') {
        return { percent: explicitPct !== null ? explicitPct : 100, label: (st && st.is_stale) ? '⚠️ 任務逾時無心跳回應' : '⏱️ 升級任務執行逾時', state: 'error' };
      }
      if (v.verdict === 'failure') {
        return { percent: 100, label: '❌ 升級執行失敗（' + (v.conclusion || 'failure') + '）', state: 'error' };
      }
      if (v.verdict === 'pr_created') {
        return { percent: explicitPct !== null ? explicitPct : 92, label: '✅ PR 已建立，等待合併', state: 'running' };
      }
      if (v.verdict === 'queued') {
        return { percent: explicitPct !== null ? explicitPct : 10, label: '⏳ 升級任務排隊準備中...', state: 'running' };
      }

      var basePct = 18;
      if (/PR|pull request|合併|merge/i.test(joinedLogs)) {
        basePct = 85;
      } else if (/push|commit|分支|branch/i.test(joinedLogs)) {
        basePct = 72;
      } else if (/tsc|typecheck|編譯|檢查|驗證/i.test(joinedLogs)) {
        basePct = 56;
      } else if (/生成|產生|規劃|Gemini|架構/i.test(joinedLogs)) {
        basePct = 36;
      } else if (logs.length > 0) {
        basePct = Math.min(78, 18 + logs.length * 10);
      }
      var elapsed = (st && Number(st.elapsed_sec)) || 0;
      var timePct = Math.min(88, 15 + Math.floor(elapsed * 1.1));
      var computed = explicitPct !== null ? explicitPct : Math.max(basePct, timePct);
      return {
        percent: Math.min(89, Math.max(12, computed)),
        label: '🔄 升級執行中 (' + elapsed + 's)',
        state: 'running'
      };
    }

    function renderUpgradeVerdictDetail(st, ghInfo, v) {
      if (!upgradeVerdictDetailEl) return;
      if (!v || v.verdict === 'idle' || v.isActive) {
        upgradeVerdictDetailEl.className = 'upgrade-verdict-detail';
        upgradeVerdictDetailEl.style.display = 'none';
        upgradeVerdictDetailEl.textContent = '';
        return;
      }
      var nl = String.fromCharCode(10);
      var validGh = getValidGhForState(st, ghInfo);
      if (v.isSuccess) {
        var okMsg = '✅ GitHub Actions 驗證通過（status: completed, conclusion: success）';
        if (st && st.summary) okMsg += nl + '升級摘要：' + st.summary;
        upgradeVerdictDetailEl.className = 'upgrade-verdict-detail success';
        upgradeVerdictDetailEl.style.display = 'block';
        upgradeVerdictDetailEl.textContent = okMsg;
        return;
      }
      var lines = [];
      if (st && st.step) lines.push('停在階段：' + st.step);
      if (validGh && Array.isArray(validGh.failedSteps) && validGh.failedSteps.length > 0) {
        lines.push('失敗步驟：' + validGh.failedSteps.join('；'));
      }
      if (validGh && Array.isArray(validGh.annotations) && validGh.annotations.length > 0) {
        lines.push('Annotations 摘要：' + validGh.annotations.slice(0, 3).join(' | '));
      }
      if (st && st.error) {
        lines.push((v.isRejected ? '拒絕原因：' : '錯誤原因：') + st.error);
      } else if (st && st.is_stale) {
        lines.push('錯誤原因：任務超過 20 分鐘無心跳回應，請查看 GitHub Actions 紀錄。');
      }
      if (lines.length === 0) {
        lines.push(v.isRejected ? '安全閘門拒絕了本次升級請求（不可修改受保護的核心模組）。' : '未能成功完成升級（conclusion: ' + (v.conclusion || 'failure') + '），請點擊下方 Actions 連結查看細節。');
      }
      upgradeVerdictDetailEl.className = 'upgrade-verdict-detail ' + (v.isRejected ? 'rejected' : 'error');
      upgradeVerdictDetailEl.style.display = 'block';
      upgradeVerdictDetailEl.textContent = lines.join(nl);
    }

    function syncLogCabinLayout() {
      if (isLogCabinOpen) {
        upgradeBar.style.display = 'block';
        upgradeBtnEl.classList.add('active');
        titleProgressSlotEl.classList.remove('active');
        if (upgradeProgressContainerEl.parentNode !== cabinProgressSlotEl) {
          cabinProgressSlotEl.appendChild(upgradeProgressContainerEl);
        }
      } else {
        upgradeBar.style.display = 'none';
        upgradeBtnEl.classList.remove('active');
        if (upgradeProgressContainerEl.parentNode !== titleProgressSlotEl) {
          titleProgressSlotEl.appendChild(upgradeProgressContainerEl);
        }
        if (isUpgradeActive) {
          titleProgressSlotEl.classList.add('active');
        } else {
          titleProgressSlotEl.classList.remove('active');
        }
      }
    }

    function ensurePollingState() {
      if (isLogCabinOpen || isUpgradeActive) {
        if (!pollTimer) {
          pollTimer = setInterval(fetchUpgradeStatus, 3000);
        }
      } else if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function setLogCabinOpen(openState) {
      isLogCabinOpen = Boolean(openState);
      syncLogCabinLayout();
      if (isLogCabinOpen) {
        fetchUpgradeStatus();
      }
      ensurePollingState();
    }

    function toggleLogCabin() {
      setLogCabinOpen(!isLogCabinOpen);
    }

    document.getElementById('closeUpgradeBar').onclick = function () {
      setLogCabinOpen(false);
    };

    upgradeProgressContainerEl.onclick = function () {
      toggleLogCabin();
    };

    async function fetchUpgradeStatus() {
      var cfg = getConfig();
      if (!cfg.token) {
        upgradeTitle.textContent = 'ℹ️ 請先於右上角「設定」填入連線 Token';
        return;
      }
      try {
        var res = await fetch('/v1/pet/upgrade/status?uid=' + encodeURIComponent(cfg.uid), {
          headers: { 'Authorization': 'Bearer ' + cfg.token }
        });
        var st = await res.json();

        var ghInfo = null;
        if (st && st.status !== 'idle' && st.actions_url && typeof window.fetchGitHubRunSummaryCached === 'function') {
          ghInfo = await window.fetchGitHubRunSummaryCached(st.actions_url, false);
        }

        var verdictInfo = resolveUpgradeVerdict(st, ghInfo);
        var prog = computeUpgradeProgressInfo(st, ghInfo);
        updateProgressBarUI(prog.percent, prog.label, prog.state);

        isUpgradeActive = verdictInfo.isActive;
        syncLogCabinLayout();
        ensurePollingState();

        if (typeof window.syncUpgradeTrackingFromStatus === 'function') {
          window.syncUpgradeTrackingFromStatus(st);
        }

        if (st.status === 'idle') {
          upgradeTitle.textContent = 'ℹ️ 目前尚無自我升級紀錄';
          renderUpgradeVerdictDetail(st, null, verdictInfo);
          upgradeLogs.textContent = '';
          upgradeLink.innerHTML = '';
          return;
        }

        if (verdictInfo.verdict === 'rejected') {
          upgradeTitle.textContent = '🚫 自我升級請求已被安全閘門拒絕';
        } else if (verdictInfo.verdict === 'cancelled') {
          upgradeTitle.textContent = '⚠️ 自我升級任務已取消（cancelled）';
        } else if (verdictInfo.verdict === 'timed_out') {
          upgradeTitle.textContent = st.is_stale ? '⚠️ 任務已超過 20 分鐘無心跳更新，請點擊下方 Actions 確認' : '⏱️ 自我升級任務執行逾時（timed_out）';
        } else if (verdictInfo.verdict === 'failure') {
          upgradeTitle.textContent = '❌ 自我升級執行失敗（' + (verdictInfo.conclusion || 'failure') + '）';
        } else if (verdictInfo.verdict === 'running') {
          upgradeTitle.textContent = '🔄 GitHub Actions 升級中（已耗時 ' + (st.elapsed_sec || 0) + ' 秒）';
        } else if (verdictInfo.verdict === 'queued') {
          upgradeTitle.textContent = '⏳ 自我升級任務排隊準備中...';
        } else if (verdictInfo.verdict === 'success') {
          upgradeTitle.textContent = '🎉 升級已通過驗證並合併至主分支！Cloudflare 約 30 秒後上線';
        } else if (verdictInfo.verdict === 'pr_created') {
          upgradeTitle.textContent = '✅ PR 已建立，等待合併';
        } else {
          upgradeTitle.textContent = '❌ 升級終止：' + st.status;
        }

        renderUpgradeVerdictDetail(st, ghInfo, verdictInfo);

        var nl = String.fromCharCode(10);
        upgradeLogs.textContent = (st.logs || []).join(nl) + (st.error ? nl + '錯誤: ' + st.error : '');
        upgradeLogs.scrollTop = upgradeLogs.scrollHeight;

        upgradeLink.innerHTML = '';
        var validGh = getValidGhForState(st, ghInfo);
        var resolvedActionsUrl = (validGh && validGh.htmlUrl) || st.actions_url || '';
        if (resolvedActionsUrl) {
          var a1 = document.createElement('a');
          a1.href = resolvedActionsUrl;
          a1.target = '_blank';
          a1.style.color = '#74b9ff';
          a1.style.marginRight = '12px';
          a1.textContent = '查看 Actions 即時終端日誌 ↗';
          upgradeLink.appendChild(a1);
        }
        if (st.pr_url) {
          var a2 = document.createElement('a');
          a2.href = st.pr_url;
          a2.target = '_blank';
          a2.style.color = '#a29bfe';
          a2.textContent = '查看 PR 變更內容 ↗';
          upgradeLink.appendChild(a2);
        }
      } catch (e) {
        upgradeTitle.textContent = '⚠️ 查詢進度失敗：' + e.message;
      }
    }

    window.refreshUpgradeStatusOnce = fetchUpgradeStatus;
    window.notifyUpgradeStartedUI = function () {
      isUpgradeActive = true;
      updateProgressBarUI(12, '🔄 已啟動自我升級任務...', 'running');
      syncLogCabinLayout();
      ensurePollingState();
      fetchUpgradeStatus();
    };

    upgradeBtnEl.onclick = toggleLogCabin;
    sendBtn.onclick = sendMessage;
    inputEl.addEventListener('input', function () {
      markUserActivity();
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    var isImeComposing = false;
    var lastCompositionEndAt = 0;
    inputEl.addEventListener('compositionstart', function () {
      isImeComposing = true;
    });
    inputEl.addEventListener('compositionend', function () {
      isImeComposing = false;
      lastCompositionEndAt = Date.now();
    });
    inputEl.addEventListener('keydown', function (e) {
      markUserActivity();
      if (isMobileTouchDevice()) return;
      if (e.isComposing || isImeComposing || e.keyCode === 229 || (Date.now() - lastCompositionEndAt < 50)) {
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (!sendBtn.disabled) {
          sendMessage();
        }
      }
    });

    var initialLog = loadLocalLog();
    if (initialLog.length === 0) {
      renderMessage('bot', '嗨主人！點右上角「設定」填入你的連線 Token 後，就可以正式開始聊天或點「🎮 餵食與遊戲」陪我玩囉！', '', Date.now());
    } else {
      initialLog.forEach(function (item) {
        renderMessage(item.role, item.text, item.meta, item.time);
      });
    }

    syncLogCabinLayout();
    if (!getConfig().token) {
      openSettings();
    } else {
      fetchUpgradeStatus();
    }

    // ==================== [PROACTIVE_MESSAGES] ====================
    var PROACTIVE_STORAGE_KEY = 'pet_proactive_store_v1';
    var UPGRADE_TRACK_STORAGE_KEY = 'pet_upgrade_tracking_v1';
    var proactiveModalEl = document.getElementById('proactiveModal');
    var proactiveRuleListEl = document.getElementById('proactiveRuleList');
    var proactiveGlobalLabelEl = document.getElementById('proactiveGlobalLabel');
    var proactiveIdleInfoEl = document.getElementById('proactiveIdleInfo');
    var toggleSysNotifyBtnEl = document.getElementById('toggleSysNotifyBtn');
    var ruleTypeSelectEl = document.getElementById('ruleTypeSelect');
    var ruleTimeWrapEl = document.getElementById('ruleTimeWrap');
    var ruleIntervalWrapEl = document.getElementById('ruleIntervalWrap');
    var ruleTitleInputEl = document.getElementById('ruleTitleInput');
    var ruleTimeInputEl = document.getElementById('ruleTimeInput');
    var ruleIntervalInputEl = document.getElementById('ruleIntervalInput');
    var ruleMsgInputEl = document.getElementById('ruleMsgInput');
    var ruleAiGenInputEl = document.getElementById('ruleAiGenInput');
    var proactiveBubbleEl = document.getElementById('proactiveBubble');
    var proactiveBubbleIconEl = document.getElementById('proactiveBubbleIcon');
    var proactiveBubbleTitleEl = document.getElementById('proactiveBubbleTitle');
    var proactiveBubbleTextEl = document.getElementById('proactiveBubbleText');
    var activeBubbleRule = null;
    var isGeneratingProactiveAi = false;
    var isCheckingUpgradeTrack = false;
    var upgradeWatchTimer = null;

    function createDefaultProactiveStore() {
      var nowIso = new Date().toISOString();
      return {
        globalEnabled: true,
        sysNotifyEnabled: false,
        rules: [
          {
            id: 'daily-morning',
            title: '每日早安問候',
            message: '早安主人！新的一天開始囉，今天有什麼計畫想跟我分享嗎？☀️',
            scheduleType: 'daily',
            time: '09:00',
            intervalMinutes: 60,
            enabled: true,
            aiGenerated: false,
            createdAt: nowIso,
            lastTriggeredAt: null
          },
          {
            id: 'idle-care',
            title: '閒置關懷提醒',
            message: '主人忙了好一陣子呢，記得站起來伸個懶腰、喝口水休息一下喔！🐾',
            scheduleType: 'idle',
            time: '00:00',
            intervalMinutes: 120,
            enabled: true,
            aiGenerated: false,
            createdAt: nowIso,
            lastTriggeredAt: null
          }
        ]
      };
    }

    function loadProactiveStore() {
      try {
        var raw = localStorage.getItem(PROACTIVE_STORAGE_KEY);
        if (!raw) return createDefaultProactiveStore();
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.rules)) {
          return createDefaultProactiveStore();
        }
        parsed.sysNotifyEnabled = Boolean(parsed.sysNotifyEnabled);
        parsed.rules.forEach(function (r) {
          if (r && typeof r === 'object') {
            r.aiGenerated = Boolean(r.aiGenerated);
          }
        });
        return parsed;
      } catch (e) {
        return createDefaultProactiveStore();
      }
    }

    function saveProactiveStore(store) {
      localStorage.setItem(PROACTIVE_STORAGE_KEY, JSON.stringify(store));
    }

    function trySendSystemNotification(titleText, bodyText) {
      var store = loadProactiveStore();
      if (!store.sysNotifyEnabled) return;
      if (typeof window.Notification === 'undefined') return;
      if (window.Notification.permission === 'granted') {
        try {
          new window.Notification(titleText, { body: bodyText });
        } catch (e) {
          // ignore notification error
        }
      }
    }

    function loadUpgradeTrack() {
      try {
        var raw = localStorage.getItem(UPGRADE_TRACK_STORAGE_KEY);
        if (!raw) {
          return { tracking: false, lastStatus: 'idle', actionsUrl: '', prUrl: '', summary: '', startedAt: 0, reportedKeys: [] };
        }
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
          return { tracking: false, lastStatus: 'idle', actionsUrl: '', prUrl: '', summary: '', startedAt: 0, reportedKeys: [] };
        }
        if (!Array.isArray(parsed.reportedKeys)) parsed.reportedKeys = [];
        return parsed;
      } catch (e) {
        return { tracking: false, lastStatus: 'idle', actionsUrl: '', prUrl: '', summary: '', startedAt: 0, reportedKeys: [] };
      }
    }

    function saveUpgradeTrack(track) {
      if (Array.isArray(track.reportedKeys) && track.reportedKeys.length > 20) {
        track.reportedKeys = track.reportedKeys.slice(-20);
      }
      localStorage.setItem(UPGRADE_TRACK_STORAGE_KEY, JSON.stringify(track));
    }

    function parseGitHubRunTarget(rawUrl) {
      if (!rawUrl || typeof rawUrl !== 'string') return {};
      try {
        var u = new URL(rawUrl);
        if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return {};
        var parts = u.pathname.split('/').filter(function (s) { return s.length > 0; });
        if (parts.length < 2) return {};
        var res = { repo: parts[0] + '/' + parts[1], runId: '' };
        if (parts[2] === 'actions' && parts[3] === 'runs' && parts[4] && /^[0-9]+$/.test(parts[4])) {
          res.runId = parts[4];
        }
        return res;
      } catch (e) {
        return {};
      }
    }

    function ensureUpgradeWatchTimer() {
      var track = loadUpgradeTrack();
      if (track.tracking && !upgradeWatchTimer) {
        upgradeWatchTimer = setInterval(function () {
          checkTrackedUpgradeProgress(false);
        }, 12000);
      } else if (!track.tracking && upgradeWatchTimer) {
        clearInterval(upgradeWatchTimer);
        upgradeWatchTimer = null;
      }
    }

    function buildUpgradeKey(runId, actionsUrl, startedAt, verdictOrConclusion) {
      var base = runId || actionsUrl || String(startedAt || 'latest');
      return base + ':' + (verdictOrConclusion || 'completed');
    }

    function emitUpgradeProactiveReport(opts) {
      var track = loadUpgradeTrack();
      var verdict = opts.verdict || (opts.isSuccess ? 'success' : 'failure');
      var reportKey = buildUpgradeKey(opts.runId, opts.actionsUrl, track.startedAt, verdict);
      if (track.reportedKeys.indexOf(reportKey) >= 0) {
        track.tracking = false;
        saveUpgradeTrack(track);
        ensureUpgradeWatchTimer();
        return false;
      }

      track.tracking = false;
      track.lastStatus = verdict === 'success' ? 'completed' : verdict;
      track.reportedKeys.push(reportKey);
      saveUpgradeTrack(track);
      ensureUpgradeWatchTimer();
      if (typeof window.refreshUpgradeStatusOnce === 'function') {
        window.refreshUpgradeStatusOnce();
      }

      var nl = String.fromCharCode(10);
      var isSuccess = Boolean(opts.isSuccess) && verdict === 'success';
      var isRejected = verdict === 'rejected';
      var titleText = isSuccess
        ? '🎉 自我升級完成通知'
        : (isRejected
          ? '🚫 自我升級被拒絕通知'
          : (verdict === 'cancelled'
            ? '⚠️ 自我升級已取消通知'
            : (verdict === 'timed_out' ? '⏱️ 自我升級逾時通知' : '❌ 自我升級失敗通知')));
      var iconChar = isSuccess ? '🎉' : (isRejected ? '🚫' : (verdict === 'timed_out' ? '⏱️' : '❌'));
      var lines = [];

      if (isSuccess) {
        lines.push('主人好消息！自我升級任務' + (opts.summary ? '「' + opts.summary + '」' : '') + '已通過 GitHub Actions 驗證（completed / success）並部署上線囉！✨');
        if (opts.prUrl) lines.push('PR 連結：' + opts.prUrl);
        if (opts.actionsUrl) lines.push('Actions 日誌：' + opts.actionsUrl);
      } else {
        if (isRejected) {
          lines.push('主人注意：自我升級任務' + (opts.summary ? '「' + opts.summary + '」' : '') + '已被安全閘門拒絕（rejected），不可修改受保護的核心模組。');
        } else {
          lines.push('主人注意：自我升級任務' + (opts.summary ? '「' + opts.summary + '」' : '') + '未能成功（狀態：' + verdict + ' / 結論：' + (opts.conclusion || verdict) + '）。');
        }
        if (opts.failedSteps && opts.failedSteps.length > 0) {
          lines.push('失敗步驟：' + opts.failedSteps.join('；'));
        }
        if (opts.annotations && opts.annotations.length > 0) {
          lines.push('Annotations 摘要：' + opts.annotations.slice(0, 3).join(' | '));
        }
        if (opts.reason) {
          lines.push((isRejected ? '拒絕原因：' : '失敗原因：') + opts.reason);
        }
        if (opts.actionsUrl) {
          lines.push('Actions 連結：' + opts.actionsUrl);
        }
      }

      var fullMsg = lines.join(nl);
      activeBubbleRule = { title: titleText, message: fullMsg };
      proactiveBubbleIconEl.textContent = iconChar;
      proactiveBubbleTitleEl.textContent = titleText;
      proactiveBubbleTextEl.textContent = fullMsg;
      proactiveBubbleEl.classList.add('show');
      petEmojiEl.textContent = isSuccess ? EMOJI_MAP.happy : EMOJI_MAP.caring;
      triggerAvatarBounce();
      trySendSystemNotification(titleText, fullMsg);

      var nowTs = Date.now();
      var metaLabel = '主動回報 · 自我升級' + (isSuccess ? '成功' : (isRejected ? '被拒絕' : '失敗'));
      var log = loadLocalLog();
      log.push({ role: 'bot', text: fullMsg, meta: metaLabel, time: nowTs });
      saveLocalLog(log);
      renderMessage('bot', fullMsg, metaLabel, nowTs);
      return true;
    }

    async function fetchGitHubRunSummary(actionsUrl) {
      var parsed = parseGitHubRunTarget(actionsUrl);
      if (!parsed.repo) return null;
      try {
        var ghHeaders = { 'Accept': 'application/vnd.github+json' };
        var targetRun = null;
        if (parsed.runId) {
          var rRes = await fetch('https://api.github.com/repos/' + parsed.repo + '/actions/runs/' + parsed.runId, { headers: ghHeaders });
          if (rRes.ok) targetRun = await rRes.json();
        } else {
          var listRes = await fetch('https://api.github.com/repos/' + parsed.repo + '/actions/workflows/self-upgrade-runner.yml/runs?per_page=3', { headers: ghHeaders });
          if (listRes.ok) {
            var listData = await listRes.json();
            if (listData && Array.isArray(listData.workflow_runs) && listData.workflow_runs.length > 0) {
              targetRun = listData.workflow_runs[0];
            }
          }
        }
        if (!targetRun) return null;
        var runStatus = String(targetRun.status || '').toLowerCase();
        var runConclusion = String(targetRun.conclusion || '').toLowerCase();
        var failedSteps = [];
        var annotations = [];
        if (runStatus === 'completed' && runConclusion !== 'success' && targetRun.id) {
          try {
            var jRes = await fetch('https://api.github.com/repos/' + parsed.repo + '/actions/runs/' + targetRun.id + '/jobs?per_page=10', { headers: ghHeaders });
            if (jRes.ok) {
              var jData = await jRes.json();
              var jobs = Array.isArray(jData.jobs) ? jData.jobs : [];
              for (var ji = 0; ji < jobs.length; ji++) {
                var job = jobs[ji];
                var steps = Array.isArray(job.steps) ? job.steps : [];
                steps.forEach(function (s) {
                  if (s.conclusion === 'failure' || s.conclusion === 'cancelled' || s.conclusion === 'timed_out' || s.conclusion === 'action_required') {
                    failedSteps.push((job.name || 'Job') + ' > ' + (s.name || '步驟') + ' (' + s.conclusion + ')');
                  }
                });
                if (job.id && ji < 3 && (job.conclusion === 'failure' || job.conclusion === 'cancelled' || job.conclusion === 'timed_out' || job.conclusion === 'action_required' || failedSteps.length > 0)) {
                  try {
                    var aRes = await fetch('https://api.github.com/repos/' + parsed.repo + '/check-runs/' + job.id + '/annotations?per_page=10', { headers: ghHeaders });
                    if (aRes.ok) {
                      var aList = await aRes.json();
                      if (Array.isArray(aList)) {
                        aList.forEach(function (ann) {
                          if (!ann || !ann.message) return;
                          var loc = ann.path ? (ann.path + (ann.start_line ? ':' + ann.start_line : '') + ' ') : '';
                          var head = ann.annotation_level ? ('[' + ann.annotation_level + '] ') : '';
                          var titlePart = ann.title ? (ann.title + ': ') : '';
                          var formatted = (head + loc + titlePart + ann.message).trim();
                          if (annotations.indexOf(formatted) < 0) annotations.push(formatted);
                        });
                      }
                    }
                  } catch (ae) {
                    // 忽略 annotations 查詢失敗
                  }
                }
              }
            }
          } catch (e) {
            // 忽略 jobs 額外查詢失敗
          }
        }
        var rejectRe = /(rejected|安全閘門|拒絕修改|受保護|核心模組|核心功能|白名單|PROTECTED_CORE)/i;
        var isRejected = runStatus === 'completed' && runConclusion !== 'success' && (
          failedSteps.some(function (s) { return rejectRe.test(s); }) ||
          annotations.some(function (a) { return rejectRe.test(a); })
        );
        return {
          id: targetRun.id ? String(targetRun.id) : parsed.runId,
          status: runStatus,
          conclusion: runConclusion,
          htmlUrl: targetRun.html_url || actionsUrl,
          displayTitle: targetRun.display_title || targetRun.name || '',
          updatedAt: targetRun.updated_at || targetRun.created_at || '',
          failedSteps: failedSteps,
          annotations: annotations,
          isRejected: isRejected
        };
      } catch (e) {
        return null;
      }
    }

    window.fetchGitHubRunSummaryCached = async function (actionsUrl, forceFresh) {
      if (!actionsUrl) return null;
      var nowMs = Date.now();
      if (!forceFresh && cachedGhRunInfo.url === actionsUrl && (nowMs - cachedGhRunInfo.fetchedAt < 12000)) {
        return cachedGhRunInfo.data;
      }
      var data = await fetchGitHubRunSummary(actionsUrl);
      cachedGhRunInfo = { url: actionsUrl, fetchedAt: Date.now(), data: data };
      return data;
    };

    window.onSelfUpgradeTriggered = function (promptText) {
      var track = loadUpgradeTrack();
      track.tracking = true;
      track.lastStatus = 'running';
      track.actionsUrl = '';
      track.prUrl = '';
      track.summary = (promptText || '').trim().slice(0, 40);
      track.startedAt = Date.now();
      saveUpgradeTrack(track);
      ensureUpgradeWatchTimer();
      if (typeof window.notifyUpgradeStartedUI === 'function') {
        window.notifyUpgradeStartedUI();
      }
      setTimeout(function () {
        checkTrackedUpgradeProgress(true);
      }, 4500);
    };

    window.syncUpgradeTrackingFromStatus = function (st) {
      if (!st || typeof st !== 'object' || st.status === 'idle') return;
      var track = loadUpgradeTrack();
      if (st.actions_url) track.actionsUrl = st.actions_url;
      if (st.pr_url) track.prUrl = st.pr_url;
      if (st.summary && !track.summary) track.summary = st.summary;
      var s = String(st.status || '').toLowerCase();
      if (s === 'running' || s === 'in_progress' || s === 'queued' || s === 'waiting' || s === 'pending' || s === 'pr_created') {
        var parsed = parseGitHubRunTarget(track.actionsUrl);
        var doneKeys = ['success', 'failure', 'rejected', 'cancelled', 'timed_out'];
        var alreadyDone = doneKeys.some(function (k) {
          return track.reportedKeys.indexOf(buildUpgradeKey(parsed.runId, track.actionsUrl, track.startedAt, k)) >= 0;
        });
        if (!alreadyDone) {
          track.tracking = true;
          track.lastStatus = st.status;
          if (!track.startedAt) track.startedAt = Date.now();
        }
      }
      saveUpgradeTrack(track);
      ensureUpgradeWatchTimer();
    };

    async function checkTrackedUpgradeProgress(forceCheck) {
      var cfg = getConfig();
      if (!cfg.token || isCheckingUpgradeTrack) return false;
      var track = loadUpgradeTrack();
      if (!track.tracking && !forceCheck) {
        return false;
      }
      isCheckingUpgradeTrack = true;
      try {
        var res = await fetch('/v1/pet/upgrade/status?uid=' + encodeURIComponent(cfg.uid), {
          headers: { 'Authorization': 'Bearer ' + cfg.token }
        });
        if (!res.ok) return false;
        var st = await res.json();
        if (!st || st.status === 'idle') return false;

        track = loadUpgradeTrack();
        if (st.actions_url) track.actionsUrl = st.actions_url;
        if (st.pr_url) track.prUrl = st.pr_url;
        if (st.summary && !track.summary) track.summary = st.summary;

        var s = String(st.status || '').toLowerCase();
        if (s === 'running' || s === 'in_progress' || s === 'queued' || s === 'waiting' || s === 'pending' || s === 'pr_created') {
          var activeParsed = parseGitHubRunTarget(track.actionsUrl);
          var terminalKeys = ['success', 'failure', 'rejected', 'cancelled', 'timed_out'];
          var hasReported = terminalKeys.some(function (k) {
            return track.reportedKeys.indexOf(buildUpgradeKey(activeParsed.runId, track.actionsUrl, track.startedAt, k)) >= 0;
          });
          if (!hasReported) {
            track.tracking = true;
            track.lastStatus = st.status;
            if (!track.startedAt) track.startedAt = Date.now();
            saveUpgradeTrack(track);
            ensureUpgradeWatchTimer();
          }
        }

        if (!track.tracking) return false;

        var rawGhInfo = track.actionsUrl ? await window.fetchGitHubRunSummaryCached(track.actionsUrl, Boolean(forceCheck)) : null;
        var validGh = getValidGhForState(st, rawGhInfo);
        var v = resolveUpgradeVerdict(st, validGh);

        if (v.isActive) {
          if (validGh && validGh.status && validGh.status !== 'completed') {
            track.lastStatus = validGh.status;
            saveUpgradeTrack(track);
          }
          return false;
        }

        var reasonText = '';
        if (!v.isSuccess) {
          if (st.error) {
            reasonText = st.error;
          } else if (validGh && Array.isArray(validGh.annotations) && validGh.annotations.length > 0) {
            reasonText = validGh.annotations[0];
          } else if (st.is_stale && v.verdict === 'timed_out') {
            reasonText = '升級任務超過 20 分鐘無心跳更新';
          } else if (Array.isArray(st.logs) && st.logs.length > 0 && s !== 'running') {
            reasonText = st.logs[st.logs.length - 1];
          } else if (st.step && s !== 'running') {
            reasonText = '停在步驟：' + st.step;
          }
        }

        return emitUpgradeProactiveReport({
          verdict: v.verdict,
          isSuccess: v.isSuccess,
          runId: (validGh && validGh.id) || parseGitHubRunTarget(track.actionsUrl).runId || '',
          conclusion: v.conclusion || v.verdict,
          actionsUrl: (validGh && validGh.htmlUrl) || track.actionsUrl,
          prUrl: track.prUrl,
          summary: st.summary || track.summary || (validGh && validGh.displayTitle) || '',
          failedSteps: (validGh && validGh.failedSteps) || [],
          annotations: (validGh && validGh.annotations) || [],
          reason: reasonText
        });
      } catch (e) {
        return false;
      } finally {
        isCheckingUpgradeTrack = false;
      }
    }

    function formatScheduleBadge(rule) {
      if (rule.scheduleType === 'daily') return '每日 ' + (rule.time || '09:00');
      if (rule.scheduleType === 'interval') return '每 ' + (rule.intervalMinutes || 60) + ' 分鐘';
      return '閒置 ' + (rule.intervalMinutes || 120) + ' 分鐘';
    }

    function renderProactivePanel() {
      var store = loadProactiveStore();
      proactiveGlobalLabelEl.textContent = '主動關懷總開關：' + (store.globalEnabled ? '🟢 啟用中' : '⚪ 已停用');
      if (toggleSysNotifyBtnEl) {
        toggleSysNotifyBtnEl.textContent = '系統通知：' + (store.sysNotifyEnabled ? '🟢 開啟' : '⚪ 關閉');
        if (store.sysNotifyEnabled) {
          toggleSysNotifyBtnEl.classList.add('active');
        } else {
          toggleSysNotifyBtnEl.classList.remove('active');
        }
      }
      var idleMin = Math.floor((Date.now() - lastUserActivityAt) / 60000);
      var track = loadUpgradeTrack();
      var trackLabel = track.tracking ? ' ｜ 🔄 自我升級追蹤中' : '';
      proactiveIdleInfoEl.textContent = '目前閒置約 ' + idleMin + ' 分鐘 ｜ 共 ' + store.rules.length + ' 筆排程' + trackLabel;
      proactiveRuleListEl.innerHTML = '';

      if (store.rules.length === 0) {
        var emptyEl = document.createElement('div');
        emptyEl.style.fontSize = '12px';
        emptyEl.style.color = '#8c96b2';
        emptyEl.style.padding = '8px';
        emptyEl.textContent = '目前尚無排程，可由上方表單新增。';
        proactiveRuleListEl.appendChild(emptyEl);
        return;
      }

      store.rules.forEach(function (rule) {
        var item = document.createElement('div');
        item.className = 'rule-item' + (rule.enabled ? '' : ' disabled');

        var info = document.createElement('div');
        info.className = 'rule-info';

        var titleRow = document.createElement('div');
        titleRow.className = 'rule-title-row';

        var nameEl = document.createElement('span');
        nameEl.className = 'rule-name';
        nameEl.textContent = rule.title;

        var badgeEl = document.createElement('span');
        badgeEl.className = 'rule-badge';
        badgeEl.textContent = formatScheduleBadge(rule);

        titleRow.appendChild(nameEl);
        titleRow.appendChild(badgeEl);

        if (rule.aiGenerated) {
          var aiBadgeEl = document.createElement('span');
          aiBadgeEl.className = 'rule-badge ai-badge';
          aiBadgeEl.textContent = '✨ AI 隨機生成';
          titleRow.appendChild(aiBadgeEl);
        }

        var msgEl = document.createElement('div');
        msgEl.className = 'rule-msg';
        msgEl.textContent = (rule.aiGenerated ? '參考提示：' : '') + rule.message;

        info.appendChild(titleRow);
        info.appendChild(msgEl);

        var actions = document.createElement('div');
        actions.className = 'rule-actions';

        var aiToggleBtn = document.createElement('button');
        aiToggleBtn.className = 'btn-sm' + (rule.aiGenerated ? ' ai-active' : '');
        aiToggleBtn.textContent = rule.aiGenerated ? '✨ AI隨機:開' : '✨ AI隨機:關';
        aiToggleBtn.title = '切換每次由 AI 隨機生成適合主題的句子';
        aiToggleBtn.onclick = function () {
          toggleProactiveRuleAi(rule.id);
        };

        var toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn-sm';
        toggleBtn.textContent = rule.enabled ? '停用' : '啟用';
        toggleBtn.onclick = function () {
          toggleProactiveRule(rule.id);
        };

        var delBtn = document.createElement('button');
        delBtn.className = 'btn-sm danger';
        delBtn.textContent = '刪除';
        delBtn.onclick = function () {
          deleteProactiveRule(rule.id);
        };

        actions.appendChild(aiToggleBtn);
        actions.appendChild(toggleBtn);
        actions.appendChild(delBtn);

        item.appendChild(info);
        item.appendChild(actions);
        proactiveRuleListEl.appendChild(item);
      });
    }

    function toggleProactiveRuleAi(ruleId) {
      var store = loadProactiveStore();
      store.rules.forEach(function (r) {
        if (r.id === ruleId) r.aiGenerated = !r.aiGenerated;
      });
      saveProactiveStore(store);
      renderProactivePanel();
    }

    function toggleProactiveRule(ruleId) {
      var store = loadProactiveStore();
      store.rules.forEach(function (r) {
        if (r.id === ruleId) r.enabled = !r.enabled;
      });
      saveProactiveStore(store);
      renderProactivePanel();
    }

    function deleteProactiveRule(ruleId) {
      var store = loadProactiveStore();
      store.rules = store.rules.filter(function (r) { return r.id !== ruleId; });
      saveProactiveStore(store);
      renderProactivePanel();
    }

    async function resolveProactiveMessageText(rule) {
      var fallbackMsg = rule.message || '主人～記得休息一下喝口水喔！🐾';
      if (!rule.aiGenerated) {
        return { text: fallbackMsg, aiUsed: false };
      }
      var cfg = getConfig();
      if (!cfg.token) {
        return { text: fallbackMsg, aiUsed: false };
      }
      try {
        var prompt = '【主動關懷觸發】請根據主題「' + (rule.title || '日常關懷') + '」與參考提示「' + fallbackMsg + '」，以桌寵溫暖可愛的語氣，即時隨機生成一句自然且不重複的繁體中文關懷句子（約 20～60 字，請直接輸出那句給主人的關懷話語，不要加引號或其他解釋）。';
        var data = await sendInteractionRequest(prompt, '主動關懷 AI 隨機生成');
        if (data && !data.error && typeof data.reply === 'string' && data.reply.trim().length > 0) {
          if (data.pet_state && typeof window.syncPetStatsFromBackend === 'function') {
            window.syncPetStatsFromBackend(data.pet_state.affection, data.pet_state.energy);
          }
          return { text: data.reply.trim(), aiUsed: true };
        }
      } catch (e) {
        // AI 生成失敗時自動退回原本設定的 message
      }
      return { text: fallbackMsg, aiUsed: false };
    }

    function showProactiveNotification(rule, displayMessage, aiUsed) {
      var finalMsg = displayMessage || rule.message || '';
      var titleText = '🔔 ' + (rule.title || '主動關懷提醒') + (rule.aiGenerated ? ' · ✨ AI 隨機生成' : '');
      activeBubbleRule = rule;
      proactiveBubbleIconEl.textContent = rule.icon || (rule.aiGenerated ? '✨' : '🐾');
      proactiveBubbleTitleEl.textContent = titleText;
      proactiveBubbleTextEl.textContent = finalMsg;
      proactiveBubbleEl.classList.add('show');
      petEmojiEl.textContent = EMOJI_MAP.caring;
      triggerAvatarBounce();
      trySendSystemNotification(titleText, finalMsg);

      var nowTs = Date.now();
      var metaLabel = '主動關懷 · ' + formatScheduleBadge(rule);
      if (rule.aiGenerated) {
        metaLabel += aiUsed ? ' · ✨ AI 隨機生成' : ' · 備用訊息';
      }
      var log = loadLocalLog();
      log.push({ role: 'bot', text: finalMsg, meta: metaLabel, time: nowTs });
      saveLocalLog(log);
      renderMessage('bot', finalMsg, metaLabel, nowTs);
    }

    async function triggerProactiveRule(rule) {
      if (!rule.aiGenerated) {
        showProactiveNotification(rule, rule.message, false);
        return;
      }
      if (isGeneratingProactiveAi) return;
      isGeneratingProactiveAi = true;
      try {
        var result = await resolveProactiveMessageText(rule);
        showProactiveNotification(rule, result.text, result.aiUsed);
      } finally {
        isGeneratingProactiveAi = false;
      }
    }

    function checkDueProactiveRules(forceTriggerFirst) {
      checkTrackedUpgradeProgress(Boolean(forceTriggerFirst));
      if (isGeneratingProactiveAi && !forceTriggerFirst) return false;
      var store = loadProactiveStore();
      if (!store.globalEnabled) return false;

      var now = new Date();
      var nowMs = now.getTime();
      var nowIso = now.toISOString();
      var todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      var nowMinutes = now.getHours() * 60 + now.getMinutes();
      var idleMinutes = (nowMs - lastUserActivityAt) / 60000;
      var triggeredRule = null;

      for (var i = 0; i < store.rules.length; i++) {
        var rule = store.rules[i];
        if (!rule.enabled) continue;

        if (forceTriggerFirst) {
          triggeredRule = rule;
          rule.lastTriggeredAt = nowIso;
          break;
        }

        if (rule.scheduleType === 'daily') {
          var parts = (rule.time || '09:00').split(':');
          var targetMin = (parseInt(parts[0], 10) || 9) * 60 + (parseInt(parts[1], 10) || 0);
          var diff = nowMinutes - targetMin;
          var lastDateStr = '';
          if (rule.lastTriggeredAt) {
            var ld = new Date(rule.lastTriggeredAt);
            if (!isNaN(ld.getTime())) {
              lastDateStr = ld.getFullYear() + '-' + String(ld.getMonth() + 1).padStart(2, '0') + '-' + String(ld.getDate()).padStart(2, '0');
            }
          }
          if (diff >= 0 && diff <= 120 && lastDateStr !== todayStr) {
            triggeredRule = rule;
            rule.lastTriggeredAt = nowIso;
            break;
          }
        } else if (rule.scheduleType === 'interval') {
          var intervalMs = (rule.intervalMinutes || 60) * 60000;
          var refMs = Date.parse(rule.lastTriggeredAt || rule.createdAt || nowIso);
          if (!isNaN(refMs) && (nowMs - refMs >= intervalMs)) {
            triggeredRule = rule;
            rule.lastTriggeredAt = nowIso;
            break;
          }
        } else if (rule.scheduleType === 'idle') {
          var needIdle = rule.intervalMinutes || 120;
          var lastTrigMs = rule.lastTriggeredAt ? Date.parse(rule.lastTriggeredAt) : 0;
          var cooldownOk = !lastTrigMs || isNaN(lastTrigMs) || (nowMs - lastTrigMs >= needIdle * 60000);
          if (idleMinutes >= needIdle && cooldownOk) {
            triggeredRule = rule;
            rule.lastTriggeredAt = nowIso;
            break;
          }
        }
      }

      if (triggeredRule) {
        saveProactiveStore(store);
        triggerProactiveRule(triggeredRule);
        return true;
      }
      return false;
    }

    ruleTypeSelectEl.onchange = function () {
      var val = ruleTypeSelectEl.value;
      if (val === 'daily') {
        ruleTimeWrapEl.style.display = 'block';
        ruleIntervalWrapEl.style.display = 'none';
      } else {
        ruleTimeWrapEl.style.display = 'none';
        ruleIntervalWrapEl.style.display = 'block';
      }
    };

    document.getElementById('proactiveBtn').onclick = function () {
      renderProactivePanel();
      proactiveModalEl.classList.add('open');
    };

    document.getElementById('closeProactiveModalBtn').onclick = function () {
      proactiveModalEl.classList.remove('open');
    };

    document.getElementById('toggleGlobalProactiveBtn').onclick = function () {
      var store = loadProactiveStore();
      store.globalEnabled = !store.globalEnabled;
      saveProactiveStore(store);
      renderProactivePanel();
    };

    if (toggleSysNotifyBtnEl) {
      toggleSysNotifyBtnEl.onclick = async function () {
        var store = loadProactiveStore();
        if (!store.sysNotifyEnabled) {
          if (typeof window.Notification !== 'undefined' && window.Notification.permission === 'default') {
            try {
              await window.Notification.requestPermission();
            } catch (e) {
              // ignore permission request failure
            }
          }
          store.sysNotifyEnabled = true;
        } else {
          store.sysNotifyEnabled = false;
        }
        saveProactiveStore(store);
        renderProactivePanel();
      };
    }

    document.getElementById('addRuleBtn').onclick = function () {
      var stype = ruleTypeSelectEl.value || 'daily';
      var title = ruleTitleInputEl.value.trim() || (stype === 'daily' ? '每日問候' : stype === 'interval' ? '定時提醒' : '閒置關懷');
      var msg = ruleMsgInputEl.value.trim() || '主人～記得休息一下喝口水喔！🐾';
      var timeVal = ruleTimeInputEl.value.trim() || '09:00';
      var intervalVal = Math.max(1, parseInt(ruleIntervalInputEl.value, 10) || 60);
      var aiGenVal = Boolean(ruleAiGenInputEl && ruleAiGenInputEl.checked);

      var store = loadProactiveStore();
      store.rules.push({
        id: 'rule-' + Date.now().toString(36),
        title: title,
        message: msg,
        scheduleType: stype,
        time: timeVal,
        intervalMinutes: intervalVal,
        enabled: true,
        aiGenerated: aiGenVal,
        createdAt: new Date().toISOString(),
        lastTriggeredAt: null
      });
      saveProactiveStore(store);
      ruleTitleInputEl.value = '';
      ruleMsgInputEl.value = '';
      if (ruleAiGenInputEl) ruleAiGenInputEl.checked = false;
      renderProactivePanel();
    };

    document.getElementById('testProactiveBubbleBtn').onclick = function () {
      var triggered = checkDueProactiveRules(false);
      if (!triggered) {
        checkDueProactiveRules(true);
      }
      proactiveModalEl.classList.remove('open');
    };

    document.getElementById('syncProactiveCloudBtn').onclick = async function () {
      var cfg = getConfig();
      if (!cfg.token) {
        proactiveModalEl.classList.remove('open');
        openSettings();
        return;
      }
      var store = loadProactiveStore();
      var summaryText = '請使用 manage_proactive_messages 工具同步我的主動訊息設定（包含每筆規則的 ai_generated 欄位），目前總開關為 ' + (store.globalEnabled ? 'true' : 'false') + '，共有 ' + store.rules.length + ' 筆規則：' + JSON.stringify(store.rules);
      proactiveModalEl.classList.remove('open');
      inputEl.value = summaryText;
      sendMessage();
    };

    document.getElementById('proactiveCloseBtn').onclick = function () {
      proactiveBubbleEl.classList.remove('show');
    };

    document.getElementById('proactiveReplyBtn').onclick = function () {
      proactiveBubbleEl.classList.remove('show');
      if (activeBubbleRule) {
        inputEl.value = '收到你的「' + activeBubbleRule.title + '」提醒囉！';
      }
      inputEl.focus();
    };

    window.addEventListener('pointerdown', markUserActivity);
    ensureUpgradeWatchTimer();
    setTimeout(function () {
      checkTrackedUpgradeProgress(true);
    }, 2500);
    setInterval(function () {
      checkDueProactiveRules(false);
    }, 30000);

    // ==================== [CARE_GAME] ====================
    var CARE_STORAGE_KEY = 'pet_care_game_store_v1';
    var careGameModalEl = document.getElementById('careGameModal');
    var careStageAvatarEl = document.getElementById('careStageAvatar');
    var careEnergyTextEl = document.getElementById('careEnergyText');
    var careEnergyBarEl = document.getElementById('careEnergyBar');
    var careAffectionTextEl = document.getElementById('careAffectionText');
    var careAffectionBarEl = document.getElementById('careAffectionBar');
    var careMoodTextEl = document.getElementById('careMoodText');
    var careFeedbackBoxEl = document.getElementById('careFeedbackBox');
    var gameRpsPanelEl = document.getElementById('gameRpsPanel');
    var gameHeartsPanelEl = document.getElementById('gameHeartsPanel');
    var tabRpsBtnEl = document.getElementById('tabRpsBtn');
    var tabHeartsBtnEl = document.getElementById('tabHeartsBtn');
    var rpsStatusTextEl = document.getElementById('rpsStatusText');
    var heartArenaEl = document.getElementById('heartArena');
    var heartTimerTextEl = document.getElementById('heartTimerText');
    var heartScoreTextEl = document.getElementById('heartScoreText');
    var startHeartGameBtnEl = document.getElementById('startHeartGameBtn');

    var lastCareActionSummary = '';
    var heartGameTimer = null;
    var heartSpawnTimer = null;
    var heartScore = 0;
    var heartSecondsLeft = 10;

    var SNACK_ITEMS = {
      dried_fish: {
        id: 'dried_fish',
        name: '香烤小魚乾',
        emoji: '🐟',
        energyGain: 15,
        affectionGain: 3,
        reply: '咔滋咔滋！香噴噴的小魚乾太好吃了喵～活力補充完畢！🐟✨'
      },
      strawberry_cake: {
        id: 'strawberry_cake',
        name: '草莓鮮奶油蛋糕',
        emoji: '🍰',
        energyGain: 25,
        affectionGain: 5,
        reply: '哇～是酸甜的草莓蛋糕！謝謝主人，幸福感爆棚囉！🍰💖'
      },
      special_coffee: {
        id: 'special_coffee',
        name: '星光特調咖啡',
        emoji: '☕',
        energyGain: 35,
        affectionGain: 4,
        reply: '咕嚕咕嚕～特調咖啡香氣超迷人，現在精神百倍！☕⚡'
      }
    };

    function clampVal(num) {
      var n = parseInt(num, 10);
      if (isNaN(n)) return 0;
      return Math.max(0, Math.min(100, n));
    }

    function getMoodLabel(energy, affection) {
      if (energy >= 80 && affection >= 80) return '元氣滿滿・超級撒嬌 🥰';
      if (energy >= 70) return '活力充沛・心情愉快 😸';
      if (energy >= 40) return '悠閒放鬆・期待互動 🐱';
      if (energy >= 20) return '肚子微餓・想吃點心 🐾';
      return '昏昏欲睡・急需補充能量 😪';
    }

    function getFallbackActivityText(energy, boredom) {
      if (energy < 35) return '趴喺鍵盤上面瞇眼抖緊氣 😪';
      if (boredom >= 80) return '追緊雷射筆紅點狂奔解悶 🔴';
      if (boredom >= 50) return '趴喺鍵盤上面偷睇主人做緊咩 👀';
      if (boredom >= 24) return '追緊雷射筆、自己撲蝶仔玩 🦋';
      return '伸懶腰中，喺桌面四圍巡邏 🐾';
    }

    function loadCareLocalStore() {
      try {
        var raw = localStorage.getItem(CARE_STORAGE_KEY);
        if (!raw) {
          return { energy: 75, affection: 60, boredom: 0, mood: 'idle', activity: '伸懶腰中，喺桌面四圍巡邏 🐾', statusNote: '', lastFedAt: 0 };
        }
        var parsed = JSON.parse(raw);
        var energyVal = clampVal(parsed.energy !== undefined ? parsed.energy : 75);
        var affectionVal = clampVal(parsed.affection !== undefined ? parsed.affection : 60);
        var boredomVal = clampVal(parsed.boredom !== undefined ? parsed.boredom : 0);
        var moodVal = normalizeMood(parsed.mood || 'idle');
        var activityVal = (typeof parsed.activity === 'string' && parsed.activity.trim())
          ? parsed.activity.trim()
          : getFallbackActivityText(energyVal, boredomVal);
        var noteVal = (typeof parsed.statusNote === 'string') ? parsed.statusNote : '';
        return {
          energy: energyVal,
          affection: affectionVal,
          boredom: boredomVal,
          mood: moodVal,
          activity: activityVal,
          statusNote: noteVal,
          lastFedAt: parsed.lastFedAt || 0
        };
      } catch (e) {
        return { energy: 75, affection: 60, boredom: 0, mood: 'idle', activity: '伸懶腰中，喺桌面四圍巡邏 🐾', statusNote: '', lastFedAt: 0 };
      }
    }

    function saveCareLocalStore(st) {
      localStorage.setItem(CARE_STORAGE_KEY, JSON.stringify(st));
    }

    function animateCareStage(emojiChar) {
      if (emojiChar) {
        careStageAvatarEl.textContent = emojiChar;
        petEmojiEl.textContent = emojiChar;
      }
      careStageAvatarEl.classList.add('anim');
      triggerAvatarBounce();
      setTimeout(function () {
        careStageAvatarEl.classList.remove('anim');
      }, 300);
    }

    function updateCareUiDisplay() {
      var st = loadCareLocalStore();
      var boredomVal = clampVal(st.boredom !== undefined ? st.boredom : 0);
      var activityStr = (typeof st.activity === 'string' && st.activity.trim())
        ? st.activity.trim()
        : getFallbackActivityText(st.energy, boredomVal);

      careEnergyTextEl.textContent = st.energy + ' / 100';
      careEnergyBarEl.style.width = st.energy + '%';
      careAffectionTextEl.textContent = st.affection + ' / 100';
      careAffectionBarEl.style.width = st.affection + '%';
      careMoodTextEl.textContent = '狀態：' + getMoodLabel(st.energy, st.affection) + ' ｜ 無聊度 ' + boredomVal + '% ｜ ' + activityStr;

      if (petStatsEl) {
        petStatsEl.textContent = '好感度 ' + st.affection + ' ｜ 活力 ' + st.energy + ' ｜ 無聊度 ' + boredomVal + '%';
      }
      if (petAffectionValEl) {
        petAffectionValEl.textContent = String(st.affection);
      }
      if (petAffectionFillEl) {
        petAffectionFillEl.style.width = st.affection + '%';
      }
      if (petEnergyValEl) {
        petEnergyValEl.textContent = String(st.energy);
      }
      if (petEnergyFillEl) {
        petEnergyFillEl.style.width = st.energy + '%';
      }
      if (petActivityTextEl) {
        petActivityTextEl.textContent = activityStr;
      }
      if (petBoredomTextEl) {
        petBoredomTextEl.textContent = boredomVal + '%';
      }
      if (petBoredomFillEl) {
        petBoredomFillEl.style.width = boredomVal + '%';
        var fillLevel = boredomVal >= 70 ? 'high' : (boredomVal >= 35 ? 'mid' : 'low');
        petBoredomFillEl.className = 'boredom-fill ' + fillLevel;
      }
      if (petStatusNoteEl) {
        var displayNote = st.statusNote || getMoodLabel(st.energy, st.affection);
        petStatusNoteEl.textContent = displayNote ? ('💬 ' + displayNote) : '';
        petStatusNoteEl.title = displayNote || '';
      }
      setPetMood(st.mood || 'idle');
    }

    window.syncPetStatsFromBackend = function (affectionVal, energyVal, extraObj, statusNoteVal, moodVal) {
      var st = loadCareLocalStore();
      if (affectionVal !== undefined && affectionVal !== null) {
        st.affection = clampVal(affectionVal);
      }
      if (energyVal !== undefined && energyVal !== null) {
        st.energy = clampVal(energyVal);
      }
      if (extraObj && typeof extraObj === 'object') {
        if (extraObj.boredom !== undefined && extraObj.boredom !== null) {
          st.boredom = clampVal(extraObj.boredom);
        }
        if (typeof extraObj.activity === 'string' && extraObj.activity.trim()) {
          st.activity = extraObj.activity.trim();
        }
      }
      if (typeof statusNoteVal === 'string') {
        st.statusNote = statusNoteVal;
      }
      if (moodVal && EMOJI_MAP[moodVal]) {
        st.mood = normalizeMood(moodVal);
        setPetMood(st.mood);
      }
      saveCareLocalStore(st);
      updateCareUiDisplay();
    };

    function showCareBubbleAndLog(icon, title, messageText, metaTag) {
      proactiveBubbleIconEl.textContent = icon || '🍙';
      proactiveBubbleTitleEl.textContent = title;
      proactiveBubbleTextEl.textContent = messageText;
      proactiveBubbleEl.classList.add('show');

      var nowTs = Date.now();
      var log = loadLocalLog();
      log.push({ role: 'bot', text: messageText, meta: metaTag, time: nowTs });
      saveLocalLog(log);
      renderMessage('bot', messageText, metaTag, nowTs);
    }

    function handleFeedSnack(snackKey) {
      markUserActivity();
      var snack = SNACK_ITEMS[snackKey] || SNACK_ITEMS.dried_fish;
      var st = loadCareLocalStore();
      var nowMs = Date.now();

      if (nowMs - st.lastFedAt < 4000) {
        careFeedbackBoxEl.textContent = '🐾 桌寵正在嚼嚼嘴裡的點心，等幾秒鐘再餵下一口吧！';
        animateCareStage('😸');
        return;
      }

      var beforeEnergy = st.energy;
      st.energy = clampVal(st.energy + snack.energyGain);
      st.affection = clampVal(st.affection + snack.affectionGain);
      st.boredom = 0;
      st.activity = '津津有味咁嘆緊' + snack.name + ' ' + snack.emoji;
      st.lastFedAt = nowMs;
      saveCareLocalStore(st);
      updateCareUiDisplay();
      animateCareStage('🥰');

      var gainedE = st.energy - beforeEnergy;
      var summaryText = snack.emoji + ' 餵食「' + snack.name + '」成功！活力 +' + gainedE + '（目前 ' + st.energy + '），好感度 +' + snack.affectionGain + '（目前 ' + st.affection + '）';
      careFeedbackBoxEl.textContent = summaryText;
      lastCareActionSummary = '我剛餵你吃了「' + snack.name + '」（請呼叫 manage_pet_care_game 工具：action 為 feed，snack_id 為 ' + snack.id + '，sync_energy 為 ' + st.energy + '，sync_affection 為 ' + st.affection + '）';

      showCareBubbleAndLog(snack.emoji, '餵食點心 · ' + snack.name, snack.reply, '照護互動 · 活力 ' + st.energy);
    }

    function playRpsRound(playerMove) {
      markUserActivity();
      var moves = ['rock', 'scissors', 'paper'];
      var moveNames = { rock: '✊ 石頭', scissors: '✌️ 剪刀', paper: '🖐️ 布' };
      var botMove = moves[Math.floor(Math.random() * moves.length)];
      var result = 'draw';

      if (playerMove === botMove) {
        result = 'draw';
      } else if (
        (playerMove === 'rock' && botMove === 'scissors') ||
        (playerMove === 'scissors' && botMove === 'paper') ||
        (playerMove === 'paper' && botMove === 'rock')
      ) {
        result = 'win';
      } else {
        result = 'lose';
      }

      var energyAdd = result === 'win' ? 18 : result === 'draw' ? 12 : 14;
      var affectionAdd = result === 'win' ? 5 : 4;
      var st = loadCareLocalStore();
      var beforeE = st.energy;
      st.energy = clampVal(st.energy + energyAdd);
      st.affection = clampVal(st.affection + affectionAdd);
      st.boredom = 0;
      st.activity = '同主人玩緊猜拳大作戰，興奮搖尾巴 🎲';
      saveCareLocalStore(st);
      updateCareUiDisplay();

      var outcomeMsg = '';
      if (result === 'win') {
        animateCareStage('😸');
        outcomeMsg = '你出 ' + moveNames[playerMove] + '，桌寵出 ' + moveNames[botMove] + '！🎉 你贏囉！桌寵開心地跳起來～';
      } else if (result === 'draw') {
        animateCareStage('🥰');
        outcomeMsg = '雙方都出 ' + moveNames[playerMove] + '！✨ 超有默契平手！';
      } else {
        animateCareStage('😸');
        outcomeMsg = '你出 ' + moveNames[playerMove] + '，桌寵出 ' + moveNames[botMove] + '！🐾 桌寵贏得這局，得意地搖尾巴！';
      }

      var deltaE = st.energy - beforeE;
      rpsStatusTextEl.textContent = outcomeMsg + '（活力 +' + deltaE + ' / 好感 +' + affectionAdd + '）';
      careFeedbackBoxEl.textContent = '🎲 猜拳對決完成！活力提升至 ' + st.energy + '，好感度提升至 ' + st.affection + '！';
      lastCareActionSummary = '我們剛玩了猜拳大作戰，我出' + moveNames[playerMove] + '，結果為 ' + result + '（請呼叫 manage_pet_care_game 工具：action 為 play_game，game_type 為 rps，player_choice 為 ' + playerMove + '，game_result 為 ' + result + '，sync_energy 為 ' + st.energy + '，sync_affection 為 ' + st.affection + '）';

      showCareBubbleAndLog('🎲', '猜拳大作戰', outcomeMsg, '小遊戲結算 · 活力 ' + st.energy);
    }

    function stopHeartGameTimers() {
      if (heartGameTimer) { clearInterval(heartGameTimer); heartGameTimer = null; }
      if (heartSpawnTimer) { clearInterval(heartSpawnTimer); heartSpawnTimer = null; }
    }

    function spawnCatchableHeart() {
      var btn = document.createElement('button');
      btn.className = 'heart-target';
      var icons = ['💖', '💗', '💓', '⭐', '🍓'];
      btn.textContent = icons[Math.floor(Math.random() * icons.length)];
      var maxLeft = Math.max(40, heartArenaEl.clientWidth - 44);
      var maxTop = Math.max(30, heartArenaEl.clientHeight - 44);
      btn.style.left = Math.floor(Math.random() * maxLeft) + 'px';
      btn.style.top = Math.floor(Math.random() * maxTop) + 'px';

      btn.onclick = function (e) {
        e.stopPropagation();
        heartScore += 1;
        heartScoreTextEl.textContent = '接到愛心：' + heartScore + ' 顆';
        animateCareStage('🥰');
        btn.remove();
      };

      heartArenaEl.appendChild(btn);
      setTimeout(function () {
        if (btn.parentNode) btn.remove();
      }, 1400);
    }

    function finishHeartGame() {
      stopHeartGameTimers();
      heartArenaEl.innerHTML = '';
      var replayBtn = document.createElement('button');
      replayBtn.className = 'btn-primary';
      replayBtn.textContent = '🔄 再玩一次接愛心挑戰';
      replayBtn.onclick = startHeartGame;
      heartArenaEl.appendChild(replayBtn);

      var energyGain = Math.min(30, Math.max(8, heartScore * 2));
      var affectionGain = Math.min(8, Math.max(2, Math.ceil((heartScore || 1) / 3)));
      var st = loadCareLocalStore();
      var beforeE = st.energy;
      st.energy = clampVal(st.energy + energyGain);
      st.affection = clampVal(st.affection + affectionGain);
      st.boredom = 0;
      st.activity = '蹦蹦跳跳接住滿滿愛心 💖';
      saveCareLocalStore(st);
      updateCareUiDisplay();
      animateCareStage('😸');

      var actualE = st.energy - beforeE;
      var msg = '💖 10 秒挑戰結束！共接到 ' + heartScore + ' 顆愛心，桌寵活力 +' + actualE + '（目前 ' + st.energy + '）、好感度 +' + affectionGain + '！';
      careFeedbackBoxEl.textContent = msg;
      heartTimerTextEl.textContent = '挑戰完成！';
      lastCareActionSummary = '我們剛玩了點擊接愛心挑戰，我接到了 ' + heartScore + ' 顆愛心（請呼叫 manage_pet_care_game 工具：action 為 play_game，game_type 為 catch_hearts，score 為 ' + heartScore + '，sync_energy 為 ' + st.energy + '，sync_affection 為 ' + st.affection + '）';

      showCareBubbleAndLog('💖', '點擊接愛心結算', msg, '小遊戲結算 · 活力 ' + st.energy);
    }

    function startHeartGame() {
      markUserActivity();
      stopHeartGameTimers();
      heartScore = 0;
      heartSecondsLeft = 10;
      heartArenaEl.innerHTML = '';
      heartTimerTextEl.textContent = '剩餘時間：' + heartSecondsLeft + ' 秒';
      heartScoreTextEl.textContent = '接到愛心：0 顆';
      careFeedbackBoxEl.textContent = '⚡ 快點擊畫面中冒出的愛心與星星，幫桌寵收集滿滿能量！';

      spawnCatchableHeart();
      heartSpawnTimer = setInterval(spawnCatchableHeart, 450);
      heartGameTimer = setInterval(function () {
        heartSecondsLeft -= 1;
        if (heartSecondsLeft <= 0) {
          finishHeartGame();
        } else {
          heartTimerTextEl.textContent = '剩餘時間：' + heartSecondsLeft + ' 秒';
        }
      }, 1000);
    }
      
    function applyPetState(ps) {
      if (!ps || typeof ps !== 'object') return;
      var extra = (ps.extra && typeof ps.extra === 'object') ? ps.extra : {};
      window.syncPetStatsFromBackend(ps.affection, ps.energy, extra, ps.status_note || '', ps.mood || '');
    }

    async function triggerLifecycleTick(silent) {
      var cfg = getConfig();
      if (!cfg.token) return null;
      try {
        var res = await fetch('/v1/pet/lifecycle/tick?uid=' + encodeURIComponent(cfg.uid), {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + cfg.token }
        });
        var data = await res.json();
        if (data && data.ok && data.pet_state) {
          applyPetState(data.pet_state);
          if (!silent) {
            triggerAvatarBounce();
          }
          return data.pet_state;
        }
      } catch (e) {}
      return null;
    }

    async function syncPetState(withFeedback) {
      var cfg = getConfig();
      if (!cfg.token) return null;
      try {
        var res = await fetch('/v1/pet/state?uid=' + encodeURIComponent(cfg.uid), {
          headers: { 'Authorization': 'Bearer ' + cfg.token }
        });
        var data = await res.json();
        if (data && data.ok && data.pet_state) {
          var ext = data.pet_state.extra;
          if (!ext || typeof ext !== 'object' || ext.boredom === undefined || !ext.activity) {
            return await triggerLifecycleTick(!withFeedback);
          } else {
            applyPetState(data.pet_state);
            if (withFeedback) {
              triggerAvatarBounce();
            }
            return data.pet_state;
          }
        }
      } catch (e) {}
      return null;
    }

    window.triggerLifecycleTick = triggerLifecycleTick;
    window.syncPetStateFromServer = syncPetState;

    function triggerQuickInteract(promptText, reactEmoji, tempMood) {
      if (sendBtn.disabled) return;
      var cfg = getConfig();
      if (!cfg.token) {
        openSettings();
        return;
      }
      if (tempMood) {
        setPetMood(tempMood);
      }
      triggerQuickAvatarReaction(reactEmoji);
      inputEl.value = promptText;
      sendMessage();
    }

    if (quickPatBtnEl) {
      quickPatBtnEl.onclick = function () {
        triggerQuickInteract('👋 輕輕摸下你個頭，同你撒個嬌～', '🥰', 'caring');
      };
    }
    if (quickFeedBtnEl) {
      quickFeedBtnEl.onclick = function () {
        triggerQuickInteract('🐟 餵你食塊香脆小魚乾零食，快啲補充活力啦！', '😸', 'happy');
      };
    }
    if (quickSleepBtnEl) {
      quickSleepBtnEl.onclick = function () {
        triggerQuickInteract('💤 拍拍枕頭哄你瞓覺，乖乖合埋眼休息叉電啦～', '😪', 'sleepy');
      };
    }
    if (quickRefreshBtnEl) {
      quickRefreshBtnEl.onclick = async function () {
        var cfg = getConfig();
        if (!cfg.token) {
          openSettings();
          return;
        }
        markUserActivity();
        quickRefreshBtnEl.disabled = true;
        quickRefreshBtnEl.classList.add('loading');
        quickRefreshBtnEl.textContent = '🔄 同步中...';
        triggerQuickAvatarReaction();
        try {
          await syncPetState(true);
        } finally {
          quickRefreshBtnEl.disabled = false;
          quickRefreshBtnEl.classList.remove('loading');
          quickRefreshBtnEl.textContent = '🔄 刷新狀態';
        }
      };
    }

    if (petActivityBadgeEl) {
      petActivityBadgeEl.onclick = function () {
        triggerLifecycleTick(false);
      };
    }
    if (petBoredomChipEl) {
      petBoredomChipEl.onclick = function () {
        triggerLifecycleTick(false);
      };
    }

    document.getElementById('careGameBtn').onclick = function () {
      updateCareUiDisplay();
      careGameModalEl.classList.add('open');
    };

    document.getElementById('closeCareModalBtn').onclick = function () {
      stopHeartGameTimers();
      careGameModalEl.classList.remove('open');
    };

    document.getElementById('feedFishBtn').onclick = function () {
      handleFeedSnack('dried_fish');
    };
    document.getElementById('feedCakeBtn').onclick = function () {
      handleFeedSnack('strawberry_cake');
    };
    document.getElementById('feedCoffeeBtn').onclick = function () {
      handleFeedSnack('special_coffee');
    };

    tabRpsBtnEl.onclick = function () {
      stopHeartGameTimers();
      tabRpsBtnEl.classList.add('active');
      tabHeartsBtnEl.classList.remove('active');
      gameRpsPanelEl.style.display = 'flex';
      gameHeartsPanelEl.style.display = 'none';
    };

    tabHeartsBtnEl.onclick = function () {
      tabHeartsBtnEl.classList.add('active');
      tabRpsBtnEl.classList.remove('active');
      gameRpsPanelEl.style.display = 'none';
      gameHeartsPanelEl.style.display = 'flex';
    };

    document.getElementById('rpsRockBtn').onclick = function () {
      playRpsRound('rock');
    };
    document.getElementById('rpsScissorsBtn').onclick = function () {
      playRpsRound('scissors');
    };
    document.getElementById('rpsPaperBtn').onclick = function () {
      playRpsRound('paper');
    };

    startHeartGameBtnEl.onclick = startHeartGame;

    document.getElementById('shareCareChatBtn').onclick = function () {
      stopHeartGameTimers();
      careGameModalEl.classList.remove('open');
      var cfg = getConfig();
      if (!cfg.token) {
        openSettings();
        return;
      }
      var st = loadCareLocalStore();
      var promptToSend = lastCareActionSummary || ('請使用 manage_pet_care_game 工具查詢並同步我的桌寵照護狀態，目前活力值為 ' + st.energy + '，好感度為 ' + st.affection + '，並跟我撒嬌互動一下吧！');
      inputEl.value = promptToSend;
      sendMessage();
    };

    // ==================== [DIARY_AND_PERSONA] ====================
    var diaryPersonaBtnEl = document.getElementById('diaryPersonaBtn');
    var diaryPersonaModalEl = document.getElementById('diaryPersonaModal');
    var closeDiaryPersonaTopBtnEl = document.getElementById('closeDiaryPersonaTopBtn');
    var closeDiaryPersonaModalBtnEl = document.getElementById('closeDiaryPersonaModalBtn');
    var tabDiaryBtnEl = document.getElementById('tabDiaryBtn');
    var tabPersonaBtnEl = document.getElementById('tabPersonaBtn');
    var diaryPersonaNoticeEl = document.getElementById('diaryPersonaNotice');
    var diaryTabPanelEl = document.getElementById('diaryTabPanel');
    var personaTabPanelEl = document.getElementById('personaTabPanel');
    var diaryCountLabelEl = document.getElementById('diaryCountLabel');
    var refreshDiariesBtnEl = document.getElementById('refreshDiariesBtn');
    var diaryTimelineListEl = document.getElementById('diaryTimelineList');
    var rollbackPersonaBtnEl = document.getElementById('rollbackPersonaBtn');
    var triggerDreamBtnEl = document.getElementById('triggerDreamBtn');
    var refreshPersonaBtnEl = document.getElementById('refreshPersonaBtn');
    var personaUpdatedLabelEl = document.getElementById('personaUpdatedLabel');
    var traitWarmthValEl = document.getElementById('traitWarmthVal');
    var traitWarmthFillEl = document.getElementById('traitWarmthFill');
    var traitPlayfulnessValEl = document.getElementById('traitPlayfulnessVal');
    var traitPlayfulnessFillEl = document.getElementById('traitPlayfulnessFill');
    var traitTeasingValEl = document.getElementById('traitTeasingVal');
    var traitTeasingFillEl = document.getElementById('traitTeasingFill');
    var traitChattinessValEl = document.getElementById('traitChattinessVal');
    var traitChattinessFillEl = document.getElementById('traitChattinessFill');
    var personaTagsListEl = document.getElementById('personaTagsList');
    var personaBondNoteEl = document.getElementById('personaBondNote');
    var personaRecentSnapshotEl = document.getElementById('personaRecentSnapshot');

    var MOOD_NAME_MAP = {
      idle: '悠閒',
      happy: '開心',
      thinking: '思考',
      sleepy: '想睡',
      caring: '貼心'
    };

    function hideDiaryPersonaNotice() {
      if (!diaryPersonaNoticeEl) return;
      diaryPersonaNoticeEl.className = 'diary-status-banner';
      diaryPersonaNoticeEl.style.display = 'none';
      diaryPersonaNoticeEl.innerHTML = '';
    }

    function showDiaryPersonaNotice(text, level, linkUrl, linkLabel) {
      if (!diaryPersonaNoticeEl) return;
      var lvl = (level === 'success' || level === 'error') ? level : 'info';
      diaryPersonaNoticeEl.className = 'diary-status-banner ' + lvl;
      diaryPersonaNoticeEl.style.display = 'block';
      diaryPersonaNoticeEl.innerHTML = '';
      var span = document.createElement('span');
      span.textContent = text;
      diaryPersonaNoticeEl.appendChild(span);
      if (linkUrl) {
        var link = document.createElement('a');
        link.href = linkUrl;
        link.target = '_blank';
        link.style.color = '#74b9ff';
        link.style.marginLeft = '8px';
        link.style.textDecoration = 'underline';
        link.textContent = linkLabel || '查看連結 ↗';
        diaryPersonaNoticeEl.appendChild(link);
      }
    }

    function renderDiaryEmptyState(messageText) {
      if (!diaryTimelineListEl) return;
      diaryTimelineListEl.innerHTML = '';
      var emptyDiv = document.createElement('div');
      emptyDiv.className = 'diary-empty-state';
      emptyDiv.textContent = messageText;
      diaryTimelineListEl.appendChild(emptyDiv);
    }

    async function fetchPetDiaries() {
      if (!diaryTimelineListEl) return;
      var cfg = getConfig();
      if (!cfg.token) {
        if (diaryCountLabelEl) diaryCountLabelEl.textContent = '尚未設定連線 Token';
        renderDiaryEmptyState('🔑 請先點擊右上角「設定」填入 BFF_ACCESS_TOKEN，即可讀取桌寵日記本喔！');
        return;
      }

      renderDiaryEmptyState('⏳ 正在翻開桌寵的日記本...');
      if (refreshDiariesBtnEl) refreshDiariesBtnEl.disabled = true;

      try {
        var res = await fetch('/v1/pet/diaries?uid=' + encodeURIComponent(cfg.uid) + '&limit=30', {
          headers: { 'Authorization': 'Bearer ' + cfg.token }
        });
        if (!res.ok) {
          if (res.status === 401) {
            renderDiaryEmptyState('⚠️ 認證失敗（Token 不符），請檢查右上角「設定」中的 BFF_ACCESS_TOKEN。');
          } else {
            renderDiaryEmptyState('⚠️ 讀取日記失敗（HTTP ' + res.status + '），請稍後再試。');
          }
          return;
        }

        var data = await res.json();
        var diaries = (data && Array.isArray(data.diaries)) ? data.diaries : [];
        if (diaryCountLabelEl) {
          diaryCountLabelEl.textContent = '共 ' + diaries.length + ' 篇日記紀錄';
        }

        if (diaries.length === 0) {
          renderDiaryEmptyState('📭 目前還沒有日記紀錄喔！桌寵會在每晚發夢時寫下日記，你也可以切到「🌱 性格演化」點擊「🌙 立即發夢」產生日記 ✨');
          return;
        }

        diaryTimelineListEl.innerHTML = '';
        diaries.forEach(function (entry) {
          if (!entry || typeof entry !== 'object') return;
          var card = document.createElement('div');
          card.className = 'diary-card';

          var header = document.createElement('div');
          header.className = 'diary-card-header';

          var dateBadge = document.createElement('span');
          dateBadge.className = 'diary-date-badge';
          dateBadge.textContent = '📅 ' + (entry.date || '未知日期');

          var moodKey = normalizeMood(entry.mood);
          var moodEmoji = EMOJI_MAP[moodKey] || '🐱';
          var moodName = MOOD_NAME_MAP[moodKey] || moodKey;
          var moodBadge = document.createElement('span');
          moodBadge.className = 'diary-mood-badge';
          moodBadge.textContent = moodEmoji + ' ' + moodName;

          header.appendChild(dateBadge);
          header.appendChild(moodBadge);
          card.appendChild(header);

          var titleEl = document.createElement('div');
          titleEl.className = 'diary-card-title';
          titleEl.textContent = entry.title || '桌寵日記';
          card.appendChild(titleEl);

          var contentEl = document.createElement('div');
          contentEl.className = 'diary-card-content';
          contentEl.textContent = entry.content || '';
          card.appendChild(contentEl);

          var highlights = Array.isArray(entry.highlights) ? entry.highlights : [];
          if (highlights.length > 0) {
            var hlWrap = document.createElement('div');
            hlWrap.className = 'diary-highlights';
            highlights.forEach(function (hl) {
              if (!hl) return;
              var chip = document.createElement('span');
              chip.className = 'diary-highlight-chip';
              chip.textContent = '✨ ' + String(hl);
              hlWrap.appendChild(chip);
            });
            card.appendChild(hlWrap);
          }

          diaryTimelineListEl.appendChild(card);
        });
      } catch (e) {
        renderDiaryEmptyState('⚠️ 載入日記時發生網路錯誤：' + (e && e.message ? e.message : String(e)));
      } finally {
        if (refreshDiariesBtnEl) refreshDiariesBtnEl.disabled = false;
      }
    }

    async function fetchPetPersona() {
      var cfg = getConfig();
      if (!cfg.token) {
        if (personaUpdatedLabelEl) personaUpdatedLabelEl.textContent = '尚未設定 Token';
        if (personaBondNoteEl) personaBondNoteEl.textContent = '🔑 請先於右上角「設定」填入 BFF_ACCESS_TOKEN。';
        if (personaRecentSnapshotEl) personaRecentSnapshotEl.textContent = '🔑 請先於右上角「設定」填入 BFF_ACCESS_TOKEN。';
        if (personaTagsListEl) {
          personaTagsListEl.innerHTML = '';
          var noTokEl = document.createElement('span');
          noTokEl.className = 'persona-empty-inline';
          noTokEl.textContent = '請先設定連線 Token';
          personaTagsListEl.appendChild(noTokEl);
        }
        return;
      }

      if (personaUpdatedLabelEl) personaUpdatedLabelEl.textContent = '⏳ 載入中...';
      if (refreshPersonaBtnEl) refreshPersonaBtnEl.disabled = true;

      try {
        var res = await fetch('/v1/pet/persona?uid=' + encodeURIComponent(cfg.uid), {
          headers: { 'Authorization': 'Bearer ' + cfg.token }
        });
        if (!res.ok) {
          if (personaUpdatedLabelEl) personaUpdatedLabelEl.textContent = '讀取失敗 (' + res.status + ')';
          if (personaBondNoteEl) {
            personaBondNoteEl.textContent = res.status === 401
              ? '⚠️ 認證失敗（Token 不符），請檢查右上角「設定」中的 BFF_ACCESS_TOKEN。'
              : '⚠️ 讀取性格資料失敗（HTTP ' + res.status + '）';
          }
          return;
        }

        var data = await res.json();
        var persona = (data && data.persona && typeof data.persona === 'object') ? data.persona : {};
        var traits = (persona.traits && typeof persona.traits === 'object') ? persona.traits : {};

        var warmth = clampVal(traits.warmth !== undefined ? traits.warmth : 70);
        var playfulness = clampVal(traits.playfulness !== undefined ? traits.playfulness : 65);
        var teasing = clampVal(traits.teasing !== undefined ? traits.teasing : 35);
        var chattiness = clampVal(traits.chattiness !== undefined ? traits.chattiness : 55);

        if (traitWarmthValEl) traitWarmthValEl.textContent = warmth + ' / 100';
        if (traitWarmthFillEl) traitWarmthFillEl.style.width = warmth + '%';

        if (traitPlayfulnessValEl) traitPlayfulnessValEl.textContent = playfulness + ' / 100';
        if (traitPlayfulnessFillEl) traitPlayfulnessFillEl.style.width = playfulness + '%';

        if (traitTeasingValEl) traitTeasingValEl.textContent = teasing + ' / 100';
        if (traitTeasingFillEl) traitTeasingFillEl.style.width = teasing + '%';

        if (traitChattinessValEl) traitChattinessValEl.textContent = chattiness + ' / 100';
        if (traitChattinessFillEl) traitChattinessFillEl.style.width = chattiness + '%';

        if (personaUpdatedLabelEl) {
          var dreamDateStr = (data && data.last_dream_date) ? ('最後發夢：' + data.last_dream_date) : '尚未發夢';
          var histCount = (data && typeof data.history_count === 'number') ? data.history_count : 0;
          personaUpdatedLabelEl.textContent = dreamDateStr + ' ｜ 可還原版本：' + histCount;
        }

        if (personaTagsListEl) {
          personaTagsListEl.innerHTML = '';
          var insideJokes = Array.isArray(persona.inside_jokes) ? persona.inside_jokes : [];
          var speechHabits = Array.isArray(persona.speech_habits) ? persona.speech_habits : [];

          if (insideJokes.length === 0 && speechHabits.length === 0) {
            var emptyTag = document.createElement('span');
            emptyTag.className = 'persona-empty-inline';
            emptyTag.textContent = '尚無共同梗標籤，多跟桌寵聊天互動並發夢後會慢慢累積喔 ✨';
            personaTagsListEl.appendChild(emptyTag);
          } else {
            insideJokes.forEach(function (joke) {
              if (!joke) return;
              var chip = document.createElement('span');
              chip.className = 'persona-tag';
              chip.textContent = '🏷️ ' + String(joke);
              personaTagsListEl.appendChild(chip);
            });
            speechHabits.forEach(function (habit) {
              if (!habit) return;
              var chip = document.createElement('span');
              chip.className = 'persona-tag habit';
              chip.textContent = '💬 ' + String(habit);
              personaTagsListEl.appendChild(chip);
            });
          }
        }

        if (personaBondNoteEl) {
          var bondStr = (persona.bond_note && String(persona.bond_note).trim())
            ? String(persona.bond_note).trim()
            : '仲喺度慢慢了解主人嘅生活習慣同喜好。';
          personaBondNoteEl.textContent = bondStr;
        }

        if (personaRecentSnapshotEl) {
          var snapStr = (data && data.recent_snapshot && String(data.recent_snapshot).trim())
            ? String(data.recent_snapshot).trim()
            : '尚無近期近況快照，待桌寵發夢整理記憶後會顯示於此 ✨';
          personaRecentSnapshotEl.textContent = snapStr;
        }
      } catch (e) {
        if (personaUpdatedLabelEl) personaUpdatedLabelEl.textContent = '載入異常';
        if (personaBondNoteEl) {
          personaBondNoteEl.textContent = '⚠️ 載入性格資料失敗：' + (e && e.message ? e.message : String(e));
        }
      } finally {
        if (refreshPersonaBtnEl) refreshPersonaBtnEl.disabled = false;
      }
    }

    function switchDiaryPersonaTab(tabName) {
      if (tabName === 'persona') {
        if (tabDiaryBtnEl) tabDiaryBtnEl.classList.remove('active');
        if (tabPersonaBtnEl) tabPersonaBtnEl.classList.add('active');
        if (diaryTabPanelEl) diaryTabPanelEl.style.display = 'none';
        if (personaTabPanelEl) personaTabPanelEl.style.display = 'flex';
        fetchPetPersona();
      } else {
        if (tabDiaryBtnEl) tabDiaryBtnEl.classList.add('active');
        if (tabPersonaBtnEl) tabPersonaBtnEl.classList.remove('active');
        if (diaryTabPanelEl) diaryTabPanelEl.style.display = 'flex';
        if (personaTabPanelEl) personaTabPanelEl.style.display = 'none';
        fetchPetDiaries();
      }
    }

    function openDiaryPersonaModal() {
      markUserActivity();
      hideDiaryPersonaNotice();
      if (diaryPersonaModalEl) {
        diaryPersonaModalEl.classList.add('open');
      }
      fetchPetDiaries();
      fetchPetPersona();
    }

    function closeDiaryPersonaModal() {
      if (diaryPersonaModalEl) {
        diaryPersonaModalEl.classList.remove('open');
      }
    }

    if (diaryPersonaBtnEl) {
      diaryPersonaBtnEl.onclick = openDiaryPersonaModal;
    }
    if (closeDiaryPersonaTopBtnEl) {
      closeDiaryPersonaTopBtnEl.onclick = closeDiaryPersonaModal;
    }
    if (closeDiaryPersonaModalBtnEl) {
      closeDiaryPersonaModalBtnEl.onclick = closeDiaryPersonaModal;
    }
    if (tabDiaryBtnEl) {
      tabDiaryBtnEl.onclick = function () {
        switchDiaryPersonaTab('diary');
      };
    }
    if (tabPersonaBtnEl) {
      tabPersonaBtnEl.onclick = function () {
        switchDiaryPersonaTab('persona');
      };
    }
    if (refreshDiariesBtnEl) {
      refreshDiariesBtnEl.onclick = function () {
        fetchPetDiaries();
      };
    }
    if (refreshPersonaBtnEl) {
      refreshPersonaBtnEl.onclick = function () {
        fetchPetPersona();
      };
    }

    if (rollbackPersonaBtnEl) {
      rollbackPersonaBtnEl.onclick = async function () {
        var cfg = getConfig();
        if (!cfg.token) {
          closeDiaryPersonaModal();
          openSettings();
          return;
        }
        markUserActivity();
        rollbackPersonaBtnEl.disabled = true;
        showDiaryPersonaNotice('⏳ 正在還原上一版性格設定...', 'info');
        try {
          var res = await fetch('/v1/pet/persona/rollback?uid=' + encodeURIComponent(cfg.uid), {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + cfg.token }
          });
          var data = await res.json();
          await fetchPetPersona();
          if (res.ok && data && data.ok) {
            showDiaryPersonaNotice('✅ ' + (data.message || '已成功還原至上一版性格設定！'), 'success');
            triggerAvatarBounce();
          } else {
            showDiaryPersonaNotice('ℹ️ ' + ((data && (data.message || data.error)) || '目前未有可還原的舊性格版本'), 'info');
          }
        } catch (e) {
          showDiaryPersonaNotice('⚠️ 還原性格失敗：' + (e && e.message ? e.message : String(e)), 'error');
        } finally {
          rollbackPersonaBtnEl.disabled = false;
        }
      };
    }

    if (triggerDreamBtnEl) {
      triggerDreamBtnEl.onclick = async function () {
        var cfg = getConfig();
        if (!cfg.token) {
          closeDiaryPersonaModal();
          openSettings();
          return;
        }
        markUserActivity();
        triggerDreamBtnEl.disabled = true;
        showDiaryPersonaNotice('⏳ 正在派發「🌙 立即發夢」任務並同步記憶...', 'info');
        try {
          var res = await fetch('/v1/pet/dream/trigger?uid=' + encodeURIComponent(cfg.uid) + '&force=true', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + cfg.token }
          });
          var data = await res.json();
          await Promise.all([fetchPetPersona(), fetchPetDiaries()]);
          if (res.ok && data && data.ok) {
            showDiaryPersonaNotice(
              '🌙 已成功觸發立即發夢任務，並已重新載入性格與日記資料！（GitHub Actions 背景整理約需 30～60 秒完成，稍後可點重新整理查看最新成果）',
              'success',
              data.actions_url || '',
              '查看發夢 Actions ↗'
            );
            triggerAvatarBounce();
          } else {
            showDiaryPersonaNotice(
              '⚠️ 立即發夢觸發失敗：' + ((data && data.error) ? data.error : ('HTTP ' + res.status)),
              'error'
            );
          }
        } catch (e) {
          showDiaryPersonaNotice('⚠️ 觸發發夢時發生錯誤：' + (e && e.message ? e.message : String(e)), 'error');
        } finally {
          triggerDreamBtnEl.disabled = false;
        }
      };
    }

    // 保留 petStageEl 供未來 3D 桌寵模型掛載使用
    window.petStageElement = petStageEl;

    applyTimeBasedTheme();
    updateCareUiDisplay();
    if (getConfig().token) {
      syncPetState(false);
    }
    setInterval(function () {
      applyTimeBasedTheme();
      if (getConfig().token) {
        syncPetState(false);
      }
    }, 60000);
`;
