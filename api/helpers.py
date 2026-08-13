"""Pure utility functions extracted from web_ui.py.

These are stateless helpers for parsing LLM output tags (suggestions, images),
building enrichment context for curriculum facts, and extracting JSON from LLM responses.
"""

import json
import os
import re

import httpx


def verify_turnstile(token: str, remote_ip: str | None = None) -> bool:
    """Verify a Cloudflare Turnstile token against siteverify.

    Returns True on success. If TURNSTILE_SECRET_KEY is unset, verification is
    skipped (returns True) so local dev without the env var still works.
    """
    secret = os.environ.get("TURNSTILE_SECRET_KEY")
    if not secret:
        return True
    if not token:
        return False
    data = {"secret": secret, "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip
    try:
        resp = httpx.post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            data=data,
            timeout=5.0,
        )
        return bool(resp.json().get("success"))
    except Exception:
        return False


def parse_suggestions(text: str) -> dict:
    """Parse <SUGGESTIONS>...</SUGGESTIONS> blocks from text.
    Handles: properly paired tags, unclosed opening tag, orphaned closing tag,
    and inline suggestions (dash-prefixed lines before a closing tag).
    Also handles legacy [SUGGESTIONS] bracket format for backward compatibility."""

    # Normalize legacy bracket tags and variant names to XML format
    for old, new in [('[SUGGESTED]', '<SUGGESTIONS>'), ('[/SUGGESTED]', '</SUGGESTIONS>'),
                     ('[SUGGESTIONS]', '<SUGGESTIONS>'), ('[/SUGGESTIONS]', '</SUGGESTIONS>')]:
        text = text.replace(old, new)

    pattern = r'<SUGGESTIONS>(.*?)</SUGGESTIONS>'
    matches = re.findall(pattern, text, re.DOTALL)

    suggestions = []
    clean_text = text

    def _extract_suggestions(block: str):
        for line in block.strip().split('\n'):
            line = line.strip()
            if line.startswith('- '):
                suggestions.append(line[2:].strip().strip('"'))
            elif line and line not in ('<SUGGESTIONS>', '</SUGGESTIONS>'):
                suggestions.append(line.strip().strip('"'))

    # Case 1: properly paired <SUGGESTIONS>...</SUGGESTIONS>
    for match in matches:
        _extract_suggestions(match)
        clean_text = clean_text.replace(f'<SUGGESTIONS>{match}</SUGGESTIONS>', '')

    # Case 2: unclosed <SUGGESTIONS> (missing closing tag)
    if not matches and '<SUGGESTIONS>' in clean_text:
        idx = clean_text.index('<SUGGESTIONS>')
        _extract_suggestions(clean_text[idx + len('<SUGGESTIONS>'):])
        clean_text = clean_text[:idx]

    # Case 3: orphaned </SUGGESTIONS> without opening tag
    # LLM sometimes inlines suggestions as "- opt1 - opt2 </SUGGESTIONS>"
    if not suggestions and '</SUGGESTIONS>' in clean_text:
        idx = clean_text.index('</SUGGESTIONS>')
        before = clean_text[:idx]
        after = clean_text[idx + len('</SUGGESTIONS>'):]
        parts = re.split(r'\s+- ', before)
        if len(parts) > 1:
            for p in parts[1:]:
                item = p.strip().strip('"')
                if item:
                    suggestions.append(item)
            clean_text = parts[0] + after
        else:
            clean_text = before + after
        clean_text = clean_text.replace('</SUGGESTIONS>', '')

    # Strip any text AFTER the last </SUGGESTIONS> tag — LLM sometimes leaks
    # answer text after the closing tag (e.g. during TRY step)
    last_close = clean_text.rfind('</SUGGESTIONS>')
    if last_close >= 0:
        clean_text = clean_text[:last_close]

    # Final cleanup: strip any remaining orphaned tags
    clean_text = clean_text.replace('<SUGGESTIONS>', '').replace('</SUGGESTIONS>', '')

    suggestions = suggestions[:4]
    return {"text": clean_text.strip(), "suggestions": suggestions}


def _inject_image_url(text: str, url: str) -> str:
    """Inject a url: line into the first <IMAGE> block in text.

    Before: <IMAGE>\ntopic: X\ndescription: Y\n</IMAGE>
    After:  <IMAGE>\ntopic: X\ndescription: Y\nurl: https://...\n</IMAGE>

    This lets the session viewer display the correct image without
    fuzzy topic matching against the execution log.
    Also handles legacy [IMAGE] bracket format.
    """
    if not url:
        return text
    # Try XML tags first, then legacy bracket tags
    for open_tag, close_tag in [("<IMAGE>", "</IMAGE>"), ("[IMAGE]", "[/IMAGE]")]:
        if open_tag in text:
            return text.replace(close_tag, f'url: {url}\n{close_tag}', 1)
    return text


def _enrich_str(item) -> str:
    """Stringify an enrichment item (may be str or dict)."""
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        # micro_checks: {question, answer}; applications/processes may also be dicts
        return item.get("question") or item.get("text") or item.get("name") or str(item)
    return str(item)


def _format_misconception(m: dict) -> str:
    """Format a misconception dict for prompt injection. Handles both legacy and new field names."""
    # New format: misconception, correct_understanding, why_wrong, prevalence
    wrong = m.get("misconception") or m.get("wrong", "")
    correct = m.get("correct_understanding") or m.get("correct", "")
    why = m.get("why_wrong", "")
    parts = [f"{wrong} -> {correct}"]
    if why:
        parts.append(f"(why: {why})")
    return " ".join(parts)


def _build_enrichment_lines(capsule: dict, fact_text: str) -> list[str]:
    """Build enrichment context lines for a given fact in XML format.
    Only includes teaching-relevant fields (applications, processes, vocabulary, misconceptions).
    Check questions and evidence questions are handled separately by their respective steps."""
    fact_enrich = capsule.get("_fact_enrichment", {}).get(fact_text, {})
    lines = []
    apps = fact_enrich.get("applications", [])
    if apps:
        items = "\n".join(f"    <item>{_enrich_str(a)}</item>" for a in apps)
        lines.append(f"  <APPLICATIONS>\n{items}\n  </APPLICATIONS>")
    procs = fact_enrich.get("processes", [])
    if procs:
        items = "\n".join(f"    <item>{_enrich_str(p)}</item>" for p in procs)
        lines.append(f"  <PROCESSES>\n{items}\n  </PROCESSES>")
    vocab = fact_enrich.get("vocabulary", [])
    if vocab:
        terms = [v for v in vocab if isinstance(v, dict) and v.get("term")]
        if terms:
            items = "\n".join(f"    <term name=\"{v['term']}\">{v.get('definition', '')}</term>" for v in terms)
            lines.append(f"  <KEY_TERMS>\n{items}\n  </KEY_TERMS>")
    miscon = fact_enrich.get("misconceptions", [])
    if miscon:
        mc_items = [m for m in miscon if isinstance(m, dict)]
        if mc_items:
            items = "\n".join(f"    <misconception>{_format_misconception(m)}</misconception>" for m in mc_items)
            lines.append(f"  <MISCONCEPTIONS>\n{items}\n  </MISCONCEPTIONS>")
    return lines


def extract_json(text: str, default: dict | None = None) -> dict:
    """Extract a JSON object from LLM response text.

    Handles:
      - Raw JSON
      - Markdown code blocks (```json ... ```)
      - <think>...</think> reasoning preambles (Qwen, DeepSeek style)
      - Bare { ... } embedded in prose

    When prose contains multiple {...} fragments (e.g. an example object inside
    a reasoning preamble followed by the real payload), prefer the LARGEST
    valid object. Returns default (or {}) on failure.
    """
    text = (text or "").strip()
    if not text:
        return default if default is not None else {}

    # Strip <think>...</think> blocks before parsing — local reasoning models
    # often wrap their internal monologue in these and the actual JSON lives
    # after the closing tag.
    if "<think>" in text and "</think>" in text:
        text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

    # Try direct parse
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        pass

    # Try extracting from markdown code blocks — keep the largest parsable block
    candidates: list[dict] = []
    if "```" in text:
        for block in text.split("```"):
            block = block.strip()
            if block.startswith("json"):
                block = block[4:].strip()
            try:
                parsed = json.loads(block)
                if isinstance(parsed, dict):
                    candidates.append(parsed)
            except (json.JSONDecodeError, ValueError):
                continue

    # Walk {...} candidate substrings and try to parse. Bound the inputs:
    # past 64 KiB or 64 starts we trust the direct-parse / code-block paths
    # only. This prevents O(n²)-O(n³) DoS on adversarial LLM output (e.g. a
    # response of 1 MB of "{" characters). See pre-ship review pass-2 NEW-2.
    if len(text) <= _EXTRACT_JSON_BRACE_WALK_CAP:
        starts = [i for i, ch in enumerate(text) if ch == "{"][:_EXTRACT_JSON_MAX_STARTS]
        for i in starts:
            # Take the largest valid object starting at i: scan } positions from
            # the right; first parse success is the maximal slice for this i.
            for j in range(len(text) - 1, i, -1):
                if text[j] != "}":
                    continue
                try:
                    parsed = json.loads(text[i:j + 1])
                    if isinstance(parsed, dict):
                        candidates.append(parsed)
                    break
                except (json.JSONDecodeError, ValueError):
                    continue

    if candidates:
        # Heuristic ordering, top to bottom:
        #   1. Any candidate that LOOKS like the outer payload structure
        #      callers want — has a `proposals`, `candidates`, `judges`, or
        #      `score` top-level key. This prevents the case where an LLM
        #      response gets truncated mid-stream and the brace-walk picks
        #      an inner nested object (e.g. `sustained_examples_per_fact`)
        #      as "largest valid dict" because the outer object failed to
        #      parse. Truncated outer parses partially or not at all; inner
        #      parses cleanly but is the wrong return value.
        #   2. Otherwise, the candidate with the most top-level keys
        #      (back-compat: proxy for "real payload" when shape is unknown).
        _INTENT_KEYS = ("proposals", "candidates", "judges", "score", "decision")
        intent_match = [d for d in candidates if any(k in d for k in _INTENT_KEYS)]
        if intent_match:
            return max(intent_match, key=lambda d: len(d))
        return max(candidates, key=lambda d: len(d))
    return default if default is not None else {}


# Caps on the brace-walk fallback. Defined alongside the function rather than
# at module top so they're easy to spot when reading the parser.
_EXTRACT_JSON_BRACE_WALK_CAP = 64 * 1024
_EXTRACT_JSON_MAX_STARTS = 64


def parse_images(text: str) -> dict:
    """Parse <EDUCATIONAL_IMAGE>...</EDUCATIONAL_IMAGE> blocks from text.

    The LLM writes the Grok Imagine prompt directly inside the tags.
    We extract it as-is and return it as image_prompt.
    Also handles legacy <IMAGE> tags with topic/description fields as fallback."""

    image_prompt = None
    clean_text = text

    # --- Primary: <EDUCATIONAL_IMAGE> contains the raw Grok Imagine prompt ---
    ei_pattern = r'<EDUCATIONAL_IMAGE>(.*?)</EDUCATIONAL_IMAGE>'
    ei_matches = re.findall(ei_pattern, clean_text, re.DOTALL)
    for match in ei_matches:
        prompt = match.strip()
        if prompt and not image_prompt:
            image_prompt = prompt
        clean_text = clean_text.replace(f'<EDUCATIONAL_IMAGE>{match}</EDUCATIONAL_IMAGE>', '')

    # Unclosed <EDUCATIONAL_IMAGE>
    if not image_prompt and '<EDUCATIONAL_IMAGE>' in clean_text:
        idx = clean_text.index('<EDUCATIONAL_IMAGE>')
        tail = clean_text[idx + len('<EDUCATIONAL_IMAGE>'):]
        prompt = tail.split('</EDUCATIONAL_IMAGE>')[0].strip()
        if prompt:
            image_prompt = prompt
        clean_text = clean_text[:idx]

    # Final cleanup for EDUCATIONAL_IMAGE tags
    clean_text = clean_text.replace('<EDUCATIONAL_IMAGE>', '').replace('</EDUCATIONAL_IMAGE>', '')

    # --- Legacy fallback: <IMAGE> with topic/description fields ---
    if not image_prompt:
        # Normalize legacy bracket tags
        for old, new in [('[IMAGE]', '<IMAGE>'), ('[/IMAGE]', '</IMAGE>'),
                         ('[DIAGRAM]', '<IMAGE>'), ('[/DIAGRAM]', '</IMAGE>')]:
            clean_text = clean_text.replace(old, new)

        legacy_pattern = r'<IMAGE>(.*?)</IMAGE>'
        legacy_matches = re.findall(legacy_pattern, clean_text, re.DOTALL)
        for match in legacy_matches:
            block = match.strip()
            # Try to extract topic/description and build a simple prompt
            topic = ""
            description = ""
            for line in block.split('\n'):
                line = line.strip()
                if line.lower().startswith('topic:'):
                    topic = line[6:].strip()
                elif line.lower().startswith('description:'):
                    description = line[12:].strip()
            if topic or description:
                image_prompt = f"A bright educational illustration of {topic}. {description}. " \
                    "Pixar-style cartoon, cheerful colors, clean lines. " \
                    "No speech bubbles, no text boxes. Single unified scene."
            clean_text = clean_text.replace(f'<IMAGE>{match}</IMAGE>', '')

        clean_text = clean_text.replace('<IMAGE>', '').replace('</IMAGE>', '')

    return {"text": clean_text.strip(), "image_prompt": image_prompt}
