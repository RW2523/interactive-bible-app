"""Prompt pack loader: versioned prompt files with front matter, rendered with {{placeholders}}."""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

PROMPT_DIR = Path(__file__).with_name("prompts")
_PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


@dataclass(frozen=True)
class Prompt:
    id: str
    name: str
    semver: str
    role: str
    temperature: float
    max_output_tokens: int
    body: str
    system: str

    @property
    def version(self) -> str:
        digest = hashlib.sha256((self.system + "\n" + self.body).encode()).hexdigest()[:10]
        return f"{self.semver}+{digest}"

    @property
    def placeholders(self) -> set[str]:
        return set(_PLACEHOLDER.findall(self.body))

    def render(self, variables: dict[str, Any]) -> str:
        missing = self.placeholders - set(variables)
        if missing:
            raise KeyError(f"{self.id}: missing prompt variables {sorted(missing)}")

        def value(match: re.Match[str]) -> str:
            v = variables[match.group(1)]
            if isinstance(v, str):
                return v
            return json.dumps(v, ensure_ascii=False, default=str)

        return _PLACEHOLDER.sub(value, self.body)


def _parse(path: Path, system: str) -> Prompt:
    raw = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", raw, re.DOTALL)
    if not m:
        raise ValueError(f"prompt {path.name} lacks front matter")
    meta: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return Prompt(
        id=meta["id"], name=meta["name"], semver=meta.get("version", "1.0.0"), role=meta.get("role", "analysis"),
        temperature=float(meta.get("temperature", "0.1")), max_output_tokens=int(meta.get("max_output_tokens", "16384")),
        body=m.group(2).strip(), system=system,
    )


# prompt families share one system prompt each: P = Scripture analysis pipeline, S = Sermon Studio, E = Explore (atlas/timeline/stories)
PROMPT_FAMILIES = {"P": "_system_rules.md", "S": "_system_sermon.md", "E": "_system_explore.md"}


@lru_cache
def load_prompts() -> dict[str, Prompt]:
    prompts: dict[str, Prompt] = {}
    for prefix, system_file in PROMPT_FAMILIES.items():
        system = (PROMPT_DIR / system_file).read_text(encoding="utf-8").strip()
        for path in sorted(PROMPT_DIR.glob(f"{prefix}-*.md")):
            p = _parse(path, system)
            if not p.id.startswith(f"{prefix}-"):
                raise ValueError(f"prompt {path.name} declares id {p.id} outside its family {prefix}")
            prompts[p.id] = p
    return prompts


def get_prompt(prompt_id: str) -> Prompt:
    return load_prompts()[prompt_id]


def prompt_versions() -> dict[str, str]:
    return {pid: p.version for pid, p in load_prompts().items()}
