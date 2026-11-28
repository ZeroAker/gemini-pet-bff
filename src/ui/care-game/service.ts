import type { UiFeatureModule } from '../ui-module-types';
import modalHtml from './modal.html';
import script from './script.js';
import styles from './styles.css';

export const moduleCareGame: UiFeatureModule = {
  id: 'care-game',
  styles,
  modalHtml,
  script,
};
