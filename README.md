# Classroom Signal

An English-language, privacy-first starter for classroom session reflection. It is a static web app: no server, account, external API, or build step is required. Video and audio are processed in the browser, and session summaries and participant codes are stored in that browser's local storage.

## Run locally

Open `index.html` in a recent browser, or serve this folder from a local web server. To publish the same static app, push the files to a GitHub repository and enable GitHub Pages for the repository's root.

For browser compatibility, use a recent version of Chrome, Edge, or Firefox. Video support depends on the codecs available to the browser. Audio is decoded with the browser's Web Audio API.

## Starter features

- Analyze a local video by sampling frames every two seconds and comparing low-resolution image changes.
- Analyze a local audio recording by measuring sound energy in 30-second intervals.
- View a session activity chart and receive simple, rules-based teaching reflection prompts.
- Keep a local roll call using educator-entered participant codes and check-in timestamps.
- Reset attendance check-ins before a new session while retaining the participant-code list.
- Export the roll call and recent session summaries as CSV files.
- Retain up to 10 session summaries and 100 participant codes in browser local storage.

## Important limitations

This is a working UI and signal-analysis prototype, not a validated attendance or engagement measurement system. It does **not** recognize faces, track individual people, identify speakers, transcribe speech, or infer attention, emotion, comprehension, or learning outcomes. Video movement and audio energy are coarse context signals; camera movement, lighting, room noise, and the kind of lesson can all affect them. Attendance is manually confirmed by the educator.

Teaching cues are transparent heuristics, not an AI model, and are intended only as prompts for educator reflection. Review all signals in context; do not use them to grade, discipline, or make consequential decisions about learners.

## Privacy and data

- Media files are read locally and are not uploaded or saved by the app.
- The app stores participant codes, check-in times, and session summary metrics in this browser's local storage.
- Use pseudonymous participant codes. Local browser storage is not encrypted and is accessible to people who can use the same browser profile.
- Clear recent sessions from the dashboard. To clear all app data, remove the `classroom-signal-v1` entry from this browser's local storage.
- Get appropriate consent and follow institutional policy before recording or analyzing classroom media.

## Project structure

- `index.html` — dashboard and controls
- `styles.css` — responsive UI
- `app.js` — in-browser media analysis, local storage, and UI behavior

## Next steps for a production system

Add a consent and retention workflow; validated, opt-in anonymous presence detection; sustained-presence rules; accessibility and device testing; documented signal-quality checks; and educator-reviewed evaluation. Any identity matching, cloud service, or automated learner-level scoring would need a separate privacy, legal, and ethics review.
