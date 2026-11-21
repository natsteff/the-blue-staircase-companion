# The Last Witness Companion

Sally’s Detective Notebook accompanies *The Last Witness: A Mystery in Playa del Carmen*. Select the chapter you’ve read to practice Mexican Spanish, review Sally’s observations, and revisit the questions she’s carrying forward.

The v02 edition includes Chapters 1–2 and uses the supplied front cover. The warning remains untranslated in Chapter 1. Use **Listen** or **Slow** beside each Spanish expression. Tick **Mastered** when you know the entry and untick it to return it to practice. Progress belongs to this browser and website address. Use **Progress settings** to export a backup before changing devices or clearing browser data.

## Run locally

Requires Python 3.9 or newer. No package installation is required.

```sh
python3 scripts/build.py
python3 -m http.server 8767 --bind 127.0.0.1 --directory dist
```

Open [the local notebook](http://127.0.0.1:8767/). The service worker caches both notebooks, the cover, and all recordings after the first successful visit. On iPhone, open the hosted HTTPS site in Safari and use **Add to Home Screen**. When the app detects a new build online, it caches and opens the update automatically. It checks on launch and when you return to the app. Offline files are subject to browser storage availability.

## Pronunciation

On macOS, run `python3 scripts/build.py --audio` to synthesize new or changed phrases with `say` and convert them to mono PCM WAV with `afconvert`. Generation prefers Paulina when available. It requires an installed Mexican Spanish voice and access to the Mac speech service. Install a voice under Accessibility system speech settings if needed. The build checks that every required WAV contains audio samples. The versioned manifest records the text, voice, locale, path, and generation status.

Open **Audio review** in the notebook to play the selected chapter’s cumulative set, listen slowly to individual phrases, and flag pronunciation on this device. A voice identified as Spanish may be used as a browser fallback if a recording cannot play.

## GitHub Pages

The app uses relative URLs so the same build works at a domain root or under a repository path. In an approved GitHub repository, choose **GitHub Actions** as the Pages source. The **Deploy notebook to GitHub Pages** workflow publishes on pushes to `main` and can also run manually.

## Future chapter contract

Add the next contiguous chapter to `data/notebooks.json` and update `bookVersion` and `latestReleasedChapter`. Each chapter has a numeric `number`, a `title`, a one-paragraph `intro`, `vocabulary` rows in the form `[exact Spanish, exact English, optional Sally context]`, and `notes` containing chapter-specific Markdown headings, paragraphs, lists, and quotes. Preserve manuscript wording and distinctions between observations, theories, questions, and evidence. Include only released chapters. Use a space on each side of a slash when separate Spanish recordings are required.

Keep existing Spanish vocabulary spellings and punctuation stable when possible. Progress keys use normalized, case-insensitive Spanish text. If a revision changes a term’s identity, decide how its prior progress should migrate before releasing. Run the audio build and review newly generated clips, then switch through the chapters and check that later discoveries appear only in the appropriate notebook. The v02 manuscript importer can reproduce the initial two-chapter data file with `python3 scripts/import-notebook.py /path/to/manuscript.md`.
