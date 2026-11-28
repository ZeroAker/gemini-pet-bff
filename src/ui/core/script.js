// ==================== [CONFIG] ====================
    var EMOJI_MAP = {
      idle: '🐱',
      happy: '😸',
      thinking: '🤔',
      sleepy: '😪',
      caring: '🥰'
    };

    var chatEl = document.getElementById('chat');
    var inputEl = document.getElementById('msgInput') || document.getElementById('input');
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
    var petAvatarImgEl = document.getElementById('petAvatarImg');
    var avatarComicBubbleEl = document.getElementById('avatarComicBubble');
    var avatarComicBubbleContentEl = document.getElementById('avatarComicBubbleContent');
    var modalEl = document.getElementById('settingsModal');
    var tokenInput = document.getElementById('tokenInput');
    var uidInput = document.getElementById('uidInput');
    var lastUserActivityAt = Date.now();
    var CARE_STORAGE_KEY = 'pet_care_game_store_v1';

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
      localStorage.setItem('pet_ui_log', JSON.stringify(list.slice(-50)));
    }

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

    // ==================== [UI_RENDER] ====================
    var VALID_MOODS = ['idle', 'happy', 'thinking', 'sleepy', 'caring'];

    function normalizeMood(mood) {
      var m = String(mood || '').toLowerCase();
      return VALID_MOODS.indexOf(m) >= 0 ? m : 'idle';
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

    function isDesktopMode() {
      if (typeof window !== 'undefined' && window.electronPet && window.electronPet.isElectron) {
        return true;
      }
      try {
        var params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
        return (params.get('mode') || '').toLowerCase() === 'desktop';
      } catch (e) {
        var search = (typeof location !== 'undefined' && location.search) ? location.search.toLowerCase() : '';
        return search.indexOf('mode=desktop') >= 0;
      }
    }

    var desktopModeActive = isDesktopMode();

    if (petAvatarImgEl) {
      petAvatarImgEl.onerror = function () {
        if (!desktopModeActive) return;
        var curSrc = petAvatarImgEl.getAttribute('src') || '';
        if (curSrc !== '/avatar/idle.webp') {
          petAvatarImgEl.src = '/avatar/idle.webp';
        }
      };
    }

    function initDesktopBubbleLayout() {
      if (!desktopModeActive) {
        if (petStageEl) {
          petStageEl.style.display = 'none';
        }
        return;
      }

      document.documentElement.classList.add('mode-desktop', 'panel-collapsed-root');
      document.body.classList.add('mode-desktop', 'panel-collapsed');

      if (petStageEl) {
        petStageEl.style.display = 'flex';
      }
      if (petAvatarImgEl && !petAvatarImgEl.getAttribute('src')) {
        petAvatarImgEl.setAttribute('data-emotion', 'idle');
        petAvatarImgEl.src = '/avatar/idle.webp';
      }

      var bubbleWrap = document.getElementById('desktopChatBubble');
      if (!bubbleWrap) {
        bubbleWrap = document.createElement('div');
        bubbleWrap.id = 'desktopChatBubble';
        bubbleWrap.className = 'desktop-chat-bubble no-drag';

        var children = Array.prototype.slice.call(document.body.children);
        for (var i = 0; i < children.length; i++) {
          var child = children[i];
          if (child.id === 'petStage' || child.id === 'ui-script' || child.tagName === 'SCRIPT') {
            continue;
          }
          bubbleWrap.appendChild(child);
        }
        document.body.insertBefore(bubbleWrap, petStageEl || null);
      }

      var collapseBtnEl = document.getElementById('collapseBubbleBtn');
      if (collapseBtnEl) {
        collapseBtnEl.onclick = function (e) {
          e.stopPropagation();
          setChatPanelCollapsed(true);
        };
      }

      if (window.electronPet && typeof window.electronPet.setExpanded === 'function') {
        window.electronPet.setExpanded(false);
      }
    }

    initDesktopBubbleLayout();

    function setPetMood(mood) {
      var m = normalizeMood(mood);
      if (petEmojiEl) {
        petEmojiEl.textContent = EMOJI_MAP[m] || '🐱';
        VALID_MOODS.forEach(function (k) {
          petEmojiEl.classList.remove('mood-' + k);
        });
        petEmojiEl.classList.add('mood-' + m);
      }
      if (!desktopModeActive) return;

      if (petStageEl) {
        VALID_MOODS.forEach(function (k) {
          petStageEl.classList.remove('mood-' + k);
        });
        petStageEl.classList.add('mood-' + m);
      }
      if (petAvatarImgEl) {
        VALID_MOODS.forEach(function (k) {
          petAvatarImgEl.classList.remove('mood-' + k);
        });
        petAvatarImgEl.classList.add('mood-' + m);
        var nextAvatarSrc = '/avatar/' + m + '.webp';
        if (petAvatarImgEl.getAttribute('data-emotion') !== m) {
          petAvatarImgEl.setAttribute('data-emotion', m);
          petAvatarImgEl.src = nextAvatarSrc;
        }
      }
    }

    var lastPanelToggleAt = 0;
    var panelCloseTimer = null;
    var comicBubbleFadeTimer = null;
    var comicBubbleRemoveTimer = null;
    var isInitialHistoryHydrating = false;
    var supportsClickThrough = Boolean(
      window.electronPet && typeof window.electronPet.setIgnoreMouseEvents === 'function'
    );
    var lastElectronMouseIgnored = null;

    function isDesktopChatBubbleClosed() {
      if (!desktopModeActive) return false;
      var bubbleEl = document.getElementById('desktopChatBubble');
      if (!bubbleEl) return true;
      if (document.body.classList.contains('panel-collapsed') || document.body.classList.contains('panel-closing')) {
        return true;
      }
      if (bubbleEl.classList.contains('hidden') || bubbleEl.classList.contains('closed')) {
        return true;
      }
      return false;
    }

    function hideAvatarComicBubble(immediate) {
      if (comicBubbleFadeTimer) {
        clearTimeout(comicBubbleFadeTimer);
        comicBubbleFadeTimer = null;
      }
      if (comicBubbleRemoveTimer) {
        clearTimeout(comicBubbleRemoveTimer);
        comicBubbleRemoveTimer = null;
      }
      if (!avatarComicBubbleEl) return;
      var shouldRestoreCollapsedWindow = function () {
        if (
          desktopModeActive &&
          document.body.classList.contains('panel-collapsed') &&
          !document.body.classList.contains('panel-closing') &&
          window.electronPet &&
          typeof window.electronPet.setExpanded === 'function'
        ) {
          window.electronPet.setExpanded(false);
        }
      };
      if (immediate) {
        avatarComicBubbleEl.classList.remove('show', 'hiding');
        shouldRestoreCollapsedWindow();
        return;
      }
      if (avatarComicBubbleEl.classList.contains('show')) {
        avatarComicBubbleEl.classList.remove('show');
        avatarComicBubbleEl.classList.add('hiding');
        comicBubbleRemoveTimer = setTimeout(function () {
          comicBubbleRemoveTimer = null;
          if (avatarComicBubbleEl) {
            avatarComicBubbleEl.classList.remove('hiding');
          }
          shouldRestoreCollapsedWindow();
        }, 250);
      } else {
        avatarComicBubbleEl.classList.remove('hiding');
        shouldRestoreCollapsedWindow();
      }
    }

    function showAvatarComicBubble(text, stickerObj) {
      if (!desktopModeActive || !avatarComicBubbleEl || !avatarComicBubbleContentEl) return;
      if (!isDesktopChatBubbleClosed()) return;

      var cleanText = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
      if (cleanText) {
        var comicChars = Array.from(cleanText);
        if (comicChars.length > 50) {
          cleanText = comicChars.slice(0, 50).join('') + '...';
        }
      }
      var hasSticker = Boolean(stickerObj && stickerObj.url);
      if (!cleanText && !hasSticker) return;

      if (comicBubbleFadeTimer) {
        clearTimeout(comicBubbleFadeTimer);
        comicBubbleFadeTimer = null;
      }
      if (comicBubbleRemoveTimer) {
        clearTimeout(comicBubbleRemoveTimer);
        comicBubbleRemoveTimer = null;
      }

      // 桌寵收合時 Electron 視窗會縮至立繪大小，需暫時展開視窗空間以免漫畫氣泡被邊界裁切
      if (
        document.body.classList.contains('panel-collapsed') &&
        window.electronPet &&
        typeof window.electronPet.setExpanded === 'function'
      ) {
        window.electronPet.setExpanded(true);
      }

      avatarComicBubbleContentEl.innerHTML = '';

      if (hasSticker) {
        var stImg = document.createElement('img');
        stImg.className = 'avatar-comic-bubble-sticker';
        stImg.src = stickerObj.url;
        stImg.alt = stickerObj.meaning || stickerObj.id || '貼圖';
        stImg.draggable = false;
        avatarComicBubbleContentEl.appendChild(stImg);
      }

      if (cleanText) {
        var txtNode = document.createElement('div');
        txtNode.className = 'avatar-comic-bubble-text';
        txtNode.innerHTML = renderMarkdownSafe(cleanText);
        avatarComicBubbleContentEl.appendChild(txtNode);
      }

      avatarComicBubbleEl.classList.remove('hiding', 'show');
      void avatarComicBubbleEl.offsetWidth;
      avatarComicBubbleEl.classList.add('show');

      comicBubbleFadeTimer = setTimeout(function () {
        comicBubbleFadeTimer = null;
        hideAvatarComicBubble(false);
      }, 10000);
    }

    window.showAvatarComicBubble = showAvatarComicBubble;
    window.hideAvatarComicBubble = hideAvatarComicBubble;

    if (avatarComicBubbleEl) {
      avatarComicBubbleEl.addEventListener('mousedown', function (e) {
        e.stopPropagation();
      });
      avatarComicBubbleEl.addEventListener('click', function (e) {
        e.stopPropagation();
        hideAvatarComicBubble(true);
        setChatPanelCollapsed(false);
      });
    }

    function syncElectronClickThrough(ignore) {
      if (!supportsClickThrough) return;
      var nextIgnore = Boolean(ignore);
      if (lastElectronMouseIgnored === nextIgnore) return;
      lastElectronMouseIgnored = nextIgnore;
      window.electronPet.setIgnoreMouseEvents(nextIgnore);
    }

    function setChatPanelCollapsed(collapsed) {
      if (!desktopModeActive) return;
      if (panelCloseTimer) {
        clearTimeout(panelCloseTimer);
        panelCloseTimer = null;
      }
      if (collapsed) {
        if (!document.body.classList.contains('panel-collapsed')) {
          document.body.classList.add('panel-closing');
          panelCloseTimer = setTimeout(function () {
            panelCloseTimer = null;
            document.body.classList.remove('panel-closing');
            document.documentElement.classList.add('panel-collapsed-root');
            document.body.classList.add('panel-collapsed');
            if (!supportsClickThrough && window.electronPet && typeof window.electronPet.setExpanded === 'function') {
              window.electronPet.setExpanded(false);
            }
          }, 180);
        }
        if (supportsClickThrough && window.electronPet && typeof window.electronPet.setExpanded === 'function') {
          window.electronPet.setExpanded(false);
        }
      } else {
        hideAvatarComicBubble(true);
        document.body.classList.remove('panel-closing');
        document.documentElement.classList.remove('panel-collapsed-root');
        document.body.classList.remove('panel-collapsed');
        if (window.electronPet && typeof window.electronPet.setExpanded === 'function') {
          window.electronPet.setExpanded(true);
        }
        if (chatEl) {
          setTimeout(function () {
            chatEl.scrollTop = chatEl.scrollHeight;
          }, 50);
        }
      }
    }

    function togglePetChatPanel() {
      if (!desktopModeActive) return;
      var now = Date.now();
      if (now - lastPanelToggleAt < 180) return;
      lastPanelToggleAt = now;
      var isCurrentlyHidden = document.body.classList.contains('panel-collapsed') || document.body.classList.contains('panel-closing');
      setChatPanelCollapsed(!isCurrentlyHidden);
    }

    window.togglePetChatPanel = togglePetChatPanel;

    if (petStageEl && desktopModeActive) {
      var dragState = {
        active: false,
        moved: false,
        startScreenX: 0,
        startScreenY: 0,
        lastScreenX: 0,
        lastScreenY: 0
      };

      if (supportsClickThrough) {
        syncElectronClickThrough(true);
        window.addEventListener('mousemove', function (e) {
          if (dragState.active) {
            syncElectronClickThrough(false);
            return;
          }
          var targetEl = e.target && e.target.nodeType === 1 ? e.target : null;
          var overStage = Boolean(targetEl && targetEl.closest && targetEl.closest('#petStage'));
          var bubbleVisible = !document.body.classList.contains('panel-collapsed') && !document.body.classList.contains('panel-closing');
          var overBubble = bubbleVisible && Boolean(targetEl && targetEl.closest && targetEl.closest('#desktopChatBubble'));
          var comicVisible = Boolean(avatarComicBubbleEl && avatarComicBubbleEl.classList.contains('show'));
          var overComicBubble = comicVisible && Boolean(targetEl && targetEl.closest && targetEl.closest('#avatarComicBubble'));
          syncElectronClickThrough(!(overStage || overBubble || overComicBubble));
        });
        document.addEventListener('mouseleave', function () {
          if (!dragState.active) {
            syncElectronClickThrough(true);
          }
        });
      }

      petStageEl.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        syncElectronClickThrough(false);
        dragState.active = true;
        dragState.moved = false;
        dragState.startScreenX = e.screenX;
        dragState.startScreenY = e.screenY;
        dragState.lastScreenX = e.screenX;
        dragState.lastScreenY = e.screenY;
      });

      window.addEventListener('mousemove', function (e) {
        if (!dragState.active) return;
        var totalDx = e.screenX - dragState.startScreenX;
        var totalDy = e.screenY - dragState.startScreenY;
        if (!dragState.moved && (Math.abs(totalDx) > 4 || Math.abs(totalDy) > 4)) {
          dragState.moved = true;
        }
        if (dragState.moved) {
          var stepDx = e.screenX - dragState.lastScreenX;
          var stepDy = e.screenY - dragState.lastScreenY;
          dragState.lastScreenX = e.screenX;
          dragState.lastScreenY = e.screenY;
          if (window.electronPet && typeof window.electronPet.moveWindowBy === 'function') {
            window.electronPet.moveWindowBy(stepDx, stepDy);
          }
        }
      });

      window.addEventListener('mouseup', function (e) {
        if (!dragState.active) return;
        var wasMoved = dragState.moved;
        dragState.active = false;
        dragState.moved = false;
        if (!wasMoved && e.button === 0) {
          togglePetChatPanel();
        }
      });
    }

    function triggerAvatarBounce() {
      if (petEmojiEl) {
        petEmojiEl.classList.add('bounce');
        setTimeout(function () {
          petEmojiEl.classList.remove('bounce');
        }, 520);
      }
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

    function buildStickerNode(stickerObj) {
      var box = document.createElement('div');
      box.className = 'sticker-standalone';
      var img = document.createElement('img');
      img.className = 'chat-sticker-img';
      img.src = stickerObj.url;
      img.alt = stickerObj.label || stickerObj.id || '貼圖';
      img.loading = 'lazy';
      img.onerror = function () {
        var badge = document.createElement('div');
        badge.className = 'chat-sticker-fallback';
        badge.textContent = '[🎭 ' + (stickerObj.label || stickerObj.id || '貼圖') + ']';
        if (img.parentNode) {
          img.parentNode.replaceChild(badge, img);
        }
      };
      box.appendChild(img);
      return box;
    }

    function escapeHTML(raw) {
      return String(raw === undefined || raw === null ? '' : raw)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function renderMarkdownSafe(rawText) {
      if (!rawText) return '';
      var escaped = escapeHTML(rawText);
      var LF = String.fromCharCode(10);
      var CR = String.fromCharCode(13);
      var BT = String.fromCharCode(96);

      escaped = escaped.split(CR + LF).join(LF).split(CR).join(LF);

      var blockCodeStore = [];
      var inlineCodeStore = [];

      var fenceToken = BT + BT + BT;
      if (escaped.indexOf(fenceToken) >= 0) {
        var fenceParts = escaped.split(fenceToken);
        if (fenceParts.length >= 3) {
          var rebuilt = [];
          for (var fi = 0; fi < fenceParts.length; fi++) {
            if (fi % 2 === 1 && fi < fenceParts.length - 1) {
              var rawBlock = fenceParts[fi];
              var firstLf = rawBlock.indexOf(LF);
              if (firstLf >= 0) {
                var firstLine = rawBlock.slice(0, firstLf).trim();
                if (/^[a-zA-Z0-9_+-]{1,20}$/.test(firstLine)) {
                  rawBlock = rawBlock.slice(firstLf + 1);
                }
              }
              while (rawBlock.indexOf(LF) === 0) {
                rawBlock = rawBlock.slice(1);
              }
              while (rawBlock.length > 0 && rawBlock.charAt(rawBlock.length - 1) === LF) {
                rawBlock = rawBlock.slice(0, -1);
              }
              var bIdx = blockCodeStore.length;
              blockCodeStore.push('<pre class="md-code-block"><code>' + rawBlock + '</code></pre>');
              var prevStr = rebuilt.length > 0 ? rebuilt[rebuilt.length - 1] : '';
              var needLeadLf = prevStr.length > 0 && prevStr.charAt(prevStr.length - 1) !== LF;
              var nextStr = fenceParts[fi + 1] || '';
              var needTrailLf = nextStr.length > 0 && nextStr.charAt(0) !== LF;
              rebuilt.push((needLeadLf ? LF : '') + '@@MD_BLOCK_CODE_' + bIdx + '@@' + (needTrailLf ? LF : ''));
            } else if (fi % 2 === 1 && fi === fenceParts.length - 1) {
              rebuilt[rebuilt.length - 1] = rebuilt[rebuilt.length - 1] + fenceToken + fenceParts[fi];
            } else {
              rebuilt.push(fenceParts[fi]);
            }
          }
          escaped = rebuilt.join('');
        }
      }

      var inlineCodeRe = new RegExp(BT + '([^' + BT + LF + ']+)' + BT, 'g');
      escaped = escaped.replace(inlineCodeRe, function (_, codeContent) {
        var cIdx = inlineCodeStore.length;
        inlineCodeStore.push('<code class="md-inline-code">' + codeContent + '</code>');
        return '@@MD_INLINE_CODE_' + cIdx + '@@';
      });

      function formatInline(str) {
        var out = str;
        out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
        out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        out = out.replace(/\*([^ *][^*]*?[^ *]|[^ *])\*/g, '<em>$1</em>');
        out = out.replace(/@@MD_INLINE_CODE_([0-9]+)@@/g, function (_, idxStr) {
          var idx = parseInt(idxStr, 10);
          return inlineCodeStore[idx] !== undefined ? inlineCodeStore[idx] : '';
        });
        return out;
      }

      var lines = escaped.split(LF);
      var tokens = [];
      var listItems = [];

      function flushList() {
        if (listItems.length > 0) {
          tokens.push({
            type: 'block',
            html: '<ul class="md-list">' + listItems.join('') + '</ul>'
          });
          listItems = [];
        }
      }

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var trimmed = line.trim();

        var blockCodeMatch = trimmed.match(/^@@MD_BLOCK_CODE_([0-9]+)@@$/);
        if (blockCodeMatch) {
          flushList();
          var bIndex = parseInt(blockCodeMatch[1], 10);
          tokens.push({
            type: 'block',
            html: blockCodeStore[bIndex] || ''
          });
          continue;
        }

        if (/^[ \t]*---+[ \t]*$/.test(line)) {
          flushList();
          tokens.push({
            type: 'block',
            html: '<hr class="md-hr" />'
          });
          continue;
        }

        var headingMatch = line.match(/^[ \t]*(#{1,3})[ \t]+(.+)$/);
        if (headingMatch) {
          flushList();
          var hLevel = headingMatch[1].length;
          var hContent = formatInline(headingMatch[2].trim());
          tokens.push({
            type: 'block',
            html: '<h' + hLevel + ' class="md-heading md-h' + hLevel + '">' + hContent + '</h' + hLevel + '>'
          });
          continue;
        }

        var listMatch = line.match(/^[ \t]*[-*][ \t]+(.+)$/);
        if (listMatch) {
          listItems.push('<li class="md-list-item">' + formatInline(listMatch[1]) + '</li>');
          continue;
        }

        flushList();
        if (trimmed === '') {
          tokens.push({ type: 'empty', html: '' });
        } else {
          tokens.push({ type: 'text', html: formatInline(line) });
        }
      }
      flushList();

      var resultParts = [];
      var textBuffer = [];
      var hasPrevBlock = false;

      function flushTextBuffer(hasNextBlock) {
        if (textBuffer.length === 0) return;
        var startIdx = 0;
        var endIdx = textBuffer.length - 1;
        if (hasPrevBlock && startIdx <= endIdx && textBuffer[startIdx].type === 'empty') {
          startIdx++;
        }
        if (hasNextBlock && endIdx >= startIdx && textBuffer[endIdx].type === 'empty') {
          endIdx--;
        }
        if (startIdx <= endIdx) {
          var segs = [];
          for (var ti = startIdx; ti <= endIdx; ti++) {
            segs.push(textBuffer[ti].html);
          }
          resultParts.push(segs.join('<br />'));
        }
        textBuffer = [];
      }

      for (var k = 0; k < tokens.length; k++) {
        var tk = tokens[k];
        if (tk.type === 'block') {
          flushTextBuffer(true);
          resultParts.push(tk.html);
          hasPrevBlock = true;
        } else {
          textBuffer.push(tk);
        }
      }
      flushTextBuffer(false);

      return resultParts.join('');
    }

    function renderMessage(role, text, metaText, timestamp, stickerObj) {
      var wrap = document.createElement('div');
      wrap.className = 'msg ' + role;
      var hasText = typeof text === 'string' && text.length > 0;
      var hasSticker = Boolean(stickerObj && stickerObj.url);
      var timeStr = formatTime(timestamp);

      if (hasSticker) {
        var stickerNode = buildStickerNode(stickerObj);
        if (!hasText && timeStr) {
          var stTimeEl = document.createElement('div');
          stTimeEl.className = 'sticker-only-time';
          stTimeEl.textContent = timeStr;
          stickerNode.appendChild(stTimeEl);
        }
        wrap.appendChild(stickerNode);
      }

      if (hasText || !hasSticker) {
        var bubble = document.createElement('div');
        bubble.className = 'bubble';

        var textEl = document.createElement('div');
        textEl.className = 'bubble-text';
        textEl.innerHTML = renderMarkdownSafe(text || '');
        bubble.appendChild(textEl);

        if (timeStr) {
          bubble.classList.add('has-time');
          var timeEl = document.createElement('div');
          timeEl.className = 'bubble-time';
          timeEl.textContent = timeStr;
          bubble.appendChild(timeEl);
        }

        wrap.appendChild(bubble);
      }

      if (metaText) {
        var meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = metaText;
        wrap.appendChild(meta);
      }
      chatEl.appendChild(wrap);
      chatEl.scrollTop = chatEl.scrollHeight;
      if (role === 'bot' && !isInitialHistoryHydrating && isDesktopChatBubbleClosed()) {
        showAvatarComicBubble(text, stickerObj);
      }
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
      lastSyncedActiveAt = '';
      modalEl.classList.remove('open');
      if (typeof window.refreshUpgradeStatusOnce === 'function') {
        window.refreshUpgradeStatusOnce();
      }
      if (typeof window.syncPetStateFromServer === 'function') {
        window.syncPetStateFromServer(true);
      }
    };

    // ==================== [STATE_SYNC & QUICK_ACTIONS] ====================
    function updateHeaderStatsDisplay() {
      var st = loadCareLocalStore();
      var boredomVal = clampVal(st.boredom !== undefined ? st.boredom : 0);
      var activityStr = (typeof st.activity === 'string' && st.activity.trim())
        ? st.activity.trim()
        : getFallbackActivityText(st.energy, boredomVal);

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
      if (typeof window.refreshCareModalBars === 'function') {
        window.refreshCareModalBars(st, boredomVal, activityStr);
      }
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
      updateHeaderStatsDisplay();
      window.dispatchEvent(new CustomEvent('pet:state-updated', { detail: st }));
    };

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

    var lastSyncedActiveAt = '';
    var isSyncingHistory = false;

    var lastKnownSyncedBotKey = '';

    async function syncChatHistory() {
      var cfg = getConfig();
      if (!cfg.token || isSyncingHistory) return false;
      isSyncingHistory = true;
      try {
        var prevLog = loadLocalLog();
        var prevLastBot = null;
        for (var p = prevLog.length - 1; p >= 0; p--) {
          if (prevLog[p] && prevLog[p].role === 'bot') {
            prevLastBot = prevLog[p];
            break;
          }
        }
        var prevKey = lastKnownSyncedBotKey || (prevLastBot ? ((prevLastBot.text || '') + '|' + (prevLastBot.time || '')) : '');

        var res = await fetch('/v1/pet/history?uid=' + encodeURIComponent(cfg.uid), {
          headers: { 'Authorization': 'Bearer ' + cfg.token }
        });
        var data = await res.json();
        if (data && data.ok && Array.isArray(data.history)) {
          saveLocalLog(data.history);
          var nextLastBot = null;
          for (var n = data.history.length - 1; n >= 0; n--) {
            if (data.history[n] && data.history[n].role === 'bot') {
              nextLastBot = data.history[n];
              break;
            }
          }
          var nextKey = nextLastBot ? ((nextLastBot.text || '') + '|' + (nextLastBot.time || '')) : '';
          if (nextKey) {
            lastKnownSyncedBotKey = nextKey;
          }

          if (!sendBtn.disabled) {
            chatEl.innerHTML = '';
            if (data.history.length === 0) {
              renderMessage('bot', '嗨主人！點右上角「設定」填入你的連線 Token 後，就可以正式開始聊天或點「🎮 餵食與遊戲」陪我玩囉！', '', Date.now());
            } else {
              isInitialHistoryHydrating = true;
              data.history.forEach(function (item) {
                renderMessage(item.role, item.text, item.meta, item.time, item.sticker || null);
              });
              isInitialHistoryHydrating = false;
              if (prevKey && nextKey && nextKey !== prevKey && isDesktopChatBubbleClosed()) {
                showAvatarComicBubble(nextLastBot.text, nextLastBot.sticker || null);
              }
            }
          }
          return true;
        }
      } catch (e) {} finally {
        isSyncingHistory = false;
      }
      return false;
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
          var serverActiveAt = data.pet_state.last_active_at || '';
          if (withFeedback || (serverActiveAt && serverActiveAt !== lastSyncedActiveAt) || !lastSyncedActiveAt) {
            lastSyncedActiveAt = serverActiveAt || 'synced';
            syncChatHistory();
          }
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
    window.syncChatHistoryFromServer = syncChatHistory;
    window.petStageElement = petStageEl;

    // ==================== [STICKERS] ====================
    var STICKER_PACK_CACHE_KEY = 'pet_sticker_pack_v1';
    var RECENT_STICKERS_KEY = 'pet_recent_stickers_v1';
    var stickerBtnEl = document.getElementById('stickerBtn');
    var stickerDrawerEl = document.getElementById('stickerDrawer');
    var closeStickerDrawerBtnEl = document.getElementById('closeStickerDrawerBtn');
    var stickerTabsEl = document.getElementById('stickerTabs');
    var stickerRecentRowEl = document.getElementById('stickerRecentRow');
    var stickerGridEl = document.getElementById('stickerGrid');
    var stickerAttachBarEl = document.getElementById('stickerAttachBar');
    var stickerAttachThumbEl = document.getElementById('stickerAttachThumb');
    var stickerAttachLabelEl = document.getElementById('stickerAttachLabel');
    var clearAttachedStickerBtnEl = document.getElementById('clearAttachedStickerBtn');

    var availableStickers = [];
    var activeStickerCategory = '全部';
    var pendingAttachedSticker = null;

    function clearPendingSticker() {
      pendingAttachedSticker = null;
      if (stickerAttachBarEl) {
        stickerAttachBarEl.style.display = 'none';
      }
    }

    function setPendingSticker(st) {
      pendingAttachedSticker = st;
      if (stickerAttachBarEl && stickerAttachThumbEl && stickerAttachLabelEl) {
        stickerAttachThumbEl.src = st.url;
        stickerAttachThumbEl.alt = st.label;
        stickerAttachLabelEl.textContent = '已附加貼圖：' + st.label + '（按傳送將與文字一併送出）';
        stickerAttachBarEl.style.display = 'flex';
      }
    }

    function loadRecentStickerIds() {
      try {
        var arr = JSON.parse(localStorage.getItem(RECENT_STICKERS_KEY) || '[]');
        return Array.isArray(arr) ? arr : [];
      } catch (e) {
        return [];
      }
    }

    function recordRecentSticker(id) {
      var list = loadRecentStickerIds().filter(function (x) { return x !== id; });
      list.unshift(id);
      localStorage.setItem(RECENT_STICKERS_KEY, JSON.stringify(list.slice(0, 6)));
      renderRecentStickers();
    }

    // ==================== [CHAT_API] ====================
    async function sendInteractionRequest(contentText, contextLabel, stickerId) {
      var cfg = getConfig();
      var inputPayload = {
        type: stickerId ? 'sticker' : 'text',
        content: contentText || ''
      };
      if (stickerId) {
        inputPayload.sticker_id = stickerId;
      }
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
          input: inputPayload
        })
      });
      return await res.json();
    }

    async function sendMessage(overrideStickerObj) {
      var text = inputEl.value.trim();
      var chosenSticker = overrideStickerObj || pendingAttachedSticker || null;
      if (!text && !chosenSticker) return;

      var cfg = getConfig();
      if (!cfg.token) {
        openSettings();
        return;
      }

      markUserActivity();
      inputEl.value = '';
      inputEl.style.height = 'auto';
      clearPendingSticker();
      if (stickerDrawerEl) stickerDrawerEl.style.display = 'none';
      sendBtn.disabled = true;

      if (chosenSticker && chosenSticker.id) {
        recordRecentSticker(chosenSticker.id);
      }

      var userTime = Date.now();
      var userStickerLog = chosenSticker
        ? { id: chosenSticker.id, url: chosenSticker.url, label: chosenSticker.label }
        : null;
      var log = loadLocalLog();
      log.push({ role: 'user', text: text, meta: '', time: userTime, sticker: userStickerLog });
      saveLocalLog(log);
      renderMessage('user', text, '', userTime, userStickerLog);

      var loadingEl = renderMessage('bot', '思考中...', '', null);
      setPetMood('thinking');

      try {
        var data = await sendInteractionRequest(text, 'PWA 專屬介面', chosenSticker ? chosenSticker.id : '');
        loadingEl.remove();

        var botSticker = (data && data.sticker && data.sticker.url) ? data.sticker : null;
        var reply = (typeof data.reply === 'string') ? data.reply : (botSticker ? '' : JSON.stringify(data));
        var emotion = (data.action && data.action.emotion) ? data.action.emotion : 'idle';
        setPetMood(emotion);
        triggerAvatarBounce();

        if (data.pet_state) {
          if (data.pet_state.last_active_at) {
            lastSyncedActiveAt = data.pet_state.last_active_at;
          }
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
          if (data.meta.tools_used.indexOf('request_self_upgrade') >= 0) {
            if (typeof window.onSelfUpgradeTriggered === 'function') {
              window.onSelfUpgradeTriggered(text);
            }
            window.dispatchEvent(new CustomEvent('pet:upgrade-triggered', {
              detail: { promptText: text, startedAt: Date.now() }
            }));
          }
        }
        var metaStr = metaParts.join(' · ');

        var botTime = Date.now();
        var updatedLog = loadLocalLog();
        updatedLog.push({ role: 'bot', text: reply, meta: metaStr, time: botTime, sticker: botSticker });
        saveLocalLog(updatedLog);
        renderMessage('bot', reply, metaStr, botTime, botSticker);
      } catch (err) {
        loadingEl.remove();
        renderMessage('bot', '⚠️ 連線失敗：' + err.message, '', Date.now());
      } finally {
        sendBtn.disabled = false;
        if (!isMobileTouchDevice()) {
          inputEl.focus();
        }
      }
    }

    function handleStickerPick(st) {
      markUserActivity();
      if (inputEl.value.trim().length > 0) {
        setPendingSticker(st);
        if (stickerDrawerEl) stickerDrawerEl.style.display = 'none';
      } else {
        sendMessage(st);
      }
    }

    function renderRecentStickers() {
      if (!stickerRecentRowEl) return;
      var ids = loadRecentStickerIds();
      var matched = [];
      ids.forEach(function (id) {
        for (var i = 0; i < availableStickers.length; i++) {
          if (availableStickers[i].id === id) {
            matched.push(availableStickers[i]);
            break;
          }
        }
      });
      if (matched.length === 0) {
        stickerRecentRowEl.style.display = 'none';
        return;
      }
      stickerRecentRowEl.style.display = 'flex';
      stickerRecentRowEl.innerHTML = '';
      var tag = document.createElement('span');
      tag.className = 'sticker-recent-tag';
      tag.textContent = '最近：';
      stickerRecentRowEl.appendChild(tag);
      matched.forEach(function (st) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sticker-recent-btn';
        btn.title = st.label;
        var img = document.createElement('img');
        img.src = st.url;
        img.alt = st.label;
        btn.appendChild(img);
        btn.onclick = function () { handleStickerPick(st); };
        stickerRecentRowEl.appendChild(btn);
      });
    }

    function renderStickerDrawer() {
      if (!stickerGridEl || !stickerTabsEl) return;

      var categories = ['全部'];
      availableStickers.forEach(function (st) {
        var cat = st.category || '日常';
        if (categories.indexOf(cat) === -1) categories.push(cat);
      });

      stickerTabsEl.innerHTML = '';
      if (categories.length > 2 || availableStickers.length > 8) {
        categories.forEach(function (cat) {
          var tab = document.createElement('button');
          tab.type = 'button';
          tab.className = 'sticker-tab' + (activeStickerCategory === cat ? ' active' : '');
          tab.textContent = cat;
          tab.onclick = function () {
            activeStickerCategory = cat;
            renderStickerDrawer();
          };
          stickerTabsEl.appendChild(tab);
        });
      } else {
        activeStickerCategory = '全部';
        var titleSpan = document.createElement('span');
        titleSpan.style.fontSize = '12px';
        titleSpan.style.color = '#9aa3bd';
        titleSpan.textContent = '🎭 點擊貼圖立即傳送（有打字則附加）';
        stickerTabsEl.appendChild(titleSpan);
      }

      renderRecentStickers();

      stickerGridEl.innerHTML = '';
      var filtered = availableStickers.filter(function (st) {
        return activeStickerCategory === '全部' || (st.category || '日常') === activeStickerCategory;
      });

      if (filtered.length === 0) {
        var emptyEl = document.createElement('div');
        emptyEl.style.fontSize = '12px';
        emptyEl.style.color = '#8c96b2';
        emptyEl.textContent = '尚未載入任何貼圖';
        stickerGridEl.appendChild(emptyEl);
        return;
      }

      filtered.forEach(function (st) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sticker-item';
        var img = document.createElement('img');
        img.src = st.url;
        img.alt = st.label;
        img.loading = 'lazy';
        var label = document.createElement('span');
        label.textContent = st.label;
        btn.appendChild(img);
        btn.appendChild(label);
        btn.onclick = function () { handleStickerPick(st); };
        stickerGridEl.appendChild(btn);
      });
    }

    async function loadStickerPack() {
      try {
        var cached = JSON.parse(localStorage.getItem(STICKER_PACK_CACHE_KEY) || '[]');
        if (Array.isArray(cached) && cached.length > 0) {
          availableStickers = cached;
          renderStickerDrawer();
        }
      } catch (e) {}

      try {
        var res = await fetch('/v1/stickers');
        var data = await res.json();
        if (data && data.ok && Array.isArray(data.stickers)) {
          availableStickers = data.stickers;
          localStorage.setItem(STICKER_PACK_CACHE_KEY, JSON.stringify(availableStickers));
          renderStickerDrawer();
        }
      } catch (e) {}
    }

    if (stickerBtnEl) {
      stickerBtnEl.onclick = function () {
        if (!stickerDrawerEl) return;
        var willOpen = stickerDrawerEl.style.display === 'none';
        stickerDrawerEl.style.display = willOpen ? 'flex' : 'none';
        if (willOpen) {
          inputEl.blur();
          if (availableStickers.length === 0) {
            loadStickerPack();
          }
        }
      };
    }
    if (closeStickerDrawerBtnEl) {
      closeStickerDrawerBtnEl.onclick = function () {
        if (stickerDrawerEl) stickerDrawerEl.style.display = 'none';
      };
    }
    if (clearAttachedStickerBtnEl) {
      clearAttachedStickerBtnEl.onclick = clearPendingSticker;
    }

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

    sendBtn.onclick = function () {
      sendMessage();
    };
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
      isInitialHistoryHydrating = true;
      initialLog.forEach(function (item) {
        renderMessage(item.role, item.text, item.meta, item.time, item.sticker || null);
      });
      isInitialHistoryHydrating = false;
    }

    loadStickerPack();
    applyTimeBasedTheme();
    updateHeaderStatsDisplay();
    if (!getConfig().token) {
      openSettings();
    } else {
      syncPetState(false);
    }
    setInterval(function () {
      applyTimeBasedTheme();
      if (getConfig().token) {
        syncPetState(false);
      }
    }, 60000);
