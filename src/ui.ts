import { moduleCareGame } from './ui/care-game/service';
import { moduleCore } from './ui/core/service';
import { moduleDiaryPersona } from './ui/diary-persona/service';
import { moduleProactive } from './ui/proactive/service';
import type { UiFeatureModule } from './ui/ui-module-types';
import { moduleUpgrade } from './ui/upgrade/service';

const FEATURE_MODULES: UiFeatureModule[] = [
  moduleCore,
  moduleUpgrade,
  moduleProactive,
  moduleCareGame,
  moduleDiaryPersona,
];

const UI_STYLES: string = FEATURE_MODULES.map((m) => m.styles).join('\n');

const UI_TOP_SLOTS: string = FEATURE_MODULES.map((m) => m.topHtml ?? '')
  .filter(Boolean)
  .join('\n');

const UI_MODAL_SLOTS: string = FEATURE_MODULES.map((m) => m.modalHtml ?? '')
  .filter(Boolean)
  .join('\n');

const UI_BODY: string = [
  moduleCore.headerHtml,
  UI_TOP_SLOTS,
  moduleCore.mainHtml,
  moduleCore.footerHtml,
  UI_MODAL_SLOTS,
].join('\n');

const UI_SCRIPT: string = FEATURE_MODULES.map((m) => m.script).join('\n');

export const CHAT_HTML: string = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#0f111a" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <title>Gemini 桌寵</title>
  <style id="ui-styles">${UI_STYLES}</style>
</head>
<body>${UI_BODY}
  <script id="ui-script">${UI_SCRIPT}</script>
</body>
</html>`;
