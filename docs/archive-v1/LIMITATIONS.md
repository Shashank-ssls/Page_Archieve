## v2.0 render-engine notes

- If DevTools is open on the tab, the debugger cannot attach; capture falls back to stitching with a warning.
- Viewport growth briefly re-lays out the page; apps that resize content on every window resize (like the notebook fixture) fall back to stitching.
- Bottom-pinned floating bars are hidden by heuristic (fixed, anchored to the bottom, under half the viewport tall). Turn off Hide floating bars to keep them.
- Background-tab rendering depends on Chrome; keep the tab visible for best results.

# Known Limitations and Failure Semantics

## What the extension cannot guarantee

- An asset that the website never successfully loads cannot be reconstructed from the page.
- Virtualized conversations/lists may not have all older/newer items in the DOM at once. A bounded auto-load pass is not equivalent to downloading an application's complete database/history.
- Closed shadow roots, inaccessible cross-origin iframe DOM, canvas-rendered art, video frames, CSS `image-set()` alternatives and some embedded viewers cannot be audited comprehensively.
- Browser-internal Chrome/Edge pages cannot be fully scrolled or scripted with the normal extension path. Visible-area capture is a separate operation.
- Dynamic sites can shift/reorder/replace content during capture. Correction handles bounded cases; significant unstable geometry should still produce an error instead of a deceptive image.
- Fixed/sticky overlays are heuristically identified. Depending on the site's layout, hiding a fixed composer after the first tile may still need site-specific adjustment.
- Screenshot quality/dimensions reflect current viewport, device scale factor, zoom, loaded fonts/assets, and current rendered state.

## Warning vs failure

**Warnings with successful output** mean PNG files were exported but some limitations remain. Examples: maximum height reached; part output was needed; image preparation timed out; image audit reached its safety limit; panel-only capture was selected; small bounded page/panel reflow was corrected.

**Capture failures** mean the extension chose not to export because it could not trust the result: missing/undecodable tiles, material geometry gaps, panel positions outside safe tolerance, prohibited URL/script injection, or stitcher errors.

A warning that says an image is unverified does not prove it is broken. A warning that counts a broken `<img>` or a probed CSS source is stronger evidence, but still cannot describe every rendered pixel. Always inspect the downloaded PNGs.

## Stable baseline vs latest implementation

The user explicitly described v1.2.3 as stable and confirmed successful downloads from their own tests. v1.2.6 contains additional image audit, fixed-composer suppression, and Smart-target clipping improvements introduced after those tests. As of this handoff, v1.2.6 passes its automated suite, but has not had a full user-confirmed real Chrome end-to-end run for every changed behavior. Keep v1.2.3's ZIP separately for rollback until v1.2.6 passes the manual matrix.

## Avoid these anti-patterns

- Do not remove tile coverage validation to make more captures end with “Complete”.
- Do not silently fall back from Full page PNG to Visible area PNG.
- Do not label all audit timeouts as broken assets.
- Do not promise compatibility with every SPA, every iframe or every internal browser page.
- Do not increase tile/height limits without checking memory use and output splitting.
