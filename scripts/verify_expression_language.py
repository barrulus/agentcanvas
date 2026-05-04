"""Verify _apply_transform handles every documented grammar branch.

Run from repo root:  python -m scripts.verify_expression_language
Exits non-zero on any failure; prints PASS/FAIL per case.
"""
from __future__ import annotations

import sys

from backend.agents.agent_manager import AgentManager

CASES = [
    # (label, transform, text, nodes, expected)
    ("output full",            "{{output}}",                      "hello",                                  None,                                "hello"),
    ("output JSON path",       "Got: {{output.summary}}",         '{"summary":"yes"}',                      None,                                "Got: yes"),
    ("output missing path",    "{{output.nope}}",                 '{"summary":"yes"}',                      None,                                "{{output.nope}}"),
    ("output non-JSON path",   "{{output.x}}",                    "not json",                               None,                                "{{output.x}}"),
    ("nodes full",             "{{nodes.Researcher.output}}",     "ignored",                                {"researcher": "raw text"},          "raw text"),
    ("nodes JSON path",        "{{nodes.Bot.output.title}}",      "",                                       {"bot": '{"title":"Hi"}'},           "Hi"),
    ("nodes case insensitive", "{{nodes.alice.output}}",          "",                                       {"alice": "x"},                      "x"),
    ("nodes spaces in name",   "{{nodes.Devil's advocate.output}}", "",                                     {"devil's advocate": "y"},           "y"),
    ("nodes unknown",          "{{nodes.Ghost.output}}",          "",                                       {"alice": "x"},                      "{{nodes.Ghost.output}}"),
    ("nodes missing field",    "{{nodes.Bot.output.gone}}",       "",                                       {"bot": '{"title":"Hi"}'},           "{{nodes.Bot.output.gone}}"),
    ("nodes non-JSON path",    "{{nodes.Bot.output.x}}",          "",                                       {"bot": "plain"},                    "{{nodes.Bot.output.x}}"),
    ("mixed",                  "A={{output}} B={{nodes.X.output}}", "from-text",                            {"x": "from-x"},                     "A=from-text B=from-x"),
    ("nested JSON path",       "{{nodes.Bot.output.a.b}}",        "",                                       {"bot": '{"a":{"b":"deep"}}'},       "deep"),
    ("None nodes is fine",     "{{output}}",                      "hello",                                  None,                                "hello"),
]


def main() -> int:
    failures = 0
    for label, transform, text, nodes, expected in CASES:
        got = AgentManager._apply_transform(transform, text, nodes)
        ok = got == expected
        print(f"[{'PASS' if ok else 'FAIL'}] {label}")
        if not ok:
            print(f"    transform: {transform!r}")
            print(f"    expected:  {expected!r}")
            print(f"    got:       {got!r}")
            failures += 1
    print(f"\n{len(CASES) - failures}/{len(CASES)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
