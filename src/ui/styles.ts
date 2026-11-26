export const UI_STYLES: string = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(180deg, #0f111a 0%, #141829 100%);
      color: #e6e8f0;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: background 0.8s ease;
    }
    body.theme-day {
      background: radial-gradient(circle at 20% 0%, #242952 0%, #161b36 52%, #0f1326 100%);
    }
    body.theme-day header, body.theme-day footer {
      background: rgba(25, 30, 52, 0.92);
      border-color: #2e3759;
    }
    body.theme-dusk {
      background: radial-gradient(circle at 80% 0%, #271f45 0%, #15182e 55%, #0d101f 100%);
    }
    body.theme-dusk header, body.theme-dusk footer {
      background: rgba(23, 25, 42, 0.94);
      border-color: #2b304d;
    }
    body.theme-night {
      background: linear-gradient(180deg, #07090f 0%, #0b0e17 55%, #101420 100%);
    }
    body.theme-night header, body.theme-night footer {
      background: rgba(15, 18, 28, 0.96);
      border-color: #1e2336;
    }
    header {
      background: #171a26;
      border-bottom: 1px solid #262b3d;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      flex-shrink: 0;
      width: 100%;
      position: relative;
      z-index: 10;
    }
    .pet-info {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1 1 auto;
      min-width: 180px;
    }
    .pet-meta {
      display: flex;
      flex-direction: column;
      min-width: 120px;
      flex: 1;
      overflow: hidden;
    }
    .avatar {
      width: 42px; height: 42px; border-radius: 50%;
      background: linear-gradient(135deg, #6c5ce7, #a29bfe);
      display: flex; align-items: center; justify-content: center;
      font-size: 21px; flex-shrink: 0;
      position: relative;
      transition: transform 0.25s ease, box-shadow 0.35s ease, background 0.35s ease;
      will-change: transform;
    }
    .avatar::after {
      position: absolute;
      top: -6px;
      right: -7px;
      font-size: 11px;
      font-weight: 700;
      pointer-events: none;
      opacity: 0;
    }
    .avatar.mood-idle {
      animation: avatarIdleBreath 3.6s ease-in-out infinite;
      box-shadow: 0 0 10px rgba(108, 92, 231, 0.35);
    }
    .avatar.mood-happy {
      background: linear-gradient(135deg, #6c5ce7, #fd79a8);
      animation: avatarHappyBounce 1.7s ease-in-out infinite;
      box-shadow: 0 0 15px rgba(253, 121, 168, 0.55);
    }
    .avatar.mood-happy::after {
      content: "✨";
      animation: avatarBadgeFloat 1.7s ease-in-out infinite;
    }
    .avatar.mood-thinking {
      background: linear-gradient(135deg, #0984e3, #6c5ce7);
      animation: avatarThinkingTilt 2.4s ease-in-out infinite;
      box-shadow: 0 0 14px rgba(116, 185, 255, 0.5);
    }
    .avatar.mood-thinking::after {
      content: "💭";
      animation: avatarBadgeFloat 2.2s ease-in-out infinite;
    }
    .avatar.mood-sleepy {
      background: linear-gradient(135deg, #3a3f66, #576094);
      animation: avatarSleepyBreath 4.4s ease-in-out infinite;
      box-shadow: 0 0 12px rgba(129, 236, 236, 0.28);
    }
    .avatar.mood-sleepy::after {
      content: "Zzz";
      color: #81ecec;
      font-size: 10px;
      letter-spacing: 0.5px;
      text-shadow: 0 1px 4px rgba(0, 0, 0, 0.75);
      animation: avatarSleepyZzz 2.8s ease-in-out infinite;
    }
    .avatar.mood-caring {
      background: linear-gradient(135deg, #e84393, #fab1a0);
      animation: avatarCaringGlow 2.2s ease-in-out infinite;
      box-shadow: 0 0 18px rgba(255, 118, 117, 0.65);
    }
    .avatar.mood-caring::after {
      content: "💗";
      animation: avatarBadgeFloat 2s ease-in-out infinite;
    }
    .avatar.bounce, .avatar.quick-react {
      animation: avatarQuickReact 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
      box-shadow: 0 0 22px rgba(255, 234, 167, 0.9), 0 0 10px rgba(162, 155, 254, 0.95) !important;
    }
    @keyframes avatarIdleBreath {
      0%, 100% { transform: scale(1) translateY(0); }
      50% { transform: scale(1.05) translateY(-1.5px); }
    }
    @keyframes avatarHappyBounce {
      0%, 100% { transform: translateY(0) scale(1); }
      35% { transform: translateY(-4px) scale(1.08) rotate(4deg); }
      70% { transform: translateY(-1px) scale(1.03) rotate(-3deg); }
    }
    @keyframes avatarThinkingTilt {
      0%, 100% { transform: rotate(0deg) scale(1); }
      30% { transform: rotate(-9deg) scale(1.05); }
      70% { transform: rotate(7deg) scale(1.03); }
    }
    @keyframes avatarSleepyBreath {
      0%, 100% { transform: scale(0.96) translateY(1px); opacity: 0.92; }
      50% { transform: scale(1.03) translateY(-1px); opacity: 1; }
    }
    @keyframes avatarSleepyZzz {
      0% { opacity: 0; transform: translate(0, 4px) scale(0.75); }
      45% { opacity: 1; transform: translate(3px, -3px) scale(1); }
      100% { opacity: 0; transform: translate(7px, -10px) scale(1.15); }
    }
    @keyframes avatarCaringGlow {
      0%, 100% { transform: scale(1); box-shadow: 0 0 12px rgba(255, 118, 117, 0.5); }
      50% { transform: scale(1.08); box-shadow: 0 0 22px rgba(250, 177, 160, 0.85); }
    }
    @keyframes avatarBadgeFloat {
      0%, 100% { opacity: 0.75; transform: translateY(0) scale(0.92); }
      50% { opacity: 1; transform: translateY(-3px) scale(1.1); }
    }
    @keyframes avatarQuickReact {
      0% { transform: scale(1); }
      35% { transform: scale(1.3) rotate(-10deg) translateY(-4px); }
      70% { transform: scale(1.15) rotate(8deg) translateY(-2px); }
      100% { transform: scale(1); }
    }
    .title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      min-width: 0;
    }
    .title {
      font-size: 15px;
      font-weight: 600;
      line-height: 1.25;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pet-activity-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 500;
      color: #ffeaa7;
      background: rgba(108, 92, 231, 0.2);
      border: 1px solid rgba(124, 111, 247, 0.45);
      border-radius: 99px;
      padding: 2px 9px;
      white-space: nowrap;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;
      user-select: none;
      transition: border-color 0.2s, background 0.2s;
    }
    .pet-activity-badge:hover {
      border-color: #a29bfe;
      background: rgba(108, 92, 231, 0.34);
    }
    .stats {
      font-size: 12px;
      color: #9aa3bd;
      margin-top: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pet-bars-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 5px;
      flex-wrap: wrap;
      min-width: 0;
    }
    .stat-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #121521;
      border: 1px solid #282f47;
      border-radius: 99px;
      padding: 2px 8px;
      font-size: 11px;
      color: #cfd5e6;
      user-select: none;
      flex-shrink: 0;
      transition: border-color 0.2s;
    }
    .stat-pill:hover {
      border-color: #6c5ce7;
    }
    .stat-pill-label {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .stat-pill-label strong {
      color: #fff;
      font-weight: 600;
    }
    .stat-pill-track {
      width: 48px;
      height: 5px;
      background: #0b0d14;
      border-radius: 99px;
      overflow: hidden;
      border: 1px solid #252b42;
      flex-shrink: 0;
    }
    .stat-pill-fill {
      height: 100%;
      border-radius: 99px;
      transition: width 0.35s ease;
    }
    .stat-pill-fill.affection {
      background: linear-gradient(90deg, #fd79a8, #ff7675);
    }
    .stat-pill-fill.energy {
      background: linear-gradient(90deg, #00b894, #55efc4);
    }
    .pet-extra-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
      flex-wrap: wrap;
      min-width: 0;
    }
    .boredom-meter {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #121521;
      border: 1px solid #282f47;
      border-radius: 99px;
      padding: 2px 8px;
      font-size: 11px;
      color: #cfd5e6;
      cursor: pointer;
      user-select: none;
      flex-shrink: 0;
      transition: border-color 0.2s;
    }
    .boredom-meter:hover {
      border-color: #6c5ce7;
    }
    .boredom-label {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .boredom-label strong {
      color: #fab1a0;
      font-weight: 600;
    }
    .boredom-track {
      width: 52px;
      height: 5px;
      background: #0b0d14;
      border-radius: 99px;
      overflow: hidden;
      border: 1px solid #252b42;
      flex-shrink: 0;
    }
    .boredom-fill {
      height: 100%;
      border-radius: 99px;
      transition: width 0.35s ease, background 0.3s ease;
    }
    .boredom-fill.low {
      background: linear-gradient(90deg, #00cec9, #81ecec);
    }
    .boredom-fill.mid {
      background: linear-gradient(90deg, #fdcb6e, #ffeaa7);
    }
    .boredom-fill.high {
      background: linear-gradient(90deg, #e17055, #ff7675);
    }
    .status-note-text {
      font-size: 11px;
      color: #8c96b2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 320px;
    }
    .header-actions {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: nowrap;
      justify-content: flex-end;
      flex-shrink: 0;
    }
    .btn-icon {
      background: #23283a; color: #cfd5e6; border: 1px solid #323952;
      border-radius: 8px; padding: 6px 10px; font-size: 13px; cursor: pointer;
      transition: border-color 0.2s, background 0.2s, color 0.2s;
      flex-shrink: 0;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }
    .btn-icon:hover { border-color: #6c5ce7; color: #fff; }
    .btn-icon.active {
      background: #2b3152;
      border-color: #7c6ff7;
      color: #fff;
    }
    .btn-text-short { display: none; }
    .btn-primary {
      background: #6c5ce7; color: #fff; border: none;
      border-radius: 8px; padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
      flex-shrink: 0;
      white-space: nowrap;
    }
    .btn-primary:disabled, .btn-icon:disabled { opacity: 0.5; cursor: not-allowed; }
    #upgradeBar {
      display: none;
      background: #141827;
      border-bottom: 1px solid #2b3147;
      padding: 10px 14px;
      font-size: 12px;
      color: #cfd5e6;
      flex-shrink: 0;
    }
    .upgrade-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .upgrade-verdict-detail {
      display: none;
      margin-bottom: 6px;
      padding: 7px 10px;
      border-radius: 8px;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .upgrade-verdict-detail.error {
      display: block;
      background: rgba(214, 48, 49, 0.14);
      border: 1px solid rgba(255, 118, 117, 0.45);
      color: #ffb8b8;
    }
    .upgrade-verdict-detail.rejected {
      display: block;
      background: rgba(225, 112, 85, 0.16);
      border: 1px solid rgba(250, 177, 160, 0.5);
      color: #ffd3c4;
    }
    .upgrade-verdict-detail.success {
      display: block;
      background: rgba(0, 184, 148, 0.14);
      border: 1px solid rgba(85, 239, 196, 0.4);
      color: #b8f7e6;
    }
    .header-progress-slot {
      display: none;
      width: 100%;
      margin: 0;
      padding: 0;
      background: #0b0d14;
      flex-shrink: 0;
      line-height: 0;
    }
    .header-progress-slot.active {
      display: block;
    }
    .cabin-progress-slot {
      margin-top: 8px;
    }
    .upgrade-progress-wrap {
      width: 100%;
      cursor: pointer;
      user-select: none;
      transition: border-color 0.2s, background 0.2s;
    }
    .header-progress-slot .upgrade-progress-wrap {
      width: 100%;
      max-width: none;
      margin: 0;
      padding: 0;
      border: none;
      border-radius: 0;
      background: transparent;
      display: block;
    }
    .header-progress-slot .upgrade-progress-info {
      display: none;
    }
    .header-progress-slot .upgrade-progress-track {
      width: 100%;
      height: 4px;
      background: #121521;
      border: none;
      border-radius: 0;
      overflow: hidden;
    }
    .header-progress-slot .upgrade-progress-fill {
      border-radius: 0;
    }
    @media (max-width: 768px) {
      header {
        padding: 8px 12px;
        gap: 8px;
      }
      .pet-info {
        flex: 1 1 100%;
        min-width: 0;
      }
      .pet-meta {
        min-width: 0;
      }
      .header-actions {
        flex: 1 1 100%;
        width: 100%;
        justify-content: flex-start;
        gap: 6px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .header-actions::-webkit-scrollbar {
        display: none;
      }
      .header-actions .btn-icon {
        flex: 1 0 auto;
        padding: 5px 9px;
        font-size: 12px;
      }
    }
    @media (max-width: 480px) {
      header {
        padding: 8px 10px;
        gap: 6px;
      }
      .avatar {
        width: 34px;
        height: 34px;
        font-size: 18px;
      }
      .title {
        font-size: 14px;
      }
      .stats {
        font-size: 11px;
      }
      .pet-activity-badge {
        font-size: 10.5px;
        padding: 1px 7px;
      }
      .stat-pill, .boredom-meter {
        font-size: 10.5px;
        padding: 1px 6px;
        gap: 4px;
      }
      .stat-pill-track, .boredom-track {
        width: 36px;
      }
      .status-note-text {
        max-width: 180px;
        font-size: 10.5px;
      }
      .header-actions {
        gap: 5px;
      }
      .header-actions .btn-icon {
        padding: 5px 8px;
        font-size: 12px;
        border-radius: 7px;
      }
      .btn-text-full {
        display: none;
      }
      .btn-text-short {
        display: inline;
      }
    }
    .cabin-progress-slot .upgrade-progress-wrap {
      max-width: none;
      margin: 8px 0 0 0;
      padding: 8px 10px;
      background: #0f121d;
      border: 1px solid #343d63;
      border-radius: 8px;
    }
    .cabin-progress-slot .upgrade-progress-wrap:hover {
      border-color: #6c5ce7;
    }
    .cabin-progress-slot .upgrade-progress-info {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      margin-bottom: 5px;
    }
    .upgrade-progress-status {
      color: #cfd5e6;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
    }
    .upgrade-progress-percent {
      color: #a29bfe;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }
    .upgrade-progress-track {
      height: 8px;
      background: #0b0d14;
      border-radius: 99px;
      overflow: hidden;
      border: 1px solid #252b42;
    }
    .upgrade-progress-fill {
      height: 100%;
      border-radius: 99px;
      transition: width 0.35s ease, background 0.3s ease;
    }
    .upgrade-progress-fill.idle {
      background: linear-gradient(90deg, #4b5563, #6b7280);
    }
    .upgrade-progress-fill.running {
      background: linear-gradient(90deg, #6c5ce7, #00cec9);
    }
    .upgrade-progress-fill.success {
      background: linear-gradient(90deg, #00b894, #55efc4);
    }
    .upgrade-progress-fill.error {
      background: linear-gradient(90deg, #d63031, #ff7675);
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
    .proactive-bubble-text { font-size: 13px; color: #e6e8f0; word-break: break-word; white-space: pre-wrap; }
    .proactive-bubble-actions { display: flex; gap: 6px; flex-shrink: 0; }
    #petStage {
      width: 100%;
      min-height: 180px;
      background: radial-gradient(circle at center, #1b2038 0%, #0f111a 100%);
      border-bottom: 1px solid #262b3d;
      position: relative;
      flex-shrink: 0;
      align-items: center;
      justify-content: center;
      overflow: hidden;
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
    .quick-actions-bar {
      background: rgba(18, 21, 33, 0.88);
      border-top: 1px solid #23283c;
      padding: 7px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      overflow-x: auto;
      flex-shrink: 0;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .quick-actions-bar::-webkit-scrollbar {
      display: none;
    }
    .quick-action-btn {
      background: #1d2236;
      color: #dfe4f2;
      border: 1px solid #323a56;
      border-radius: 99px;
      padding: 5px 12px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: transform 0.15s ease, border-color 0.2s ease, background 0.2s ease, color 0.2s ease;
    }
    .quick-action-btn:hover:not(:disabled) {
      border-color: #7c6ff7;
      background: #282f4d;
      color: #fff;
      transform: translateY(-1px);
    }
    .quick-action-btn:active:not(:disabled) {
      transform: scale(0.95);
    }
    .quick-action-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .quick-action-btn.refresh {
      margin-left: auto;
      border-color: #2f435a;
      color: #81ecec;
    }
    .quick-action-btn.refresh.loading {
      opacity: 0.75;
      border-color: #00cec9;
    }
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
    .modal-card input:not([type="checkbox"]), .modal-card select {
      width: 100%; background: #0f111a; color: #fff; border: 1px solid #2f3650;
      border-radius: 8px; padding: 9px 10px; font-size: 13px; outline: none;
    }
    .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; flex-wrap: wrap; }
    .proactive-top-row {
      display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
      background: #121521; border: 1px solid #282f47; border-radius: 10px; padding: 10px 12px;
    }
    .proactive-top-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .proactive-form {
      background: #121521; border: 1px solid #282f47; border-radius: 10px;
      padding: 12px; display: flex; flex-direction: column; gap: 8px;
    }
    .proactive-form-row { display: flex; gap: 8px; }
    .proactive-form-row > div { flex: 1; }
    .proactive-ai-check {
      display: flex !important;
      align-items: center;
      gap: 8px;
      background: #171b2d;
      border: 1px solid #323b5e;
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 0 !important;
      cursor: pointer;
      color: #e6e8f0 !important;
      font-size: 12px !important;
      user-select: none;
    }
    .proactive-ai-check:hover { border-color: #6c5ce7; }
    .proactive-ai-check input[type="checkbox"] {
      width: 16px;
      height: 16px;
      accent-color: #6c5ce7;
      cursor: pointer;
      flex-shrink: 0;
    }
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
    .rule-badge.ai-badge {
      background: rgba(108, 92, 231, 0.22);
      color: #ffeaa7;
      border-color: #6c5ce7;
    }
    .rule-msg { font-size: 12px; color: #9aa3bd; word-break: break-word; }
    .rule-actions { display: flex; gap: 5px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
    .btn-sm {
      background: #23283a; color: #cfd5e6; border: 1px solid #323952;
      border-radius: 6px; padding: 4px 8px; font-size: 11px; cursor: pointer;
    }
    .btn-sm:hover { border-color: #6c5ce7; color: #fff; }
    .btn-sm.ai-active {
      background: rgba(108, 92, 231, 0.25);
      color: #ffeaa7;
      border-color: #6c5ce7;
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
`;
