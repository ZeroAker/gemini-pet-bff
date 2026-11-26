import { UI_BODY } from './ui/body';
import { UI_SCRIPT } from './ui/script';
import { UI_STYLES } from './ui/styles';

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
