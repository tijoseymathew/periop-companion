"""MkDocs build hook: keep source-file links working on the published site.

The docs are authored to read well *in the repo*, so they link to source with
repo-relative paths like ``[stages.py](../src/periop/adk/stages.py)``. Those
resolve on GitHub but 404 on the built site, where there is no ``../src``.

This hook rewrites every Markdown link that escapes ``docs/`` (any target
starting with ``../``) into an absolute GitHub blob/tree URL, pinned to the ref
configured via ``extra.source_ref`` in ``mkdocs.yml`` (default ``main``, or the
``DOCS_SOURCE_REF`` env var in CI). Links between docs pages (``architecture.md``)
and external ``http(s)`` links are left untouched.
"""

import posixpath
import re

# [text](../path/to/file.py#anchor "optional title") — target must start with ../
_LINK = re.compile(r"(?P<text>\]\()(?P<target>\.\./[^)\s]+)(?P<tail>[)\s])")


def on_page_markdown(markdown, page, config, files, **kwargs):
    repo_url = config.get("repo_url", "").rstrip("/")
    if not repo_url:
        return markdown
    source_ref = config.get("extra", {}).get("source_ref", "main")

    def replace(match):
        target = match.group("target")
        path, _, fragment = target.partition("#")
        # Normalise ../foo/bar -> foo/bar relative to the repo root.
        repo_path = posixpath.normpath(posixpath.join("docs", path)).lstrip("/")
        # blob for files, tree for directories (best-effort: trailing slash = dir).
        kind = "tree" if path.endswith("/") else "blob"
        url = f"{repo_url}/{kind}/{source_ref}/{repo_path}"
        if fragment:
            url = f"{url}#{fragment}"
        return f"{match.group('text')}{url}{match.group('tail')}"

    return _LINK.sub(replace, markdown)
