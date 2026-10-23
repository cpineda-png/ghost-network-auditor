"""Normalize directory fields so a run diff can be compared to the answer key.

The agents service can mirror these rules. Empty stays empty.
"""

from __future__ import annotations

import re

_WHITESPACE = re.compile(r"\s+")
_STE = re.compile(r"\bste\b\.?")


def normalize(field: str, value: object) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text == "":
        return ""
    if field == "address":
        return _address(text)
    if field == "phone":
        return _phone(text)
    if field == "accepting":
        return _accepting(text)
    if field in {"status", "specialty"}:
        return _plain(text)
    raise ValueError(f"unknown field {field}")


def _address(value: str) -> str:
    text = value.casefold()
    text = _STE.sub("suite", text)
    text = text.replace("#", " suite ")
    return _WHITESPACE.sub(" ", text).strip()


def _phone(value: str) -> str:
    return "".join(char for char in value if char.isdigit())


def _accepting(value: str) -> str:
    token = value.casefold()
    if token in {"true", "yes"}:
        return "true"
    if token in {"false", "no"}:
        return "false"
    return token


def _plain(value: str) -> str:
    return _WHITESPACE.sub(" ", value).casefold()
