# route to check health of the backend service

from fastapi import APIRouter

router = APIRouter(tags=["health"])

@router.get("/")
def health():
    return {"ok": True, "service": "ecosort-backend"}
