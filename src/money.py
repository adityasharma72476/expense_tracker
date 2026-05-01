import math
import re

AMOUNT_PATTERN = re.compile(r"^(0|[1-9]\d*)(\.\d{1,2})?$")


# Parse user-facing decimal money into integer minor units so calculations stay exact.
def parse_amount_to_minor_units(raw_value):
    normalized_value = normalize_amount_input(raw_value)

    if not AMOUNT_PATTERN.fullmatch(normalized_value):
        raise ValueError("Amount must be a positive number with up to 2 decimal places.")

    whole_part, _, fractional_part = normalized_value.partition(".")
    minor_units = int(whole_part) * 100 + int(fractional_part.ljust(2, "0") or "0")

    if not math.isfinite(minor_units) or minor_units <= 0:
        raise ValueError("Amount must be greater than 0.")

    return minor_units


# Convert stored integer minor units back into the string format expected by the API and UI.
def format_minor_units(minor_units):
    if not isinstance(minor_units, int):
        raise ValueError("Money values must be stored as integers.")

    absolute_value = abs(minor_units)
    whole_part = absolute_value // 100
    fractional_part = str(absolute_value % 100).rjust(2, "0")
    prefix = "-" if minor_units < 0 else ""

    return f"{prefix}{whole_part}.{fractional_part}"


def normalize_amount_input(raw_value):
    if isinstance(raw_value, int | float):
        if not math.isfinite(raw_value):
            raise ValueError("Amount must be a finite number.")

        return str(raw_value)

    if not isinstance(raw_value, str):
        raise ValueError("Amount must be provided as a string or number.")

    normalized_value = raw_value.strip()

    if not normalized_value:
        raise ValueError("Amount is required.")

    return normalized_value
