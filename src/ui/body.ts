export const UI_BODY: string = `
  <header>
    <div class="pet-info">
      <div class="avatar" id="petEmoji">🐱</div>
      <div class="pet-meta">
        <div class="title" id="petTitle">Gemini 桌寵</div>
        <div class="stats" id="petStats">好感度 -- ｜ 活力 --</div>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn-icon" id="careGameBtn"><span class="btn-text-full">🎮 餵食與遊戲</span><span class="btn-text-short">🎮 餵食遊戲</span></button>
      <button class="btn-icon" id="proactiveBtn"><span class="btn-text-full">🔔 主動關懷</span><span class="btn-text-short">🔔 關懷</span></button>
      <button class="btn-icon" id="upgradeBtn"><span class="btn-text-full">升級進度</span><span class="btn-text-short">🪵 升級</span></button>
      <button class="btn-icon" id="settingsBtn"><span class="btn-text-full">設定</span><span class="btn-text-short">⚙️ 設定</span></button>
    </div>
  </header>

  <div id="titleProgressSlot" class="header-progress-slot">
    <div id="upgradeProgressContainer" class="upgrade-progress-wrap" title="點擊切換 Log Cabin（升級日誌面板）">
      <div class="upgrade-progress-info">
        <span id="upgradeProgressStatus" class="upgrade-progress-status">升級狀態：待機中</span>
        <span id="upgradeProgressPercent" class="upgrade-progress-percent">0%</span>
      </div>
      <div class="upgrade-progress-track">
        <div id="upgradeProgressFill" class="upgrade-progress-fill idle" style="width: 0%;"></div>
      </div>
    </div>
  </div>

  <div id="upgradeBar">
    <div class="upgrade-header">
      <strong id="upgradeTitle">🪵 Log Cabin · 升級日誌面板</strong>
      <button class="btn-icon" id="closeUpgradeBar" style="padding:2px 8px;font-size:11px;">隱藏</button>
    </div>
    <div id="upgradeVerdictDetail" class="upgrade-verdict-detail" style="display:none;"></div>
    <pre id="upgradeLogs" style="white-space:pre-wrap;font-family:monospace;color:#9aa3bd;max-height:120px;overflow-y:auto;line-height:1.4;"></pre>
    <div id="upgradeLink" style="margin-top:6px;"></div>
    <div id="cabinProgressSlot" class="cabin-progress-slot"></div>
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

  <div id="petStage" style="display:none;"></div>

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
        <div class="proactive-top-actions">
          <button class="btn-icon" id="toggleSysNotifyBtn">系統通知：關閉</button>
          <button class="btn-icon" id="toggleGlobalProactiveBtn">切換總開關</button>
        </div>
      </div>

      <div class="proactive-form">
        <div class="proactive-form-row">
          <div>
            <label>排程標題（主題）</label>
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
          <label>提醒訊息內容（開啟 AI 生成時作為參考提示與備用內容）</label>
          <input id="ruleMsgInput" type="text" placeholder="主人～記得喝口水休息一下喔！" />
        </div>
        <label class="proactive-ai-check" for="ruleAiGenInput">
          <input id="ruleAiGenInput" type="checkbox" />
          <span>✨ 每次由 AI 隨機生成主題句子（依標題與提示即時生成，失敗時退回原訊息）</span>
        </label>
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
`;
