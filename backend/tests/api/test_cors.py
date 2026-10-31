from fastapi.testclient import TestClient

from app.core.config import settings


def test_cors_exposes_request_id_and_content_disposition(client: TestClient) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/utils/health-check/",
        headers={"Origin": settings.FRONTEND_HOST},
    )
    exposed = r.headers["access-control-expose-headers"]
    assert "X-Request-ID" in exposed
    assert "Content-Disposition" in exposed
