import type { UiFeatureModule } from '../ui-module-types';
import modalHtml from './modal.html';
import script from './script.js';
import styles from './styles.css';
import topHtml from './top.html';

export const moduleProactive: UiFeatureModule = {
  id: 'proactive',
  styles,
  topHtml,
  modalHtml,
  script,
};
