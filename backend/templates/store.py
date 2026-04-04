"""Prompt template persistence."""

import json
import logging
from pathlib import Path

from backend.templates.models import PromptTemplate
from backend.sessions.store import _data_dir

logger = logging.getLogger(__name__)


def _templates_dir() -> Path:
    d = _data_dir() / "templates"
    d.mkdir(exist_ok=True)
    return d


def save_template(template: PromptTemplate) -> None:
    path = _templates_dir() / f"{template.id}.json"
    path.write_text(json.dumps(template.model_dump(), indent=2))


def load_template(template_id: str) -> PromptTemplate | None:
    path = _templates_dir() / f"{template_id}.json"
    if not path.exists():
        return None
    try:
        return PromptTemplate.model_validate_json(path.read_text())
    except Exception:
        logger.warning("Failed to load template %s", template_id)
        return None


def load_all_templates() -> list[PromptTemplate]:
    templates = []
    for path in _templates_dir().glob("*.json"):
        try:
            templates.append(PromptTemplate.model_validate_json(path.read_text()))
        except Exception:
            logger.warning("Skipping corrupt template file %s", path.name)
    templates.sort(key=lambda t: t.created_at)
    return templates


def load_template_by_slug(slug: str) -> PromptTemplate | None:
    for t in load_all_templates():
        if t.slug == slug:
            return t
    return None


def delete_template(template_id: str) -> None:
    # Protect built-in templates from deletion
    t = load_template(template_id)
    if t and t.is_builtin:
        return
    path = _templates_dir() / f"{template_id}.json"
    path.unlink(missing_ok=True)


def seed_builtin_templates() -> None:
    """Create built-in templates if they don't already exist."""
    from backend.templates.builtins import BUILTIN_TEMPLATES

    existing_slugs = {t.slug for t in load_all_templates()}
    for tmpl_data in BUILTIN_TEMPLATES:
        if tmpl_data["slug"] not in existing_slugs:
            template = PromptTemplate(**tmpl_data)
            save_template(template)
            logger.info("Seeded built-in template: %s", template.name)
