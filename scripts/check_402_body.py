"""Check that a 402 body survived the edge whole.

``scripts/traefik-proof.sh`` passes the body Traefik returned to the client.
The 402 is only useful if the client can still read the payment terms, so this
fails when the accepts array is missing, empty, or lost the ``exact`` scheme.
"""

import json
import sys


def main() -> int:
    with open(sys.argv[1], encoding="utf-8") as handle:
        body = json.load(handle)
    accepts = body.get("accepts")
    if not isinstance(accepts, list) or not accepts:
        print("   FAIL: the 402 body has no accepts array", file=sys.stderr)
        return 1
    schemes = sorted({str(item.get("scheme")) for item in accepts})
    if "exact" not in schemes:
        print(f"   FAIL: the 402 body lost the exact scheme: {schemes}", file=sys.stderr)
        return 1
    print(f"   402 whole: accepts {len(accepts)} items, schemes {schemes}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
