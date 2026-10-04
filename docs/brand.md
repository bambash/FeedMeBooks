# FeedMeBooks — brand and theme

One identity for the app, the launcher, the Play listing and the docs. Everything here is
in the repo: change a value in one place and the rest follows.

## The idea

FeedMeBooks does one thing: it lets a book be read and heard, and it never loses your place
across the two. The identity says that in one picture: **an open book whose right page carries
the narrator's voice.** Text lines on the left in ink, sound bars on the right in amber.

**Name:** FeedMeBooks, one word, capital F, M and B. In the feature graphic the *Me* is amber.
**Tagline:** *Read it. Hear it. Never lose your place.*

## Colours

| Name | Hex | Role |
|---|---|---|
| Ink | `#2F4170` | The brand colour. Buttons, links, reading progress, the launcher background. |
| Ink deep | `#1F2E55` | Bottom of the launcher gradient; the dark end of the splash. |
| Ink light | `#B4C4F0` | Ink's role on dark surfaces. |
| Amber | `#F5B52E` | The narrator's voice: the voice bars in the mark, the sentence being read, listening progress. |
| Amber deep | `#7A5200` | Amber's role as text on light surfaces (Material `tertiary`). |
| Paper | `#FCFAF6` | The light surface. |
| Night | `#121316` | The dark surface. |

Ink is for reading, amber is for listening. That is the whole rule: wherever the app shows
both, the reading one is ink and the listening one is amber (the two progress bars on a
library card, the paragraph highlight under the narrator).

The sepia reader theme keeps its warm paper and pulls ink towards brown; see `SepiaScheme`.

Where the values live:

- `native/app/src/main/kotlin/feedmebooks/app/ui/Brand.kt`: the three Material 3 colour
  schemes (light, dark, sepia), typography and shapes. `AppTheme` applies them to every screen.
- `native/app/src/main/res/values/colors.xml`: the same core colours for things that happen
  before Compose is up: the window background, status and navigation bars (`themes.xml`,
  plus `values-night/`), and the splash screen.

## Type

Headings (Material `display*`, `headline*`, `titleLarge`) are set in the system serif;
body text and labels in the system sans. No fonts are bundled. The book pages themselves
use the publisher's styling through Readium.

## Shape

Soft corners: 10 dp on small elements (covers, chips), 14 dp on cards, 20–28 dp on sheets
and dialogs. The mark's pages are drawn with the same softness.

## The mark

Source of truth: `native/brand/icon.svg`, drawn on the Android adaptive-icon canvas
(108 dp, with everything inside the 66 dp safe circle). The same paths are in:

- `res/drawable/ic_launcher_foreground.xml` / `ic_launcher_background.xml` /
  `ic_launcher_monochrome.xml`: the adaptive launcher icon (`mipmap-anydpi-v26/`). The
  monochrome layer is what Android 13+ shows for themed icons.
- `res/drawable/ic_brand_mark.xml`: the mark alone, for in-app use (the library header,
  the empty library, a cover placeholder).
- `res/drawable/ic_stat_feedmebooks.xml`: the one-colour status-bar icon for the playback
  notification (the voice bars are cut out of the right page).
- The splash screen (`Theme.FeedMeBooks.Starting`) shows the launcher foreground on ink.

Keep the mark whole: no cropping it, no recolouring the bars, no putting it on amber.

## Store assets

`native/store/` holds what the Play listing needs, rendered from the brand sources:

- `icon-512.png`: the listing icon (Play adds its own corner rounding).
- `feature-graphic-1024x500.png`: the mark, the wordmark and the tagline on ink.

Rebuild them after changing a source with `native/brand/render.sh` (needs a Chromium binary;
set `CHROME=/path/to/chromium` if it isn't on the PATH). Screenshots are taken from a device
and belong in the same folder when the listing is prepared.

## In the app

- **Launcher:** adaptive icon, round variant, themed-icon layer.
- **Launch:** the splash is the mark on ink, then paper (or night) takes over.
- **Library:** mark and wordmark in the header; each card shows reading progress in ink and
  listening progress in amber; the empty library shows the mark and the tagline.
- **Reader:** the page keeps Readium's light, sepia or dark colours and the window matches
  them; the player bar uses the icon set (replay 30, play/pause, forward 30); the sentence
  the narrator is reading is highlighted in amber.
- **Notification:** the brand mark in the status bar while the audiobook plays.
