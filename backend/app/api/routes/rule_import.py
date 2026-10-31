"""Static bulk-maintenance paths, registered before the rule-id routes."""

import uuid
from typing import Annotated, Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from pydantic import BaseModel
from sqlmodel import select
from starlette.concurrency import run_in_threadpool

from app.api.brand_deps import BrandAdminDep
from app.api.deps import CurrentUser, SessionDep, get_current_active_superuser
from app.domain.compliance.import_rules import (
    MAX_BYTES,
    FileFormat,
    Mode,
    template_file,
)
from app.models import BrandMember, MemberRole
from app.services import rule_import as service
from app.services.errors import InvalidInputError

router = APIRouter(tags=["compliance"])
DOWNLOAD_RESPONSES: dict[int | str, dict[str, Any]] = {
    200: {
        "description": "Download file",
        "content": {
            "text/csv": {"schema": {"type": "string", "format": "binary"}},
            "application/json": {
                "schema": {"type": "array", "items": {"type": "object"}}
            },
        },
    }
}


class RuleImportResult(BaseModel):
    dry_run: bool
    mode: Mode
    created: int
    updated: int
    unchanged: int
    disabled: int
    errors: list[dict[str, str]]


async def _import(
    request: Request,
    file: UploadFile,
    session: SessionDep,
    user_id: uuid.UUID,
    brand_id: uuid.UUID | None,
    mode: Mode,
    dry_run: bool,
) -> RuleImportResult:
    filename = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    service.validate_file(filename, file.size or 0, mode, dry_run)
    content = await file.read(MAX_BYTES + 1)
    service.validate_file(filename, len(content), mode, dry_run)
    form = await request.form()
    if list(form.keys()) != ["file"] or len(form.getlist("file")) != 1:
        raise InvalidInputError(
            "只接受一个名为 file 的文件",
            {
                "errors": [
                    {
                        "row": None,
                        "column": "file",
                        "loc": ["body", "file"],
                        "msg": "只接受一个文件",
                        "type": "value_error",
                    }
                ]
            },
        )
    return RuleImportResult(
        **await run_in_threadpool(
            service.import_rules,
            session=session,
            brand_id=brand_id,
            user_id=user_id,
            filename=filename,
            content=content,
            mode=mode,
            dry_run=dry_run,
        )
    )


@router.post(
    "/compliance-rules/import",
    response_model=RuleImportResult,
    dependencies=[Depends(get_current_active_superuser)],
)
async def import_global_rules(
    request: Request,
    session: SessionDep,
    current_user: CurrentUser,
    file: Annotated[UploadFile, File()],
    mode: Mode = "merge",
    dry_run: bool = True,
) -> RuleImportResult:
    return await _import(request, file, session, current_user.id, None, mode, dry_run)


@router.post(
    "/brands/{brand_id}/compliance-rules/import", response_model=RuleImportResult
)
async def import_brand_rules(
    access: BrandAdminDep,
    request: Request,
    session: SessionDep,
    file: Annotated[UploadFile, File()],
    mode: Mode = "merge",
    dry_run: bool = True,
) -> RuleImportResult:
    return await _import(
        request, file, session, access.user_id, access.brand_id, mode, dry_run
    )


def _download(content: bytes, format: FileFormat, name: str) -> Response:
    return Response(
        content=content,
        media_type="application/json" if format == "json" else "text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}.{format}"'},
    )


@router.get(
    "/compliance-rules/export",
    dependencies=[Depends(get_current_active_superuser)],
    response_class=Response,
    responses=DOWNLOAD_RESPONSES,
)
def export_global_rules(session: SessionDep, format: FileFormat = "csv") -> Response:
    return _download(
        service.export_rules(session, None, format), format, "global-rules"
    )


@router.get(
    "/brands/{brand_id}/compliance-rules/export",
    response_class=Response,
    responses=DOWNLOAD_RESPONSES,
)
def export_brand_rules(
    access: BrandAdminDep, session: SessionDep, format: FileFormat = "csv"
) -> Response:
    return _download(
        service.export_rules(session, access.brand_id, format), format, "brand-rules"
    )


@router.get(
    "/compliance-rules/import-template",
    response_class=Response,
    responses=DOWNLOAD_RESPONSES,
)
def download_rule_template(
    session: SessionDep, current_user: CurrentUser, format: FileFormat = "csv"
) -> Response:
    if (
        not current_user.is_superuser
        and session.exec(
            select(BrandMember).where(
                BrandMember.user_id == current_user.id,
                BrandMember.role == MemberRole.ADMIN.value,
            )
        ).first()
        is None
    ):
        raise HTTPException(
            status_code=403, detail="Platform or brand administrator required"
        )
    return _download(template_file(format), format, "rules-template")
