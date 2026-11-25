export const CHAT_HTML = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#0f111a" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <title>Gemini 桌寵</title>
  <style>
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
      flex-wrap: wrap;
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
    .header-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .btn-icon {
      background: #23283a; color: #cfd5e6; border: 1px solid #323952;
      border-radius: 8px; padding: 6px 10px; font-size: 13px; cursor: pointer;
    }
    .btn-icon.active {
      background: #2c2856; color: #dcd6ff; border-color: #6c5ce7;
    }
    .panel-bar {
      display: none;
      background: #141827;
      border-bottom: 1px solid #2b3147;
      padding: 10px 14px;
      font-size: 12px;
      color: #cfd5e6;
      max-height: 44dvh;
      overflow-y: auto;
    }
    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .proactive-section {
      border-top: 1px solid #242a3d;
      padding-top: 8px;
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .proactive-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .proactive-input, .proactive-select {
      background: #0f111a;
      color: #e6e8f0;
      border: 1px solid #2f3650;
      border-radius: 8px;
      padding: 6px 8px;
      font-size: 12px;
      outline: none;
    }
    .proactive-input:focus, .proactive-select:focus { border-color: #7c6ff7; }
    .proactive-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .proactive-item {
      background: #1a1f31;
      border: 1px solid #2a314a;
      border-radius: 8px;
      padding: 7px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .proactive-item-meta {
      font-size: 11px;
      color: #9aa3bd;
      margin-top: 2px;
    }
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
    .bubble.has-time {
      padding-bottom: 7px;
    }
    .bubble-text {
      white-space: pre-wrap;
      word-break: break-word;
    }
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
      display: none; align-items: center; justify-content: center; padding: 20px; z-index: 99;
    }
    .modal.open { display: flex; }
    .modal-card {
      background: #171a26; border: 1px solid #2f3650; border-radius: 14px;
      width: 100%; max-width: 360px; padding: 18px; display: flex; flex-direction: column; gap: 12px;
    }
    .modal-card h3 { font-size: 16px; }
    .modal-card label { font-size: 12px; color: #9aa3bd; display: block; margin-bottom: 4px; }
    .modal-card input {
      width: 100%; background: #0f111a; color: #fff; border: 1px solid #2f3650;
      border-radius: 8px; padding: 10px; font-size: 14px; outline: none;
    }
    .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
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
      <button class="btn-icon" id="notifyBtn">🔕 通知</button>
      <button class="btn-icon" id="proactiveBtn">⏰ 主動關懷</button>
      <button class="btn-icon" id="upgradeBtn">升級進度</button>
      <button class="btn-icon" id="settingsBtn">設定</button>
    </div>
  </header>
  <div id="upgradeBar" class="panel-bar">
    <div class="panel-header">
      <strong id="upgradeTitle">🔄 升級進度追蹤中...</strong>
      <button class="btn-icon" id="closeUpgradeBar" style="padding:2px 8px;font-size:11px;">隱藏</button>
    </div>
    <pre id="upgradeLogs" style="white-space:pre-wrap;font-family:monospace;color:#9aa3bd;max-height:120px;overflow-y:auto;line-height:1.4;"></pre>
    <div id="upgradeLink" style="margin-top:6px;"></div>
  </div>
  <div id="proactiveBar" class="panel-bar">
    <div class="panel-header">
      <strong>⏰ 主動訊息與系統通知設定</strong>
      <button class="btn-icon" id="closeProactiveBar" style="padding:2px 8px;font-size:11px;">隱藏</button>
    </div>
    <div class="proactive-row">
      <span id="notifyStatusText" style="color:#9aa3bd;">系統通知狀態檢查中...</span>
      <button class="btn-icon" id="toggleNotifyInsideBtn" style="padding:3px 8px;font-size:11px;">切換通知</button>
      <button class="btn-icon" id="testCareNowBtn" style="padding:3px 8px;font-size:11px;">立即測試關懷</button>
    </div>
    <div class="proactive-section">
      <div class="proactive-row">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="checkbox" id="idleCareCheckbox" />
          <span>啟用閒置／回到頁面主動關懷</span>
        </label>
        <select id="idleMinutesSelect" class="proactive-select">
          <option value="1">閒置 1 分鐘</option>
          <option value="5">閒置 5 分鐘</option>
          <option value="15">閒置 15 分鐘</option>
          <option value="30">閒置 30 分鐘</option>
          <option value="60">閒置 60 分鐘</option>
        </select>
      </div>
    </div>
    <div class="proactive-section">
      <div style="font-weight:600;color:#e6e8f0;">新增排程主動訊息</div>
      <div class="proactive-row">
        <input id="proactiveMsgInput" class="proactive-input" type="text" placeholder="例如：主人記得喝水伸展一下喔！" style="flex:1;min-width:170px;" />
        <input id="proactiveDelayInput" class="proactive-input" type="number" min="1" max="1440" value="5" style="width:68px;" title="延遲分鐘數" />
        <span style="color:#9aa3bd;">分鐘後</span>
      </div>
      <div class="proactive-row">
        <select id="proactiveEmotionSelect" class="proactive-select">
          <option value="caring">🥰 關懷</option>
          <option value="happy">😸 開心</option>
          <option value="idle">🐱 待機</option>
          <option value="thinking">🤔 思考</option>
          <option value="sleepy">😪 想睡</option>
        </select>
        <select id="proactiveRepeatSelect" class="proactive-select">
          <option value="0">單次提醒</option>
          <option value="30">每 30 分鐘重複</option>
          <option value="60">每 60 分鐘重複</option>
        </select>
        <button id="addProactiveBtn" class="btn-icon active" style="padding:5px 12px;font-size:12px;">新增排程</button>
      </div>
      <div id="proactiveList" class="proactive-list"></div>
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
        <button id="saveSettingsBtn" style="background:#6c5ce7;color:#fff;border:none;border-radius:8px;padding:6px 14px;cursor:pointer;">儲存</button>
      </div>
    </div>
  </div>

  <script>
    const EMOJI_MAP = {
      idle: '🐱',
      happy: '😸',
      thinking: '🤔',
      sleepy: '😪',
      caring: '🥰'
    };

    const chatEl = document.getElementById('chat');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('sendBtn');
    const petEmojiEl = document.getElementById('petEmoji');
    const petStatsEl = document.getElementById('petStats');
    const modalEl = document.getElementById('settingsModal');
    const tokenInput = document.getElementById('tokenInput');
    const uidInput = document.getElementById('uidInput');

    const notifyBtn = document.getElementById('notifyBtn');
    const proactiveBtn = document.getElementById('proactiveBtn');
    const proactiveBar = document.getElementById('proactiveBar');
    const notifyStatusText = document.getElementById('notifyStatusText');
    const toggleNotifyInsideBtn = document.getElementById('toggleNotifyInsideBtn');
    const testCareNowBtn = document.getElementById('testCareNowBtn');
    const idleCareCheckbox = document.getElementById('idleCareCheckbox');
    const idleMinutesSelect = document.getElementById('idleMinutesSelect');
    const proactiveMsgInput = document.getElementById('proactiveMsgInput');
    const proactiveDelayInput = document.getElementById('proactiveDelayInput');
    const proactiveEmotionSelect = document.getElementById('proactiveEmotionSelect');
    const proactiveRepeatSelect = document.getElementById('proactiveRepeatSelect');
    const addProactiveBtn = document.getElementById('addProactiveBtn');
    const proactiveListEl = document.getElementById('proactiveList');

    function detectPlatform() {
      const ua = navigator.userAgent || '';
      if (/Mac/i.test(ua) && !/Android/i.test(ua)) return 'macos';
      if (/Windows/i.test(ua)) return 'windows';
      return 'android';
    }

    function isMobileTouchDevice() {
      const ua = navigator.userAgent || '';
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
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '';
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return hh + ':' + mm;
    }

    function renderMessage(role, text, metaText, timestamp) {
      const wrap = document.createElement('div');
      wrap.className = 'msg ' + role;
      const bubble = document.createElement('div');
      bubble.className = 'bubble';

      const textEl = document.createElement('div');
      textEl.className = 'bubble-text';
      textEl.textContent = text;
      bubble.appendChild(textEl);

      const timeStr = formatTime(timestamp);
      if (timeStr) {
        bubble.classList.add('has-time');
        const timeEl = document.createElement('div');
        timeEl.className = 'bubble-time';
        timeEl.textContent = timeStr;
        bubble.appendChild(timeEl);
      }

      wrap.appendChild(bubble);
      if (metaText) {
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = metaText;
        wrap.appendChild(meta);
      }
      chatEl.appendChild(wrap);
      chatEl.scrollTop = chatEl.scrollHeight;
      return wrap;
    }

    function supportsWebNotification() {
      return typeof window !== 'undefined' && 'Notification' in window;
    }

    function isNotifyEnabled() {
      return localStorage.getItem('pet_notify_enabled') === '1';
    }

    function updateNotifyUi() {
      if (!supportsWebNotification()) {
        notifyBtn.textContent = '🔕 不支援通知';
        notifyBtn.classList.remove('active');
        notifyStatusText.textContent = '此瀏覽器環境不支援 Web Notification API';
        return;
      }
      const perm = Notification.permission;
      const enabled = isNotifyEnabled() && perm === 'granted';
      if (enabled) {
        notifyBtn.textContent = '🔔 通知開';
        notifyBtn.classList.add('active');
        notifyStatusText.textContent = '系統通知：已啟用（背景時自動彈出系統通知）';
      } else if (perm === 'denied') {
        notifyBtn.textContent = '🔕 通知封鎖';
        notifyBtn.classList.remove('active');
        notifyStatusText.textContent = '系統通知：已被瀏覽器封鎖，請至網站權限開啟';
      } else {
        notifyBtn.textContent = '🔕 通知關';
        notifyBtn.classList.remove('active');
        notifyStatusText.textContent = '系統通知：目前關閉（點擊右側按鈕開啟）';
      }
    }

    async function toggleWebNotification() {
      if (!supportsWebNotification()) {
        updateNotifyUi();
        return;
      }
      if (isNotifyEnabled() && Notification.permission === 'granted') {
        localStorage.setItem('pet_notify_enabled', '0');
        updateNotifyUi();
        return;
      }
      if (Notification.permission === 'default') {
        try {
          const result = await Notification.requestPermission();
          if (result === 'granted') {
            localStorage.setItem('pet_notify_enabled', '1');
            try {
              new Notification('Gemini 桌寵通知已開啟', {
                body: '之後有定時提醒或主動關懷時會通知你喔！',
                tag: 'pet-notify-enabled'
              });
            } catch (e) {}
          } else {
            localStorage.setItem('pet_notify_enabled', '0');
          }
        } catch (e) {
          localStorage.setItem('pet_notify_enabled', '0');
        }
      } else if (Notification.permission === 'granted') {
        localStorage.setItem('pet_notify_enabled', '1');
        try {
          new Notification('Gemini 桌寵通知已開啟', {
            body: '背景主動提醒與關懷通知已恢復啟用。',
            tag: 'pet-notify-enabled'
          });
        } catch (e) {}
      }
      updateNotifyUi();
    }

    function loadProactiveSchedules() {
      try {
        const raw = JSON.parse(localStorage.getItem('pet_proactive_schedules') || '[]');
        return Array.isArray(raw) ? raw : [];
      } catch (e) {
        return [];
      }
    }

    function saveProactiveSchedules(list) {
      localStorage.setItem('pet_proactive_schedules', JSON.stringify(list));
    }

    function renderProactiveList() {
      const list = loadProactiveSchedules().slice().sort(function (a, b) {
        return (a.triggerAt || 0) - (b.triggerAt || 0);
      });
      proactiveListEl.innerHTML = '';
      if (list.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.style.color = '#7e87a3';
        emptyEl.textContent = '目前沒有待發送的本地排程。';
        proactiveListEl.appendChild(emptyEl);
        return;
      }
      list.forEach(function (item) {
        const row = document.createElement('div');
        row.className = 'proactive-item';

        const info = document.createElement('div');
        const titleLine = document.createElement('div');
        const emoji = EMOJI_MAP[item.emotion] || '🥰';
        titleLine.textContent = emoji + ' ' + item.message;
        const metaLine = document.createElement('div');
        metaLine.className = 'proactive-item-meta';
        const d = new Date(item.triggerAt);
        const timeStr = isNaN(d.getTime()) ? '' : (String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
        const repeatStr = item.repeatMinutes > 0 ? (' · 每 ' + item.repeatMinutes + ' 分鐘重複') : ' · 單次';
        metaLine.textContent = '預計 ' + timeStr + ' 發送' + repeatStr;
        info.appendChild(titleLine);
        info.appendChild(metaLine);

        const delBtn = document.createElement('button');
        delBtn.className = 'btn-icon';
        delBtn.style.padding = '3px 8px';
        delBtn.style.fontSize = '11px';
        delBtn.textContent = '刪除';
        delBtn.onclick = function () {
          const next = loadProactiveSchedules().filter(function (entry) {
            return entry.id !== item.id;
          });
          saveProactiveSchedules(next);
          renderProactiveList();
        };

        row.appendChild(info);
        row.appendChild(delBtn);
        proactiveListEl.appendChild(row);
      });
    }

    function isIdleCareEnabled() {
      const raw = localStorage.getItem('pet_idle_care_enabled');
      return raw === null ? true : raw === '1';
    }

    function getIdleMinutes() {
      const val = Number(localStorage.getItem('pet_idle_minutes') || '15');
      return Number.isFinite(val) && val >= 1 ? val : 15;
    }

    function pickCaringMessage(isWelcomeBack) {
      const hour = new Date().getHours();
      if (isWelcomeBack) {
        return {
          emotion: 'happy',
          text: '主人歡迎回來！剛剛都在忙些什麼呢？隨時跟我聊聊吧。'
        };
      }
      if (hour >= 0 && hour < 6) {
        return {
          emotion: 'sleepy',
          text: '已經深夜囉，主人記得早點休息、讓眼睛和腦袋放鬆一下！'
        };
      }
      if (hour >= 11 && hour < 14) {
        return {
          emotion: 'caring',
          text: '午間時間到了，主人記得吃飯補充能量、順便喝杯水喔！'
        };
      }
      if (hour >= 18 && hour < 23) {
        return {
          emotion: 'caring',
          text: '忙碌了一陣子，主人別忘了站起來伸展肩頸、喝口水休息一下。'
        };
      }
      return {
        emotion: 'caring',
        text: '主人專心好一陣子了呢！記得喝口水、眨眨眼睛休息一分鐘喔。'
      };
    }

    function deliverProactiveMessage(text, emotion, notifyTitle, metaLabel, forceNotify) {
      const validEmotion = EMOJI_MAP[emotion] ? emotion : 'caring';
      petEmojiEl.textContent = EMOJI_MAP[validEmotion] || '🥰';
      const now = Date.now();
      const log = loadLocalLog();
      log.push({ role: 'bot', text: text, meta: metaLabel, time: now });
      saveLocalLog(log);
      renderMessage('bot', text, metaLabel, now);

      const inBackground = document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus());
      if ((inBackground || forceNotify) && isNotifyEnabled() && supportsWebNotification() && Notification.permission === 'granted') {
        try {
          const n = new Notification(notifyTitle || 'Gemini 桌寵主動訊息', {
            body: text,
            tag: 'pet-proactive-' + now
          });
          n.onclick = function () {
            window.focus();
            n.close();
          };
        } catch (e) {}
      }
    }

    let lastActivityAt = Date.now();
    let lastCareSentAt = 0;
    let hiddenSinceAt = 0;

    function markUserActivity() {
      lastActivityAt = Date.now();
    }

    ['pointerdown', 'keydown', 'touchstart'].forEach(function (evtName) {
      document.addEventListener(evtName, markUserActivity, { passive: true });
    });

    function checkProactiveTick(fromVisibilityReturn) {
      const now = Date.now();
      const schedules = loadProactiveSchedules();
      let changed = false;
      const remaining = [];

      schedules.forEach(function (item) {
        if (item.triggerAt <= now) {
          changed = true;
          deliverProactiveMessage(
            item.message,
            item.emotion,
            'Gemini 桌寵排程提醒',
            '主動訊息 · 排程提醒',
            false
          );
          if (item.repeatMinutes && item.repeatMinutes > 0) {
            const intervalMs = item.repeatMinutes * 60000;
            let nextTrigger = item.triggerAt + intervalMs;
            while (nextTrigger <= now) {
              nextTrigger += intervalMs;
            }
            item.triggerAt = nextTrigger;
            remaining.push(item);
          }
        } else {
          remaining.push(item);
        }
      });

      if (changed) {
        saveProactiveSchedules(remaining);
        renderProactiveList();
      }

      if (!isIdleCareEnabled()) {
        return;
      }

      const idleMs = getIdleMinutes() * 60000;
      const careCooldownOk = (now - lastCareSentAt) >= idleMs;
      if (!careCooldownOk) {
        return;
      }

      if (fromVisibilityReturn && hiddenSinceAt > 0 && (now - hiddenSinceAt) >= idleMs) {
        const care = pickCaringMessage(true);
        lastCareSentAt = now;
        lastActivityAt = now;
        hiddenSinceAt = 0;
        deliverProactiveMessage(care.text, care.emotion, 'Gemini 桌寵歡迎你回來', '主動訊息 · 回到頁面關懷', false);
        return;
      }

      if (!document.hidden && (now - lastActivityAt) >= idleMs) {
        const care = pickCaringMessage(false);
        lastCareSentAt = now;
        lastActivityAt = now;
        deliverProactiveMessage(care.text, care.emotion, 'Gemini 桌寵關心你', '主動訊息 · 閒置關懷', false);
      }
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        hiddenSinceAt = Date.now();
      } else {
        checkProactiveTick(true);
        hiddenSinceAt = 0;
      }
    });

    window.addEventListener('focus', function () {
      checkProactiveTick(false);
    });

    notifyBtn.onclick = toggleWebNotification;
    toggleNotifyInsideBtn.onclick = toggleWebNotification;
    proactiveBtn.onclick = function () {
      const isOpen = proactiveBar.style.display === 'block';
      proactiveBar.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) {
        updateNotifyUi();
        renderProactiveList();
      }
    };
    document.getElementById('closeProactiveBar').onclick = function () {
      proactiveBar.style.display = 'none';
    };
    idleCareCheckbox.checked = isIdleCareEnabled();
    idleMinutesSelect.value = String(getIdleMinutes());
    idleCareCheckbox.onchange = function () {
      localStorage.setItem('pet_idle_care_enabled', idleCareCheckbox.checked ? '1' : '0');
    };
    idleMinutesSelect.onchange = function () {
      localStorage.setItem('pet_idle_minutes', idleMinutesSelect.value);
    };
    testCareNowBtn.onclick = function () {
      const care = pickCaringMessage(false);
      lastCareSentAt = Date.now();
      lastActivityAt = Date.now();
      deliverProactiveMessage(care.text, care.emotion, 'Gemini 桌寵主動關懷', '主動訊息 · 測試關懷', true);
    };
    addProactiveBtn.onclick = function () {
      const msg = proactiveMsgInput.value.trim();
      const delayMin = Number(proactiveDelayInput.value);
      if (!msg) {
        proactiveMsgInput.focus();
        return;
      }
      const safeDelay = Number.isFinite(delayMin) && delayMin >= 1 ? Math.round(delayMin) : 5;
      const repeatMin = Number(proactiveRepeatSelect.value) || 0;
      const item = {
        id: Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        message: msg,
        emotion: proactiveEmotionSelect.value || 'caring',
        triggerAt: Date.now() + safeDelay * 60000,
        repeatMinutes: repeatMin
      };
      const list = loadProactiveSchedules();
      list.push(item);
      saveProactiveSchedules(list);
      proactiveMsgInput.value = '';
      renderProactiveList();
    };

    function openSettings() {
      const cfg = getConfig();
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

    async function sendMessage() {
      const text = inputEl.value.trim();
      if (!text) return;

      const cfg = getConfig();
      if (!cfg.token) {
        openSettings();
        return;
      }

      markUserActivity();
      inputEl.value = '';
      inputEl.style.height = 'auto';
      sendBtn.disabled = true;

      const userTime = Date.now();
      const log = loadLocalLog();
      log.push({ role: 'user', text: text, meta: '', time: userTime });
      saveLocalLog(log);
      renderMessage('user', text, '', userTime);

      const loadingEl = renderMessage('bot', '思考中...', '', null);

      try {
        const res = await fetch('/v1/pet/interact', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + cfg.token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: cfg.uid,
            device: {
              platform: detectPlatform(),
              context: 'PWA 專屬介面'
            },
            input: {
              type: 'text',
              content: text
            }
          })
        });

        const data = await res.json();
        loadingEl.remove();

        const reply = data.reply || JSON.stringify(data);
        const emotion = (data.action && data.action.emotion) ? data.action.emotion : 'idle';
        petEmojiEl.textContent = EMOJI_MAP[emotion] || '🐱';

        if (data.pet_state) {
          petStatsEl.textContent = '好感度 ' + data.pet_state.affection + ' ｜ 活力 ' + data.pet_state.energy;
        }

        const metaParts = [];
        if (data.meta && data.meta.model_used) metaParts.push(data.meta.model_used);
        if (data.meta && data.meta.tools_used && data.meta.tools_used.length > 0) {
          metaParts.push('工具: ' + data.meta.tools_used.join(', '));
        }
        const metaStr = metaParts.join(' · ');

        const botTime = Date.now();
        const updatedLog = loadLocalLog();
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
    let pollTimer = null;
    const upgradeBar = document.getElementById('upgradeBar');
    const upgradeTitle = document.getElementById('upgradeTitle');
    const upgradeLogs = document.getElementById('upgradeLogs');
    const upgradeLink = document.getElementById('upgradeLink');

    document.getElementById('closeUpgradeBar').onclick = function () {
      upgradeBar.style.display = 'none';
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    };

    async function fetchUpgradeStatus() {
      const cfg = getConfig();
      if (!cfg.token) return;
      try {
        const res = await fetch('/v1/pet/upgrade/status?uid=' + encodeURIComponent(cfg.uid), {
          headers: { 'Authorization': 'Bearer ' + cfg.token }
        });
        const st = await res.json();
        upgradeBar.style.display = 'block';

        if (st.status === 'idle') {
          upgradeTitle.textContent = 'ℹ️ 目前尚無自我升級紀錄';
          upgradeLogs.textContent = '';
          upgradeLink.innerHTML = '';
          return;
        }

        if (st.is_stale) {
          upgradeTitle.textContent = '⚠️ 任務已超過 6 分鐘無更新，請點擊下方 Actions 確認';
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

        upgradeLogs.textContent = (st.logs || []).join('\\n') + (st.error ? '\\n錯誤: ' + st.error : '');
        upgradeLogs.scrollTop = upgradeLogs.scrollHeight;

        const links = [];
        if (st.actions_url) {
          links.push('<a href="' + st.actions_url + '" target="_blank" style="color:#74b9ff;margin-right:12px;">查看 Actions 即時終端日誌 ↗</a>');
        }
        if (st.pr_url) {
          links.push('<a href="' + st.pr_url + '" target="_blank" style="color:#a29bfe;">查看 PR 變更內容 ↗</a>');
        }
        upgradeLink.innerHTML = links.join('');
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

    let isImeComposing = false;
    let lastCompositionEndAt = 0;
    inputEl.addEventListener('compositionstart', function () {
      isImeComposing = true;
    });
    inputEl.addEventListener('compositionend', function () {
      isImeComposing = false;
      lastCompositionEndAt = Date.now();
    });
    inputEl.addEventListener('keydown', function (e) {
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

    // 初始化載入本地畫面紀錄與主動訊息檢查器
    const initialLog = loadLocalLog();
    if (initialLog.length === 0) {
      renderMessage('bot', '嗨主人！點右上角「設定」填入你的連線 Token 後，就可以正式開始聊天囉。', '', Date.now());
    } else {
      initialLog.forEach(function (item) {
        renderMessage(item.role, item.text, item.meta, item.time);
      });
    }

    updateNotifyUi();
    renderProactiveList();
    checkProactiveTick(false);
    setInterval(function () {
      checkProactiveTick(false);
    }, 10000);

    if (!getConfig().token) {
      openSettings();
    }
  </script>
</body>
</html>`;
