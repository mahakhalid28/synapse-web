# Product: Synapse

<!-- impeccable:product-schema 1 -->

## Platform

web

The React interface also runs in an Electron desktop shell. It retains the web interface rather than adopting a separate native design language.

## Users

Blind and low-vision students learning from YouTube lectures are the primary users. Study mode also supports following the visible video. Accessibility is a core product requirement.

## Product Purpose

Make the visual content of lectures available through explanations that students can read or hear. Synapse plays a YouTube lecture and pauses at diagrams, equations and charts to explain them. Learners can listen, read or watch.

Success means learners can follow the lecture and understand its visual material while retaining control over playback and navigation. No quantitative success target has been established.

## Positioning

The implemented mechanism is time-linked explanation of visual lecture moments, alongside the lecture itself. This is a product description, not a verified competitive superiority claim.

## Operating Context

- Students choose a YouTube lecture, prepare it, and move between visual moments and their explanations.
- Accessibility mode prioritises audio and explanation content; Study mode exposes the video. Presentation mode is separate from explanation depth.
- Keyboard, screen-reader and voice interactions are supported alongside visible controls. Voice actions share the corresponding button handlers.
- Saved explanations, bookmarks and voice notes support returning to lecture material. Opening preserved content must not restart inference.
- The frontend uses a separate backend for processing and personal learning data. Browser and packaged Electron storage origins are distinct.

## Capabilities and Constraints

- Existing code uses React, Vite and Tailwind CSS, with an Electron shell; no stack selection is required.
- Lecture explanations, listening controls, lecture-wide questions, timeline navigation, saved collections and personal voice notes are implemented surfaces. Practice functionality depends on its feature configuration; do not present a disabled feature as universally available.
- Preserve playback ownership: a learner's explicit pause or a recording must not unexpectedly resume the lecture. Opening a lecture or voice-note timestamp stays paused.
- Preserve explicit deletion confirmation, recording-draft recovery, and leave guards. Permanent voice-note audio belongs to backend-managed storage; IndexedDB retains drafts and legacy browser recordings. Audio does not belong in localStorage.
- Account and personal-storage behaviour must follow the current source and the focused storage/account documentation. Older README descriptions of mocks and browser-only persistence are not authoritative for current behaviour.
- Do not imply cloud accounts, cross-device sync, installation readiness, or verification of real hardware without evidence.

## Brand Commitments

The product name is **Synapse**. Preserve the supplied identity assets under `public/assets/brand/`; the current `BrandMark` uses `app/app-icon.svg`.

The confirmed character is **calm, colourful and legible; clarity leads every decision**. Visual implementation details belong in DESIGN.md.

## Evidence on Hand

- `src/lib/onboardingText.js`: current learner-facing product and mode descriptions.
- `src/components/` and `src/voice/`: implemented screens and interaction workflows.
- `src/index.css`, `tailwind.config.js`, `src/main.jsx`: current themes, shared primitives and self-hosted typography.
- `docs/ACCESSIBILITY.md`: accessibility behaviour and limits of verification; check claims against current source.
- `docs/PERSONAL_STORAGE.md` and `docs/LOCAL_ACCOUNTS.md`: focused personal-data and account contracts.
- `docs/VOICE_NOTES_VALIDATION.md`: recorded verification and untested scenarios, not blanket hardware or screen-reader certification.
- `public/assets/brand/`: supplied logo, web, desktop and media assets. Asset presence is not proof of installer validation.

No approved testimonials, competitive benchmarks or quantified learning outcomes have been established in this setup. Do not invent them.

## Product Principles

1. Make visual lecture meaning available without requiring sight.
2. Keep the learner in control of playback, recording and navigation.
3. Offer equivalent actions through visible controls, keyboard and voice without competing announcements.
4. Preserve personal learning material and distinguish saved content from newly generated content.
5. Let clarity and legibility guide product decisions.

## Accessibility & Inclusion

Preserve semantic headings, accessible names, skip navigation, deliberate focus placement and visible focus indicators. Use concise status announcements; full explanation text must not compete with explanation audio through a live region. Colour alone must not carry state or meaning. Retain reduced-motion and Windows forced-colours support.

Repository contrast targets and automated checks do not establish WCAG conformance. Real screen-reader, microphone and packaged-profile behaviour require their own evidence. No formal conformance level or additional language requirement was confirmed during setup.
