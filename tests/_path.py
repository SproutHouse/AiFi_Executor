import os, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
os.environ["EXECUTOR_HOME"] = str(ROOT)
os.environ.setdefault("EXECUTOR_STATE", tempfile.mkdtemp(prefix="executor-test-"))
