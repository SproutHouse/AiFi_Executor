// cloud/ui/boot.js — joined LAST, after every module has filled VIEWS, COMP, SHEETS and HOOKS; it starts everything.
// The app page (#app present) gets the shell: routing, keys, the delegated sheet/cursor clicks, the capsule and alert
// rail, polling and timers, then the first /api/latest. A page without #app (a doc page or /login, should either
// ever load this bundle) gets only the theme toggle and tips.
{
  initTheme();
  initTips();
  if (document.getElementById('app')) {
    initShell();
    boot();
  }
}
