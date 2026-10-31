# Translating the interface

View ▸ Language changes these parts of the interface:
- the words on the ribbon (tab and group names) and the File button;
- the classic menu bar and its submenus;
- the command names, wherever they appear (buttons, menus, the Quick Access Bar, command search, Customize dialogs);
- the command tooltips.

Dialogs, messages and the help pages are still English only. Command search finds commands by their English names as well as the translated ones.

## Where a language comes from

| Source | Notes |
|---|---|
| English (United States) | The source language. |
| Spanish (Español) | Built in. All command names, tabs, groups and menus; tooltips stay in English. It is a machine-assisted draft, and corrections are welcome as a file (see below). |
| Load a translation file | A JSON string table (format below). It is checked against this version and kept on this device. |
| Translate with the AI service | The English strings go to the configured AI service (AI ▸ Set Up AI) in batches: 120 names at a time, or 40 tooltips if you choose to include them. No pictures are sent. The result is kept on this device. Check it before relying on it, because AI translations can be wrong. |

A table loaded or translated on this device replaces a built-in table with the same code. Removing it brings the built-in one back.

## The file format

Use "Export the English strings as a template for translators" in the Language dialog for a complete starting file. Set `language` and `name`, translate the values, keep the keys, and load the file back.

```json
{
  "format": "annes-lens-strings",
  "version": 1,
  "language": "de",
  "name": "Deutsch",
  "source": "Your name or organization",
  "labels": { "file.open": "Öffnen…", "image.rotateRight": "Rechts drehen" },
  "tips":   { "image.rotateRight": "Dreht das Bild um 90° im Uhrzeigersinn" },
  "tabs":   { "File": "Datei", "View": "Ansicht" },
  "groups": { "Color management": "Farbmanagement" },
  "menus":  { "Open as": "Öffnen als" }
}
```

How each section is keyed:
- `labels` and `tips` are keyed by command id. `labels` may also name commands that are planned but not built yet, so a table can run ahead of the program.
- `tabs`, `groups` and `menus` are keyed by their English text. The same English word gets the same translation everywhere.

Missing entries stay in English. When a table is loaded, entries that this version does not know are skipped and the dialog reports how many. Keep a trailing "…": it means that the command asks something before it acts.

To have a translation built in, send the file as a pull request at `src/i18n/<code>.json` and add it to `BUILT_IN` in `src/i18n/languages.ts`.
