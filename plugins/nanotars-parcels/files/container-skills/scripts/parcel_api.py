#!/usr/bin/env python3
import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

API_BASE = "https://api.parcel.app/external/deliveries/"
CARRIERS_URL = "https://api.parcel.app/external/supported_carriers.json"
STATUS_LABELS = {
    0: "completed",
    1: "frozen",
    2: "in transit",
    3: "awaiting pickup",
    4: "out for delivery",
    5: "not found",
    6: "delivery attempt failed",
    7: "exception",
    8: "label created",
}


def fetch_json(url: str, api_key: Optional[str] = None, timeout: int = 30) -> Any:
    headers = {"Accept": "application/json"}
    if api_key:
        headers["api-key"] = api_key
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return json.loads(resp.read().decode(charset))


def get_api_key(explicit_key: Optional[str]) -> str:
    api_key = explicit_key or os.getenv("PARCEL_API_KEY")
    if not api_key:
        raise SystemExit("PARCEL_API_KEY is not set. Export it or pass --api-key.")
    return api_key


def latest_event(delivery: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    events = delivery.get("events") or []
    return events[0] if events else None


def load_carriers(timeout: int) -> Dict[str, str]:
    payload = fetch_json(CARRIERS_URL, timeout=timeout)
    if isinstance(payload, dict):
        if payload and all(isinstance(k, str) and isinstance(v, str) for k, v in payload.items()):
            return {str(k): str(v) for k, v in payload.items()}
        if "carriers" in payload and isinstance(payload["carriers"], list):
            items = payload["carriers"]
        else:
            items = [payload]
    elif isinstance(payload, list):
        items = payload
    else:
        return {}

    carriers: Dict[str, str] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        code = item.get("code") or item.get("carrier_code") or item.get("id")
        name = item.get("name") or item.get("title") or item.get("display_name")
        if code and name:
            carriers[str(code)] = str(name)
    return carriers


def normalize_delivery(delivery: Dict[str, Any], carrier_names: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    status_code = delivery.get("status_code")
    carrier_code = delivery.get("carrier_code")
    event = latest_event(delivery)
    return {
        "description": delivery.get("description") or "Unnamed delivery",
        "tracking_number": delivery.get("tracking_number"),
        "carrier_code": carrier_code,
        "carrier_name": (carrier_names or {}).get(str(carrier_code)) if carrier_code is not None else None,
        "status_code": status_code,
        "status": STATUS_LABELS.get(status_code, f"unknown ({status_code})"),
        "expected": delivery.get("date_expected"),
        "expected_end": delivery.get("date_expected_end"),
        "extra_information": delivery.get("extra_information"),
        "latest_event": event,
        "events": delivery.get("events") or [],
    }


def summarize_delivery(delivery: Dict[str, Any], event_limit: int = 1) -> str:
    carrier = delivery.get("carrier_name") or delivery.get("carrier_code") or "unknown carrier"
    line = f"- {delivery['description']} [{delivery['status']}]"
    details = [f"carrier: {carrier}"]
    if delivery.get("tracking_number"):
        details.append(f"tracking: {delivery['tracking_number']}")
    if delivery.get("expected") and delivery.get("expected_end"):
        details.append(f"window: {delivery['expected']} → {delivery['expected_end']}")
    elif delivery.get("expected"):
        details.append(f"expected: {delivery['expected']}")
    if details:
        line += "\n  " + " | ".join(details)

    events = delivery.get("events") or []
    for event in events[: max(0, event_limit)]:
        event_bits = [event.get("date") or "unknown time", event.get("event") or "unknown event"]
        if event.get("location"):
            event_bits.append(event["location"])
        if event.get("additional"):
            event_bits.append(event["additional"])
        line += "\n  latest: " + " — ".join(event_bits)
    return line


def main() -> int:
    parser = argparse.ArgumentParser(description="Query Parcel recent or active deliveries")
    parser.add_argument("mode", nargs="?", default="active", choices=["active", "recent"], help="Which delivery filter to request")
    parser.add_argument("--api-key", dest="api_key", help="Parcel API key (otherwise uses PARCEL_API_KEY env var)")
    parser.add_argument("--json", action="store_true", help="Print raw API payload with normalized deliveries")
    parser.add_argument("--events", type=int, default=1, help="How many recent events to show per delivery in text output")
    parser.add_argument("--include-carriers", action="store_true", help="Resolve carrier codes into carrier names")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout in seconds")
    args = parser.parse_args()

    api_key = get_api_key(args.api_key)
    query = urllib.parse.urlencode({"filter_mode": args.mode})
    payload = fetch_json(f"{API_BASE}?{query}", api_key=api_key, timeout=args.timeout)

    if not isinstance(payload, dict):
        raise SystemExit("Unexpected API response format")
    if not payload.get("success"):
        raise SystemExit(payload.get("error_message") or "Parcel API request failed")

    carrier_names: Dict[str, str] = {}
    if args.include_carriers:
        try:
            carrier_names = load_carriers(timeout=args.timeout)
        except Exception:
            carrier_names = {}

    deliveries = [normalize_delivery(item, carrier_names=carrier_names) for item in payload.get("deliveries", [])]

    if args.json:
        print(json.dumps({
            "mode": args.mode,
            "count": len(deliveries),
            "deliveries": deliveries,
            "raw": payload,
        }, indent=2, ensure_ascii=False))
        return 0

    print(f"Parcel {args.mode} deliveries: {len(deliveries)}")
    if not deliveries:
        print("- No deliveries found")
        return 0

    for delivery in deliveries:
        print(summarize_delivery(delivery, event_limit=args.events))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        message = f"HTTP {exc.code}"
        if body:
            message += f": {body}"
        raise SystemExit(message)
    except urllib.error.URLError as exc:
        raise SystemExit(f"Network error: {exc}")
