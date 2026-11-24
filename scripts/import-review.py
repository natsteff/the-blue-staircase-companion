"""Import notebook sections from a reviewed, assembled manuscript Markdown file."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def vocabulary(section):
    rows = [line.strip("|").split("|") for line in section.splitlines() if line.startswith("|")]
    return [[cell.strip() for cell in row] for row in rows[2:]]

def travelers_reference(section):
    parts = re.split(r"^#{2,3} (.+)\n", section, flags=re.M)
    groups = {}
    rows = []
    for title, content in zip(parts[1::2], parts[2::2]):
        group = vocabulary(content) or re.findall(r"^\*\*(.+)\*\* *\n([^\n|]+)", content, re.M)
        if not group:
            raise SystemExit(f"Traveler phrase group is empty: {title}")
        for spanish, english in group:
            match = re.fullmatch(r"(.+) \(Also: (.+)\)", spanish)
            if match:
                phrase, alternate = match.groups()
                meaning, _, alternate_meaning = english.partition(" (")
                detail = f"Also **{alternate}**"
                if alternate_meaning:
                    detail += f" — {alternate_meaning.removesuffix(')')}"
                rows.append([phrase, meaning, detail, [alternate]])
            else:
                rows.append([spanish, english])
        groups[rows[-len(group)][0]] = title
    return dict(vocabulary=rows or vocabulary(section), groups=groups,
                tip=section.strip().splitlines()[-1].strip("*"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manuscript", type=Path)
    parser.add_argument("--edition", required=True)
    args = parser.parse_args()
    source = args.manuscript.read_text()
    data_path = ROOT / "data/notebooks.json"
    previous = json.loads(data_path.read_text()) if data_path.exists() else {}
    current = {chapter["number"]: chapter for chapter in previous.get("chapters", [])}
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
        evidence.extend(translated_rows)
        # Rosa's two-part warning was recorded together before it was translated.
        if number == 2 and len(translated_rows) >= 2:
            prior_warning = next((
                row for chapter in chapters for row in chapter["evidence"]
                if all(phrase in row[0] for phrase, *_ in translated_rows[:2])
            ), None)
            if prior_warning:
                evidence.append([prior_warning[0], " ".join(row[1].split(" (", 1)[0].rstrip(".") + "."
                                                           for row in translated_rows[:2]),
                                 "Lucía’s contextual reading; owner unknown"])
        chapters.append(dict(number=number, title=title, intro=words.splitlines()[0].strip("*").replace("**", ""),
                             vocabulary=vocabulary(words), evidence=evidence, notes=notes.strip()))
    if not chapters or not all(c["vocabulary"] and c["notes"] for c in chapters):
        raise SystemExit("The reviewed source is missing a chapter notebook or case notes.")
    for chapter in chapters:
        existing = current.get(chapter["number"], {})
        # These placements interleave the two manuscript lists in the app's Story Order.
        if "evidenceBefore" in existing and chapter["evidence"] == existing["evidence"]:
            chapter.update(evidenceBefore=existing["evidenceBefore"], intro=existing["intro"])
    data = dict(bookVersion=args.edition, latestReleasedChapter=len(chapters), chapters=chapters,
                travelers=travelers_reference(traveler))
    data_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")

if __name__ == "__main__":
    main()
