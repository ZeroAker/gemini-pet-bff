import type { UiFeatureModule } from '../ui-module-types';
import modalHtml from './modal.html';
import styles from './styles.css';

export const moduleDiaryPersona: UiFeatureModule = {
  id: 'diary-persona',
  styles,
  modalHtml,
  script: `
    // ==================== [DIARY_AND_PERSONA] ====================
    var diaryPersonaBtnEl = document.getElementById('diaryPersonaBtn');
    var diaryPersonaModalEl = document.getElementById('diaryPersonaModal');
    var closeDiaryPersonaTopBtnEl = document.getElementById('closeDiaryPersonaTopBtn');
    var closeDiaryPersonaModalBtnEl = document.getElementById('closeDiaryPersonaModalBtn');
    var tabDiaryBtnEl = document.getElementById('tabDiaryBtn');
    var tabPersonaBtnEl = document.getElementById('tabPersonaBtn');
    var diaryPersonaNoticeEl = document.getElementById('diaryPersonaNotice');
    var diaryTabPanelEl = document.getElementById('diaryTabPanel');
    var personaTabPanelEl = document.getElementById('personaTabPanel');
    var diaryCountLabelEl = document.getElementById('diaryCountLabel');
    var refreshDiariesBtnEl = document.getElementById('refreshDiariesBtn');
    var diaryTimelineListEl = document.getElementById('diaryTimelineList');
    var rollbackPersonaBtnEl = document.getElementById('rollbackPersonaBtn');
    var triggerDreamBtnEl = document.getElementById('triggerDreamBtn');
    var refreshPersonaBtnEl = document.getElementById('refreshPersonaBtn');
    var personaUpdatedLabelEl = document.getElementById('personaUpdatedLabel');
    var traitWarmthValEl = document.getElementById('traitWarmthVal');
    var traitWarmthFillEl = document.getElementById('traitWarmthFill');
    var traitPlayfulnessValEl = document.getElementById('traitPlayfulnessVal');
    var traitPlayfulnessFillEl = document.getElementById('traitPlayfulnessFill');
    var traitTeasingValEl = document.getElementById('traitTeasingVal');
    var traitTeasingFillEl = document.getElementById('traitTeasingFill');
    var traitChattinessValEl = document.getElementById('traitChattinessVal');
    var traitChattinessFillEl = document.getElementById('traitChattinessFill');
    var personaTagsListEl = document.getElementById('personaTagsList');
    var personaBondNoteEl = document.getElementById('personaBondNote');
    var personaRecentSnapshotEl = document.getElementById('personaRecentSnapshot');

    var MOOD_NAME_MAP = {
      idle: '悠閒',
      happy: '開心',
      thinking: '思考',
      sleepy: '想睡',
      caring: '貼心'
    };

    function hideDiaryPersonaNotice() {
      if (!diaryPersonaNoticeEl) return;
      diaryPersonaNoticeEl.className = 'diary-status-banner';
      diaryPersonaNoticeEl.style.display = 'none';
      diaryPersonaNoticeEl.innerHTML = '';
    }

    function showDiaryPersonaNotice(text, level, linkUrl, linkLabel) {
      if (!diaryPersonaNoticeEl) return;
      var lvl = (level === 'success' || level === 'error') ? level : 'info';
      diaryPersonaNoticeEl.className = 'diary-status-banner ' + lvl;
      diaryPersonaNoticeEl.style.display = 'block';
      diaryPersonaNoticeEl.innerHTML = '';
      var span = document.createElement('span');
      span.textContent = text;
      diaryPersonaNoticeEl.appendChild(span);
      if (linkUrl) {
        var link = document.createElement('a');
        link.href = linkUrl;
        link.target = '_blank';
        link.style.color = '#74b9ff';
        link.style.marginLeft = '8px';
        link.style.textDecoration = 'underline';
        link.textContent = linkLabel || '查看連結 ↗';
        diaryPersonaNoticeEl.appendChild(link);
      }
    }

    function renderDiaryEmptyState(messageText) {
      if (!diaryTimelineListEl) return;
      diaryTimelineListEl.innerHTML = '';
      var emptyDiv = document.createElement('div');
      emptyDiv.className = 'diary-empty-state';
      emptyDiv.textContent = messageText;
      diaryTimelineListEl.appendChild(emptyDiv);
    }

    async function fetchPetDiaries() {
      if (!diaryTimelineListEl) return;
      var cfg = getConfig();
      if (!cfg.token) {
        if (diaryCountLabelEl) diaryCountLabelEl.textContent = '尚未設定連線 Token';
        renderDiaryEmptyState('🔑 請先點擊右上角「設定」填入 BFF_ACCESS_TOKEN，即可讀取桌寵日記本喔！');
        return;
      }

      renderDiaryEmptyState('⏳ 正在翻開桌寵的日記本...');
      if (refreshDiariesBtnEl) refreshDiariesBtnEl.disabled = true;

      try {
        var res = await fetch('/v1/pet/diaries?uid=' + encodeURIComponent(cfg.uid) + '&limit=30', {
          headers: { 'Authorization': 'Bearer ' + cfg.token }
        });
        if (!res.ok) {
          if (res.status === 401) {
            renderDiaryEmptyState('⚠️ 認證失敗（Token 不符），請檢查右上角「設定」中的 BFF_ACCESS_TOKEN。');
          } else {
            renderDiaryEmptyState('⚠️ 讀取日記失敗（HTTP ' + res.status + '），請稍後再試。');
          }
          return;
        }

        var data = await res.json();
        var diaries = (data && Array.isArray(data.diaries)) ? data.diaries : [];
        if (diaryCountLabelEl) {
          diaryCountLabelEl.textContent = '共 ' + diaries.length + ' 篇日記紀錄';
        }

        if (diaries.length === 0) {
          renderDiaryEmptyState('📭 目前還沒有日記紀錄喔！桌寵會在每晚發夢時寫下日記，你也可以切到「🌱 性格演化」點擊「🌙 立即發夢」產生日記 ✨');
          return;
        }

        diaryTimelineListEl.innerHTML = '';
        diaries.forEach(function (entry) {
          if (!entry || typeof entry !== 'object') return;
          var card = document.createElement('div');
          card.className = 'diary-card';

          var header = document.createElement('div');
          header.className = 'diary-card-header';

          var dateBadge = document.createElement('span');
          dateBadge.className = 'diary-date-badge';
          dateBadge.textContent = '📅 ' + (entry.date || '未知日期');

          var moodKey = normalizeMood(entry.mood);
          var moodEmoji = EMOJI_MAP[moodKey] || '🐱';
          var moodName = MOOD_NAME_MAP[moodKey] || moodKey;
          var moodBadge = document.createElement('span');
          moodBadge.className = 'diary-mood-badge';
          moodBadge.textContent = moodEmoji + ' ' + moodName;

          header.appendChild(dateBadge);
          header.appendChild(moodBadge);
          card.appendChild(header);

          var titleEl = document.createElement('div');
          titleEl.className = 'diary-card-title';
          titleEl.textContent = entry.title || '桌寵日記';
          card.appendChild(titleEl);

          var contentEl = document.createElement('div');
          contentEl.className = 'diary-card-content';
          contentEl.textContent = entry.content || '';
          card.appendChild(contentEl);

          var highlights = Array.isArray(entry.highlights) ? entry.highlights : [];
          if (highlights.length > 0) {
            var hlWrap = document.createElement('div');
            hlWrap.className = 'diary-highlights';
            highlights.forEach(function (hl) {
              if (!hl) return;
              var chip = document.createElement('span');
              chip.className = 'diary-highlight-chip';
              chip.textContent = '✨ ' + String(hl);
              hlWrap.appendChild(chip);
            });
            card.appendChild(hlWrap);
          }

          diaryTimelineListEl.appendChild(card);
        });
      } catch (e) {
        renderDiaryEmptyState('⚠️ 載入日記時發生網路錯誤：' + (e && e.message ? e.message : String(e)));
      } finally {
        if (refreshDiariesBtnEl) refreshDiariesBtnEl.disabled = false;
      }
    }

    async function fetchPetPersona() {
      var cfg = getConfig();
      if (!cfg.token) {
        if (personaUpdatedLabelEl) personaUpdatedLabelEl.textContent = '尚未設定 Token';
        if (personaBondNoteEl) personaBondNoteEl.textContent = '🔑 請先於右上角「設定」填入 BFF_ACCESS_TOKEN。';
        if (personaRecentSnapshotEl) personaRecentSnapshotEl.textContent = '🔑 請先於右上角「設定」填入 BFF_ACCESS_TOKEN。';
        if (personaTagsListEl) {
          personaTagsListEl.innerHTML = '';
          var noTokEl = document.createElement('span');
          noTokEl.className = 'persona-empty-inline';
          noTokEl.textContent = '請先設定連線 Token';
          personaTagsListEl.appendChild(noTokEl);
        }
        return;
      }

      if (personaUpdatedLabelEl) personaUpdatedLabelEl.textContent = '⏳ 載入中...';
      if (refreshPersonaBtnEl) refreshPersonaBtnEl.disabled = true;

      try {
        var res = await fetch('/v1/pet/persona?uid=' + encodeURIComponent(cfg.uid), {
          headers: { 'Authorization': 'Bearer ' + cfg.token }
        });
        if (!res.ok) {
          if (personaUpdatedLabelEl) personaUpdatedLabelEl.textContent = '讀取失敗 (' + res.status + ')';
          if (personaBondNoteEl) {
            personaBondNoteEl.textContent = res.status === 401
              ? '⚠️ 認證失敗（Token 不符），請檢查右上角「設定」中的 BFF_ACCESS_TOKEN。'
              : '⚠️ 讀取性格資料失敗（HTTP ' + res.status + '）';
          }
          return;
        }

        var data = await res.json();
        var persona = (data && data.persona && typeof data.persona === 'object') ? data.persona : {};
        var traits = (persona.traits && typeof persona.traits === 'object') ? persona.traits : {};

        var warmth = clampVal(traits.warmth !== undefined ? traits.warmth : 70);
        var playfulness = clampVal(traits.playfulness !== undefined ? traits.playfulness : 65);
        var teasing = clampVal(traits.teasing !== undefined ? traits.teasing : 35);
        var chattiness = clampVal(traits.chattiness !== undefined ? traits.chattiness : 55);

        if (traitWarmthValEl) traitWarmthValEl.textContent = warmth + ' / 100';
        if (traitWarmthFillEl) traitWarmthFillEl.style.width = warmth + '%';

        if (traitPlayfulnessValEl) traitPlayfulnessValEl.textContent = playfulness + ' / 100';
        if (traitPlayfulnessFillEl) traitPlayfulnessFillEl.style.width = playfulness + '%';

        if (traitTeasingValEl) traitTeasingValEl.textContent = teasing + ' / 100';
        if (traitTeasingFillEl) traitTeasingFillEl.style.width = teasing + '%';

        if (traitChattinessValEl) traitChattinessValEl.textContent = chattiness + ' / 100';
        if (traitChattinessFillEl) traitChattinessFillEl.style.width = chattiness + '%';

        if (personaUpdatedLabelEl) {
          var dreamDateStr = (data && data.last_dream_date) ? ('最後發夢：' + data.last_dream_date) : '尚未發夢';
          var histCount = (data && typeof data.history_count === 'number') ? data.history_count : 0;
          personaUpdatedLabelEl.textContent = dreamDateStr + ' ｜ 可還原版本：' + histCount;
        }

        if (personaTagsListEl) {
          personaTagsListEl.innerHTML = '';
          var insideJokes = Array.isArray(persona.inside_jokes) ? persona.inside_jokes : [];
          var speechHabits = Array.isArray(persona.speech_habits) ? persona.speech_habits : [];

          if (insideJokes.length === 0 && speechHabits.length === 0) {
            var emptyTag = document.createElement('span');
            emptyTag.className = 'persona-empty-inline';
            emptyTag.textContent = '尚無共同梗標籤，多跟桌寵聊天互動並發夢後會慢慢累積喔 ✨';
            personaTagsListEl.appendChild(emptyTag);
          } else {
            insideJokes.forEach(function (joke) {
              if (!joke) return;
              var chip = document.createElement('span');
              chip.className = 'persona-tag';
              chip.textContent = '🏷️ ' + String(joke);
              personaTagsListEl.appendChild(chip);
            });
            speechHabits.forEach(function (habit) {
              if (!habit) return;
              var chip = document.createElement('span');
              chip.className = 'persona-tag habit';
              chip.textContent = '💬 ' + String(habit);
              personaTagsListEl.appendChild(chip);
            });
          }
        }

        if (personaBondNoteEl) {
          var bondStr = (persona.bond_note && String(persona.bond_note).trim())
            ? String(persona.bond_note).trim()
            : '仲喺度慢慢了解主人嘅生活習慣同喜好。';
          personaBondNoteEl.textContent = bondStr;
        }

        if (personaRecentSnapshotEl) {
          var snapStr = (data && data.recent_snapshot && String(data.recent_snapshot).trim())
            ? String(data.recent_snapshot).trim()
            : '尚無近期近況快照，待桌寵發夢整理記憶後會顯示於此 ✨';
          personaRecentSnapshotEl.textContent = snapStr;
        }
      } catch (e) {
        if (personaUpdatedLabelEl) personaUpdatedLabelEl.textContent = '載入異常';
        if (personaBondNoteEl) {
          personaBondNoteEl.textContent = '⚠️ 載入性格資料失敗：' + (e && e.message ? e.message : String(e));
        }
      } finally {
        if (refreshPersonaBtnEl) refreshPersonaBtnEl.disabled = false;
      }
    }

    function switchDiaryPersonaTab(tabName) {
      if (tabName === 'persona') {
        if (tabDiaryBtnEl) tabDiaryBtnEl.classList.remove('active');
        if (tabPersonaBtnEl) tabPersonaBtnEl.classList.add('active');
        if (diaryTabPanelEl) diaryTabPanelEl.style.display = 'none';
        if (personaTabPanelEl) personaTabPanelEl.style.display = 'flex';
        fetchPetPersona();
      } else {
        if (tabDiaryBtnEl) tabDiaryBtnEl.classList.add('active');
        if (tabPersonaBtnEl) tabPersonaBtnEl.classList.remove('active');
        if (diaryTabPanelEl) diaryTabPanelEl.style.display = 'flex';
        if (personaTabPanelEl) personaTabPanelEl.style.display = 'none';
        fetchPetDiaries();
      }
    }

    function openDiaryPersonaModal() {
      markUserActivity();
      hideDiaryPersonaNotice();
      if (diaryPersonaModalEl) {
        diaryPersonaModalEl.classList.add('open');
      }
      fetchPetDiaries();
      fetchPetPersona();
    }

    function closeDiaryPersonaModal() {
      if (diaryPersonaModalEl) {
        diaryPersonaModalEl.classList.remove('open');
      }
    }

    if (diaryPersonaBtnEl) {
      diaryPersonaBtnEl.onclick = openDiaryPersonaModal;
    }
    if (closeDiaryPersonaTopBtnEl) {
      closeDiaryPersonaTopBtnEl.onclick = closeDiaryPersonaModal;
    }
    if (closeDiaryPersonaModalBtnEl) {
      closeDiaryPersonaModalBtnEl.onclick = closeDiaryPersonaModal;
    }
    if (tabDiaryBtnEl) {
      tabDiaryBtnEl.onclick = function () {
        switchDiaryPersonaTab('diary');
      };
    }
    if (tabPersonaBtnEl) {
      tabPersonaBtnEl.onclick = function () {
        switchDiaryPersonaTab('persona');
      };
    }
    if (refreshDiariesBtnEl) {
      refreshDiariesBtnEl.onclick = function () {
        fetchPetDiaries();
      };
    }
    if (refreshPersonaBtnEl) {
      refreshPersonaBtnEl.onclick = function () {
        fetchPetPersona();
      };
    }

    if (rollbackPersonaBtnEl) {
      rollbackPersonaBtnEl.onclick = async function () {
        var cfg = getConfig();
        if (!cfg.token) {
          closeDiaryPersonaModal();
          openSettings();
          return;
        }
        markUserActivity();
        rollbackPersonaBtnEl.disabled = true;
        showDiaryPersonaNotice('⏳ 正在還原上一版性格設定...', 'info');
        try {
          var res = await fetch('/v1/pet/persona/rollback?uid=' + encodeURIComponent(cfg.uid), {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + cfg.token }
          });
          var data = await res.json();
          await fetchPetPersona();
          if (res.ok && data && data.ok) {
            showDiaryPersonaNotice('✅ ' + (data.message || '已成功還原至上一版性格設定！'), 'success');
            triggerAvatarBounce();
          } else {
            showDiaryPersonaNotice('ℹ️ ' + ((data && (data.message || data.error)) || '目前未有可還原的舊性格版本'), 'info');
          }
        } catch (e) {
          showDiaryPersonaNotice('⚠️ 還原性格失敗：' + (e && e.message ? e.message : String(e)), 'error');
        } finally {
          rollbackPersonaBtnEl.disabled = false;
        }
      };
    }

    if (triggerDreamBtnEl) {
      triggerDreamBtnEl.onclick = async function () {
        var cfg = getConfig();
        if (!cfg.token) {
          closeDiaryPersonaModal();
          openSettings();
          return;
        }
        markUserActivity();
        triggerDreamBtnEl.disabled = true;
        showDiaryPersonaNotice('⏳ 正在派發「🌙 立即發夢」任務並同步記憶...', 'info');
        try {
          var res = await fetch('/v1/pet/dream/trigger?uid=' + encodeURIComponent(cfg.uid) + '&force=true', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + cfg.token }
          });
          var data = await res.json();
          await Promise.all([fetchPetPersona(), fetchPetDiaries()]);
          if (res.ok && data && data.ok) {
            if (data.skipped) {
              showDiaryPersonaNotice('ℹ️ ' + (data.reason || '目前無新對話可供發夢整理。'), 'info');
            } else {
              showDiaryPersonaNotice(
                '🌙 「立即發夢」完成！已寫下新日記「' + (data.diary_title || '桌寵日記') + '」並更新性格與記憶 ✨',
                'success',
                data.actions_url || '',
                data.actions_url ? '查看發夢紀錄 ↗' : ''
              );
              triggerAvatarBounce();
            }
          } else {
            showDiaryPersonaNotice(
              '⚠️ 立即發夢觸發失敗：' + ((data && data.error) ? data.error : ('HTTP ' + res.status)),
              'error'
            );
          }
        } catch (e) {
          showDiaryPersonaNotice('⚠️ 觸發發夢時發生錯誤：' + (e && e.message ? e.message : String(e)), 'error');
        } finally {
          triggerDreamBtnEl.disabled = false;
        }
      };
    }
  `,
};
