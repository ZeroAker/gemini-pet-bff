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
        window.dispatchEvent(new CustomEvent('pet:upgrade-status-synced', { detail: { status: st } }));

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
    syncLogCabinLayout();
    if (getConfig().token) {
      fetchUpgradeStatus();
    }
