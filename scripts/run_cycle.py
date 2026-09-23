#!/usr/bin/env python3
"""Run one cycle. --dry evaluates everything and writes nothing; --verbose prints every name's reading."""
import sys, _path  # noqa: F401
from executor.cycle import Cycle
if __name__ == "__main__":
    Cycle(dry="--dry" in sys.argv, verbose="--verbose" in sys.argv).run()
