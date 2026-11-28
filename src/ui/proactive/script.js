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
      window.dispatchEvent(new CustomEvent('pet:proactive-bubble-shown', {
        detail: { rule: rule, message: finalMsg, aiUsed: Boolean(aiUsed) }
      }));
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
