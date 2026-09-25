# Real fixtures (copied from state/ on 2026-09-25, after the 04:20Z cycle)

`state/` holds verbatim copies of the executor's first nine run docs (`runs/*.jsonl`, `last_run.json`), the
refusals, the equity points, the (empty) paper positions and the two expired legacy proposals. `config/` freezes
`settings.json` and `books.json` as they were, so adding a book or a name later cannot change the expected values.

`tests/test_dashboard_bundle.py` builds bundle v2 from this tree with the clock pinned to 2026-09-25T04:47:26.060Z and
asserts the spec's ground truth: the four `rd` strings, the funnel 124 → 8 → 5 → 0 → 0, the lag stats 21 (20–27) over
7 runs, the pinned LINK row. `tests/test_dashboard_events.py` asserts `diag.unparsed == 0` on these run docs.
Never edit these files; copy newer ones in only together with new expected values.
