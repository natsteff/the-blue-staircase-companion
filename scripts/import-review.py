"""Import notebook sections from a reviewed, assembled manuscript Markdown file."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def vocabulary(section):
    rows = [line.strip("|").split("|") for line in section.splitlines() if line.startswith("|")]
    return [[cell.strip() for cell in row] for row in rows[2:]]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manuscript", type=Path)
    parser.add_argument("--edition", required=True)
    args = parser.parse_args()
    source = args.manuscript.read_text()
    front, *sections = re.split(r"^# Chapter (?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten): ", source, flags=re.M)
    traveler = front.split("# Spanish Phrases for Travelers\n", 1)[1]
    traveler = traveler.split("\n---", 1)[0]
    chapters = []
    for number, section in enumerate(sections, 1):
        title, _, _ = section.partition("\n")
        notebook = section.split("## Sally's Detective Notebook\n", 1)[1].strip()
        notebook = re.split(r"\n---\s*(?=\n# |\Z)|\n# ", notebook, maxsplit=1)[0]
        words, _, notes = notebook.partition("### Case notes\n")
        evidence_sections = re.split(r"^\*\*Untranslated evidence[^\n]*\*\*\s*$", words, maxsplit=1, flags=re.M)
        words = evidence_sections[0]
        untranslated = evidence_sections[1] if len(evidence_sections) > 1 else ""
        words, _, translated = words.partition("### Evidence translated in this chapter")
        evidence = [
            [phrase, None, context or ""]
            for phrase, context in re.findall(r"^- \*([^*]+)\*(?: \((.+)\))?$", untranslated, re.M)
        ]
        translated_rows = vocabulary(translated)
        if translated_rows:
            previous = next(
                row for chapter in chapters for row in chapter["evidence"]
                if all(phrase in row[0] for phrase, *_ in translated_rows[:2])
            )
            # The worksheet teaches both clauses separately. Keep the original warning available too.
            evidence.extend(translated_rows)
            evidence.append([previous[0], " ".join(row[1].split(" (", 1)[0].rstrip(".") + "."
                                                   for row in translated_rows[:2]),
                             "Lucía’s contextual reading; owner unknown"])
        chapters.append(dict(number=number, title=title, intro=words.splitlines()[0].strip("*").replace("**", ""),
                             vocabulary=vocabulary(words), evidence=evidence, notes=notes.strip()))
    if not chapters or not all(c["vocabulary"] and c["notes"] for c in chapters):
        raise SystemExit("The reviewed source is missing a chapter notebook or case notes.")
    data = dict(bookVersion=args.edition, latestReleasedChapter=len(chapters), chapters=chapters,
                travelers=dict(vocabulary=vocabulary(traveler), tip=traveler.strip().splitlines()[-1].strip("*")))
    (ROOT / "data/notebooks.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")

if __name__ == "__main__":
    main()
