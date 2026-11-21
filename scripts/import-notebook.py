"""Import the two canonical v02 notebooks from the supplied Markdown file."""
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]).read_text()
chapters = []
for number, body in enumerate(source.split("## Sally's Detective Notebook\n")[1:], 1):
    body = body.split("\n---")[0].strip()
    lines = body.splitlines()
    rows = [line.strip("|").split("|") for line in lines if line.startswith("|")][2:]
    chapters.append({
        "number": number,
        "title": ["The House with the Blue Staircase", "A Word for Dead"][number - 1],
        "intro": lines[0].strip("*"),
        "vocabulary": [[cell.strip() for cell in row] for row in rows],
        "notes": body[body.rfind("\n|") + 1:].split("\n", 1)[1].strip(),
    })
assert [len(c["vocabulary"]) for c in chapters] == [17, 14]
(ROOT / "data/notebooks.json").write_text(json.dumps({
    "bookVersion": "v02", "latestReleasedChapter": 2, "chapters": chapters
}, ensure_ascii=False, indent=2) + "\n")
