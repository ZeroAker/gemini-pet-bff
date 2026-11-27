import type { UiFeatureModule } from '../ui-module-types';
import modalHtml from './modal.html';
import styles from './styles.css';

export const moduleCareGame: UiFeatureModule = {
  id: 'care-game',
  styles,
  modalHtml,
  script: `
    // ==================== [CARE_GAME] ====================
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

    window.refreshCareModalBars = function (st, boredomVal, activityStr) {
      if (!careEnergyTextEl) return;
      careEnergyTextEl.textContent = st.energy + ' / 100';
      careEnergyBarEl.style.width = st.energy + '%';
      careAffectionTextEl.textContent = st.affection + ' / 100';
      careAffectionBarEl.style.width = st.affection + '%';
      careMoodTextEl.textContent = '狀態：' + getMoodLabel(st.energy, st.affection) + ' ｜ 無聊度 ' + boredomVal + '% ｜ ' + activityStr;
    };

    function updateCareUiDisplay() {
      updateHeaderStatsDisplay();
    }

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

      showCareBubbleAndLog(snack.emoji, '餵食點心 · ' + snack.name, snack.reply, '照護互動 · 活力 ' + st.energy);
      lastCareActionSummary = '我剛餵你吃了「' + snack.name + '」，現在你活力 ' + st.energy + '、好感度 ' + st.affection + '，快跟我撒嬌回應一下吧！';
      syncCareActionToBackend({ action: 'feed', snack_id: snack.id });
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

      showCareBubbleAndLog('🎲', '猜拳大作戰', outcomeMsg, '小遊戲結算 · 活力 ' + st.energy);
      lastCareActionSummary = '我們剛玩了猜拳大作戰，我出' + moveNames[playerMove] + '，結果為 ' + result + '（現在活力 ' + st.energy + '、好感度 ' + st.affection + '），快跟我互動回應一下吧！';
      syncCareActionToBackend({ action: 'play_game', game_type: 'rps', player_choice: playerMove, game_result: result });
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

      showCareBubbleAndLog('💖', '點擊接愛心結算', msg, '小遊戲結算 · 活力 ' + st.energy);
      lastCareActionSummary = '我們剛玩了點擊接愛心挑戰，我接到了 ' + heartScore + ' 顆愛心（現在活力 ' + st.energy + '、好感度 ' + st.affection + '），快跟我互動回應一下吧！';
      syncCareActionToBackend({ action: 'play_game', game_type: 'catch_hearts', score: String(heartScore) });
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

    async function syncCareActionToBackend(payload) {
      var cfg = getConfig();
      if (!cfg.token) return null;
      try {
        var reqBody = Object.assign({ uid: cfg.uid }, payload);
        var res = await fetch('/v1/pet/care', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + cfg.token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(reqBody)
        });
        var data = await res.json();
        if (data && data.pet_state) {
          applyPetState(data.pet_state);
        }
        if (data && data.onCooldown && data.message) {
          careFeedbackBoxEl.textContent = data.message;
        } else if (data && data.summary) {
          careFeedbackBoxEl.textContent = data.summary;
        }
        return data;
      } catch (e) {
        return null;
      }
    }

    document.getElementById('careGameBtn').onclick = function () {
      updateCareUiDisplay();
      careGameModalEl.classList.add('open');
      syncPetState(false);
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
  `,
};
