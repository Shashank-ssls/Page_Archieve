# Tallshot

Capture whole web pages and AI conversations exactly as you see them, as PNG,
JPEG or searchable PDF. Chrome/Edge Manifest V3 extension. Everything runs
locally: no backend, no analytics, no uploads.

- **Full render engine** (Full edition): renders the entire page through the
  Chrome DevTools protocol, so lazy images, virtualised chats, 100vh sections and
  fixed backdrops come out right. Falls back to scroll-and-stitch when needed.
- **Site presets** for ChatGPT, Claude, Gemini, Perplexity, Copilot, DeepSeek,
  Colab and Jupyter.
- **Searchable PDF** with an invisible text layer; auto-expand of "show more";
  file-name templates and folders.
- **Two editions** from one source: Full (debugger permission) and Lite (no
  debugger permission, scroll-and-stitch only).

## Load it
```
npm run build
```
Then `chrome://extensions` -> Developer mode -> Load unpacked -> `dist/full` or `dist/lite`.

## Develop
Start with `CLAUDE.md`. Status is in `PROGRESS.md`, the plan in `ROADMAP.md`,
internals in `ARCHITECTURE.md`, UI rules in `DESIGN.md`, tests in `TESTING.md`,
business in `PRODUCT.md`, machine setup in `SETUP_CLAUDE_CODE.md`.
Version history: `CHANGELOG.md`. Older v1 documents: `docs/archive-v1/`.

```
npm install
npm run check      # unit tests + ASCII check
npm run e2e        # real-browser suite, Full edition
npm run e2e:lite   # same suite, Lite edition
npm run popup-shot # popup screenshots, light and dark
```

## License
See `LICENSE` and `THIRD_PARTY_NOTICES.md` (bundled fonts are OFL).
