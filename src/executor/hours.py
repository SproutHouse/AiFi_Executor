"""hours.py — approval mode by the owner's clock.
Online hours: every entry becomes a proposal that waits for a tap. Offline hours: Tier A entries execute on
their own; Tier B still waits. Exits never wait for anyone."""
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
