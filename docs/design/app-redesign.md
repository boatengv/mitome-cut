# Handover: Mitome Studio app redesign

**Goal:** restyle the web app (`apps/web`) to match the approved app designs, and add the missing production screens. This is a visual and navigation change. Keep the existing data model, API calls and editor behaviour.

**Design reference (Claude canvas, page "App"):** https://claude.ai/artifact/HFPX37gkUkg4Xqr8E8wVdX

Each screen on the canvas is clickable (press play) and has a working light/dark switch in its top bar. Use it as the source of truth for spacing and layout; this document gives the exact values.

---

## 1. Themes

Two themes, switched by a sun/moon button in the top bar. Default to the OS preference (`prefers-color-scheme`) on first visit, then remember the choice in `localStorage` (`mitome-theme`). Set `data-theme="dark|light"` on `<html>` and drive every colour from CSS variables.

**Both themes use layering:** the page background is the deepest surface; sidebars, the top bar, cards, panels, the inspector and the timeline sit on top of it in a contrasting surface.

The existing `styles.css` variable names map as below. Replace the current `:root` values with the **Graphite** column and add a `[data-theme='light']` block with the **Layered white** column.

| Variable (existing name) | Role | Dark · Graphite | Light · Layered white |
|---|---|---|---|
| `--surface` | Page background (deepest) | `#1C1C20` | `#F3F3F5` |
| `--surface-alt` | Panels, cards, sidebar, top bar | `#232328` | `#FFFFFF` |
| `--surface-raised` | Buttons, inputs, tabs | `#2B2B31` | `#FFFFFF` |
| `--surface-hover` | Hover, active nav item | `#33333A` | `#F0F0F3` |
| `--surface-soft` *(new)* | Segmented controls, info strips | `#28282E` | `#F7F7F9` |
| `--surface-stage` *(new)* | Behind the video viewer | `#141417` | `#E9E9ED` |
| `--border` | Hairlines | `#3A3A42` | `#E2E2E7` |
| `--border-strong` | Input borders, empty rings | `#4A4A53` | `#CFCFD6` |
| `--text` | Primary text | `#F0F0F3` | `#111113` |
| `--text-muted` | Secondary text, labels | `#A6A6B0` | `#5E5E66` |
| `--text-accent` | Links, overlines | `#FF8F52` | `#C2410C` |
| `--action` | Primary button, selection, playhead | `#F26B1D` | `#F26B1D` |
| `--action-text` | Label on `--action` | `#0B0B0D` | `#111113` |
| `--selected` *(new)* | Selected row/card fill | `rgba(242,107,29,0.14)` | `rgba(242,107,29,0.08)` |
| `--sun` | Ready/approved dots, voice waveforms | `#FFC72C` | `#FFC72C` |

Rules:
- **Orange is a signal**, not decoration: one primary button per area, the selected item's outline, the playhead, the current stage. Never large orange backgrounds in the app UI.
- No drop shadows and no gradients. Show depth with the surface layers above.
- Radii: 4px clips and thumbnails, 6px inputs and rows, 8px buttons and cards, 12px dialogs.
- Buttons 30px (small) / 34px (default) / 40px (large). Inputs 34px.
- Type: Inter everywhere (`--font-ui`). Page titles 24px/600, section titles 15px/600, body 13px, labels 12px/500 muted, captions 11px. Outfit only in the MITOME wordmark.
- Status = 7px dot + text label, never colour alone: Ready/Approved = sun dot, Generating/Needs review = orange ring, Demo = muted dot, Not started = hollow ring.
- Focus: 3px `--action` outline, 2px offset (already in `styles.css`).

> The sign-in page (`pages/Login.tsx`, `signin.css`) still uses the older near-black values. Optional follow-up: point it at the same variables so the whole product matches.

---

## 2. App shell (all signed-in screens)

### Top bar (56px, `--surface-alt`, bottom border)
Left to right:
1. Logo: seal (28px, with the sun) + `MITOME` / `STUDIO` stacked wordmark, links to Home.
2. 1px divider, then breadcrumb (`Studio / Into the Deep`), muted links, last item `--text`.
3. On production screens: `● Saved` status.
4. Centre, on production screens only: **stage stepper**, a segmented pill with `1 Script · 2 Scenes · 3 Assets · 4 Storyboard · 5 Studio`. Current stage: raised background, orange numbered circle. Finished stages: tinted circle with a tick. Upcoming: hollow ring, muted text. Each is a link.
5. Right: `● Demo mode` pill (when no provider key), theme toggle, Settings icon, and on production screens the orange **Export** button.

### Sidebar (240px, `--surface-alt`, right border)
Replaces the current file-tree explorer.
- Search field with `⌘K` hint.
- Main nav: Home, Asset library, Settings.
- **Productions** heading with a `+` button, then one row per show/movie (small cover, name, episode or scene count).
- Under the open production: its five stages as sub-items, with a dot that is orange on the current stage.
- Bottom: storage meter (`74 KB of 2.1 GB`) and "Download project file (.json)".

The Studio (editor) screen hides the sidebar and uses a 64px icon rail instead, to give the editor room.

---

## 3. Screens

| Canvas board | What it is | Code |
|---|---|---|
| **Home** | Dashboard | Restyle `pages/Projects.tsx` |
| **TV show** | One show: seasons, episodes, details | New page |
| **1 · Script** | Write and split the script | New page |
| **2 · Scenes** | Scene list + flow diagram | New page |
| **3 · Assets** | Cast/places/props/looks + scene grid | New page |
| **4 · Storyboard** | Frame review | New page |
| **5 · Studio** | The editor | Restyle `pages/Editor.tsx` + `editor/*` |
| **Settings** | Full settings page | New page (replaces any settings modal) |
| **Export dialog** | Export options | Restyle `editor/ExportDialog.tsx` |

The router (`router.ts`) is a small history router; add routes such as `/`, `/shows/:id`, `/p/:id/script`, `/p/:id/scenes`, `/p/:id/assets`, `/p/:id/storyboard`, `/p/:id/studio`, `/settings`. Keep the existing editor route working.

### Home
Max-width 1120px content column, 32/40px padding, 32px between sections.
1. Header: overline `YOUR STUDIO`, title "Everything in production"; actions on the right: Open file… (ghost), Sample (ghost), New movie (secondary), **New TV show** (primary).
2. **Continue card**: 16:9 thumbnail on the left (max 460px); on the right the production name, meta line, a five-segment stage progress bar with labels, a "Next:" hint strip, and **Continue in <stage>** (primary) + Open in Studio (secondary).
3. **Totals strip**: one card with six stats separated by vertical borders (Productions, Episodes, Scenes, Frames approved, Clips made, Storage).
4. **Productions** grid (`auto-fill, minmax(260px, 1fr)`): cover, type chip (`MOVIE` / `TV SHOW`), status, title, meta. Last tile is a dashed "Start a production" card with TV show / Movie buttons. Filter: All / TV shows / Movies.
5. **Pipeline**: six columns (Script, Scenes, Assets, Storyboard, Studio, Premiere) with count and small item cards; empty columns say "Nothing here yet".

### TV show
Cover (240px) + overline `TV SHOW`, title, meta, actions (New episode primary, New season, Create episodes from script). Tabs: Overview · Seasons · Show bible · Assets (2px orange underline on the active tab). Two columns:
- Left: a card per season with episode rows (cover, `EPISODE n` overline, title, progress text, stage status, chevron). Dashed "Start season 2" button below.
- Right: **Show details** card (Theme, Style with "Comes first in every prompt across the show", Show bible link) and **Recurring assets** card (avatar/icon, name, type, `SHOW` chip; + Cast / Place / Prop / Look buttons).

### 1 · Script
- Centre column (max 780px): overline `MOVIE · SCRIPT`, editable title (28px/600, no border), stats line (`N words · about N seconds read aloud · N sections`), a small toolbar (Import text, Paste, "A blank line starts a new section"), then the writing surface: a card with numbered sections, 16px text, line-height 1.75.
- Right panel (340px, `--surface-alt`): Project style (textarea), Pacing (words per second, beat length), a Preview box with proportional bars for the scenes the split will create, **Split into scenes** (large primary, full width) with "Replaces the current scene list.", and Next: Scenes at the bottom.

### 2 · Scenes
- Left column (460px): header (Scenes · count · total duration, "Carry style forward" checkbox, Create scene). Scene cards: thumbnail (112×63), number, name, duration, script line, muted "We see:" description. Between cards, a pill button showing the transition (`Cut`, `Cross-fade · 0.5 s`, `Continue from last frame`). Selected card: orange border + 3px `--selected` ring. Footer: Script / Next: Assets.
- Right: flow canvas on `--surface`; nodes are mini cards (thumbnail + name + duration + line), joined by 2px orange connectors with transition pills. Floating toolbar bottom-centre (Create scene primary, Generate missing, Auto-arrange, Play from selected) and zoom control bottom-right.

### 3 · Assets
- Left panel (340px): header with count and `+`, **Find in script** (primary) + Write scene prompts, filter (All · Cast · Places · Props · Looks), then the list grouped by type with a swatch (round for cast), name, reference status and scene count. Selected row uses `--selected`.
- Main: title "Assets per scene" + caption; actions Auto-tag all scenes, Next: Storyboard. A table with scene thumbnails and numbers as columns, assets as rows, and a checkbox cell per pair (orange filled tick when on). Below it, a detail card for the selected asset (image, type chip, description, "Must contain in prompt" field).

### 4 · Storyboard
Header with stats (`8 frames · 6 sketched · 3 approved · 0:34`), actions Print / save PDF, Sketch missing frames, **Next: Studio**. Filter segmented control with counts, plus an approval progress bar (sun fill). Grid `auto-fill, minmax(240px, 1fr)` of frame cards:
- 16:9 frame with dark chips for the transition (`OPEN` / `CUT` / `EXTEND`) and duration.
- Body: number, name, status, script line in quotes.
- Actions by state: **Approved** → Redo, Upload. **Needs review** → **Approve** (primary), Redo. **Text only** → frame area shows the visual description and a Sketch frame button; actions Upload.

### 5 · Studio (editor)
Layout: top bar, then a row of icon rail (64px) · scene panel (288px) · viewer (flexible) · inspector (320px), then the timeline across the full width.
- **Rail:** Scenes, Media, Assets, Voice, Music, Style. Active item uses `--surface-hover`.
- **Scene panel:** title + count, "8 of 8 generated" with a progress bar, Generate missing (primary) + Voice all; rows with a 72×40 thumbnail (scene number overlaid), two-line script, status, duration. Selected row: `--selected` fill + orange inset outline.
- **Viewer:** 44px header (scene name, status, 16:9 / 9:16 toggle); frame centred on `--surface-stage` with the caption overlaid; 52px transport (timecode with tabular numerals, previous / round orange play / next, Captions checkbox, mute, full screen).
- **Inspector:** tabs Clip · Audio · Transition; a demo-mode info strip linking to Settings; fields Scene name, Script, What we see; Assets in this scene as removable pills + Auto-tag; Style toggle (Project style / Own style); footer **Regenerate clip** + more menu.
- **Timeline:** 40px toolbar (select, split, delete, hint, zoom); 120px track headers with badges V1 (orange tint), T1 (neutral), A1 (sun tint), A2 (neutral); video clips show repeated thumbnails, selected clip has a 2px orange border; voiceover clips show sun waveforms; the music lane is a dashed drop zone; orange playhead with a small head.

### Settings
Sub-nav on the left (Appearance, Video generation, Prompt AI, Voiceover, Pacing, Keys and privacy). Each section is a row: title + one-line explanation on the left, controls on the right, separated by hairlines. "Changes save automatically" + `● Saved` at the top.
- Appearance: segmented Match my system / Dark / Light.
- Video generation: two radio cards (Demo / fal.ai). fal.ai fields are dimmed until fal.ai is chosen: API key, text-to-video model, image-to-video model, allowed clip lengths, asset image model, "Send length as text" toggle.
- Prompt AI: provider select, model, Anthropic key.
- Voiceover: ElevenLabs key, voice ID, voice model.
- Pacing: words per second (2.6), beat length (6).
- Keys and privacy: "Remember keys in this browser" toggle.

### Export dialog
560px dialog, 12px radius: header (title, scene count/duration, close), preview row (thumbnail, file name, demo status, size estimate), Format option cards (MP4 / MOV / GIF), Resolution segmented control (720p / 1080p / 4K), toggles for burn-in captions and include audio, footer strip ("Rendered in your browser. Keep this tab open.", Cancel, **Export video**).

---

## 4. Suggested order
1. Theme variables + light/dark toggle (whole app benefits immediately).
2. Shell: top bar with stepper, sidebar replacing the explorer.
3. Restyle Home (`Projects.tsx`), Studio (`Editor.tsx` + `editor/*`) and the Export dialog.
4. Settings page.
5. New stage pages: Script, Scenes, Assets, Storyboard, then TV show.

## 5. Acceptance checks
- [ ] Both themes match the table; page background is visibly deeper than panels in both.
- [ ] Theme toggle works on every screen and survives a reload; first visit follows the OS.
- [ ] Orange appears only on primary actions, selection, current stage and playhead.
- [ ] Stage stepper shows finished / current / upcoming correctly and links to each stage.
- [ ] Sidebar replaces the file explorer; Studio uses the icon rail instead.
- [ ] All statuses use dot + label.
- [ ] Text contrast ≥ 4.5:1 in both themes (all pairs in the table pass).
- [ ] Existing editor features (generate, voice, timeline editing, export) still work.
