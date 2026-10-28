# Contributing to Anne's Lens

Thank you for your interest. Anne's Lens is in the **planning stage — there is no code yet**, so the most useful contributions right now are:

- **Feedback on the plan:** missing commands, wrong command placement, menu arrangements that differ from the programs they model, ideas from other picture viewers, and corrections to [docs/INNOVATIONS.md](docs/INNOVATIONS.md), [docs/MENUS-PLAN.md](docs/MENUS-PLAN.md) or [docs/QAT.md](docs/QAT.md). Edit [docs/commands-plan.src.txt](docs/commands-plan.src.txt) or [docs/menus-plan.src.txt](docs/menus-plan.src.txt) and run `python3 scripts/gen-plan.py`; it fails on unknown ids, duplicate ids and shortcut conflicts. Open an issue with the *Feature request* template.
- **Test files:** pictures you made yourself (or that are openly licensed) in unusual formats, camera RAW samples you may redistribute, multipage and animated files, and damaged files for the recovery engine. Do not attach files you do not have the right to share or that contain private information.

## Ground rules

- **Clean room.** Do not contribute code, text, effects presets, frames, sounds, menu text or icons copied from proprietary software, its documentation or its help files, and do not consult leaked or decompiled source. Work from public specifications, open-source references and your own observation of behavior. See [docs/LEGAL.md](docs/LEGAL.md).
- **Generic names.** Use the generic terms in docs/LEGAL.md (Erase Object, Tone Equalizer, Markup Board…) in the interface and code.
- **No missing commands.** Every new feature is a command in the registry with an id, label, icon, tab and group (or *not in tabs*), so it can be placed on the Quick Access Bar, custom tabs, classic menus, shortcuts, macros and batch recipes and found by command search.
- **American English** in the interface, code comments and documentation.
- **Licenses.** Contributions are accepted under the MIT License. New dependencies must use a permissive license (MIT, BSD, Apache 2.0, ISC, SIL OFL for fonts).

## When code exists

The workflow will match the sister apps:

```bash
npm ci
npm run dev        # web app at http://localhost:5173
npm run typecheck
npm test           # unit tests (vitest)
npm run build
```

Keep pull requests focused, include tests for codec, pixel-operation, metadata and recovery changes, and run the type check and tests before submitting.
