"""The human rating rubric. Versioned: ratings store the version they were given under."""

from dataclasses import dataclass

RUBRIC_VERSION = "rubric-v1"
MIN_SCORE = 1
MAX_SCORE = 5


@dataclass(frozen=True)
class Dimension:
    key: str
    name: str
    description: str


DIMENSIONS: tuple[Dimension, ...] = (
    Dimension(
        "structure", "结构", "是否按场景要求组织：开头、展开、收束清楚，层次分明"
    ),
    Dimension("tone", "调性", "语气是否符合品牌调性和所选风格，读起来是否自然"),
    Dimension(
        "specificity", "具体度", "是否有具体的场景和感受，而不是空泛的形容词堆砌"
    ),
    Dimension("faithfulness", "贴合资料", "写到的事实是否都能在资料里找到，没有编造"),
)


def rubric_payload() -> dict[str, object]:
    """The rubric as the API returns it."""
    return {
        "rubric_version": RUBRIC_VERSION,
        "scale": {
            "min": MIN_SCORE,
            "max": MAX_SCORE,
            "meaning": "1 很差，3 一般，5 很好",
        },
        "dimensions": [
            {"key": d.key, "name": d.name, "description": d.description}
            for d in DIMENSIONS
        ],
        "note": "各维度分开记录，不合并成一个总分",
    }


def validate_scores(scores: dict[str, int]) -> str | None:
    """Why a set of scores is not acceptable, or ``None``. Every dimension is needed, nothing else is."""
    expected = {d.key for d in DIMENSIONS}
    if set(scores) != expected:
        missing = sorted(expected - set(scores))
        extra = sorted(set(scores) - expected)
        parts = []
        if missing:
            parts.append(f"缺少维度：{', '.join(missing)}")
        if extra:
            parts.append(f"未知维度：{', '.join(extra)}")
        return "；".join(parts)
    bad = [k for k, v in scores.items() if not MIN_SCORE <= v <= MAX_SCORE]
    if bad:
        return f"分值必须在 {MIN_SCORE} 到 {MAX_SCORE} 之间：{', '.join(sorted(bad))}"
    return None
