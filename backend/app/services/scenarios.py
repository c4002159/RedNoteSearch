import uuid

from sqlmodel import Session, col, func, or_, select

from app.models import (
    Brand,
    BrandMember,
    ScenarioPublic,
    ScenarioTemplate,
    Scene,
    StylePreset,
    StylePresetCreate,
)
from app.models.viral import ViralPattern
from app.services.audit import record_audit
from app.services.errors import ConflictError

# Global starter templates. They are product content written for this project (structure outlines, not
# claims about any product) and can be edited or replaced; bump ``template_version`` when the text changes.
DEFAULT_SCENARIOS: tuple[tuple[Scene, str, str], ...] = (
    (
        Scene.SEEDING,
        "种草笔记",
        "1. 开头：一个具体的生活场景或小困扰，引出这款产品\n"
        "2. 使用感受：只写亲身可感知的细节（气味、质地、使用时刻）\n"
        "3. 适合谁、适合什么场合\n"
        "4. 结尾：轻量的互动提问，不催促购买",
    ),
    (
        Scene.REVIEW,
        "真实测评",
        "1. 先说明测评的前提：使用时长、使用方式\n"
        "2. 逐项记录感受，优点和不足都写\n"
        "3. 与同类的对比只写自己体验到的差别\n"
        "4. 总结：适合与不适合的人群",
    ),
    (
        Scene.TUTORIAL,
        "教程攻略",
        "1. 先说这篇能解决什么问题\n"
        "2. 分步骤说明，每步一句话加一个要点\n"
        "3. 常见误区与小提示\n"
        "4. 结尾：邀请读者分享自己的做法",
    ),
    (
        Scene.LAUNCH,
        "新品上市",
        "1. 一句话说明新品是什么、和系列的关系\n"
        "2. 设计与气味（或质地）的描述，只用已核实的资料\n"
        "3. 上市信息：规格、渠道，以资料为准\n"
        "4. 结尾：引导关注，不做功效承诺",
    ),
    (
        Scene.PROMOTION,
        "活动促销",
        "1. 活动是什么、持续多久（以运营提供的信息为准）\n"
        "2. 参与方式，分步骤写清楚\n"
        "3. 适合什么需求的人\n"
        "4. 提醒：以活动页面公布的规则为准",
    ),
    (
        Scene.STORY,
        "品牌故事",
        "1. 从一个小场景或一段经历切入\n"
        "2. 品牌的想法和做事方式，用具体的事讲，不用空话\n"
        "3. 产品如何呼应这种想法\n"
        "4. 结尾：一句温和的收束",
    ),
)


def ensure_default_scenarios(session: Session) -> int:
    """Create the missing global templates; safe to run on every start. Returns how many were added."""
    existing = {
        (s.scene, s.name, s.template_version)
        for s in session.exec(
            select(ScenarioTemplate).where(col(ScenarioTemplate.brand_id).is_(None))
        ).all()
    }
    added = 0
    for scene, name, structure in DEFAULT_SCENARIOS:
        if (scene.value, name, 1) in existing:
            continue
        session.add(ScenarioTemplate(scene=scene.value, name=name, structure=structure))
        added += 1
    if added:
        session.commit()
    return added


def list_scenarios_for_user(
    *, session: Session, user_id: uuid.UUID
) -> list[ScenarioTemplate]:
    """Enabled global templates plus those of brands the user is a member of."""
    brand_ids = select(BrandMember.brand_id).where(BrandMember.user_id == user_id)
    return list(
        session.exec(
            select(ScenarioTemplate)
            .where(
                col(ScenarioTemplate.enabled).is_(True),
                or_(
                    col(ScenarioTemplate.brand_id).is_(None),
                    col(ScenarioTemplate.brand_id).in_(brand_ids),
                ),
            )
            .order_by(col(ScenarioTemplate.scene), col(ScenarioTemplate.name))
        ).all()
    )


def to_public(session: Session, rows: list[ScenarioTemplate]) -> list[ScenarioPublic]:
    """Public view with the name of the viral structure each template came from."""
    ids = {r.source_pattern_id for r in rows if r.source_pattern_id}
    titles: dict[uuid.UUID, str] = {}
    if ids:
        titles = {
            p.id: p.hook_type
            for p in session.exec(
                select(ViralPattern).where(col(ViralPattern.id).in_(ids))
            ).all()
        }
    items = []
    for r in rows:
        item = ScenarioPublic.model_validate(r, from_attributes=True)
        item.source_pattern_title = titles.get(r.source_pattern_id or uuid.uuid4())
        items.append(item)
    return items


def list_templates_for_brand(
    *, session: Session, brand_id: uuid.UUID
) -> list[ScenarioTemplate]:
    """Enabled global templates plus every version of the brand's own, disabled ones included."""
    return list(
        session.exec(
            select(ScenarioTemplate)
            .where(
                or_(
                    (col(ScenarioTemplate.brand_id).is_(None))
                    & col(ScenarioTemplate.enabled).is_(True),
                    ScenarioTemplate.brand_id == brand_id,
                )
            )
            .order_by(
                col(ScenarioTemplate.brand_id).is_(None).desc(),
                col(ScenarioTemplate.scene),
                col(ScenarioTemplate.name),
                col(ScenarioTemplate.template_version).desc(),
            )
        ).all()
    )


def add_brand_template(
    session: Session,
    *,
    brand_id: uuid.UUID,
    scene: str,
    name: str,
    structure: str,
    source_pattern_id: uuid.UUID | None = None,
) -> ScenarioTemplate:
    """Add the next version of a brand template and switch the earlier versions off, so the workbench
    lists one entry per name. Earlier versions stay in the table: tasks keep pointing at the one they used.

    The caller records the audit entry and commits. Locks the brand row so two saves cannot take the same
    version number.
    """
    session.exec(select(Brand.id).where(Brand.id == brand_id).with_for_update()).one()
    same = (
        ScenarioTemplate.brand_id == brand_id,
        ScenarioTemplate.scene == scene,
        ScenarioTemplate.name == name,
    )
    previous = session.exec(
        select(func.max(ScenarioTemplate.template_version)).where(*same)
    ).one()
    for old in session.exec(select(ScenarioTemplate).where(*same)).all():
        old.enabled = False
        session.add(old)
    row = ScenarioTemplate(
        brand_id=brand_id,
        scene=scene,
        name=name,
        structure=structure,
        template_version=(previous or 0) + 1,
        source_pattern_id=source_pattern_id,
    )
    session.add(row)
    return row


def create_brand_template(
    session: Session,
    *,
    brand_id: uuid.UUID,
    scene: str,
    name: str,
    structure: str,
    actor_id: uuid.UUID,
) -> ScenarioTemplate:
    try:
        row = add_brand_template(
            session, brand_id=brand_id, scene=scene, name=name, structure=structure
        )
        record_audit(
            session,
            action="scenario.create",
            entity_type="scenario_template",
            actor_id=actor_id,
            brand_id=brand_id,
            entity_id=row.id,
            detail={"scene": scene, "template_version": row.template_version},
        )
        session.commit()
        session.refresh(row)
        return row
    except Exception:
        session.rollback()
        raise


def set_template_enabled(
    session: Session, *, row: ScenarioTemplate, enabled: bool, actor_id: uuid.UUID
) -> ScenarioTemplate:
    """Switch a brand template on or off. Only the newest version of a name can be switched on; to bring
    back older wording, save it as a new version."""
    if enabled and not row.enabled:
        newest = session.exec(
            select(func.max(ScenarioTemplate.template_version)).where(
                ScenarioTemplate.brand_id == row.brand_id,
                ScenarioTemplate.scene == row.scene,
                ScenarioTemplate.name == row.name,
            )
        ).one()
        if row.template_version != newest:
            raise ConflictError("Only the newest version can be switched on")
    row.enabled = enabled
    session.add(row)
    record_audit(
        session,
        action="scenario.enable" if enabled else "scenario.disable",
        entity_type="scenario_template",
        actor_id=actor_id,
        brand_id=row.brand_id,
        entity_id=row.id,
        detail={"template_version": row.template_version},
    )
    session.commit()
    session.refresh(row)
    return row


def list_style_presets(*, session: Session, brand_id: uuid.UUID) -> list[StylePreset]:
    return list(
        session.exec(
            select(StylePreset)
            .where(StylePreset.brand_id == brand_id)
            .order_by(col(StylePreset.created_at), col(StylePreset.id))
        ).all()
    )


def create_style_preset(
    *,
    session: Session,
    brand_id: uuid.UUID,
    data: StylePresetCreate,
    user_id: uuid.UUID,
) -> StylePreset:
    preset = StylePreset(
        brand_id=brand_id,
        name=data.name,
        params=data.params.model_dump(),
        created_by=user_id,
    )
    session.add(preset)
    session.commit()
    session.refresh(preset)
    return preset
