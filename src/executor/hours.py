"""hours.py — the owner's clock. Used for the daily summary hour and, only when settings.approval.mode is
"online_hours", for the proposal-versus-execute decision. With mode "never" (current) it is informational."""
from datetime import datetime
from zoneinfo import ZoneInfo


def mode(s, when=None):
    tz = ZoneInfo(s["timezone"])
    now = when.astimezone(tz) if when else datetime.now(tz)
    start, end = s["online_hours"]["start"], s["online_hours"]["end"]
    online = (start <= now.hour < end) if start < end else (now.hour >= start or now.hour < end)
    return ("approval" if online else "auto"), now


def next_bar_close(now_ts, bar_seconds):
    return (now_ts // bar_seconds + 1) * bar_seconds
