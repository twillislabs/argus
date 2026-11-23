"""Turn the documentation site's pages (docs-site/docs) into GitHub wiki
pages, in the sidebar's order (docs-site/sidebars.ts).

    python3 scripts/docs_to_wiki.py docs-site OUT_DIR

Writes one OUT_DIR/<Page-Name>.md per page (the introduction becomes
Home.md), plus _Sidebar.md and _Footer.md. The .github/workflows/wiki.yml
workflow runs it on every push to main and pushes the result to the
repository's wiki, so edit the docs in the repository, never the wiki.

What changes on the way:
- front matter goes; its title becomes the page name (and a heading,
  when the page has none);
- links to other pages (relative .md paths) become wiki page links,
  keeping their #anchors;
- Docusaurus admonitions (:::info ... :::) become GitHub alerts;
- everything else (tables, code, Mermaid diagrams) stays as written.
"""

import os
import posixpath
import re
import sys

ADMONITIONS = {
    "note": "NOTE",
    "info": "NOTE",
    "tip": "TIP",
    "warning": "WARNING",
    "caution": "WARNING",
    "danger": "CAUTION",
}
FRONT = re.compile(r"^---\n(.*?)\n---\n", re.S)
LINK = re.compile(r"\]\((?!https?:|mailto:|#)([^)\s]+?\.md)(#[^)\s]*)?\)")
CATEGORY = re.compile(
    r"label:\s*'([^']+)'[\s\S]*?items:\s*\[([\s\S]*?)\]", re.M
)
QUOTED = re.compile(r"'([^']+)'")
REPO = "https://github.com/twillislabs/argus"


def front_matter(text: str) -> tuple[dict, str]:
    m = FRONT.match(text)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip().strip("'\"")
    return meta, text[m.end() :]


def page_name(title: str) -> str:
    """A wiki page name: words joined by dashes, no punctuation GitHub
    would mangle."""
    name = re.sub(r"[^\w\s-]", "", title, flags=re.U)
    name = re.sub(r"\s+", "-", name.strip())
    return name or "Page"


def admonitions(body: str) -> str:
    out: list[str] = []
    inside = False
    for line in body.split("\n"):
        m = re.match(r"^:::(\w+)\s*(.*)$", line)
        if m and not inside and m.group(1) in ADMONITIONS:
            inside = True
            out.append("> [!{0}]".format(ADMONITIONS[m.group(1)]))
            if m.group(2):
                out.append("> **{0}**".format(m.group(2).strip()))
            continue
        if inside and line.strip() == ":::":
            inside = False
            continue
        out.append(("> " + line).rstrip() if inside else line)
    return "\n".join(out)


def sidebar(site: str) -> list[tuple[str | None, list[str]]]:
    """[(category or None, [doc ids])] in the sidebar's order."""
    with open(os.path.join(site, "sidebars.ts"), encoding="utf-8") as f:
        text = f.read()
    start = text.index("docs:")
    body = text[start:]
    groups: list[tuple[str | None, list[str]]] = []
    first = body.find("{")
    head = body[:first] if first >= 0 else body
    top = [q for q in QUOTED.findall(head) if "/" in q or q == "intro"]
    if top:
        groups.append((None, top))
    for label, items in CATEGORY.findall(body):
        groups.append((label, QUOTED.findall(items)))
    return groups


def convert(site: str, out: str) -> list[str]:
    docs = os.path.join(site, "docs")
    groups = sidebar(site)
    ordered = [d for _, ids in groups for d in ids]
    # Every page, sidebar ones first, then any the sidebar leaves out.
    for root, _, files in os.walk(docs):
        for f in sorted(files):
            if f.endswith(".md"):
                rel = posixpath.relpath(
                    posixpath.join(root.replace(os.sep, "/"), f[:-3]),
                    docs.replace(os.sep, "/"),
                )
                if rel not in ordered:
                    ordered.append(rel)
    pages: dict[str, tuple[str, dict, str]] = {}
    names: dict[str, str] = {}
    used: set[str] = set()
    for doc in ordered:
        path = os.path.join(docs, doc + ".md")
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            meta, body = front_matter(f.read())
        h1 = re.search(r"^#\s+(.+)$", body, re.M)
        title = meta.get("title") or (h1.group(1) if h1 else doc)
        name = "Home" if doc == "intro" else page_name(title)
        while name in used:
            name += "-"
        used.add(name)
        names[doc] = name
        pages[doc] = (title, meta, body)

    def fix_links(doc: str, body: str) -> str:
        here = posixpath.dirname(doc)

        def repl(m: re.Match) -> str:
            target = posixpath.normpath(posixpath.join(here, m.group(1)))
            target = target[:-3] if target.endswith(".md") else target
            name = names.get(target)
            if not name:
                return m.group(0)
            return "]({0}{1})".format(name, m.group(2) or "")

        return LINK.sub(repl, body)

    os.makedirs(out, exist_ok=True)
    written = []
    for doc, (title, _meta, body) in pages.items():
        body = admonitions(fix_links(doc, body)).strip() + "\n"
        if not re.search(r"^#\s", body, re.M):
            body = "# {0}\n\n{1}".format(title, body)
        name = names[doc]
        with open(os.path.join(out, name + ".md"), "w", encoding="utf-8") as f:
            f.write(body)
        written.append(name)

    lines = ["**[Home](Home)**", ""]
    for label, ids in groups:
        if label:
            lines += ["**{0}**".format(label), ""]
        for d in ids:
            if d in names and names[d] != "Home":
                lines.append("- [{0}]({1})".format(pages[d][0], names[d]))
        lines.append("")
    lines.append("[Source on GitHub]({0})".format(REPO))
    with open(os.path.join(out, "_Sidebar.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    with open(os.path.join(out, "_Footer.md"), "w", encoding="utf-8") as f:
        f.write(
            "This wiki is generated from "
            "[docs-site/docs]({0}/tree/main/docs-site/docs) on every push "
            "to main. Edit the docs there: changes made here are "
            "replaced.\n".format(REPO)
        )
    return written


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit("usage: docs_to_wiki.py DOCS_SITE OUT_DIR")
    written = convert(sys.argv[1], sys.argv[2])
    print("Wrote {0} pages: {1}".format(len(written), ", ".join(written)))


if __name__ == "__main__":
    main()
