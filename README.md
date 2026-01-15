# Screen Share Warning

Screen Share Warning is a GNOME Shell extension that highlights screen sharing
activity with a clear panel banner. It also supports a temporary preview mode
and an optional border around the primary monitor.

![Screenshot](screenshot.png)

## Features

- Show a bold warning label in the top bar while screen sharing is active.
- Customize warning text, panel color, text color, and blink interval.
- Preview the warning without sharing.
- Optional primary-monitor border in the same color as the panel.

## Usage

Open the extension settings to configure colors, text, blink interval, and the
screen border. Use the preview toggle to verify your appearance settings.

The border is drawn around the entire primary monitor by design, not around the
shared window, because the window can remain in the foreground while sharing.

## Implementation note

The panel background color is applied via a small runtime stylesheet injection
instead of inline styles. This avoids clashes with extensions and themes that
override panel styling (for example Blur My Shell), while still allowing the
panel color to be set dynamically. This approach is compatible with Blur My
Shell.

## Installation

This extension is not published on extensions.gnome.org. Download the latest
zip from GitHub releases, extract it, and copy the extracted folder
`screenshare-warning@wilderbridge` to:

`~/.local/share/gnome-shell/extensions/`

Then log out and back in (or restart GNOME Shell) and enable the extension in
the Extensions app.


## License

MIT License.

## Author

Niklas Siltakorpi <niklas@northco.de>

## Credits

100% of the code was written by Codex.
