import type { UiFeatureModule } from '../ui-module-types';
import script from './script.js';
import styles from './styles.css';
import topHtml from './top.html';

export const moduleUpgrade: UiFeatureModule = {
  id: 'upgrade',
  styles,
  topHtml,
  script,
};
