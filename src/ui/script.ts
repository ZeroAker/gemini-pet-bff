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
    function triggerAvatarBounce() {
      petEmojiEl.classList.add('bounce');
      setTimeout(function () {
        petEmojiEl.classList.remove('bounce');
      }, 320);
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

      try {
        var data = await sendInteractionRequest(text, 'PWA 專屬介面');
        loadingEl.remove();

        var reply = data.reply || JSON.stringify(data);
        var emotion = (data.action && data.action.emotion) ? data.action.emotion : 'idle';
        petEmojiEl.textContent = EMOJI_MAP[emotion] || '🐱';
        triggerAvatarBounce();

        if (data.pet_state) {
          if (typeof window.syncPetStatsFromBackend === 'function') {
            window.syncPetStatsFromBackend(data.pet_state.affection, data.pet_state.energy);
          } else {
            petStatsEl.textContent = '好感度 ' + data.pet_state.affection + ' ｜ 活力 ' + data.pet_state.energy;
          }
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
    var upgradeBtnEl = document.getElementById('upgradeBtn');
    var upgradeBar = document.getElementById('upgradeBar');
    var upgradeTitle = document.getElementById('upgradeTitle');
    var upgradeLogs = document.getElementById('upgradeLogs');
    var upgradeLink = document.getElementById('upgradeLink');
    var titleProgressSlotEl = document.getElementById('titleProgressSlot');
    var cabinProgressSlotEl = document.getElementById('cabinProgressSlot');
    var upgradeProgressContainerEl = document.getElementById('upgradeProgressContainer');
    var upgradeProgressStatusEl = document.getElementById('upgradeProgressStatus');
    var upgradeProgressPercentEl = document.getElementById('upgradeProgressPercent');
    var upgradeProgressFillEl = document.getElementById('upgradeProgressFill');

    function isUpgradeStatusInProgress(st) {
      if (!st || typeof st !== 'object' || st.is_stale) return false;
      var s = String(st.status || '').toLowerCase();
      return (
        s === 'running' ||
        s === 'in_progress' ||
        s === 'queued' ||
        s === 'waiting' ||
        s === 'pending' ||
        s === 'requested' ||
        s === 'pr_created'
      );
    }

    function updateProgressBarUI(percentVal, statusLabel, stateType) {
      var pct = Math.max(0, Math.min(100, Math.round(Number(percentVal) || 0)));
      upgradeProgressPercentEl.textContent = pct + '%';
      upgradeProgressStatusEl.textContent = statusLabel || '升級狀態：待機中';
      upgradeProgressFillEl.style.width = pct + '%';
      upgradeProgressFillEl.className = 'upgrade-progress-fill ' + (stateType || 'idle');
    }

    function computeUpgradeProgressInfo(st) {
      if (!st || typeof st !== 'object' || !st.status || st.status === 'idle') {
        return {
          percent: 0,
          label: '升級狀態：待機中',
          state: 'idle'
        };
      }

      var s = String(st.status || '').toLowerCase();
      var explicitPct = typeof st.progress === 'number' ? st.progress : (typeof st.percent === 'number' ? st.percent : null);
      var logs = Array.isArray(st.logs) ? st.logs : [];
      var joinedLogs = logs.join(' ');

      if (s === 'merged' || s === 'completed' || s === 'success') {
        return {
          percent: 100,
          label: '🎉 升級已合併完成',
          state: 'success'
        };
      }

      if (s === 'pr_created') {
        return {
          percent: explicitPct !== null ? explicitPct : 92,
          label: '✅ PR 已建立，等待合併',
          state: 'running'
        };
      }

      if (s === 'queued' || s === 'waiting' || s === 'pending' || s === 'requested') {
        if (st.is_stale) {
          return {
            percent: explicitPct !== null ? explicitPct : 90,
            label: '⚠️ 任務逾時無心跳回應',
            state: 'error'
          };
        }
        return {
          percent: explicitPct !== null ? explicitPct : 10,
          label: '⏳ 升級任務排隊準備中...',
          state: 'running'
        };
      }

      if (s === 'running' || s === 'in_progress') {
        if (st.is_stale) {
          return {
            percent: explicitPct !== null ? explicitPct : 90,
            label: '⚠️ 任務逾時無心跳回應',
            state: 'error'
          };
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
        var elapsed = Number(st.elapsed_sec) || 0;
        var timePct = Math.min(88, 15 + Math.floor(elapsed * 1.1));
        var computed = explicitPct !== null ? explicitPct : Math.max(basePct, timePct);
        return {
          percent: Math.min(89, Math.max(12, computed)),
          label: '🔄 升級執行中 (' + elapsed + 's)',
          state: 'running'
        };
      }

      return {
        percent: explicitPct !== null ? explicitPct : 100,
        label: '❌ 升級終止：' + st.status,
        state: 'error'
      };
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

        var prog = computeUpgradeProgressInfo(st);
        updateProgressBarUI(prog.percent, prog.label, prog.state);

        isUpgradeActive = isUpgradeStatusInProgress(st);
        syncLogCabinLayout();
        ensurePollingState();

        if (typeof window.syncUpgradeTrackingFromStatus === 'function') {
          window.syncUpgradeTrackingFromStatus(st);
        }

        if (st.status === 'idle') {
          upgradeTitle.textContent = 'ℹ️ 目前尚無自我升級紀錄';
          upgradeLogs.textContent = '';
          upgradeLink.innerHTML = '';
          return;
        }

        var s = String(st.status || '').toLowerCase();
        if (st.is_stale) {
          upgradeTitle.textContent = '⚠️ 任務已超過 20 分鐘無心跳更新，請點擊下方 Actions 確認';
        } else if (s === 'running' || s === 'in_progress') {
          upgradeTitle.textContent = '🔄 GitHub Actions 升級中（已耗時 ' + (st.elapsed_sec || 0) + ' 秒）';
        } else if (s === 'queued' || s === 'waiting' || s === 'pending' || s === 'requested') {
          upgradeTitle.textContent = '⏳ 自我升級任務排隊準備中...';
        } else if (s === 'merged' || s === 'completed' || s === 'success') {
          upgradeTitle.textContent = '🎉 升級已合併至主分支！Cloudflare 約 30 秒後上線';
        } else if (s === 'pr_created') {
          upgradeTitle.textContent = '✅ PR 已建立，等待合併';
        } else {
          upgradeTitle.textContent = '❌ 升級終止：' + st.status;
        }

        var nl = String.fromCharCode(10);
        upgradeLogs.textContent = (st.logs || []).join(nl) + (st.error ? nl + '錯誤: ' + st.error : '');
        upgradeLogs.scrollTop = upgradeLogs.scrollHeight;

        upgradeLink.innerHTML = '';
        if (st.actions_url) {
          var a1 = document.createElement('a');
          a1.href = st.actions_url;
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
        if (parts[2] === 'actions' && parts[3] === 'runs' && parts[4] && /^\d+$/.test(parts[4])) {
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

    function buildUpgradeKey(runId, actionsUrl, startedAt, conclusion) {
      var base = runId || actionsUrl || String(startedAt || 'latest');
      return base + ':' + (conclusion || 'completed');
    }

    function emitUpgradeProactiveReport(opts) {
      var track = loadUpgradeTrack();
      var reportKey = buildUpgradeKey(opts.runId, opts.actionsUrl, track.startedAt, opts.conclusion);
      if (track.reportedKeys.indexOf(reportKey) >= 0) {
        track.tracking = false;
        saveUpgradeTrack(track);
        ensureUpgradeWatchTimer();
        return false;
      }

      track.tracking = false;
      track.lastStatus = 'completed';
      track.reportedKeys.push(reportKey);
      saveUpgradeTrack(track);
      ensureUpgradeWatchTimer();
      if (typeof window.refreshUpgradeStatusOnce === 'function') {
        window.refreshUpgradeStatusOnce();
      }

      var nl = String.fromCharCode(10);
      var isSuccess = Boolean(opts.isSuccess);
      var titleText = isSuccess ? '🎉 自我升級完成通知' : '⚠️ 自我升級失敗通知';
      var iconChar = isSuccess ? '🎉' : '⚠️';
      var lines = [];

      if (isSuccess) {
        lines.push('主人好消息！自我升級任務' + (opts.summary ? '「' + opts.summary + '」' : '') + '已順利完成並部署上線囉！✨');
        if (opts.prUrl) lines.push('PR 連結：' + opts.prUrl);
        if (opts.actionsUrl) lines.push('Actions 日誌：' + opts.actionsUrl);
      } else {
        lines.push('主人注意：自我升級任務執行失敗（狀態：' + (opts.conclusion || 'failure') + '）。');
        if (opts.failedSteps && opts.failedSteps.length > 0) {
          lines.push('失敗步驟：' + opts.failedSteps.join('；'));
        }
        if (opts.reason) {
          lines.push('失敗原因：' + opts.reason);
        }
        if (opts.actionsUrl) {
          lines.push('查看詳細日誌：' + opts.actionsUrl);
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
      var metaLabel = '主動回報 · 自我升級' + (isSuccess ? '成功' : '失敗');
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
        var failedSteps = [];
        if (targetRun.status === 'completed' && targetRun.conclusion !== 'success' && targetRun.id) {
          try {
            var jRes = await fetch('https://api.github.com/repos/' + parsed.repo + '/actions/runs/' + targetRun.id + '/jobs?per_page=10', { headers: ghHeaders });
            if (jRes.ok) {
              var jData = await jRes.json();
              var jobs = Array.isArray(jData.jobs) ? jData.jobs : [];
              jobs.forEach(function (job) {
                var steps = Array.isArray(job.steps) ? job.steps : [];
                steps.forEach(function (s) {
                  if (s.conclusion === 'failure' || s.conclusion === 'cancelled' || s.conclusion === 'timed_out') {
                    failedSteps.push((job.name || 'Job') + ' > ' + (s.name || '步驟'));
                  }
                });
              });
            }
          } catch (e) {
            // 忽略 jobs 額外查詢失敗
          }
        }
        return {
          id: targetRun.id ? String(targetRun.id) : parsed.runId,
          status: targetRun.status || '',
          conclusion: targetRun.conclusion || '',
          htmlUrl: targetRun.html_url || actionsUrl,
          displayTitle: targetRun.display_title || targetRun.name || '',
          updatedAt: targetRun.updated_at || targetRun.created_at || '',
          failedSteps: failedSteps
        };
      } catch (e) {
        return null;
      }
    }

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
      var s = String(st.status || '').toLowerCase();
      if (s === 'running' || s === 'in_progress' || s === 'queued' || s === 'waiting' || s === 'pending' || s === 'pr_created') {
        var parsed = parseGitHubRunTarget(track.actionsUrl);
        var doneKey1 = buildUpgradeKey(parsed.runId, track.actionsUrl, track.startedAt, 'success');
        var doneKey2 = buildUpgradeKey(parsed.runId, track.actionsUrl, track.startedAt, 'failure');
        if (track.reportedKeys.indexOf(doneKey1) < 0 && track.reportedKeys.indexOf(doneKey2) < 0) {
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

        var s = String(st.status || '').toLowerCase();
        if (s === 'running' || s === 'in_progress' || s === 'queued' || s === 'waiting' || s === 'pending' || s === 'pr_created') {
          var activeParsed = parseGitHubRunTarget(track.actionsUrl);
          var keyOk = buildUpgradeKey(activeParsed.runId, track.actionsUrl, track.startedAt, 'success');
          var keyFail = buildUpgradeKey(activeParsed.runId, track.actionsUrl, track.startedAt, 'failure');
          if (track.reportedKeys.indexOf(keyOk) < 0 && track.reportedKeys.indexOf(keyFail) < 0) {
            track.tracking = true;
            track.lastStatus = st.status;
            if (!track.startedAt) track.startedAt = Date.now();
            saveUpgradeTrack(track);
            ensureUpgradeWatchTimer();
          }
        }

        if (!track.tracking) return false;

        var ghInfo = track.actionsUrl ? await fetchGitHubRunSummary(track.actionsUrl) : null;
        if (ghInfo) {
          if (ghInfo.status !== 'completed') {
            track.lastStatus = ghInfo.status || 'in_progress';
            saveUpgradeTrack(track);
            return false;
          }
          var ghIsSuccess = ghInfo.conclusion === 'success';
          var ghReason = '';
          if (!ghIsSuccess) {
            if (st.error) ghReason = st.error;
            else if (Array.isArray(st.logs) && st.logs.length > 0) ghReason = st.logs[st.logs.length - 1];
          }
          return emitUpgradeProactiveReport({
            isSuccess: ghIsSuccess,
            runId: ghInfo.id,
            conclusion: ghInfo.conclusion || (ghIsSuccess ? 'success' : 'failure'),
            actionsUrl: ghInfo.htmlUrl || track.actionsUrl,
            prUrl: track.prUrl,
            summary: track.summary || ghInfo.displayTitle,
            failedSteps: ghInfo.failedSteps,
            reason: ghReason
          });
        }

        if (s === 'merged' || s === 'completed' || s === 'success') {
          return emitUpgradeProactiveReport({
            isSuccess: true,
            runId: parseGitHubRunTarget(track.actionsUrl).runId || '',
            conclusion: 'success',
            actionsUrl: track.actionsUrl,
            prUrl: track.prUrl,
            summary: track.summary,
            failedSteps: [],
            reason: ''
          });
        }

        if (st.is_stale || (s !== 'running' && s !== 'in_progress' && s !== 'queued' && s !== 'waiting' && s !== 'pending' && s !== 'pr_created')) {
          var failReason = st.error || (st.is_stale ? '升級任務超過 20 分鐘無心跳更新' : (Array.isArray(st.logs) && st.logs.length > 0 ? st.logs[st.logs.length - 1] : '狀態異常終止'));
          return emitUpgradeProactiveReport({
            isSuccess: false,
            runId: parseGitHubRunTarget(track.actionsUrl).runId || '',
            conclusion: st.status || 'failure',
            actionsUrl: track.actionsUrl,
            prUrl: track.prUrl,
            summary: track.summary,
            failedSteps: [],
            reason: failReason
          });
        }

        return false;
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

    function loadCareLocalStore() {
      try {
        var raw = localStorage.getItem(CARE_STORAGE_KEY);
        if (!raw) return { energy: 75, affection: 60, lastFedAt: 0 };
        var parsed = JSON.parse(raw);
        return {
          energy: clampVal(parsed.energy !== undefined ? parsed.energy : 75),
          affection: clampVal(parsed.affection !== undefined ? parsed.affection : 60),
          lastFedAt: parsed.lastFedAt || 0
        };
      } catch (e) {
        return { energy: 75, affection: 60, lastFedAt: 0 };
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
      careEnergyTextEl.textContent = st.energy + ' / 100';
      careEnergyBarEl.style.width = st.energy + '%';
      careAffectionTextEl.textContent = st.affection + ' / 100';
      careAffectionBarEl.style.width = st.affection + '%';
      careMoodTextEl.textContent = '狀態：' + getMoodLabel(st.energy, st.affection);
      petStatsEl.textContent = '好感度 ' + st.affection + ' ｜ 活力 ' + st.energy;
    }

    window.syncPetStatsFromBackend = function (affectionVal, energyVal) {
      var st = loadCareLocalStore();
      if (affectionVal !== undefined && affectionVal !== null) {
        st.affection = clampVal(affectionVal);
      }
      if (energyVal !== undefined && energyVal !== null) {
        st.energy = clampVal(energyVal);
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

    // 保留 petStageEl 供未來 3D 桌寵模型掛載使用
    window.petStageElement = petStageEl;

    updateCareUiDisplay();
`;
