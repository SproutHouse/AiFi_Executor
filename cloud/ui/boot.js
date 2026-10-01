// cloud/ui/boot.js — joined LAST, after every module has filled VIEWS, COMP, SHEETS and HOOKS; it starts everything.
// An old "/#tab" link on the master is first sent on to that tab of a bot page (COMMAND_CENTER_SPEC §2.5). The app page
// (#app present) then gets the shell: routing, keys, the delegated sheet/cursor clicks, the capsule and alert rail,
// polling and timers, then its data (/api/agents on the master, /api/latest plus the bot's row on a bot page). A page
// without #app (a doc page or /login, should either ever load this bundle) gets only the theme toggle and tips.
{
  if (!(document.getElementById('app') && legacyHash())) {
    initTheme();
    initTips();
    if (document.getElementById('app')) {
      initShell();
      boot();
    }
  }
}
