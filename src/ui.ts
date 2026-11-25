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
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
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
    .btn-icon {
      background: #23283a; color: #cfd5e6; border: 1px solid #323952;
      border-radius: 8px; padding: 6px 10px; font-size: 13px; cursor: pointer;
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
      white-space: pre-wrap;
      word-break: break-word;
    }
    .msg.user .bubble { background: #5b4ee6; color: #fff; border-bottom-right-radius: 4px; }
    .msg.bot .bubble { background: #1d2233; color: #e6e8f0; border: 1px solid #2b3147; border-bottom-left-radius: 4px; }
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
    <button class="btn-icon" id="settingsBtn">設定</button>
  </header>

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

    function detectPlatform() {
      const ua = navigator.userAgent || '';
      if (/Mac/i.test(ua) && !/Android/i.test(ua)) return 'macos';
      if (/Windows/i.test(ua)) return 'windows';
      return 'android';
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

    function renderMessage(role, text, metaText) {
      const wrap = document.createElement('div');
      wrap.className = 'msg ' + role;
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = text;
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

      inputEl.value = '';
      inputEl.style.height = 'auto';
      sendBtn.disabled = true;

      const log = loadLocalLog();
      log.push({ role: 'user', text: text, meta: '' });
      saveLocalLog(log);
      renderMessage('user', text, '');

      const loadingEl = renderMessage('bot', '思考中...', '');

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

        const updatedLog = loadLocalLog();
        updatedLog.push({ role: 'bot', text: reply, meta: metaStr });
        saveLocalLog(updatedLog);
        renderMessage('bot', reply, metaStr);
      } catch (err) {
        loadingEl.remove();
        renderMessage('bot', '⚠️ 連線失敗：' + err.message, '');
      } finally {
        sendBtn.disabled = false;
        inputEl.focus();
      }
    }

    sendBtn.onclick = sendMessage;
    inputEl.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    // 初始化載入本地畫面紀錄
    const initialLog = loadLocalLog();
    if (initialLog.length === 0) {
      renderMessage('bot', '嗨主人！點右上角「設定」填入你的連線 Token 後，就可以正式開始聊天囉。', '');
    } else {
      initialLog.forEach(function (item) {
        renderMessage(item.role, item.text, item.meta);
      });
    }

    if (!getConfig().token) {
      openSettings();
    }
  </script>
</body>
</html>`;