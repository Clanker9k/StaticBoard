// Commented by anthropic's Opus 4.8
'use strict';

// Bootstrap / router. Modules live in /scripts/*.js.

async function render() {
  // board.html only — index.html has no #app, so bail to avoid the router
  // rewriting the URL to ?board=… and redirecting away from home.
  const app = document.getElementById('app');
  if (!app) return;

  const { board, thread, search } = Router.current();
  Settings.syncRouteTheme(board);

  if (thread && board && getBoardConfig(board)) {
    await Views.showThread(board, thread);
  } else if (board && getBoardConfig(board)) {
    await Views.showBoard(board, search || '');
  } else {
    // No valid board in URL — show the first board by default
    const firstBoard = getDefaultBoardKey();
    if (firstBoard) Router.toBoard(firstBoard);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  Settings.initUI();
  render();
});
