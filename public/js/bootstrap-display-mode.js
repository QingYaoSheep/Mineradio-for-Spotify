'use strict';

try {
  document.documentElement.classList.add(
    localStorage.getItem('mineradio-diy-player-mode-v1') === '1'
      ? 'diy-mode-preload'
      : 'simple-mode-preload'
  );
} catch (error) {
  document.documentElement.classList.add('simple-mode-preload');
}
