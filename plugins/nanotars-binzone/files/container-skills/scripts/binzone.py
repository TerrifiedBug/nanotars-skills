#!/usr/bin/env python3
"""Fetch Vale of White Horse bin collection details by UPRN."""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import requests
from bs4 import BeautifulSoup


URL = "https://eform.southoxon.gov.uk/ebase/BINZONE_DESKTOP.eb"


def fetch_collection(uprn: str) -> dict[str, str]:
    if not uprn:
        raise ValueError("BINZONE_UPRN is not set")

    response = requests.get(
        URL,
        params={"SOVA_TAG": "VALE", "ebd": "0"},
        cookies={"SVBINZONE": f"VALE%3AUPRN%40{uprn}"},
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/107.0.0.0 Safari/537.36"
            )
        },
        timeout=10,
    )
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "lxml")
    result = {
        "day": "Unknown",
        "next_collection_date": "",
        "type": "Unknown",
    }

    bin_extra = soup.find("div", class_="binextra")
    if bin_extra:
        strong = bin_extra.find("strong")
        if strong:
            result["special_message"] = strong.get_text(strip=True)

        lines = [
            line.strip()
            for line in bin_extra.get_text(separator="\n", strip=True).split("\n")
            if line.strip()
        ]
        for line in lines:
            if line == result.get("special_message"):
                continue
            if "-" in line:
                day, date = [part.strip() for part in line.split("-", 1)]
                result["day"] = day or result["day"]
                result["next_collection_date"] = date
                break
            if result["day"] == "Unknown":
                result["day"] = line

    bin_text = soup.find("div", class_="bintxt")
    heading = bin_text.find("h2") if bin_text else None
    if heading:
        result["type"] = heading.get_text(strip=True)

    return result


def format_text(collection: dict[str, str]) -> str:
    pieces = ["Next bin collection:"]
    when = collection["day"]
    if collection.get("next_collection_date"):
        when = f"{when} - {collection['next_collection_date']}"
    pieces.append(f"{when}: {collection['type']}")
    if collection.get("special_message"):
        pieces.append(f"Important: {collection['special_message']}")
    return "\n".join(pieces)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uprn", default=os.environ.get("BINZONE_UPRN") or os.environ.get("UPRN"))
    parser.add_argument("--json", action="store_true", help="print structured JSON")
    args = parser.parse_args(argv)

    try:
        collection = fetch_collection(args.uprn)
    except Exception as exc:
        payload: dict[str, Any] = {"error": str(exc)}
        if args.json:
            print(json.dumps(payload, indent=2, sort_keys=True))
        else:
            print(f"Binzone lookup failed: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(collection, indent=2, sort_keys=True))
    else:
        print(format_text(collection))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
