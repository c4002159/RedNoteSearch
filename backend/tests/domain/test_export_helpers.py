"""Plain-text body, Markdown export and rewrite targeting (pure)."""

import pytest

from app.domain.constraints import plain_body, to_markdown
from app.domain.generation.rewrite import REWRITE_TARGETS, target_problem


def test_plain_body_normalises_line_breaks_and_trailing_spaces() -> None:
    assert plain_body("第一行  \r\n第二行\t\r第三行\n\n") == "第一行\n第二行\n第三行"
    assert plain_body("  开头保留缩进以外的内容  ") == "开头保留缩进以外的内容"


def test_plain_body_removes_markdown_markers_but_keeps_wording_and_emoji() -> None:
    raw = "# 标题行\n**加粗**的词 和 __另一个__ 与 `代码` 😀\n## 小节\n普通 # 号 保留"
    assert (
        plain_body(raw) == "标题行\n加粗的词 和 另一个 与 代码 😀\n小节\n普通 # 号 保留"
    )
    assert plain_body("") == ""


def test_markdown_export_has_title_body_tags_and_covers() -> None:
    text = to_markdown(
        "晨雾", "**正文**第一行\n第二行", ["#日常", "通勤"], ["清爽一整天", "通勤香气"]
    )
    assert text == (
        "# 晨雾\n\n正文第一行\n第二行\n\n#日常 #通勤\n\n## 封面文案候选\n- 清爽一整天\n- 通勤香气\n"
    )


def test_markdown_export_leaves_out_empty_sections() -> None:
    assert to_markdown("标题", "正文", [], []) == "# 标题\n\n正文\n"


@pytest.mark.parametrize("target", sorted(REWRITE_TARGETS))
def test_each_rewrite_target_limits_the_change_to_one_part(target: str) -> None:
    problem = target_problem(target)
    assert REWRITE_TARGETS[target] in problem and "其余部分原样保留" in problem
    assert "字数" in problem


def test_unknown_rewrite_targets_are_not_accepted() -> None:
    with pytest.raises(KeyError):
        target_problem("everything")


def test_markdown_export_lists_human_confirmed_claims_as_not_system_verified() -> None:
    text = to_markdown(
        "晨雾",
        "正文",
        ["日常"],
        [],
        ["- 获过奖（人工确认：品牌方提供了证书）", "- 产自法国（人工确认）"],
    )
    assert "## 人工核对记录（资料里没有依据，由人工确认，不是系统验证）" in text
    assert text.endswith(
        "- 获过奖（人工确认：品牌方提供了证书）\n- 产自法国（人工确认）\n"
    )
    assert "人工核对记录" not in to_markdown("晨雾", "正文", ["日常"], [], [])
    assert "人工核对记录" not in to_markdown("晨雾", "正文", ["日常"], [], None)
