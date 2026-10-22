# Privacy Policy - Tallshot

Last updated: 2026-10-22 (DRAFT, owner to review before publishing)

Tallshot captures web pages on your own computer. It has no server, no
account and no analytics. This policy applies to both editions (Lite and Full).

## What leaves your device

Nothing. Tallshot makes no network requests of its own. Screenshots, page
text, file names and settings never leave your browser.

Planned, not yet in this version:
- Pro license check: when Pro launches, the extension will send your license key
  to the payment provider to confirm it. Nothing about your pages is sent.
- Proof Stamp (later): a SHA-256 hash of a capture (a fingerprint, not the
  capture itself) may be sent to a timestamp authority, only when you choose to.

This policy will be updated, and the change shown in the release notes, before
either of these ships.

## What is stored on your device

In the browser's extension storage (`chrome.storage.local`):

| Item | What it holds | How long |
| --- | --- | --- |
| Settings | Format, target, engine, toggles, file name template, folder | Until you change or remove them |
| Theme and panel state | Light or dark theme, whether "More options" is open | Until changed |
| Capture count and review flag | How many captures succeeded, and whether the one-time "leave a review" note was shown | Until the extension is removed |
| Last capture status | Progress, engine name, warnings and the saved file names (taken from the page title) of the most recent capture | Replaced by the next capture; the popup only shows it for 24 hours |

Captured images and PDFs are saved by Chrome's download manager into your
Downloads folder (or the subfolder you choose). Tallshot keeps no copy.

## What the extension reads

When you start a capture (popup, keyboard shortcut), Tallshot reads the
current tab only: its layout, images and text, to render and stitch the page
and to build the PDF text layer, clickable links and bookmarks (link
addresses and headings stay inside the PDF on your device). It does not run on other tabs and
does nothing in the background.

## Permissions

| Permission | Why |
| --- | --- |
| activeTab | Access the tab you are capturing, only after you start a capture |
| scripting | Prepare the page (scroll, expand, hide floating bars) and restore it afterwards |
| downloads | Save the finished file into your Downloads folder |
| storage | Remember your settings and the last capture status |
| debugger (Full edition only) | Render the whole page in one pass with Chrome's built-in renderer. Attached only to the tab being captured, only during the capture, then detached |

## How to delete your data

- Captures: delete the files from your Downloads folder.
- Settings and status: remove the extension (`chrome://extensions`, Remove).
  The browser deletes its stored data with it.

## Contact

shashanksinghal336@gmail.com
