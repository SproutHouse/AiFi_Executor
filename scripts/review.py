#!/usr/bin/env python3
import _path  # noqa: F401
from executor import common as C, review
if __name__ == "__main__":
    print(review.render(C.settings().get("mode", "paper")))
