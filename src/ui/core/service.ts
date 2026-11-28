import type { UiCoreSkeletonModule } from '../ui-module-types';
import footerHtml from './footer.html';
import headerHtml from './header.html';
import mainHtml from './main.html';
import modalHtml from './modal.html';
import script from './script.js';
import styles from './styles.css';

export const moduleCore: UiCoreSkeletonModule = {
  id: 'core',
  styles,
  headerHtml,
  mainHtml,
  footerHtml,
  modalHtml,
  script,
};
