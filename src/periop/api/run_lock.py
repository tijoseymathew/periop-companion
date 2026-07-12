"""The one-generation-at-a-time server lock (spec v2 §5.2, v2-speed §3.2).

Stage runs and background gap analyses share it — this is a demo tool, not a
job queue: a single in-memory lock per process serializes every generation.
It lives in its own module so both `stage_runs` and `gap_analysis` can import
it without a cycle through the router modules.
"""

import threading

RUN_LOCK = threading.Lock()
