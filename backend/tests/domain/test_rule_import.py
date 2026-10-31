import json
import uuid
from datetime import date

import pytest

from app.domain.compliance.import_rules import (
    COLUMNS,
    MAX_BYTES,
    ExistingRule,
    FileProblem,
    check_file,
    export_file,
    parse_file,
    plan_import,
    template_file,
)

RULE = {
    "layer": "lexicon",
    "rule_type": "brand_forbidden",
    "severity": "warn",
    "pattern": "别家词",
}


def parsed(*rows):
    return parse_file("rules.json", json.dumps(rows).encode())


@pytest.mark.parametrize(
    "filename,content",
    [
        ("a.csv", b""),
        ("a.json", b"\xef\xbb\xbf"),
        ("a.csv", b" \n\t"),
        ("a.json", b"[]"),
        ("a.csv", b"layer,rule_type,severity,pattern\n"),
    ],
)
def test_empty_files(filename, content):
    with pytest.raises(FileProblem) as exc:
        parse_file(filename, content)
    assert exc.value.code == "VALIDATION_ERROR"
    assert exc.value.details == {"reason": "empty_file"}


def test_file_types_sizes_decode_and_parse():
    assert check_file("A.CSV", MAX_BYTES) == "csv"
    for filename, size, code in [
        ("a.exe", MAX_BYTES + 1, "UNSUPPORTED_FILE_TYPE"),
        ("a.csv", MAX_BYTES + 1, "FILE_TOO_LARGE"),
    ]:
        with pytest.raises(FileProblem) as exc:
            check_file(filename, size)
        assert exc.value.code == code
    for filename, body in [
        ("a.json", b"\xff"),
        ("a.csv", b"\xff"),
        ("a.json", b"{"),
        ("a.csv", b'pattern\n"unterminated'),
    ]:
        with pytest.raises(FileProblem) as exc:
            parse_file(filename, body)
        assert exc.value.code == "PARSE_FAILED"


def test_csv_encoding_boolean_and_literal_content():
    text = 'layer,rule_type,severity,pattern,is_regex,enabled,source_name\nlexicon,brand_forbidden,warn,"别家词",FALSE,0,\n'
    for encoding in ("utf-8", "utf-8-sig", "gbk"):
        rule = parse_file("a.csv", text.encode(encoding))[0]
        assert rule.pattern == "别家词" and not rule.is_regex and not rule.enabled
        assert rule.source_name == ""
    rule = parsed({**RULE, "pattern": r"\N", "source_clause": r"\text"})[0]
    assert rule.pattern == r"\N" and rule.source_clause == r"\text"


@pytest.mark.parametrize(
    "body",
    [
        {},
        [None],
        [{**RULE, "brand_id": str(uuid.uuid4())}],
        [{**RULE, "layer": "context"}],
        [{**RULE, "pattern": " "}],
        [{**RULE, "pattern": "x" * 201}],
        [{**RULE, "pattern": "(a+)+", "is_regex": True}],
        [{**RULE, "pattern": "[", "is_regex": True}],
        [{**RULE, "source_name": "x" * 201}],
        [{**RULE, "effective_from": "2026-10-02", "effective_to": "2026-10-01"}],
        [{**RULE, "effective_from": "20261001"}],
        [{**RULE, "enabled": 1}],
        [{**RULE, "id": "bad"}],
        [RULE, RULE],
        [RULE] * 2001,
    ],
)
def test_invalid_json_rows(body):
    with pytest.raises(FileProblem) as exc:
        parse_file("a.json", json.dumps(body).encode())
    assert exc.value.code == "VALIDATION_ERROR"
    assert exc.value.details["errors"]


@pytest.mark.parametrize(
    "text",
    [
        "pattern,pattern\nx,x",
        "pattern\nx",
        "layer,rule_type,severity,pattern,other\nlexicon,brand_forbidden,warn,x,y",
        "layer,rule_type,severity,pattern\nlexicon,brand_forbidden,warn",
        "layer,rule_type,severity,pattern\n\n",
        "layer,rule_type,severity,pattern,enabled\nlexicon,brand_forbidden,warn,x,yes",
    ],
)
def test_invalid_csv_rows(text):
    with pytest.raises(FileProblem) as exc:
        parse_file("a.csv", text.encode())
    assert exc.value.code == "VALIDATION_ERROR"


def test_defaults_dates_nulls_and_export_roundtrip():
    data = parsed(
        {**RULE, "source_name": None, "source_url": "", "effective_from": "2026-11-01"}
    )[0]
    assert data.source_name == "" and data.source_url is None
    assert data.effective_from == date(2026, 11, 1)
    old = ExistingRule(
        uuid.uuid4(), {**data.editable(), "source_clause": "", "region_scope": ""}
    )
    for format in ("csv", "json"):
        again = parse_file(f"a.{format}", export_file([old], format))
        plan = plan_import(again, [old], "merge")
        assert plan.counts() == {
            "created": 0,
            "updated": 0,
            "unchanged": 1,
            "disabled": 0,
        }
        assert again[0].id == old.id
        assert export_file([], format)
        template = parse_file(f"template.{format}", template_file(format))[0]
        assert (
            template.pattern == "示例，请删除"
            and not template.enabled
            and template.id is None
        )
    assert len(COLUMNS) == 14


def test_matching_disabled_conflicts_exact_id_and_replace():
    data = parsed(RULE)[0]
    a, b = (
        ExistingRule(uuid.uuid4(), {**data.editable(), "enabled": False}),
        ExistingRule(uuid.uuid4(), data.editable()),
    )
    assert plan_import([data], [a], "merge").counts()["updated"] == 1
    for mode in ("merge", "replace"):
        with pytest.raises(FileProblem) as exc:
            plan_import([data], [a, b], mode)
        assert exc.value.code == "CONFLICT"
        conflict = exc.value.details["conflicts"][0]
        assert conflict["rows"] == [1] and set(conflict["rule_ids"]) == {
            str(a.id),
            str(b.id),
        }
    exact = parsed({**RULE, "id": str(a.id)})[0]
    plan = plan_import([exact], [a, b], "replace")
    assert plan.updated == [(a.id, exact)] and plan.disabled == [b.id]
    unrelated = parsed({**RULE, "pattern": "新词"})[0]
    assert len(plan_import([unrelated], [a, b], "merge").created) == 1


def test_invalid_id_precedes_conflicts_and_duplicate_locators():
    data = parsed(RULE)[0]
    a, b = (
        ExistingRule(uuid.uuid4(), data.editable()),
        ExistingRule(uuid.uuid4(), data.editable()),
    )
    missing = parsed({**RULE, "id": str(uuid.uuid4()), "pattern": "不存在"})[0]
    with pytest.raises(FileProblem) as exc:
        plan_import([data, missing], [a, b], "merge")
    assert (
        exc.value.code == "VALIDATION_ERROR"
        and exc.value.details["errors"][0]["row"] == 2
    )
    exact_other_key = parsed({**RULE, "id": str(a.id), "pattern": "改名"})[0]
    with pytest.raises(FileProblem):
        plan_import([data, exact_other_key], [a], "merge")
    same = str(uuid.uuid4())
    with pytest.raises(FileProblem) as exc:
        parsed({**RULE, "id": same}, {**RULE, "id": same, "pattern": "不同"})
    assert exc.value.details["errors"][0]["column"] == "id"
