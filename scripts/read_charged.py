"""Print the credits a usage report was charged.

Takes the JSON answer of ``POST /awall/usage`` as its only argument and prints
the ``credits`` field, or nothing when the answer has no such field, which the
caller treats as a failure.
"""

import json
import sys


def main() -> int:
    try:
        body = json.loads(sys.argv[1])
    except (IndexError, ValueError):
        return 0
    credits = body.get("credits") if isinstance(body, dict) else None
    if credits is not None:
        print(credits)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
