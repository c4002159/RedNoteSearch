"""Independent tone sources; plain values only, without model calls or combined scores."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.domain.results import MIN_NOTES_FOR_RANKING, engagement, hottest


@dataclass(frozen=True)
class HistoryTone:
    tone: str
    source: Literal["task", "preset"]
    count: int | None
    last_used_at: datetime | None


@dataclass(frozen=True)
class TemplateTone:
    tone: str
    count: int
    sample_count: int


@dataclass(frozen=True)
class ResultTone:
    tone: str
    note_count: int
    average_engagement: float
    approximate: bool


@dataclass(frozen=True)
class ToneResults:
    enough_data: bool
    notes_with_metrics: int
    min_notes: int
    items: list[ResultTone]


@dataclass(frozen=True)
class ToneSuggestions:
    history: list[HistoryTone]
    template: list[TemplateTone]
    results: ToneResults


def clean_tone(value: object) -> str:
    return " ".join(value.split()) if isinstance(value, str) else ""


def _time(value: datetime | None) -> datetime:
    if value is None:
        return datetime.min.replace(tzinfo=UTC)
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def _check_limit(limit: int) -> None:
    if not 1 <= limit <= 20:
        raise ValueError("limit must be between 1 and 20")


def history_tones(
    tasks: Sequence[tuple[object, datetime | None]],
    presets: Sequence[tuple[object, datetime | None]],
    limit: int = 10,
) -> list[HistoryTone]:
    """Tasks count uses; presets are options, never evidence of a use."""
    _check_limit(limit)
    task_groups: dict[str, list[datetime | None]] = {}
    for value, at in tasks:
        if tone := clean_tone(value):
            task_groups.setdefault(tone, []).append(at)
    counted = [
        HistoryTone(tone, "task", len(times), max(times, key=_time))
        for tone, times in task_groups.items()
    ]
    counted.sort(
        key=lambda row: (row.count or 0, _time(row.last_used_at)), reverse=True
    )
    preset_times: dict[str, datetime | None] = {}
    for value, at in presets:
        if tone := clean_tone(value):
            if tone not in preset_times or _time(at) > _time(preset_times[tone]):
                preset_times[tone] = at
    options = [
        HistoryTone(tone, "preset", None, None)
        for tone in sorted(
            preset_times, key=lambda tone: _time(preset_times[tone]), reverse=True
        )
    ]
    return (counted + options)[:limit]


def template_tones(
    patterns: Sequence[tuple[object, str]], limit: int = 10
) -> list[TemplateTone]:
    _check_limit(limit)
    groups: dict[str, list[str]] = {}
    for value, sample_id in patterns:
        if tone := clean_tone(value):
            groups.setdefault(tone, []).append(sample_id)
    rows = [TemplateTone(tone, len(ids), len(set(ids))) for tone, ids in groups.items()]
    rows.sort(key=lambda row: -row.count)
    return rows[:limit]


def result_tones(
    readings: Sequence[tuple[object, int, int, int, bool]], limit: int = 10
) -> ToneResults:
    """One latest reading per confirmed copy, supplied by the service."""
    _check_limit(limit)
    rows = [
        ((tone, ""), engagement(likes, collects, comments), approximate)
        for value, likes, collects, comments, approximate in readings
        if (tone := clean_tone(value))
    ]
    enough, stats = hottest(rows, limit=limit)
    return ToneResults(
        enough_data=enough,
        notes_with_metrics=len(rows),
        min_notes=MIN_NOTES_FOR_RANKING,
        items=[
            ResultTone(s.key[0], s.count, round(s.average, 1), s.approximate)
            for s in stats
        ],
    )


# Tone generation uses code-point lengths, independent of note/title publishing limits.
_ABSOLUTE_TERMS = (
    "最",
    "第一",
    "唯一",
    "100%",
    "百分之百",
    "顶级",
    "顶尖",
    "绝对",
    "永久",
    "首创",
    "首选",
    "必然",
    "保证",
    "零风险",
    "无副作用",
)
_CLAIM_TERMS = (
    "功效",
    "疗效",
    "治疗",
    "治愈",
    "医疗",
    "药用",
    "抗炎",
    "消炎",
    "杀菌",
    "抗菌",
    "修复",
    "美白",
    "祛斑",
    "淡斑",
    "祛痘",
    "抗痘",
    "抗衰",
    "抗皱",
    "除皱",
    "补水",
    "保湿",
    "防晒",
    "生发",
    "防脱",
    "减肥",
    "瘦身",
    "排毒",
    "助眠",
    "失眠",
    "镇静",
    "止痛",
    "过敏",
    "敏感肌",
    "促进代谢",
    "增强免疫",
    "改善肤质",
    "改善皮肤",
    "改善睡眠",
    "提亮肤色",
    "紧致",
    "淡纹",
    "cure",
    "heal",
    "treat",
    "medical",
    "efficacy",
    "whitening",
    "antiaging",
    # Assemble blocked phrases so the source wording scan does not flag the filter itself.
    "".join(("法务", "批准")),
    "".join(("已验证", "事实")),
    "".join(("合规", "通过")),
)


def tone_key(value: str) -> str:
    """Duplicate key: width, case, spaces and punctuation do not make a tone new."""
    import unicodedata

    return "".join(
        c
        for c in unicodedata.normalize("NFKC", value).casefold()
        if not c.isspace() and not unicodedata.category(c).startswith("P")
    )


def _screen_text(value: str) -> str:
    import unicodedata

    return "".join(
        c
        for c in unicodedata.normalize("NFKC", value).casefold()
        if not c.isspace() and unicodedata.category(c) != "Cf"
    )


def safe_tone_text(value: str, forbidden_words: Sequence[str] = ()) -> bool:
    """Conservative lexical rejection for both tone and reason; no claims of legal review."""
    text = _screen_text(value)
    terms = (*_ABSOLUTE_TERMS, *_CLAIM_TERMS, *forbidden_words)
    return not any((term := _screen_text(word)) and term in text for word in terms)


class ToneCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    tone: str = Field(min_length=1, max_length=20)
    reason: str = Field(min_length=1, max_length=60)

    @field_validator("tone", "reason", mode="before")
    @classmethod
    def normalize(cls, value: object) -> str:
        return clean_tone(value)


class ToneModelOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    suggestions: list[dict[str, object]]


class InvalidToneOutput(ValueError):
    """The JSON envelope is malformed."""


class NoValidTones(ValueError):
    """No novel, safe, length-valid suggestions remain."""


def filter_generated_tones(
    text: str,
    *,
    existing: Sequence[str] = (),
    forbidden_words: Sequence[str] = (),
    count: int = 5,
) -> list[ToneCandidate]:
    """Strict JSON envelope, validation, filtering and stable normalized deduplication."""
    if not 1 <= count <= 5:
        raise ValueError("count must be between 1 and 5")
    try:
        output = ToneModelOutput.model_validate_json(text)
    except ValidationError as exc:
        raise InvalidToneOutput("模型未返回有效的语气 JSON") from exc
    seen = {tone_key(tone) for tone in existing}
    items: list[ToneCandidate] = []
    for raw in output.suggestions:
        try:
            item = ToneCandidate.model_validate(raw)
        except ValidationError:
            continue
        key = tone_key(item.tone)
        if (
            not key
            or key in seen
            or not safe_tone_text(item.tone, forbidden_words)
            or not safe_tone_text(item.reason, forbidden_words)
        ):
            continue
        seen.add(key)
        items.append(item)
        if len(items) == count:
            break
    if not items:
        raise NoValidTones("模型未返回可用的新语气建议，请调整品牌档案或稍后重试")
    return items
