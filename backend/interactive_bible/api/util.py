"""Small helpers shared by the API routers."""
from __future__ import annotations

from typing import Any


def json_safe(value: Any) -> Any:
    """Make DB rows JSON-serialisable (datetimes, decimals, sets)."""
    import datetime
    import decimal

    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, set):
        return sorted(value)
    return value
