export const CHAT_HTML = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#0f111a" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <title>Gemini 桌寵</title>
  <style id="ui-styles">
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f111a;
      color: #e6e8f0;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    header {
      background: #171a26;
      border-bottom: 1px solid #262b3d;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .pet-info { display: flex; align-items: center; gap: 10px; }
    .avatar {
      width: 40px; height: 40px; border-radius: 50%;
      background: linear-gradient(135deg, #6c5ce7, #a29bfe);
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; flex-shrink: 0;
    }
    .title { font-size: 15px; font-weight: 600; }
    .stats { font-size: 12px; color: #9aa3bd; margin-top: 2px; }
    .header-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .btn-icon {
      background: #23283a; color: #cfd5e6; border: 1px solid #323952;
      border-radius: 8px; padding: 6px 10px; font-size: 13px; cursor: pointer;
    }
    .btn-icon:hover { border-color: #6c5ce7; color: #fff; }
    .btn-primary {
      background: #6c5ce7; color: #fff; border: none;
      border-radius: 8px; padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
    }
    #upgradeBar {
      display: none;
      background: #141827;
      border-bottom: 1px solid #2b3147;
      padding: 10px 14px;
      font-size: 12px;
      color: #cfd5e6;
    }
    .upgrade-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    #proactiveBubble {
      display: none;
      background: linear-gradient(135deg, #1e2238, #252b48);
      border-bottom: 1px solid #48548a;
      padding: 10px 14px;
      font-size: 13px;
      color: #f1f2f8;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    }
    #proactiveBubble.show { display: flex; }
    .proactive-bubble-body { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
    .proactive-bubble-icon {
      width: 32px; height: 32px; border-radius: 50%;
      background: rgba(108, 92, 231, 0.28); border: 1px solid #7c6ff7;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 16px;
    }
    .proactive-bubble-content { flex: 1; min-width: 0; }
    .proactive-bubble-title { font-size: 12px; font-weight: 600; color: #a29bfe; margin-bottom: 2px; }
    .proactive-bubble-text { font-size: 13px; color: #e6e8f0; word-break: break-word; }
    .proactive-bubble-actions { display: flex; gap: 6px; flex-shrink: 0; }
    #chat {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .msg { max-width: 84%; display: flex; flex-direction: column; gap: 4px; }
    .msg.user { align-self: flex-end; align-items: flex-end; }
    .msg.bot { align-self: flex-start; align-items: flex-start; }
    .bubble {
      padding: 10px 14px;
      border-radius: 16px;
      font-size: 15px;
      line-height: 1.5;
      word-break: break-word;
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 60px;
    }
    .bubble.has-time { padding-bottom: 7px; }
    .bubble-text { white-space: pre-wrap; word-break: break-word; }
    .bubble-time {
      font-size: 11px;
      line-height: 1.1;
      align-self: flex-end;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.2px;
      user-select: none;
    }
    .msg.user .bubble { background: #5b4ee6; color: #fff; border-bottom-right-radius: 4px; }
    .msg.user .bubble-time { color: rgba(255, 255, 255, 0.74); }
    .msg.bot .bubble { background: #1d2233; color: #e6e8f0; border: 1px solid #2b3147; border-bottom-left-radius: 4px; }
    .msg.bot .bubble-time { color: #8c96b2; }
    .meta { font-size: 11px; color: #7e87a3; padding: 0 4px; }
    footer {
      background: #171a26;
      border-top: 1px solid #262b3d;
      padding: 10px 12px;
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }
    textarea {
      flex: 1;
      background: #0f111a;
      color: #fff;
      border: 1px solid #2f3650;
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 15px;
      resize: none;
      max-height: 120px;
      outline: none;
      font-family: inherit;
    }
    textarea:focus { border-color: #7c6ff7; }
    #sendBtn {
      background: #6c5ce7; color: #fff; border: none;
      border-radius: 12px; padding: 10px 16px; font-size: 15px;
      font-weight: 600; cursor: pointer; flex-shrink: 0;
    }
    #sendBtn:disabled { opacity: 0.5; cursor: not-allowed; }
    .modal {
      position: fixed; inset: 0; background: rgba(0, 0, 0, 0.72);
      display: none; align-items: center; justify-content: center; padding: 16px; z-index: 99;
    }
    .modal.open { display: flex; }
    .modal-card {
      background: #171a26; border: 1px solid #2f3650; border-radius: 14px;
      width: 100%; max-width: 360px; padding: 18px; display: flex; flex-direction: column; gap: 12px;
      max-height: 88dvh; overflow-y: auto;
    }
    .modal-card.wide { max-width: 460px; }
    .modal-card h3 { font-size: 16px; }
    .modal-card label { font-size: 12px; color: #9aa3bd; display: block; margin-bottom: 4px; }
    .modal-card input, .modal-card select {
      width: 100%; background: #0f111a; color: #fff; border: 1px solid #2f3650;
      border-radius: 8px; padding: 9px 10px; font-size: 13px; outline: none;
    }
    .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; flex-wrap: wrap; }
    .proactive-top-row {
      display: flex; align-items: center; justify-content: space-between;
      background: #121521; border: 1px solid #282f47; border-radius: 10px; padding: 10px 12px;
    }
    .proactive-form {
      background: #121521; border: 1px solid #282f47; border-radius: 10px;
      padding: 12px; display: flex; flex-direction: column; gap: 8px;
    }
    .proactive-form-row { display: flex; gap: 8px; }
    .proactive-form-row > div { flex: 1; }
    .rule-list { display: flex; flex-direction: column; gap: 8px; max-height: 220px; overflow-y: auto; }
    .rule-item {
      background: #121521; border: 1px solid #282f47; border-radius: 10px;
      padding: 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .rule-item.disabled { opacity: 0.55; }
    .rule-info { flex: 1; min-width: 0; }
    .rule-title-row { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; flex-wrap: wrap; }
    .rule-name { font-size: 13px; font-weight: 600; color: #e6e8f0; }
    .rule-badge {
      font-size: 11px; padding: 1px 6px; border-radius: 6px;
      background: #252b42; color: #a29bfe; border: 1px solid #384166;
    }
    .rule-msg { font-size: 12px; color: #9aa3bd; word-break: break-word; }
    .rule-actions { display: flex; gap: 5px; flex-shrink: 0; }
    .btn-sm {
      background: #23283a; color: #cfd5e6; border: 1px solid #323952;
      border-radius: 6px; padding: 4px 8px; font-size: 11px; cursor: pointer;
    }
    .btn-sm.danger { color: #ff7675; border-color: #5c2b33; }
  </style>
</head>
<body>
  <header>
    <div class="pet-info">
      <div class="avatar" id="petEmoji">🐱</div>
      <div>
        <div class="title">Gemini 桌寵</div>
        <div class="stats" id="petStats">好感度 -- ｜ 活力 --</div>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn-icon" id="proactiveBtn">🔔 主動關懷</button>
      <button class="btn-icon" id="upgradeBtn">升級進度</button>
      <button class="btn-icon" id="settingsBtn">設定</button>
    </div>
  </header>

  <div id="upgradeBar">
    <div class="upgrade-header">
      <strong id="upgradeTitle">🔄 升級進度追蹤中...</strong>
      <button class="btn-icon" id="closeUpgradeBar" style="padding:2px 8px;font-size:11px;">隱藏</button>
    </div>
    <pre id="upgradeLogs" style="white-space:pre-wrap;font-family:monospace;color:#9aa3bd;max-height:120px;overflow-y:auto;line-height:1.4;"></pre>
    <div id="upgradeLink" style="margin-top:6px;"></div>
  </div>

  <div id="proactiveBubble">
    <div class="proactive-bubble-body">
      <div class="proactive-bubble-icon">🐾</div>
      <div class="proactive-bubble-content">
        <div class="proactive-bubble-title" id="proactiveBubbleTitle">主動關懷提醒</div>
        <div class="proactive-bubble-text" id="proactiveBubbleText"></div>
      </div>
    </div>
    <div class="proactive-bubble-actions">
      <button class="btn-sm" id="proactiveReplyBtn">回覆</button>
      <button class="btn-sm" id="proactiveCloseBtn">關閉</button>
    </div>
  </div>

  <main id="chat"></main>

  <footer>
    <textarea id="input" rows="1" placeholder="跟桌寵說點什麼..."></textarea>
    <button id="sendBtn">傳送</button>
  </footer>

  <div class="modal" id="settingsModal">
    <div class="modal-card">
      <h3>連線設定</h3>
      <div>
        <label>BFF_ACCESS_TOKEN（連線密碼）</label>
        <input id="tokenInput" type="password" placeholder="填入你在 Cloudflare 設定的 Token" />
      </div>
      <div>
        <label>User ID（跨裝置記憶識別碼）</label>
        <input id="uidInput" type="text" placeholder="例如 zero_main" />
      </div>
      <div class="modal-actions">
        <button class="btn-icon" id="clearUiBtn">清空畫面</button>
        <button class="btn-icon" id="closeModalBtn">取消</button>
        <button class="btn-primary" id="saveSettingsBtn">儲存</button>
      </div>
    </div>
  </div>

  <div class="modal" id="proactiveModal">
    <div class="modal-card wide">
      <h3>🔔 主動訊息排程面板</h3>
      <div class="proactive-top-row">
        <div>
          <div style="font-size:13px;font-weight:600;" id="proactiveGlobalLabel">主動關懷總開關：啟用中</div>
          <div style="font-size:11px;color:#9aa3bd;" id="proactiveIdleInfo">每 30 秒自動檢查到期排程與閒置狀態</div>
        </div>
        <button class="btn-icon" id="toggleGlobalProactiveBtn">切換總開關</button>
      </div>

      <div class="proactive-form">
        <div class="proactive-form-row">
          <div>
            <label>排程標題</label>
            <input id="ruleTitleInput" type="text" placeholder="例如：喝水提醒" />
          </div>
          <div>
            <label>類型</label>
            <select id="ruleTypeSelect">
              <option value="daily">每日固定時間 (daily)</option>
              <option value="interval">固定間隔分鐘 (interval)</option>
              <option value="idle">閒置觸發分鐘 (idle)</option>
            </select>
          </div>
        </div>
        <div class="proactive-form-row">
          <div id="ruleTimeWrap">
            <label>每日時間 (HH:mm)</label>
            <input id="ruleTimeInput" type="text" value="09:00" placeholder="09:00" />
          </div>
          <div id="ruleIntervalWrap" style="display:none;">
            <label>分鐘數 (正整數)</label>
            <input id="ruleIntervalInput" type="number" min="1" max="10080" value="60" />
          </div>
        </div>
        <div>
          <label>提醒訊息內容</label>
          <input id="ruleMsgInput" type="text" placeholder="主人～記得喝口水休息一下喔！" />
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:2px;">
          <button class="btn-icon" id="testProactiveBubbleBtn">立即檢查到期</button>
          <button class="btn-primary" id="addRuleBtn">＋ 新增排程</button>
        </div>
      </div>

      <div>
        <label style="margin-bottom:6px;">目前排程列表</label>
        <div class="rule-list" id="proactiveRuleList"></div>
      </div>

      <div class="modal-actions">
        <button class="btn-icon" id="syncProactiveCloudBtn">☁️ 同步至雲端工具</button>
        <button class="btn-icon" id="closeProactiveModalBtn">關閉</button>
      </div>
    </div>
  </div>

  <script id="scripts-core">
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
    };
  </script>

  <script id="scripts-chat">
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

        if (data.pet_state) {
          petStatsEl.textContent = '好感度 ' + data.pet_state.affection + ' ｜ 活力 ' + data.pet_state.energy;
        }

        var metaParts = [];
        if (data.meta && data.meta.model_used) metaParts.push(data.meta.model_used);
        if (data.meta && data.meta.tools_used && data.meta.tools_used.length > 0) {
          metaParts.push('工具: ' + data.meta.tools_used.join(', '));
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

    var pollTimer = null;
    var upgradeBar = document.getElementById('upgradeBar');
    var upgradeTitle = document.getElementById('upgradeTitle');
    var upgradeLogs = document.getElementById('upgradeLogs');
    var upgradeLink = document.getElementById('upgradeLink');

    document.getElementById('closeUpgradeBar').onclick = function () {
      upgradeBar.style.display = 'none';
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    };

    async function fetchUpgradeStatus() {
      var cfg = getConfig();
      if (!cfg.token) return;
      try {
        var res = await fetch('/v1/pet/upgrade/status?uid=' + encodeURIComponent(cfg.uid), {
          headers: { 'Authorization': 'Bearer ' + cfg.token }
        });
        var st = await res.json();
        upgradeBar.style.display = 'block';

        if (st.status === 'idle') {
          upgradeTitle.textContent = 'ℹ️ 目前尚無自我升級紀錄';
          upgradeLogs.textContent = '';
          upgradeLink.innerHTML = '';
          return;
        }

        if (st.is_stale) {
          upgradeTitle.textContent = '⚠️ 任務已超過 20 分鐘無心跳更新，請點擊下方 Actions 確認';
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        } else if (st.status === 'running') {
          upgradeTitle.textContent = '🔄 GitHub Actions 升級中（已耗時 ' + (st.elapsed_sec || 0) + ' 秒）';
        } else if (st.status === 'merged') {
          upgradeTitle.textContent = '🎉 升級已合併至主分支！Cloudflare 約 30 秒後上線';
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        } else if (st.status === 'pr_created') {
          upgradeTitle.textContent = '✅ PR 已建立，等待合併';
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        } else {
          upgradeTitle.textContent = '❌ 升級終止：' + st.status;
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
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

    function startUpgradePolling() {
      fetchUpgradeStatus();
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(fetchUpgradeStatus, 3000);
    }

    document.getElementById('upgradeBtn').onclick = startUpgradePolling;
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
      renderMessage('bot', '嗨主人！點右上角「設定」填入你的連線 Token 後，就可以正式開始聊天囉。', '', Date.now());
    } else {
      initialLog.forEach(function (item) {
        renderMessage(item.role, item.text, item.meta, item.time);
      });
    }

    if (!getConfig().token) {
      openSettings();
    }
  </script>

  <script id="scripts-proactive">
    var PROACTIVE_STORAGE_KEY = 'pet_proactive_store_v1';
    var proactiveModalEl = document.getElementById('proactiveModal');
    var proactiveRuleListEl = document.getElementById('proactiveRuleList');
    var proactiveGlobalLabelEl = document.getElementById('proactiveGlobalLabel');
    var proactiveIdleInfoEl = document.getElementById('proactiveIdleInfo');
    var ruleTypeSelectEl = document.getElementById('ruleTypeSelect');
    var ruleTimeWrapEl = document.getElementById('ruleTimeWrap');
    var ruleIntervalWrapEl = document.getElementById('ruleIntervalWrap');
    var ruleTitleInputEl = document.getElementById('ruleTitleInput');
    var ruleTimeInputEl = document.getElementById('ruleTimeInput');
    var ruleIntervalInputEl = document.getElementById('ruleIntervalInput');
    var ruleMsgInputEl = document.getElementById('ruleMsgInput');
    var proactiveBubbleEl = document.getElementById('proactiveBubble');
    var proactiveBubbleTitleEl = document.getElementById('proactiveBubbleTitle');
    var proactiveBubbleTextEl = document.getElementById('proactiveBubbleText');
    var activeBubbleRule = null;

    function createDefaultProactiveStore() {
      var nowIso = new Date().toISOString();
      return {
        globalEnabled: true,
        rules: [
          {
            id: 'daily-morning',
            title: '每日早安問候',
            message: '早安主人！新的一天開始囉，今天有什麼計畫想跟我分享嗎？☀️',
            scheduleType: 'daily',
            time: '09:00',
            intervalMinutes: 60,
            enabled: true,
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
        return parsed;
      } catch (e) {
        return createDefaultProactiveStore();
      }
    }

    function saveProactiveStore(store) {
      localStorage.setItem(PROACTIVE_STORAGE_KEY, JSON.stringify(store));
    }

    function formatScheduleBadge(rule) {
      if (rule.scheduleType === 'daily') return '每日 ' + (rule.time || '09:00');
      if (rule.scheduleType === 'interval') return '每 ' + (rule.intervalMinutes || 60) + ' 分鐘';
      return '閒置 ' + (rule.intervalMinutes || 120) + ' 分鐘';
    }

    function renderProactivePanel() {
      var store = loadProactiveStore();
      proactiveGlobalLabelEl.textContent = '主動關懷總開關：' + (store.globalEnabled ? '🟢 啟用中' : '⚪ 已停用');
      var idleMin = Math.floor((Date.now() - lastUserActivityAt) / 60000);
      proactiveIdleInfoEl.textContent = '目前閒置約 ' + idleMin + ' 分鐘 ｜ 共 ' + store.rules.length + ' 筆排程';
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

        var msgEl = document.createElement('div');
        msgEl.className = 'rule-msg';
        msgEl.textContent = rule.message;

        info.appendChild(titleRow);
        info.appendChild(msgEl);

        var actions = document.createElement('div');
        actions.className = 'rule-actions';

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

        actions.appendChild(toggleBtn);
        actions.appendChild(delBtn);

        item.appendChild(info);
        item.appendChild(actions);
        proactiveRuleListEl.appendChild(item);
      });
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

    function showProactiveNotification(rule) {
      activeBubbleRule = rule;
      proactiveBubbleTitleEl.textContent = '🔔 ' + (rule.title || '主動關懷提醒');
      proactiveBubbleTextEl.textContent = rule.message || '';
      proactiveBubbleEl.classList.add('show');
      petEmojiEl.textContent = EMOJI_MAP.caring;

      var nowTs = Date.now();
      var metaLabel = '主動關懷 · ' + formatScheduleBadge(rule);
      var log = loadLocalLog();
      log.push({ role: 'bot', text: rule.message, meta: metaLabel, time: nowTs });
      saveLocalLog(log);
      renderMessage('bot', rule.message, metaLabel, nowTs);
    }

    function checkDueProactiveRules(forceTriggerFirst) {
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
        showProactiveNotification(triggeredRule);
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

    document.getElementById('addRuleBtn').onclick = function () {
      var stype = ruleTypeSelectEl.value || 'daily';
      var title = ruleTitleInputEl.value.trim() || (stype === 'daily' ? '每日問候' : stype === 'interval' ? '定時提醒' : '閒置關懷');
      var msg = ruleMsgInputEl.value.trim() || '主人～記得休息一下喝口水喔！🐾';
      var timeVal = ruleTimeInputEl.value.trim() || '09:00';
      var intervalVal = Math.max(1, parseInt(ruleIntervalInputEl.value, 10) || 60);

      var store = loadProactiveStore();
      store.rules.push({
        id: 'rule-' + Date.now().toString(36),
        title: title,
        message: msg,
        scheduleType: stype,
        time: timeVal,
        intervalMinutes: intervalVal,
        enabled: true,
        createdAt: new Date().toISOString(),
        lastTriggeredAt: null
      });
      saveProactiveStore(store);
      ruleTitleInputEl.value = '';
      ruleMsgInputEl.value = '';
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
      var summaryText = '請使用 manage_proactive_messages 工具同步我的主動訊息設定，目前總開關為 ' + (store.globalEnabled ? 'true' : 'false') + '，共有 ' + store.rules.length + ' 筆規則：' + JSON.stringify(store.rules);
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
    setInterval(function () {
      checkDueProactiveRules(false);
    }, 30000);
  </script>
</body>
</html>`;
