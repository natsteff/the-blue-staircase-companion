# Sally’s Detective Notebook

<p align="center">
  <img src="assets/sallys-detective-notebook-logo.png" width="720" alt="Sally’s Detective Notebook, a companion to The Last Witness">
</p>

<p align="center">
  <a href="https://natsteff.github.io/the-last-witness-companion/"><img alt="Open TLW Notebook" src="https://img.shields.io/badge/Open%20TLW%20Notebook-205275?style=for-the-badge"></a>
</p>

## About the book

In *The Last Witness: A Mystery in Playa del Carmen*, Sally Mercer and her husband Nate head to Mexico for a long-overdue getaway. When Sally is drawn into a murder investigation, the Spanish she came to practice becomes part of how she follows clues and makes sense of what people tell her.

<p align="center">
  <img src="assets/the-last-witness-front-cover.jpg" width="240" alt="Front cover of The Last Witness">
  <img src="assets/the-last-witness-back-cover.jpg" width="240" alt="Back cover of The Last Witness with the book synopsis">
</p>

## About the notebook

Select the chapter you’ve read to revisit Sally’s observations, theories, and unanswered questions. Practice the Mexican Spanish she encounters with **Listen** or **Slow**, and tick **Mastered** when you know an entry. Use **Hide mastered** to focus on entries you’re still practicing. The v02 notebook covers Chapters 1–2 and reveals evidence translations at the point Sally learns them.

Use **Notebook tools → Progress settings** to back up progress before changing devices or clearing browser data. On mobile, add the app to your home screen as **TLW Notebook**. Both chapter notebooks and their recordings are available offline after the first successful visit.

## Run locally

Requires Python 3.9 or newer. No package installation is required.

```sh
python3 scripts/build.py
python3 -m http.server 8767 --bind 127.0.0.1 --directory dist
```

Open [the local notebook](http://127.0.0.1:8767/). The service worker caches both notebooks, the cover, and all recordings after the first successful visit. On iPhone, open the hosted HTTPS site in Safari and use **Add to Home Screen**. When the app detects a new build online, it caches and opens the update automatically. It checks on launch and when you return to the app. Offline files are subject to browser storage availability.

## Pronunciation

On macOS, run `python3 scripts/build.py --audio` to synthesize new or changed phrases with `say` and convert them to mono PCM WAV with `afconvert`. Generation prefers Paulina when available. It requires an installed Mexican Spanish voice and access to the Mac speech service. Install a voice under Accessibility system speech settings if needed. The build checks that every required WAV contains audio samples. The versioned manifest records the text, voice, locale, path, and generation status.

Open **Notebook tools → Audio review** to play the selected chapter’s cumulative set, listen slowly to individual phrases, and flag pronunciation on this device. A voice identified as Spanish may be used as a browser fallback if a recording cannot play.

## GitHub Pages

The app uses relative URLs so the same build works at a domain root or under a repository path. In an approved GitHub repository, choose **GitHub Actions** as the Pages source. The **Deploy notebook to GitHub Pages** workflow publishes on pushes to `main` and can also run manually.

## App versions

The footer shows the app version and its unique build ID. Update `VERSION` when preparing an app release. The build ID is generated automatically from the published app files and changes whenever their content changes. The manuscript edition is tracked separately as `bookVersion`.

## Future chapter contract

Add the next contiguous chapter to `data/notebooks.json` and update `bookVersion` and `latestReleasedChapter`. Each chapter has a numeric `number`, a `title`, a one-paragraph `intro`, `vocabulary` rows in the form `[exact Spanish, exact English, optional Sally context]`, and `notes` containing chapter-specific Markdown headings, paragraphs, lists, and quotes. Preserve manuscript wording and distinctions between observations, theories, questions, and evidence. Include only released chapters. Use a space on each side of a slash when separate Spanish recordings are required.

Keep existing Spanish vocabulary spellings and punctuation stable when possible. Progress keys use normalized, case-insensitive Spanish text. If a revision changes a term’s identity, decide how its prior progress should migrate before releasing. Run the audio build and review newly generated clips, then switch through the chapters and check that later discoveries appear only in the appropriate notebook. The v02 manuscript importer can reproduce the initial two-chapter data file with `python3 scripts/import-notebook.py /path/to/manuscript.md`.
