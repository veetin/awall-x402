"""Print the payment rails of a PaymentRequired body, or just its offer id."""

import json
import sys


def main(argv: list[str]) -> int:
    want_offer = "--offer-id" in argv
    paths = [arg for arg in argv[1:] if not arg.startswith("--")]
    if not paths:
        print("usage: print_rails.py [--offer-id] <payment-required.json>", file=sys.stderr)
        return 2

    with open(paths[0], encoding="utf-8") as handle:
        required = json.load(handle)

    accepts = required.get("accepts", [])
    if want_offer:
        print(accepts[0]["extra"]["offerId"])
        return 0

    for item in accepts:
        print(
            "   {:>6} {:>9} {:<14} {}".format(
                item["scheme"], item["amount"], item["asset"][:14], item["network"]
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
