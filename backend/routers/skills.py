"""
Skills catalog API router.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.skills_catalog import CATALOG_PATH, SKILLS_DIR, load_catalog, rebuild_catalog
from core.skills_importer import (
    SkillInstallError,
    install_from_package,
    remove_skill_from_library,
    search_skills_sh,
)


router = APIRouter()


@router.get("/skills/catalog")
async def get_catalog():
    """Return skill catalog (builds if missing)."""
    if not CATALOG_PATH.exists():
        catalog = rebuild_catalog()
    else:
        catalog = load_catalog()
        if not catalog:
            catalog = rebuild_catalog()

    return {
        "status": "success",
        "catalog": catalog,
        "path": str(CATALOG_PATH),
        "skills_dir": str(SKILLS_DIR),
    }


@router.post("/skills/catalog/rebuild")
async def rebuild_catalog_endpoint():
    """Rebuild catalog by scanning storage/skills."""
    catalog = rebuild_catalog()
    return {
        "status": "success",
        "catalog": catalog,
        "path": str(CATALOG_PATH),
        "skills_dir": str(SKILLS_DIR),
    }


class SkillSearchResponse(BaseModel):
    status: str
    source: str
    results: list[dict]


@router.get("/skills/sources/search", response_model=SkillSearchResponse)
async def search_skills_source(source: str = "skills.sh", query: str | None = None, limit: int = 20):
    """Search skills from external sources (skills.sh API)."""
    if source not in {"skills.sh"}:
        raise HTTPException(status_code=400, detail=f"Unsupported source: {source}")
    if not query:
        return {"status": "success", "source": source, "results": []}
    try:
        results = await search_skills_sh(query=query, limit=limit)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"status": "success", "source": source, "results": results}


class SkillInstallRequest(BaseModel):
    package: str | None = None
    skill: str | None = None
    full_depth: bool | None = None
    # Backwards-compatible fields (legacy UI)
    source: str | None = None
    owner: str | None = None
    repo: str | None = None


@router.post("/skills/sources/install")
async def install_skill(request: SkillInstallRequest):
    """Install a skill from a supported source into storage/skills."""
    package = request.package
    if not package and request.owner and request.repo:
        package = f"{request.owner}/{request.repo}"
    if not package:
        raise HTTPException(status_code=400, detail="package is required")
    try:
        result = await install_from_package(
            package=package,
            skill=request.skill,
            full_depth=bool(request.full_depth),
        )
    except SkillInstallError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"status": "success", **result}


class SkillRemoveRequest(BaseModel):
    skill_id: str


@router.post("/skills/library/remove")
async def remove_skill(request: SkillRemoveRequest):
    """Remove a skill from storage/skills based on skill_id."""
    try:
        catalog = remove_skill_from_library(request.skill_id)
    except SkillInstallError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"status": "success", "catalog": catalog}
