"""Validate and package the static app or generate its local pronunciation assets."""
import hashlib
import json
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import wave
from urllib.parse import quote
from zipfile import ZipFile
from array import array
from reader import reader_book

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/notebooks.json"
MANIFEST = ROOT / "audio/manifest.json"
PUBLISHED_BOOKS = (
    "books/The Blue Staircase - Chapters 1-12 - Review Draft 01.epub",
    "books/The Blue Staircase - Chapters 1-10 - Review Draft 01.epub",
    "books/The Blue Staircase - Chapters 1-8 - Review Draft 01.epub",
    "books/The Blue Staircase - Review Draft (Chapters 1-4) v3.epub",
    "books/The Blue Staircase - Review Draft (Chapters 1-4) v2.epub",
    "books/The_Last_Witness_-_Working_Draft_v02.epub",
)
WARNING = "No confíe en él. La llave no es suya."

def key(text):
    return unicodedata.normalize("NFC", text).strip().casefold()

def speech_key(text):
    return re.sub(r"(?<!\.)\.$", "", key(text))

def audio_id(text):
    return hashlib.sha256(key(text).encode()).hexdigest()[:20]

def read(path):
    return json.loads(path.read_text())

def call(*args):
    subprocess.run(args, check=True)

def has_audio(path):
    try:
        with wave.open(str(path)) as recording:
            if recording.getsampwidth() != 2:
                return False
            samples = array("h", recording.readframes(recording.getnframes()))
            if sys.byteorder != "little":
                samples.byteswap()
            return any(abs(sample) > 100 for sample in samples)
    except (OSError, EOFError, ValueError, wave.Error):
        return False

def generate(entries):
    voices = subprocess.check_output(["say", "-v", "?"], text=True)
    mexican = [line.split("es_MX")[0].strip() for line in voices.splitlines() if " es_MX " in line]
    if not mexican:
        raise SystemExit("Install a Mexican Spanish system voice in Accessibility settings.")
    voice = "Paulina" if "Paulina" in mexican else mexican[0]
    old = read(MANIFEST)["recordings"] if MANIFEST.exists() else {}
    with tempfile.TemporaryDirectory() as temp:
        wav = Path(temp) / "speech.aiff"
        encoded = Path(temp) / "speech.wav"
        for identity, phrase in entries.items():
            record = dict(text=phrase, voice=voice, locale="es-MX", file=f"audio/{identity}.wav", status="generated")
            destination = ROOT / record["file"]
            if old.get(identity) != record or not has_audio(destination):
                call("say", "-v", voice, "-o", str(wav), phrase)
                call("afconvert", "-f", "WAVE", "-d", "LEI16@22050", str(wav), str(encoded))
                if not has_audio(encoded):
                    raise SystemExit(f"Speech service returned silent audio for {phrase!r}.")
                shutil.move(encoded, destination)
            old[identity] = record
    MANIFEST.write_text(json.dumps({"version": 1, "recordings": {i: old[i] for i in entries}}, ensure_ascii=False, indent=2) + "\n")

def main():
    version = (ROOT / "VERSION").read_text().strip()
    if not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version):
        raise SystemExit("VERSION must contain a major.minor.patch app version.")
    book = read(SOURCE)
    assert [c["number"] for c in book["chapters"]] == list(range(1, book["latestReleasedChapter"] + 1))
    for chapter in book["chapters"]:
        if placements := chapter.get("evidenceBefore"):
            vocabulary = {row[0] for row in chapter["vocabulary"]}
            evidence = [row[0] for row in chapter["evidence"]]
            placed = [phrase for phrases in placements.values() for phrase in phrases]
            assert placements.keys() <= vocabulary and sorted(placed) == sorted(evidence), chapter["title"]
    rows = [row for chapter in book["chapters"]
            for row in chapter["vocabulary"] + chapter.get("evidence", [])]
    rows.extend(book.get("travelers", {}).get("vocabulary", []))
    phrases = [phrase for row in rows for phrase in row[0].split(" / ") + (row[3] if len(row) > 3 else [])]
    if any("evidence" not in chapter and WARNING in chapter["notes"] for chapter in book["chapters"]):
        phrases.append(WARNING)
    previous = read(MANIFEST)["recordings"] if MANIFEST.exists() else {}
    recorded_text = {speech_key(item["text"]): item["text"] for item in previous.values()}
    distinct = {speech_key(text): text for text in phrases}
    recordings = [recorded_text.get(identity, text) for identity, text in distinct.items()]
    entries = {audio_id(text): text for text in recordings}
    if "--audio" in sys.argv:
        generate(entries)
    manifest = read(MANIFEST)["recordings"]
    for identity, phrase in entries.items():
        record = manifest[identity]
        assert key(record["text"]) == key(phrase)
        assert has_audio(ROOT / record["file"]), record["file"]
    for name in PUBLISHED_BOOKS:
        with ZipFile(ROOT / name) as epub:
            if epub.read("mimetype") != b"application/epub+zip" or epub.testzip() is not None:
                raise SystemExit(f"Invalid EPUB: {name}")
    reader, reader_assets = reader_book(ROOT / PUBLISHED_BOOKS[0], book["chapters"],
                                        book.get("travelers", {}).get("vocabulary", []), {
        speech_key(manifest[i]["text"]): manifest[i]["file"] for i in entries
    })
    if "--check" in sys.argv:
        print(f"Verified chapter sequence and {len(entries)} audio assets. EPUB integrity and reader contents checks passed.")
        return
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    files = ["index.html", "app.js", "style.css", "app.webmanifest", "icon-192.png", "icon-512.png",
             "apple-touch-icon.png",
             "reader.html", "reader.css", "reader.js", "data/notebooks.json", "audio/manifest.json", "assets/the-blue-staircase-front-cover.jpg",
             "assets/the-blue-staircase-back-cover.jpg"]
    files += [manifest[i]["file"] for i in entries]
    worker = (ROOT / "scripts/service-worker.js").read_text()
    payloads = {name: (ROOT / name).read_bytes() for name in files}
    payloads["index.html"] = payloads["index.html"].replace(b"__APP_VERSION__", version.encode())
    for page in ("index.html", "reader.html"):
        payloads[page] = payloads[page].replace(b"__EPUB_DOWNLOAD__", quote(PUBLISHED_BOOKS[0]).encode())
    payloads["data/reader-book.json"] = json.dumps(reader, ensure_ascii=False).encode()
    payloads.update(reader_assets)
    digest = hashlib.sha256()
    for name, payload in payloads.items():
        digest.update(name.encode() + payload)
    digest.update(worker.encode())
    revision = digest.hexdigest()[:12]
    payloads["index.html"] = payloads["index.html"].replace(b"__BUILD_REVISION__", revision.encode())
    for name, payload in payloads.items():
        target = dist / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
    for name in PUBLISHED_BOOKS:
        target = dist / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)
    (dist / "sw.js").write_text(worker.replace("__REVISION__", revision).replace("__FILES__", json.dumps(list(payloads))))
    (dist / ".nojekyll").touch()
    print(f"Built app {version} ({revision}), book {book['bookVersion']}, with {len(entries)} recordings.")

if __name__ == "__main__":
    main()
