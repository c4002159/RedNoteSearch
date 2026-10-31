"""Demo seed data: one brand with products, a voice profile and approved knowledge documents.

Run from ``backend/``::

    uv run python -m app.seed                    # real embeddings (needs DASHSCOPE_API_KEY)
    uv run python -m app.seed --fake-embeddings  # offline: retrieval works but is only keyword-like

Every text below is **placeholder demo content written for this project**, marked 【演示数据】. It is
not the customer's brand manual and makes no real product claims: replace it with reviewed material
through the knowledge base before showing results to anyone as real. The seed is idempotent: it does
nothing when the demo brand already exists. The brand's creator (and so its admin) is the first
superuser from the settings.
"""

import argparse
import logging
from dataclasses import dataclass

from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine, init_db
from app.fakes.embedding import FakeEmbeddingProvider
from app.infra.dashscope import DashScopeEmbeddingProvider
from app.models import (
    Brand,
    BrandCategory,
    BrandCreate,
    CaseIn,
    DatasetCreate,
    EvalKind,
    KbChunk,
    KbDocument,
    ProductCreate,
    ProductNotes,
    SellingPoint,
    User,
    VoiceProfileCreate,
)
from app.ports.embedding import EmbeddingProvider
from app.services import brands as brand_service
from app.services import evaluation as eval_service
from app.services import knowledge as kb
from app.services import products as product_service
from app.services import voice_profiles as voice_service

logger = logging.getLogger(__name__)

DEMO_SLUG = "boitown-demo"
DEMO_NAME = "冰希黎（演示）"
MARK = "【演示数据】"


@dataclass(frozen=True)
class DemoDocument:
    title: str
    doc_type: str
    text: str


DOCUMENTS = [
    DemoDocument(
        "品牌故事（演示）",
        "brand_story",
        f"{MARK}冰希黎是一个用于演示的香氛品牌设定。\n\n"
        "品牌希望把日常生活里的轻松感带进香氛：不追求浓烈，强调贴近日常的清爽与自在。\n\n"
        "品牌语气偏向亲切、克制，像和朋友分享一件小事，避免夸张的承诺。",
    ),
    DemoDocument(
        "商品资料（演示）",
        "product_spec",
        f"{MARK}演示商品 A「晨雾淡香水」：前调为柑橘与佛手柑，中调为白茶，后调为雪松与白麝香；"
        "香调清新，适合日常通勤。\n\n"
        f"{MARK}演示商品 B「午后木质香薰」：以雪松与檀香木为主，香气温和，适合居家阅读时使用。\n\n"
        f"{MARK}演示商品 C「夜色身体乳」：质地轻盈，带有淡淡的白麝香气味。",
    ),
    DemoDocument(
        "成分说明（演示）",
        "ingredient",
        f"{MARK}佛手柑是常见的柑橘类香料，气味清新明亮。白茶香调常用来营造干净、安静的感觉。"
        "雪松香气干燥、温和。以上仅为气味描述，不涉及任何功效说法。",
    ),
    DemoDocument(
        "内容合规约定（演示）",
        "compliance_policy",
        f"{MARK}这是演示用的内部约定，不是法律意见。写作时避免使用「最」「第一」「100%」这类绝对化表述；"
        "不要承诺功效或医疗效果；涉及获奖、认证、销量等事实，必须有已审核的资料支撑，没有来源就不要写。",
    ),
    DemoDocument(
        "笔记范例（演示）",
        "sample_note",
        f"{MARK}标题范例：通勤路上的一点清爽。\n\n"
        "正文范例：早上出门前喷一下，柑橘的明亮感很快散开，到公司已经变得很柔和。"
        "不算浓烈，适合不想被香味打扰的日子。\n\n标签范例：#日常香氛 #通勤好物",
    ),
]

VOICE = VoiceProfileCreate(
    persona="亲切克制、像朋友分享日常的小事；重感受描述，轻夸张承诺。",
    tone_keywords=["清爽", "自在", "日常", "克制"],
    preferred_words=["清爽", "柔和", "日常", "通勤", "分享"],
    forbidden_words=["最好", "第一", "100%", "绝对", "神器"],
    sample_refs=["笔记范例（演示）"],
)


SPEC_SOURCE = "演示商品 A「晨雾淡香水」：前调为柑橘与佛手柑，中调为白茶，后调为雪松与白麝香；香调清新，适合日常通勤。"

EVAL_DATASETS: tuple[tuple[str, EvalKind, list[CaseIn]], ...] = (
    (
        "合规词库样本（演示）",
        EvalKind.COMPLIANCE,
        [
            CaseIn(input={"text": "这是最好的香水"}, expected={"hit_words": ["最好"]}),
            CaseIn(
                input={"text": "全网第一，唯一选择"},
                expected={"hit_words": ["第一", "唯一"]},
            ),
            CaseIn(input={"text": "用完皮肤会美白"}, expected={"hit_words": ["美白"]}),
            CaseIn(input={"text": "含 99% 天然成分"}, expected={"hit_words": ["99%"]}),
            CaseIn(
                input={"text": "前调是佛手柑，味道清爽"}, expected={"hit_words": []}
            ),
            CaseIn(
                input={"text": "通勤路上喷一下，很柔和"}, expected={"hit_words": []}
            ),
        ],
    ),
    (
        "事实核查样本（演示）",
        EvalKind.FACTCHECK,
        [
            CaseIn(
                input={"claim": "前调为柑橘与佛手柑", "sources": [SPEC_SOURCE]},
                expected={"verdict": "supported"},
            ),
            CaseIn(
                input={"claim": "后调含有雪松", "sources": [SPEC_SOURCE]},
                expected={"verdict": "supported"},
            ),
            CaseIn(
                input={"claim": "获得过国际大奖", "sources": [SPEC_SOURCE]},
                expected={"verdict": "insufficient"},
            ),
            CaseIn(
                input={"claim": "含有玫瑰精油", "sources": [SPEC_SOURCE]},
                expected={"verdict": "insufficient"},
            ),
            CaseIn(
                input={"claim": "中调为玫瑰", "sources": [SPEC_SOURCE]},
                expected={"verdict": "conflict"},
            ),
        ],
    ),
    (
        "文案生成样本（演示）",
        EvalKind.GENERATION,
        [
            CaseIn(
                input={
                    "product_name": "晨雾淡香水（演示）",
                    "category": "perfume",
                    "scene_name": "种草笔记",
                    "brief": "突出通勤场景",
                    "required_terms": ["通勤"],
                    "facts": ["前调为柑橘与佛手柑，香调清新"],
                },
                expected={"forbidden_words": ["最好", "第一"]},
            ),
            CaseIn(
                input={
                    "product_name": "午后木质香薰（演示）",
                    "category": "home_fragrance",
                    "scene_name": "品牌故事",
                    "brief": "居家阅读的午后",
                    "required_terms": ["雪松"],
                    "facts": ["以雪松与檀香木为主，香气温和"],
                },
                expected={"forbidden_words": ["最好"]},
            ),
        ],
    ),
)


def _chunk_with(session: Session, doc: KbDocument, keyword: str) -> KbChunk | None:
    chunks = session.exec(
        select(KbChunk)
        .where(KbChunk.document_id == doc.id)
        .order_by(col(KbChunk.chunk_index))
    ).all()
    return next((c for c in chunks if keyword in c.content), None)


def seed_demo(
    session: Session, embedder: EmbeddingProvider, owner: User
) -> Brand | None:
    """Create the demo brand and its data. Returns ``None`` when the brand already exists."""
    if session.exec(select(Brand).where(Brand.slug == DEMO_SLUG)).first():
        return None
    brand = brand_service.create_brand(
        session=session,
        data=BrandCreate(
            name=DEMO_NAME,
            slug=DEMO_SLUG,
            category=BrandCategory.PERFUME,
            description=f"{MARK}用于联调和演示的品牌，内容均为占位资料。",
        ),
        creator=owner,
    )
    docs: dict[str, KbDocument] = {}
    for item in DOCUMENTS:
        docs[item.doc_type] = kb.ingest_direct(
            session=session,
            embedder=embedder,
            brand_id=brand.id,
            user_id=owner.id,
            title=item.title,
            doc_type=item.doc_type,
            filename=f"{item.doc_type}.md",
            content=item.text.encode("utf-8"),
        )

    spec = docs["product_spec"]
    sourced = SellingPoint(
        text="前调为柑橘与佛手柑，香调清新",
        source_document_id=spec.id,
        source_chunk_id=chunk.id
        if (chunk := _chunk_with(session, spec, "佛手柑"))
        else None,
    )
    product_service.create_product(
        session=session,
        brand_id=brand.id,
        data=ProductCreate(
            name="晨雾淡香水（演示）",
            product_line="日常系列",
            category=BrandCategory.PERFUME,
            notes=ProductNotes(
                top=["柑橘", "佛手柑"], middle=["白茶"], base=["雪松", "白麝香"]
            ),
            selling_points=[sourced, SellingPoint(text="适合通勤的日常香气")],
            restricted_claims=["持久", "提升魅力"],
        ),
    )
    product_service.create_product(
        session=session,
        brand_id=brand.id,
        data=ProductCreate(
            name="午后木质香薰（演示）",
            product_line="居家系列",
            category=BrandCategory.HOME_FRAGRANCE,
            notes=ProductNotes(base=["雪松", "檀香木"]),
            selling_points=[SellingPoint(text="香气温和，适合居家阅读")],
        ),
    )
    product_service.create_product(
        session=session,
        brand_id=brand.id,
        data=ProductCreate(
            name="夜色身体乳（演示）",
            category=BrandCategory.SKINCARE,
            selling_points=[SellingPoint(text="质地轻盈")],
            restricted_claims=["保湿", "修复"],
        ),
    )

    profile = voice_service.create_version(
        session=session, brand_id=brand.id, data=VOICE, created_by=owner.id
    )
    voice_service.activate_version(
        session=session,
        brand_id=brand.id,
        version=profile.version,
        actor_id=owner.id,
    )
    for name, kind, cases in EVAL_DATASETS:
        eval_service.create_dataset(
            session=session,
            data=DatasetCreate(name=name, kind=kind, brand_id=brand.id, cases=cases),
            user=owner,
        )
    return brand


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description="Seed the demo brand")
    parser.add_argument(
        "--fake-embeddings",
        action="store_true",
        help="use the offline fake embedding model instead of Bailian",
    )
    args = parser.parse_args()
    if not args.fake_embeddings and not settings.DASHSCOPE_API_KEY:
        raise SystemExit(
            "DASHSCOPE_API_KEY is not set: put it in .env or pass --fake-embeddings"
        )
    embedder: EmbeddingProvider = (
        FakeEmbeddingProvider()
        if args.fake_embeddings
        else DashScopeEmbeddingProvider()
    )
    with Session(engine) as session:
        init_db(session)
        owner = session.exec(
            select(User).where(User.email == settings.FIRST_SUPERUSER)
        ).one()
        brand = seed_demo(session, embedder, owner)
    logger.info(
        "Demo brand created" if brand else "Demo brand already exists, nothing to do"
    )


if __name__ == "__main__":
    main()
