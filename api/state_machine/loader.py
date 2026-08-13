"""Load and shape-validate the canonical state-machine contract."""
import json
import os

_DEFAULT = os.path.join(os.path.dirname(__file__), "zsm-v006.json")


def load_contract(path: str = None) -> dict:
    with open(path or _DEFAULT, "r", encoding="utf-8") as fh:
        c = json.load(fh)
    for key in ("version", "changelog", "taxonomy", "transitions"):
        if key not in c:
            raise ValueError(f"contract missing required key: {key}")
    # Shape checks so a malformed-but-parseable contract fails loudly here (as a
    # load error) instead of as a downstream AttributeError in validation.
    if not isinstance(c["taxonomy"], dict):
        raise ValueError("contract 'taxonomy' must be an object")
    if not isinstance(c["transitions"], list):
        raise ValueError("contract 'transitions' must be a list")
    return c


def transitions(contract: dict) -> list:
    return contract["transitions"]


def taxonomy(contract: dict) -> dict:
    return contract["taxonomy"]
