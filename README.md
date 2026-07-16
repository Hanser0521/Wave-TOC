# Wave TOC

A fluid, rail-style table of contents for Obsidian with smooth wave interactions.

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
<Vault>/.obsidian/plugins/wave-toc/
```

Then reload Obsidian and enable **Wave TOC** under Community plugins. Navigation behavior can be changed under **Settings → Wave TOC → 刻度导航方式**.

## Acknowledgements

Functional research for this independent implementation included [Next TOC](https://github.com/Raven-Pensieve/obsidian-next-toc) and [Floating TOC](https://github.com/PKM-er/obsidian-floating-toc-plugin). No source code or assets from those projects are included in Wave TOC.

Wave TOC is an independent project and is not affiliated with or endorsed by OpenAI.

## License

[MIT](LICENSE) © 2026 Hanser
