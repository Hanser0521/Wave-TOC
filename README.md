# Codex TOC

A fluid, Codex-inspired table of contents for Obsidian.

## Highlights

- Floating H1–H3 rail inside the active note
- Smooth multi-tick hover wave and heading bubble
- Current section indicated by color without changing tick length
- Configurable navigation: follow the pointer or jump only after click
- Accurate heading navigation in Editing and Reading views
- Automatic updates when headings change
- Configurable side, heading depth, and rail height

## Build

```bash
npm install
npm run build
```

Copy `manifest.json`, `main.js`, and `styles.css` into:

```text
<Vault>/.obsidian/plugins/codex-toc/
```

Then reload Obsidian and enable **Codex TOC** under Community plugins. Navigation behavior can be changed under **Settings → Codex TOC → 刻度导航方式**.
