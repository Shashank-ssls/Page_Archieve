# Store form: single purpose and permission justifications

DRAFT for the Chrome Web Store and Edge Add-ons forms. Plain text, paste as is.

## Single purpose

Tallshot captures the web page in the current tab as one complete image or
PDF, including long chats and app panels, and saves it to the user's
Downloads folder.

## Permission justifications

activeTab:
Used to access the current tab only after the user clicks the toolbar button or
presses the capture shortcut. The extension needs the tab's content to capture
it. No access to other tabs, and no host permissions are requested.

scripting:
Injects the capture script into the active tab when the user starts a capture.
The script measures the page, scrolls it, opens collapsed sections and hides
floating bars so the capture is complete, then restores every change.

downloads:
Saves the finished PNG or PDF into the user's Downloads folder (or the
subfolder the user chooses) and offers "Show in folder".

storage:
Stores the user's capture settings and the status of the last capture locally.
Nothing is synced or sent anywhere.

debugger (Full edition only):
Uses Chrome's DevTools protocol to render the entire page in one pass at its
full height, which is the only reliable way to capture lazy-loaded,
virtualized and fixed-position content. Attached only to the tab being
captured, only after the user starts a capture, and detached as soon as it
finishes or fails. Chrome shows its "debugging this browser" bar meanwhile.

## Remote code

No. All code ships in the package. No eval, no remote scripts.

## Data usage (form checkboxes)

Collects none of: personally identifiable information, health, financial,
authentication, personal communications, location, web history, user activity,
website content. (Page content is processed on the device only and never
collected or transmitted.)

Certifications: does not sell or transfer user data to third parties; does not
use or transfer it for purposes unrelated to the single purpose; does not use
it for creditworthiness or lending.
