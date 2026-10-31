"""Prompt for rewriting a note so that its flagged problems go away (pure)."""

from collections.abc import Sequence

from app.domain.compliance.engine import Hit
from app.domain.generation.prompt import SYSTEM_PROMPT
from app.domain.generation.schema import GeneratedNote
from app.ports.llm import LlmMessage

REWRITE_PROMPT_VERSION = "rewrite-v1"


def problems_from_hits(hits: Sequence[Hit]) -> list[str]:
    """One plain-language line per risk hint, naming where it is and what to do about it."""
    return [
        f"{_where(h.field)}里的「{h.matched_text}」：{h.suggestion or '存在风险，请改写或删除'}"
        for h in hits
    ]


def _where(field: str) -> str:
    if field.startswith("title."):
        return f"第 {int(field.split('.')[1]) + 1} 个标题"
    if field.startswith("cover."):
        return f"第 {int(field.split('.')[1]) + 1} 个封面文案"
    return {"body": "正文", "hashtags": "标签"}.get(field, field)


def build_rewrite_messages(
    note: GeneratedNote, problems: Sequence[str], instruction: str = ""
) -> tuple[LlmMessage, ...]:
    """Ask for the whole note again with the listed problems removed and everything else kept."""
    user = (
        "下面是一篇已经写好的笔记，请在保持原意和风格的前提下，只修改有问题的地方。"
        "不要为了替换而新增没有依据的事实。\n\n"
        "标题候选：\n"
        + "\n".join(f"- {t}" for t in note.title_candidates)
        + f"\n\n正文：\n{note.body}\n\n标签：{'、'.join(note.hashtags)}\n\n"
        "封面文案：\n"
        + "\n".join(f"- {c}" for c in note.cover_candidates)
        + "\n\n需要处理的问题：\n"
        + "\n".join(f"- {p}" for p in problems)
    )
    if instruction.strip():
        user += f"\n\n运营的修改要求：{instruction.strip()}"
    user += "\n\n请输出完整的 JSON。"
    return (LlmMessage("system", SYSTEM_PROMPT), LlmMessage("user", user))
