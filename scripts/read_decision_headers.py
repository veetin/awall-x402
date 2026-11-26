"""Print the AWall decision headers the echo application received.

Reads the JSON body written by ``scripts/echo-app.mjs`` and prints the
reservation, the cost and the identity on one line, in that order, so a shell
can read them with one ``read``. A missing header prints as an empty field,
which the caller checks for.
"""

import json
import sys


def main() -> int:
    with open(sys.argv[1], encoding="utf-8") as handle:
        headers = json.load(handle)["headers"]
    print(
        headers.get("x-awall-reservation", ""),
        headers.get("x-awall-cost-credits", ""),
        headers.get("x-awall-identity", ""),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
