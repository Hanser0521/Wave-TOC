# Wave TOC

[English](https://github.com/Hanser0521/Wave-TOC/blob/main/README.md) | [简体中文](https://github.com/Hanser0521/Wave-TOC/blob/main/README.zh-CN.md)

Wave TOC turns the active note's outline into a compact floating navigation rail beside the document. Move across the ticks to preview headings and nearby content, follow the current section while scrolling, or jump directly to any heading—without giving up sidebar space.

Designed for long notes, it stays accurate in both Editing and Reading views and keeps the interaction calm: scrolling changes only the active color, while the smooth wave animation appears on hover.

![Wave TOC in action](https://raw.githubusercontent.com/Hanser0521/Wave-TOC/main/assets/wave-toc-demo.gif)

## Highlights

- Floating H1–H3 rail inside the active note
- Smooth multi-tick hover wave and heading bubble
- Optional hover-card previews: title only, first paragraph, or a locally extracted section summary
- Current section indicated by color without changing tick length
- Configurable navigation: follow the pointer or jump only after click
- Configurable section tracking: follow the scrolling viewport or use the cursor click behavior
- Localized settings with Chinese and English interfaces
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

Then reload Obsidian and enable **Wave TOC** under Community plugins. Hover-card content, navigation, and scroll-tracking behavior can be changed under **Settings → Wave TOC**. The settings interface is available in Chinese and English.

## Privacy

Wave TOC works locally inside Obsidian. It does not send note content to external services, collect telemetry, show ads, or require an account.

## Acknowledgements

Functional research for this independent implementation included [Next TOC](https://github.com/Raven-Pensieve/obsidian-next-toc) and [Floating TOC](https://github.com/PKM-er/obsidian-floating-toc-plugin). No source code or assets from those projects are included in Wave TOC.

Wave TOC is an independent project and is not affiliated with or endorsed by OpenAI.

## License

[MIT](LICENSE) © 2026 Hanser
