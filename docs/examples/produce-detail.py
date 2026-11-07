"""Example OpenStruct producer; Python 3 standard library only.

Run from any directory:
  python docs/examples/produce-detail.py /tmp/v1.osdetail.json --quantity 6 --unit cm --revision 02
Replace the example's persistent context/origin IDs with your application's stable IDs.
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Produz um pacote de detalhamento OpenStruct v1.")
    parser.add_argument("output", type=Path)
    parser.add_argument("--quantity", type=int, default=4)
    parser.add_argument("--unit", choices=("mm", "cm", "m"), default="mm")
    parser.add_argument("--revision", default="00")
    args = parser.parse_args()
    if not 1 <= args.quantity <= 100000:
        parser.error("quantity deve estar entre 1 e 100000")
    if len(args.revision) > 40:
        parser.error("revision deve ter até 40 caracteres")
    package = json.loads(Path(__file__).with_name("minimal-mm.osdetail.json").read_text(encoding="utf-8"))
    package["producer"] = {"app": "Exemplo Python OpenStruct", "version": "1.0.0"}
    package["exportedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    package["revision"] = args.revision
    package["objects"]["bars"][0]["quantity"] = args.quantity
    package["units"]["length"] = args.unit
    factor = {"mm": 1, "cm": .1, "m": .001}[args.unit]
    lengths = {"x", "y", "width", "height", "hook", "diameter", "mandrel", "textHeight"}

    def convert(value):
        if isinstance(value, list):
            return [convert(item) for item in value]
        if isinstance(value, dict):
            return {key: item * factor if key in lengths and isinstance(item, (int, float)) else convert(item)
                    for key, item in value.items()}
        return value

    package["objects"] = convert(package["objects"])
    package["dependencies"] = convert(package["dependencies"])
    args.output.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
