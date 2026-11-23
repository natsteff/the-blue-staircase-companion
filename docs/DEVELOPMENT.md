# Developing Blue Staircase Notebook

## Run locally

Requires Python 3.9 or newer. No package installation is required.

```sh
python3 scripts/build.py
python3 -m http.server 8767 --bind 127.0.0.1 --directory dist
```

Open [the local notebook](http://127.0.0.1:8767/). The service worker caches both notebooks, the cover, and all recordings after the first successful visit. On iPhone, open the hosted HTTPS site in Safari and use **Add to Home Screen**. When the app detects a new build online, it caches and opens the update automatically. It checks on launch and when you return to the app. Offline files are subject to browser storage availability.

## Pronunciation

On macOS, run `python3 scripts/build.py --audio` to synthesize new or changed phrases with `say` and convert them to mono PCM WAV with `afconvert`. Generation prefers Paulina when available. It requires an installed Mexican Spanish voice and access to the Mac speech service. Install a voice under Accessibility system speech settings if needed. The build checks that every required WAV contains audio samples. The versioned manifest records the text, voice, locale, path, and generation status.

Use the chapter’s **Listen** and **Slow** controls to spot-check pronunciation. The audio manifest also maps each clip to its source phrase for review. A voice identified as Spanish may be used as a browser fallback if a recording cannot play.

## GitHub Pages

The app uses relative URLs so the same build works at a domain root or under a repository path. In an approved GitHub repository, choose **GitHub Actions** as the Pages source. The **Deploy notebook to GitHub Pages** workflow publishes on pushes to `main` and can also run manually.

## App versions

The footer shows the app version and its unique build ID. Update `VERSION` when preparing an app release. The build ID is generated automatically from the published app files and changes whenever their content changes. The manuscript edition is tracked separately as `bookVersion`. The original EPUB, its filename, and historical cover assets are retained. The app hero shows the approved artwork for The Blue Staircase. Use a new filename for each separately approved EPUB edition.

## Future chapter contract

Add the next contiguous chapter to `data/notebooks.json` and update `bookVersion` and `latestReleasedChapter`. Each chapter has a numeric `number`, a `title`, a one-paragraph `intro`, `vocabulary` rows in the form `[exact Spanish, exact English, optional Sally context]`, and `notes` containing chapter-specific Markdown headings, paragraphs, lists, and quotes. Preserve manuscript wording and distinctions between observations, theories, questions, and evidence. Include only released chapters. Use a space on each side of a slash when separate Spanish recordings are required.

Keep existing Spanish vocabulary spellings and punctuation stable when possible. Progress keys use normalized, case-insensitive Spanish text. If a revision changes a term’s identity, decide how its prior progress should migrate before releasing. Run the audio build and review newly generated clips, then switch through the chapters and check that later discoveries appear only in the appropriate notebook. The v02 manuscript importer can reproduce the initial two-chapter data file with `python3 scripts/import-notebook.py /path/to/manuscript.md`.

## Publishing a manuscript draft

Place the approved, cumulative EPUB in `books/` using the edition-specific filename in the build's approved book list. Check its metadata, table of contents, and integrity against the intended release. Update the README download and the notebook data to the same edition. Earlier chapters may be revised in a new cumulative draft. Leave existing manuscript files intact and use a new filename for a new edition. Publish only explicitly approved formats.

Run `python3 scripts/build.py --check` and `python3 scripts/build.py`. The build copies the listed EPUB to `dist/books/` outside the service worker cache. After deploying, download the public EPUB and confirm its bytes match the approved file. Verify offline notebook and audio behavior for app changes.
