import json
import re
from pathlib import Path

from .core.config import get_settings


def normalize_gloss(value: str) -> str:
    return " ".join(re.findall(r"[a-z]+(?:['-][a-z]+)*", str(value).lower()))


def word_forms(value: str) -> set[str]:
    """Return the common inflected forms that can map to one motion gloss."""
    word = normalize_gloss(value)
    if " " in word:
        return {word}

    forms = {word}
    if len(word) > 3 and word.endswith("ies"):
        forms.add(f"{word[:-3]}y")
    if len(word) > 4 and word.endswith(("ing", "ed")):
        suffix_length = 3 if word.endswith("ing") else 2
        stem = word[:-suffix_length]
        forms.add(stem)
        if len(stem) > 3 and stem[-1] == stem[-2] and stem[-1] not in "aeiou":
            forms.add(stem[:-1])
        if stem and stem[-1] not in "aeiou" and not stem.endswith(("th", "sh", "ch")):
            forms.add(f"{stem}e")
    if len(word) > 3 and word.endswith("es"):
        forms.add(word[:-2])
    if len(word) > 2 and word.endswith("s"):
        forms.add(word[:-1])
    return forms


def gloss_words(value: str) -> list[str]:
    return re.findall(r"[a-z]+(?:['-][a-z]+)*", str(value).lower())


def words_match(left: str, right: str) -> bool:
    return bool(word_forms(left) & word_forms(right))


def phrases_match(left: list[str], right: list[str]) -> bool:
    return len(left) == len(right) and all(words_match(left_word, right_word) for left_word, right_word in zip(left, right))


def load_motion_manifest() -> dict:
    path = Path(get_settings().motion_manifest_path)
    if not path.exists():
        return {"clips": [], "clipCount": 0}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"clips": [], "clipCount": 0}
    return data if isinstance(data, dict) else {"clips": [], "clipCount": 0}


def match_glosses(text: str, manifest: dict) -> list[dict]:
    words = gloss_words(text)
    candidates = {}

    for clip in manifest.get("clips", []):
        gloss = str(clip.get("gloss", "")).strip()
        candidate_words = tuple(gloss_words(gloss))
        if candidate_words and candidate_words not in candidates:
            candidates[candidate_words] = clip

    ordered_matches = []
    index = 0
    while index < len(words) and len(ordered_matches) < 20:
        match = None
        for candidate_words, clip in sorted(candidates.items(), key=lambda item: len(item[0]), reverse=True):
            end = index + len(candidate_words)
            if phrases_match(words[index:end], list(candidate_words)):
                match = (len(candidate_words), clip)
                break

        if match is None:
            index += 1
            continue

        ordered_matches.append(match[1])
        index += match[0]

    return ordered_matches


def resolve_gloss_sequence(glosses: list[str], manifest: dict) -> tuple[list[dict], list[str]]:
    clips_by_gloss = {}

    for clip in manifest.get("clips", []):
        if not isinstance(clip, dict):
            continue
        key = normalize_gloss(clip.get("gloss", ""))
        if key and key not in clips_by_gloss:
            clips_by_gloss[key] = clip

    resolved = []
    unknown = []

    for gloss in glosses:
        requested = str(gloss).strip()
        clip = clips_by_gloss.get(normalize_gloss(requested))
        if clip is None:
            requested_words = gloss_words(requested)
            clip = next(
                (
                    candidate
                    for candidate in clips_by_gloss.values()
                    if phrases_match(requested_words, gloss_words(candidate.get("gloss", "")))
                ),
                None,
            )
        if clip is None:
            unknown.append(requested)
        else:
            resolved.append(clip)

    return resolved, unknown


def build_motion_sequence(glosses: list[str], manifest: dict) -> tuple[list[dict], list[str]]:
    return resolve_gloss_sequence(glosses, manifest)
