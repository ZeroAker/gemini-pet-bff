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
      transition: transform 0.25s ease;
    }
    .avatar.bounce { transform: scale(1.22) rotate(6deg); }
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
    .btn-primary:disabled, .btn-icon:disabled { opacity: 0.5; cursor: not-allowed; }
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
    .modal-card.wide { max-width: 480px; }
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
    .care-hero {
      background: linear-gradient(135deg, #1b1f33, #232946);
      border: 1px solid #343d63;
      border-radius: 12px;
      padding: 12px;
      display: flex;
      align-items: center;
      gap: 12px;
      position: relative;
      overflow: hidden;
    }
    .care-stage-avatar {
      width: 58px; height: 58px; border-radius: 50%;
      background: rgba(108, 92, 231, 0.25);
      border: 2px solid #7c6ff7;
      display: flex; align-items: center; justify-content: center;
      font-size: 30px; flex-shrink: 0;
      transition: transform 0.25s ease;
    }
    .care-stage-avatar.anim { transform: scale(1.25) rotate(-8deg); }
    .care-bars { flex: 1; display: flex; flex-direction: column; gap: 6px; }
    .care-bar-row { display: flex; flex-direction: column; gap: 3px; }
    .care-bar-label {
      display: flex; justify-content: space-between; font-size: 12px; color: #cfd5e6;
    }
    .care-bar-track {
      height: 8px; background: #0f111a; border-radius: 99px; overflow: hidden; border: 1px solid #2b324d;
    }
    .care-bar-fill {
      height: 100%; border-radius: 99px; transition: width 0.35s ease;
    }
    .care-bar-fill.energy { background: linear-gradient(90deg, #00b894, #55efc4); }
    .care-bar-fill.affection { background: linear-gradient(90deg, #fd79a8, #ff7675); }
    .care-feedback {
      background: #121521; border: 1px solid #2b324d; border-radius: 10px;
      padding: 9px 11px; font-size: 12px; color: #e6e8f0; min-height: 38px;
      display: flex; align-items: center; line-height: 1.4;
    }
    .snack-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .snack-card {
      background: #121521; border: 1px solid #2b324d; border-radius: 10px;
      padding: 10px 8px; display: flex; flex-direction: column; align-items: center;
      gap: 4px; cursor: pointer; text-align: center; transition: border-color 0.2s, transform 0.15s;
    }
    .snack-card:hover:not(:disabled) { border-color: #7c6ff7; transform: translateY(-2px); }
    .snack-card:disabled { opacity: 0.5; cursor: not-allowed; }
    .snack-emoji { font-size: 24px; }
    .snack-name { font-size: 12px; font-weight: 600; color: #e6e8f0; }
    .snack-boost { font-size: 11px; color: #55efc4; }
    .game-tabs { display: flex; gap: 6px; margin-bottom: 6px; }
    .game-tab {
      flex: 1; background: #121521; color: #9aa3bd; border: 1px solid #282f47;
      border-radius: 8px; padding: 7px; font-size: 12px; font-weight: 600; cursor: pointer;
    }
    .game-tab.active { background: #262c47; color: #fff; border-color: #6c5ce7; }
    .game-box {
      background: #121521; border: 1px solid #282f47; border-radius: 10px;
      padding: 12px; display: flex; flex-direction: column; gap: 10px;
    }
    .rps-row { display: flex; gap: 8px; justify-content: center; }
    .rps-btn {
      flex: 1; background: #1d2236; color: #fff; border: 1px solid #353e61;
      border-radius: 10px; padding: 10px 6px; font-size: 14px; font-weight: 600;
      cursor: pointer; transition: border-color 0.2s, transform 0.15s;
    }
    .rps-btn:hover:not(:disabled) { border-color: #a29bfe; transform: scale(1.04); }
    .rps-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .heart-arena {
      position: relative; height: 140px; background: #0c0e17;
      border: 1px dashed #353e61; border-radius: 10px; overflow: hidden;
      display: flex; align-items: center; justify-content: center;
      user-select: none;
    }
    .heart-target {
      position: absolute; font-size: 24px; cursor: pointer;
      background: none; border: none; padding: 4px;
      transition: transform 0.1s ease;
    }
    .heart-target:active { transform: scale(1.35); }
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
      <button class="btn-icon" id="careGameBtn">🎮 餵食與遊戲</button>
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
      <div class="proactive-bubble-icon" id="proactiveBubbleIcon">🐾</div>
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

  <div class="modal" id="careGameModal">
    <div class="modal-card wide">
      <h3>🎮 桌寵餵食與互動小遊戲</h3>
      <div class="care-hero">
        <div class="care-stage-avatar" id="careStageAvatar">😸</div>
        <div class="care-bars">
          <div class="care-bar-row">
            <div class="care-bar-label">
              <span>⚡ 活力值 (Energy)</span>
              <strong id="careEnergyText">75 / 100</strong>
            </div>
            <div class="care-bar-track">
              <div class="care-bar-fill energy" id="careEnergyBar" style="width:75%;"></div>
            </div>
          </div>
          <div class="care-bar-row">
            <div class="care-bar-label">
              <span>💖 好感度 (Affection)</span>
              <strong id="careAffectionText">60 / 100</strong>
            </div>
            <div class="care-bar-track">
              <div class="care-bar-fill affection" id="careAffectionBar" style="width:60%;"></div>
            </div>
          </div>
          <div style="font-size:11px;color:#a29bfe;margin-top:2px;" id="careMoodText">狀態：活力充沛・心情愉快</div>
        </div>
      </div>

      <div class="care-feedback" id="careFeedbackBox">點選下方點心餵食桌寵，或陪桌寵玩場小遊戲補充活力吧！✨</div>

      <div>
        <label style="margin-bottom:6px;">🍙 點心餵食區（點擊餵食補充活力）</label>
        <div class="snack-grid">
          <button class="snack-card" id="feedFishBtn">
            <span class="snack-emoji">🐟</span>
            <span class="snack-name">香烤小魚乾</span>
            <span class="snack-boost">活力 +15 · 好感 +3</span>
          </button>
          <button class="snack-card" id="feedCakeBtn">
            <span class="snack-emoji">🍰</span>
            <span class="snack-name">草莓蛋糕</span>
            <span class="snack-boost">活力 +25 · 好感 +5</span>
          </button>
          <button class="snack-card" id="feedCoffeeBtn">
            <span class="snack-emoji">☕</span>
            <span class="snack-name">特調咖啡</span>
            <span class="snack-boost">活力 +35 · 好感 +4</span>
          </button>
        </div>
      </div>

      <div>
        <label style="margin-bottom:6px;">🎲 互動小遊戲區</label>
        <div class="game-tabs">
          <button class="game-tab active" id="tabRpsBtn">✊✌️🖐️ 猜拳大作戰</button>
          <button class="game-tab" id="tabHeartsBtn">💖 點擊接愛心</button>
        </div>

        <div class="game-box" id="gameRpsPanel">
          <div style="font-size:12px;color:#cfd5e6;text-align:center;" id="rpsStatusText">選擇你要出的拳，跟桌寵一決高下吧！</div>
          <div class="rps-row">
            <button class="rps-btn" id="rpsRockBtn">✊ 石頭</button>
            <button class="rps-btn" id="rpsScissorsBtn">✌️ 剪刀</button>
            <button class="rps-btn" id="rpsPaperBtn">🖐️ 布</button>
          </div>
        </div>

        <div class="game-box" id="gameHeartsPanel" style="display:none;">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#cfd5e6;">
            <span id="heartTimerText">限時：10 秒</span>
            <span id="heartScoreText">接到愛心：0 顆</span>
          </div>
          <div class="heart-arena" id="heartArena">
            <button class="btn-primary" id="startHeartGameBtn">▶️ 開始 10 秒接愛心挑戰</button>
          </div>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn-icon" id="shareCareChatBtn">💬 讓桌寵回應這次互動</button>
        <button class="btn-icon" id="closeCareModalBtn">關閉</button>
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

    function triggerAvatarBounce() {
      petEmojiEl.classList.add('bounce');
      setTimeout(function () {
        petEmojiEl.classList.remove('bounce');
      }, 320);
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
      renderMessage('bot', '嗨主人！點右上角「設定」填入你的連線 Token 後，就可以正式開始聊天或點「🎮 餵食與遊戲」陪我玩囉！', '', Date.now());
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
    var proactiveBubbleIconEl = document.getElementById('proactiveBubbleIcon');
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
      proactiveBubbleIconEl.textContent = rule.icon || '🐾';
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

  <script id="scripts-care-game">
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

    updateCareUiDisplay();
  </script>
</body>
</html>`;
