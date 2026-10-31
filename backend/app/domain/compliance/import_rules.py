"""Pure file validation, import planning and export for risk-hint rules."""

import csv
import io
import json
import re
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import PurePath
from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

from app.domain.compliance.engine import RuleType, Severity, pattern_problem

MAX_BYTES = 1048576
MAX_ROWS = 2000
Mode = Literal["merge", "replace"]
FileFormat = Literal["csv", "json"]
NULLABLE_TEXT = ("source_url", "source_clause", "region_scope")


class FileProblem(Exception):
    def __init__(self, code: str, message: str, details: dict[str, Any]) -> None:
        super().__init__(message)
        self.code, self.message, self.details = code, message, details


def row_error(
    row: int | None, column: str, message: str, kind: str = "value_error"
) -> dict[str, Any]:
    return {
        "row": row,
        "column": column,
        "msg": message,
        "loc": ["body", "file", "rows", str(row), column]
        if row
        else ["body", "file", column],
        "type": kind,
    }


def invalid_rows(errors: list[dict[str, Any]]) -> FileProblem:
    return FileProblem("VALIDATION_ERROR", "规则文件校验失败", {"errors": errors})


class ImportRule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: uuid.UUID | None = None
    layer: Literal["lexicon", "efficacy_basis"]
    rule_type: RuleType
    severity: Severity
    pattern: str = Field(min_length=1, max_length=200)
    is_regex: bool = Field(default=False, strict=True)
    suggestion: str = Field(default="", max_length=500)
    source_name: str = Field(default="", max_length=200)
    source_url: str | None = Field(default=None, max_length=500)
    source_clause: str | None = Field(default=None, max_length=300)
    region_scope: str | None = Field(default=None, max_length=50)
    effective_from: date | None = None
    effective_to: date | None = None
    enabled: bool = Field(default=True, strict=True)

    @field_validator("id", mode="before")
    @classmethod
    def empty_id(cls, value: Any) -> Any:
        return None if value == "" else value

    @field_validator("pattern", mode="before")
    @classmethod
    def trim_pattern(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("source_name", mode="before")
    @classmethod
    def empty_source(cls, value: Any) -> Any:
        return "" if value is None else value

    @field_validator("source_url", "source_clause", "region_scope", mode="before")
    @classmethod
    def empty_nullable(cls, value: Any) -> Any:
        return None if value == "" else value

    @field_validator("effective_from", "effective_to", mode="before")
    @classmethod
    def iso_date(cls, value: Any) -> Any:
        if value is None or value == "":
            return None
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("日期须为 YYYY-MM-DD")
        return value

    @model_validator(mode="after")
    def check_rule(self) -> ImportRule:
        problem = pattern_problem(self.pattern, self.is_regex)
        if problem:
            raise ValueError("正则表达式不安全或无效" if self.is_regex else problem)
        if (
            self.effective_from
            and self.effective_to
            and self.effective_from > self.effective_to
        ):
            raise ValueError("生效日期不能晚于失效日期")
        return self

    @property
    def key(self) -> tuple[str, str, str]:
        return self.layer, self.rule_type.value, self.pattern

    def editable(self) -> dict[str, Any]:
        data = self.model_dump(exclude={"id"})
        data["rule_type"], data["severity"] = self.rule_type.value, self.severity.value
        return data


COLUMNS = tuple(ImportRule.model_fields)
REQUIRED = {"layer", "rule_type", "severity", "pattern"}


def check_file(filename: str, size: int) -> FileFormat:
    suffix = PurePath(filename).suffix.lower()
    if suffix not in {".csv", ".json"}:
        raise FileProblem(
            "UNSUPPORTED_FILE_TYPE",
            "只支持 CSV 或 JSON",
            {"allowed": [".csv", ".json"]},
        )
    if size > MAX_BYTES:
        raise FileProblem(
            "FILE_TOO_LARGE", "规则文件不能超过 1 MB", {"limit_bytes": MAX_BYTES}
        )
    return "csv" if suffix == ".csv" else "json"


def parse_file(filename: str, content: bytes) -> list[ImportRule]:
    format = check_file(filename, len(content))
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            if format != "csv":
                raise ValueError
            text = content.decode("gbk")
        except UnicodeDecodeError, ValueError:
            raise FileProblem("PARSE_FAILED", "无法解码规则文件", {})
    empty = FileProblem(
        "VALIDATION_ERROR", "文件里没有规则，未做任何更改", {"reason": "empty_file"}
    )
    if not text.strip():
        raise empty
    errors: list[dict[str, Any]] = []
    raw: list[Any]
    if format == "json":
        try:
            value = json.loads(text)
        except ValueError:
            raise FileProblem("PARSE_FAILED", "无法解析 JSON 文件", {})
        if not isinstance(value, list):
            raise invalid_rows([row_error(None, "file", "JSON 须为规则数组")])
        raw = value
    else:
        try:
            records = list(csv.reader(io.StringIO(text, newline=""), strict=True))
        except csv.Error:
            raise FileProblem("PARSE_FAILED", "无法解析 CSV 文件", {})
        header, *data = records
        if not data:
            raise empty
        if (
            len(set(header)) != len(header)
            or set(header) - set(COLUMNS)
            or not REQUIRED <= set(header)
        ):
            errors.append(row_error(None, "header", "表头重复、缺必填列或含未知列"))
        raw = []
        for i, values in enumerate(data, 1):
            if len(values) != len(header):
                errors.append(row_error(i, "row", "列数与表头不一致"))
                raw.append(None)
                continue
            item: dict[str, Any] = dict(zip(header, values, strict=True))
            for name in ("is_regex", "enabled"):
                if name in item:
                    boolean = item[name].lower()
                    if boolean == "":
                        item.pop(name)
                    elif boolean in {"true", "false", "1", "0"}:
                        item[name] = boolean in {"true", "1"}
            if item.get("id") == "":
                item["id"] = None
            raw.append(item)
    if not raw:
        raise empty
    if len(raw) > MAX_ROWS:
        raise invalid_rows([row_error(None, "file", "规则不能超过 2000 条")])
    parsed: list[ImportRule] = []
    keys: dict[tuple[str, str, str], int] = {}
    ids: dict[uuid.UUID, int] = {}
    for i, item in enumerate(raw, 1):
        try:
            rule = ImportRule.model_validate(item)
        except ValidationError as exc:
            for e in exc.errors():
                message = e["msg"]
                column = (
                    str(e["loc"][0])
                    if e["loc"]
                    else ("effective_to" if "日期" in message else "pattern")
                )
                # Pydantic's message excludes input; regex errors use a fixed safe reason above.
                if column == "id":
                    message = "id不存在或不属于当前范围"
                errors.append(row_error(i, column, message, e["type"]))
            continue
        if rule.key in keys:
            errors.append(
                row_error(i, "pattern", f"匹配键与第 {keys[rule.key]} 行重复")
            )
        keys.setdefault(rule.key, i)
        if rule.id:
            if rule.id in ids:
                errors.append(row_error(i, "id", f"id 与第 {ids[rule.id]} 行重复"))
            ids.setdefault(rule.id, i)
        parsed.append(rule)
    if errors:
        raise invalid_rows(errors)
    return parsed


@dataclass(frozen=True)
class ExistingRule:
    id: uuid.UUID
    data: dict[str, Any]


@dataclass
class ImportPlan:
    created: list[ImportRule] = field(default_factory=list)
    updated: list[tuple[uuid.UUID, ImportRule]] = field(default_factory=list)
    unchanged: int = 0
    disabled: list[uuid.UUID] = field(default_factory=list)

    def counts(self) -> dict[str, int]:
        return {
            "created": len(self.created),
            "updated": len(self.updated),
            "unchanged": self.unchanged,
            "disabled": len(self.disabled),
        }


def comparable(data: dict[str, Any]) -> dict[str, Any]:
    return {k: (None if k in NULLABLE_TEXT and v == "" else v) for k, v in data.items()}


def plan_import(
    rules: list[ImportRule], existing: list[ExistingRule], mode: Mode
) -> ImportPlan:
    by_id = {r.id: r for r in existing}
    by_key: dict[tuple[str, str, str], list[ExistingRule]] = defaultdict(list)
    for row in existing:
        by_key[(row.data["layer"], row.data["rule_type"], row.data["pattern"])].append(
            row
        )
    errors, conflicts = [], []
    selected: list[tuple[ImportRule, ExistingRule | None]] = []
    covered: set[uuid.UUID] = set()
    for i, rule in enumerate(rules, 1):
        match = None
        if rule.id:
            match = by_id.get(rule.id)
            if match is None:
                errors.append(row_error(i, "id", "id不存在或不属于当前范围"))
        else:
            matches = by_key[rule.key]
            if len(matches) > 1:
                conflicts.append(
                    {
                        "layer": rule.layer,
                        "rule_type": rule.rule_type.value,
                        "pattern": rule.pattern,
                        "rule_ids": sorted(str(m.id) for m in matches),
                        "rows": [i],
                    }
                )
            elif matches:
                match = matches[0]
        if match:
            if match.id in covered:
                errors.append(row_error(i, "id", "多行定位到同一规则，请保留一行"))
            covered.add(match.id)
        selected.append((rule, match))
    if errors:
        raise invalid_rows(errors)
    if conflicts:
        raise FileProblem(
            "CONFLICT", "文件中的规则键对应多条已有规则", {"conflicts": conflicts}
        )
    plan = ImportPlan()
    for rule, match in selected:
        if match is None:
            plan.created.append(rule)
        elif comparable(match.data) == rule.editable():
            plan.unchanged += 1
        else:
            plan.updated.append((match.id, rule))
    if mode == "replace":
        plan.disabled = [
            r.id for r in existing if r.id not in covered and r.data["enabled"]
        ]
    return plan


def export_file(rows: list[ExistingRule], format: FileFormat) -> bytes:
    items = [
        {"id": str(r.id), **comparable(r.data)}
        for r in sorted(
            rows,
            key=lambda r: (
                r.data["layer"],
                r.data["rule_type"],
                r.data["pattern"],
                str(r.id),
            ),
        )
    ]
    if format == "json":
        return json.dumps(items, ensure_ascii=False, default=str).encode("utf-8")
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=COLUMNS)
    writer.writeheader()
    for item in items:
        writer.writerow(
            {k: str(v).lower() if isinstance(v, bool) else v for k, v in item.items()}
        )
    return output.getvalue().encode("utf-8-sig")


def template_file(format: FileFormat) -> bytes:
    rule = ImportRule(
        layer="lexicon",
        rule_type=RuleType.ABSOLUTE_TERM,
        severity=Severity.WARN,
        pattern="示例，请删除",
        suggestion="示例，请删除",
        enabled=False,
    )
    data = {"id": None, **rule.editable()}
    if format == "json":
        return json.dumps([data], ensure_ascii=False).encode("utf-8")
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=COLUMNS)
    writer.writeheader()
    writer.writerow({**data, "is_regex": "false", "enabled": "false"})
    return output.getvalue().encode("utf-8-sig")
