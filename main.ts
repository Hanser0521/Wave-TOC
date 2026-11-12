import {
  App,
  MarkdownView,
  Plugin,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
  SuggestModal,
  setIcon
} from "obsidian";
import { EditorView } from "@codemirror/view";

const LEGACY_VIEW_TYPE = "codex-toc-view";
const PLUGIN_DISPLAY_NAME = "Wave TOC";

interface FloatingTocSettings {
  enabled: boolean;
  maxDepth: number;
  side: "auto" | "left" | "right";
  verticalSize: number;
  useCustomHighlightColor: boolean;
  highlightColor: string;
  navigationMode: "hover" | "click";
  activeTrackingMode: "viewport" | "cursor";
  bubblePreviewMode: "title" | "paragraph" | "summary";
  uiLanguage: "zh" | "en";
}

type FloatingTocSettingKey = keyof FloatingTocSettings;
type WaveSettingDefinitionItem = SettingDefinitionItem<FloatingTocSettingKey> & { id?: string };

const DEFAULT_SETTINGS: FloatingTocSettings = {
  enabled: true,
  maxDepth: 3,
  side: "left",
  verticalSize: 50,
  useCustomHighlightColor: false,
  highlightColor: "#7c3aed",
  navigationMode: "hover",
  activeTrackingMode: "viewport",
  bubblePreviewMode: "summary",
  uiLanguage: "zh"
};

interface SourceHeading {
  text: string;
  level: number;
  line: number;
  bodyLine: number;
}

interface TocHeading extends SourceHeading {
  nextLine: number;
  sectionEnd: number;
  preview?: string;
}

function cleanHeadingText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(`+|\*\*|__|~~|\*|_)/g, "")
    .replace(/\\([#*_`~[\]])/g, "$1")
    .trim();
}

function markdownTextFilter(): (line: string) => string | null {
  let fence = "";
  let comment = false;
  return line => {
    if (fence) {
      const closer = line.match(/^ {0,3}(`{3,}|~{3,})[\t ]*$/)?.[1];
      if (closer && closer[0] === fence[0] && closer.length >= fence.length) fence = "";
      return null;
    }
    if (!comment) {
      const opener = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (opener && (opener[1][0] !== "`" || !opener[2].includes("`"))) {
        fence = opener[1];
        return null;
      }
    }
    let visible = "";
    let start = 0;
    for (let at = line.indexOf("%%"); at !== -1; at = line.indexOf("%%", start)) {
      if (!comment) visible += line.slice(start, at);
      comment = !comment;
      start = at + 2;
    }
    if (!comment) visible += line.slice(start);
    return visible || (line ? null : "");
  };
}

const SETEXT = /^ {0,3}(=+|-+)[\t ]*$/;

function parseSourceHeadings(lines: string[]): SourceHeading[] {
  const headings: SourceHeading[] = [];
  let start = 0;
  if (/^\uFEFF?---[\t ]*$/.test(lines[0] ?? "")) {
    const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)[\t ]*$/.test(line));
    if (end !== -1) start = end + 1;
  }
  const filter = markdownTextFilter();
  let paragraph: string[] = [];
  let paragraphStart = 0;

  for (let lineIndex = start; lineIndex < lines.length; lineIndex++) {
    const line = filter(lines[lineIndex]);
    if (!line?.trim()) {
      paragraph = [];
      continue;
    }
    const atx = line.match(/^ {0,3}(#{1,6})(?:[\t ]+(.*?)[\t ]*|[\t ]*)$/);
    if (atx) {
      const text = cleanHeadingText((atx[2] ?? "").replace(/[\t ]+#+[\t ]*$/, ""));
      if (text) headings.push({ text, level: atx[1].length, line: lineIndex, bodyLine: lineIndex + 1 });
      paragraph = [];
      continue;
    }

    const setext = line.match(SETEXT);
    if (setext && paragraph.length) {
      const text = cleanHeadingText(paragraph.join(" "));
      if (text) headings.push({ text, level: setext[1][0] === "=" ? 1 : 2, line: paragraphStart, bodyLine: lineIndex + 1 });
      paragraph = [];
    } else if (setext || /^(?:\t| {4})/.test(line) ||
      /^ {0,3}(?:>|<|\||(?:[-+*]|\d+[.)])\s|(?:\*\s*){3,}$|(?:_\s*){3,}$|(?:-\s*){3,}$)/.test(line)) {
      paragraph = [];
    } else {
      if (!paragraph.length) paragraphStart = lineIndex;
      paragraph.push(line.trim());
    }
  }

  return headings;
}

function getNoteOutline(view: MarkdownView, plugin: WaveTocPlugin, source = view.getViewData()): {
  lines: string[];
  headings: TocHeading[];
} {
  const lines = source.split(/\r?\n/);
  const cache = view.file && plugin.app.metadataCache.getFileCache(view.file);
  const sourceHeadings: SourceHeading[] = cache
    ? (cache.headings ?? []).map(heading => {
      const { start, end } = heading.position;
      const bodyLine = end.line === start.line && SETEXT.test(lines[end.line + 1] ?? "") &&
        !/^ {0,3}#{1,6}(?:\s|$)/.test(lines[start.line] ?? "") ? end.line + 2 : end.line + 1;
      return { text: cleanHeadingText(heading.heading), level: heading.level, line: start.line, bodyLine };
    })
    : parseSourceHeadings(lines);
  const stack: SourceHeading[] = [];
  const headings: TocHeading[] = [];
  for (let index = sourceHeadings.length - 1; index >= 0; index--) {
    const heading = sourceHeadings[index];
    while (stack.length && stack[stack.length - 1].level > heading.level) stack.pop();
    if (heading.text && heading.level <= plugin.settings.maxDepth) {
      headings.push({
        ...heading,
        nextLine: sourceHeadings[index + 1]?.line ?? lines.length,
        sectionEnd: stack[stack.length - 1]?.line ?? lines.length
      });
    }
    stack.push(heading);
  }
  return { lines, headings: headings.reverse() };
}

function truncatePreview(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength).replace(/\s+\S*$/, "").trimEnd();
  return `${shortened || text.slice(0, maxLength).trimEnd()}…`;
}

function cleanPreviewLine(line: string): string {
  return line
    .replace(/^>\s*/, "")
    .replace(/^\[![^\]]+\][+-]?\s*/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/!\[\[[^\]]+\]\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<https?:\/\/[^>]+>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/(`+|\*\*|__|~~|\*|_)/g, "")
    .replace(/\\([#*_`~[\]])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function extractParagraphs(lines: string[], startLine: number, endLine: number, firstOnly = false): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let chars = 0;
  const filter = markdownTextFilter();
  const flush = () => {
    const paragraph = current.join(" ").replace(/\s+/g, " ").trim();
    if (paragraph) paragraphs.push(paragraph);
    current = [];
  };

  for (let lineIndex = startLine; lineIndex < Math.min(endLine, lines.length); lineIndex++) {
    const raw = filter(lines[lineIndex])?.trim();
    if (!raw || /^#{1,6}\s+/.test(raw) || /^(?:=+|-+|\*{3,}|_{3,})$/.test(raw)) {
      flush();
      if (firstOnly && paragraphs.length) break;
      continue;
    }
    if (/^\|.*\|$/.test(raw) || /^\|?[\s:|-]+\|?$/.test(raw)) {
      flush();
      if (firstOnly && paragraphs.length) break;
      continue;
    }
    const cleaned = cleanPreviewLine(raw);
    if (cleaned) {
      current.push(cleaned.slice(0, 512 - chars));
      chars += cleaned.length + 1;
      if (chars >= 512) break;
    }
  }
  flush();
  return paragraphs;
}

function createFirstParagraph(lines: string[], startLine: number, endLine: number): string {
  return truncatePreview(extractParagraphs(lines, startLine, endLine, true)[0] ?? "", 220);
}

function createLocalSummary(lines: string[], startLine: number, endLine: number): string {
  const combined = extractParagraphs(lines, startLine, endLine).join(" ");
  if (!combined) return "";
  const sentences = combined.match(/[^。！？.!?]+[。！？.!?]+|[^。！？.!?]+$/g) ?? [combined];
  let summary = "";
  for (const sentence of sentences.slice(0, 3)) {
    const candidate = `${summary}${summary ? " " : ""}${sentence.trim()}`;
    if (summary && candidate.length > 280) break;
    summary = candidate;
    if (summary.length >= 150) break;
  }
  return truncatePreview(summary || combined, 280);
}

function jumpToHeading(view: MarkdownView, heading: SourceHeading, commit: boolean): void {
  if (view.getMode() === "preview") {
    // Obsidian's committed line navigation waits for rendering and unfolds the target.
    if (commit) view.setEphemeralState({ line: heading.line });
    else view.previewMode.applyScroll(heading.line);
    return;
  }
  const target = { line: heading.line, ch: 0 };
  if (commit) view.editor.setCursor(target);
  view.editor.scrollIntoView({ from: target, to: target }, true);
  if (commit) view.editor.focus();
}

function searchKey(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

class HeadingPicker extends SuggestModal<TocHeading> {
  private entries: Array<{ heading: TocHeading; key: string }>;

  constructor(app: App, headings: TocHeading[], zh: boolean, private choose: (heading: TocHeading) => void) {
    super(app);
    this.entries = headings.map(heading => ({ heading, key: searchKey(heading.text) }));
    this.limit = headings.length;
    this.setPlaceholder(zh ? "搜索标题…" : "Search headings…");
    this.inputEl.setAttribute("aria-label", zh ? "搜索标题" : "Search headings");
    this.emptyStateText = zh ? "没有匹配的标题" : "No matching headings";
  }

  getSuggestions(query: string): TocHeading[] {
    const words = searchKey(query).trim().split(/\s+/);
    return this.entries.filter(entry => words.every(word => entry.key.includes(word))).map(entry => entry.heading);
  }

  renderSuggestion(heading: TocHeading, el: HTMLElement): void {
    const row = el.createDiv({ cls: "wave-toc-picker-row" });
    row.style.setProperty("--wave-heading-indent", `${(heading.level - 1) * 13}px`);
    row.createSpan({ cls: "wave-toc-picker-title", text: heading.text });
    row.createSpan({ cls: "wave-toc-picker-meta", text: `H${heading.level} · ${heading.line + 1}` });
  }

  onChooseSuggestion(heading: TocHeading): void {
    this.choose(heading);
  }
}

export default class WaveTocPlugin extends Plugin {
  settings: FloatingTocSettings = DEFAULT_SETTINGS;
  private overlays = new Map<MarkdownView, FloatingToc>();
  private refreshTimer = 0;
  private headingPicker: HeadingPicker | null = null;

  async onload(): Promise<void> {
    const storedSettings = (await this.loadData()) as Partial<FloatingTocSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, storedSettings ?? {});
    this.app.workspace.detachLeavesOfType(LEGACY_VIEW_TYPE);

    this.addCommand({
      id: "toggle-floating-toc",
      name: `Toggle ${PLUGIN_DISPLAY_NAME}`,
      callback: async () => {
        this.settings.enabled = !this.settings.enabled;
        await this.saveSettings();
      }
    });
    this.addCommand({
      id: "jump-to-heading",
      name: this.settings.uiLanguage === "zh" ? "跳转到标题" : "Jump to heading",
      checkCallback: checking => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        if (!checking) this.openHeadingPicker(view);
        return true;
      }
    });
    this.addSettingTab(new FloatingTocSettingTab(this.app, this));

    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("editor-change", (_editor, info) => {
      if (info instanceof MarkdownView && !info.file) this.scheduleRefresh();
    }));
    this.registerEvent(this.app.metadataCache.on("changed", file => {
      if (Array.from(this.overlays.keys()).some(view => view.file === file)) this.scheduleRefresh();
    }));
    this.registerEvent(this.app.vault.on("modify", file => {
      if (Array.from(this.overlays.keys()).some(view => view.file === file)) this.scheduleRefresh();
    }));
    this.app.workspace.onLayoutReady(() => this.refreshAll());
  }

  onunload(): void {
    window.clearTimeout(this.refreshTimer);
    this.headingPicker?.close();
    this.overlays.forEach(overlay => overlay.destroy());
    this.overlays.clear();
  }

  private scheduleRefresh(): void {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.refreshAll(), 80);
  }

  refreshAll(): void {
    const liveViews = new Set<MarkdownView>();
    this.app.workspace.getLeavesOfType("markdown").forEach(leaf => {
      if (!(leaf.view instanceof MarkdownView)) return;
      if (!leaf.view.contentEl || leaf.view.contentEl.offsetParent === null) return;
      liveViews.add(leaf.view);
      let overlay = this.overlays.get(leaf.view);
      if (!overlay) {
        overlay = new FloatingToc(this, leaf.view);
        this.overlays.set(leaf.view, overlay);
      }
      overlay.refresh();
    });

    this.overlays.forEach((overlay, view) => {
      if (!liveViews.has(view)) {
        overlay.destroy();
        this.overlays.delete(view);
      }
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshAll();
  }

  openHeadingPicker(view: MarkdownView): void {
    const source = view.getViewData();
    const file = view.file;
    const { headings } = getNoteOutline(view, this, source);
    this.headingPicker?.close();
    this.headingPicker = new HeadingPicker(this.app, headings, this.settings.uiLanguage === "zh", heading => {
      if (view.file === file && view.getViewData() === source) jumpToHeading(view, heading, true);
    });
    this.headingPicker.open();
  }
}

class FloatingToc {
  private rootEl: HTMLElement | null = null;
  private railEl: HTMLElement | null = null;
  private bubbleEl: HTMLElement | null = null;
  private bubbleTitleEl: HTMLElement | null = null;
  private bubblePreviewEl: HTMLElement | null = null;
  private tickEls: HTMLElement[] = [];
  private headings: TocHeading[] = [];
  private sourceLines: string[] = [];
  private source: string | null = null;
  private renderedSettings = "";
  private renderedFile: MarkdownView["file"] | undefined;
  private renderedCache: ReturnType<App["metadataCache"]["getFileCache"]> | undefined;
  private renderedWindow: Window | null = null;
  private layoutFrame = 0;
  private activeIndex = -1;
  private hoverIndex = -1;
  private frame = 0;
  private waveFrame = 0;
  private wavePosition = 0;
  private waveVelocity = 0;
  private waveAmplitude = 0;
  private waveTarget = 0;
  private waveActive = false;
  private waveLastTime = 0;
  private waveTicks = new Set<number>();
  private pointerDownY: number | null = null;
  private suppressClick = false;
  private cleanup: Array<() => void> = [];

  constructor(private plugin: WaveTocPlugin, private view: MarkdownView) {}

  refresh(): void {
    const host = this.view.contentEl;
    const source = this.plugin.settings.enabled ? this.view.getViewData() : null;
    const settings = JSON.stringify(this.plugin.settings);
    const file = this.view.file;
    const cache = file ? this.plugin.app.metadataCache.getFileCache(file) : null;
    const hostWindow = host.win;
    const hostDirection = hostWindow.getComputedStyle(host).direction;
    const layoutKey = `${settings}/${hostDirection}/${this.view.getMode()}`;
    if (this.source === source && this.renderedSettings === layoutKey && this.renderedFile === file &&
      this.renderedCache === cache && this.renderedWindow === hostWindow) return;
    this.destroyDom();
    this.source = source;
    this.renderedSettings = layoutKey;
    this.renderedFile = file;
    this.renderedCache = cache;
    this.renderedWindow = hostWindow;
    if (source === null) return;
    const { lines, headings } = getNoteOutline(this.view, this.plugin, source);
    this.sourceLines = lines;
    this.headings = headings;
    if (!this.headings.length) return;

    const hostDocument = host.doc;
    host.addClass("has-wave-floating-toc");

    this.rootEl = host.createDiv({ cls: "wave-floating-toc" });
    this.rootEl.dataset.side = this.plugin.settings.side === "auto"
      ? hostDirection === "rtl" ? "right" : "left"
      : this.plugin.settings.side;
    this.rootEl.style.setProperty("--wave-toc-height", `${this.plugin.settings.verticalSize}%`);
    this.rootEl.style.setProperty(
      "--wave-highlight-color",
      this.plugin.settings.useCustomHighlightColor
        ? this.plugin.settings.highlightColor
        : "var(--text-normal)"
    );
    const rail = this.railEl = this.rootEl.createDiv({ cls: "wave-floating-toc-rail" });
    const label = this.plugin.settings.uiLanguage === "zh" ? "跳转到标题" : "Jump to heading";
    const launcher = this.rootEl.createEl("button", {
      cls: "wave-toc-picker-button",
      attr: { type: "button", "aria-label": label, title: label }
    });
    setIcon(launcher, "list");
    launcher.addEventListener("click", () => this.plugin.openHeadingPicker(this.view));
    this.bubbleEl = this.rootEl.createDiv({ cls: "wave-floating-toc-bubble" });
    this.bubbleTitleEl = this.bubbleEl.createDiv({ cls: "wave-floating-toc-bubble-title" });
    this.bubblePreviewEl = this.bubbleEl.createDiv({ cls: "wave-floating-toc-bubble-preview" });

    this.headings.forEach((heading, index) => {
      const tick = this.railEl!.createDiv({ cls: "wave-floating-toc-tick" });
      tick.dataset.index = String(index);
      tick.dataset.level = String(heading.level);
      tick.setAttribute("aria-hidden", "true");
      this.tickEls.push(tick);
    });
    const updateLayout = () => {
      const available = Math.max(0, rail.clientHeight - 8);
      const count = this.headings.length;
      const gap = count > 1
        ? Math.min(15, Math.max(5, (available - count * 3) / (count - 1)))
        : 15;
      rail.style.setProperty("--wave-tick-gap", `${gap}px`);
      this.rootEl?.toggleClass("is-overflowing", count * 3 + Math.max(0, count - 1) * 5 > available);
      this.rootEl?.style.setProperty("--wave-bubble-room", `${Math.max(0, host.clientWidth - 99)}px`);
      this.revealActiveTick();
    };
    const observer = new ResizeObserver(updateLayout);
    observer.observe(host);
    this.layoutFrame = hostWindow.requestAnimationFrame(() => {
      this.layoutFrame = 0;
      updateLayout();
      this.updateActive();
    });

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "mouse") this.handlePointerMove(event);
    };
    const onDown = (event: PointerEvent) => {
      this.pointerDownY = event.clientY;
      this.suppressClick = false;
    };
    const onLeave = () => {
      this.pointerDownY = null;
      this.clearHover();
    };
    const onClick = (event: MouseEvent) => this.handleClick(event);
    const onScroll = () => this.scheduleActiveUpdate();

    rail.addEventListener("pointermove", onMove);
    rail.addEventListener("pointerdown", onDown);
    rail.addEventListener("pointerleave", onLeave);
    rail.addEventListener("pointercancel", onLeave);
    rail.addEventListener("click", onClick);
    rail.addEventListener("scroll", () => this.clearHover(), { passive: true });
    host.addEventListener("scroll", onScroll, { capture: true, passive: true });
    host.addEventListener("wheel", onScroll, { passive: true });
    hostDocument.addEventListener("selectionchange", onScroll, { passive: true });
    this.cleanup.push(
      () => observer.disconnect(),
      () => host.removeEventListener("scroll", onScroll, { capture: true }),
      () => host.removeEventListener("wheel", onScroll),
      () => hostDocument.removeEventListener("selectionchange", onScroll)
    );
  }

  destroy(): void {
    this.destroyDom();
  }

  private destroyDom(): void {
    const hostWindow = this.renderedWindow ?? this.view.contentEl.win;
    if (this.frame) hostWindow.cancelAnimationFrame(this.frame);
    if (this.waveFrame) hostWindow.cancelAnimationFrame(this.waveFrame);
    if (this.layoutFrame) hostWindow.cancelAnimationFrame(this.layoutFrame);
    this.frame = 0;
    this.waveFrame = 0;
    this.layoutFrame = 0;
    this.cleanup.forEach(fn => fn());
    this.cleanup = [];
    this.rootEl?.parentElement?.removeClass("has-wave-floating-toc");
    this.rootEl?.remove();
    this.rootEl = null;
    this.railEl = null;
    this.bubbleEl = null;
    this.bubbleTitleEl = null;
    this.bubblePreviewEl = null;
    this.tickEls = [];
    this.headings = [];
    this.sourceLines = [];
    this.activeIndex = -1;
    this.hoverIndex = -1;
    this.waveVelocity = 0;
    this.waveAmplitude = 0;
    this.waveActive = false;
    this.waveLastTime = 0;
    this.waveTicks.clear();
    this.pointerDownY = null;
    this.suppressClick = false;
  }

  private handlePointerMove(event: MouseEvent): void {
    if (!this.railEl || !this.headings.length) return;
    if (this.pointerDownY !== null && Math.abs(event.clientY - this.pointerDownY) > 4) {
      this.suppressClick = true;
    }
    const index = this.tickAt(event.clientY);
    if (index < 0) return;
    if (index === this.hoverIndex) return;
    this.tickEls[this.hoverIndex]?.removeClass("is-hovered");
    this.hoverIndex = index;
    this.renderHover(index);
    if (this.plugin.settings.navigationMode === "hover") {
      this.navigateTo(index, false);
    }
  }

  private tickAt(clientY: number): number {
    const first = this.tickEls[0]?.getBoundingClientRect();
    if (!first) return -1;
    const second = this.tickEls[1]?.getBoundingClientRect();
    if (!second || second.top === first.top) return 0;
    const rect = this.railEl?.getBoundingClientRect();
    const y = rect ? Math.min(rect.bottom - 1, Math.max(rect.top, clientY)) : clientY;
    return Math.max(0, Math.min(this.tickEls.length - 1,
      Math.round((y - first.top - first.height / 2) / (second.top - first.top))));
  }

  private renderHover(index: number): void {
    if (!this.bubbleEl || !this.bubbleTitleEl || !this.bubblePreviewEl || !this.railEl) return;
    this.rootEl?.addClass("is-hovering");
    const tick = this.tickEls[index];
    const heading = this.headings[index];
    if (!tick || !heading) return;
    tick.addClass("is-hovered");

    const previewMode = this.plugin.settings.bubblePreviewMode;
    const preview = heading.preview ??= previewMode === "paragraph"
      ? createFirstParagraph(this.sourceLines, heading.bodyLine, heading.nextLine)
      : previewMode === "summary" ? createLocalSummary(this.sourceLines, heading.bodyLine, heading.sectionEnd) : "";
    this.bubbleTitleEl.setText(heading.text);
    this.bubblePreviewEl.setText(preview);
    this.bubbleEl.toggleClass("has-preview", Boolean(preview));
    this.bubblePreviewEl.toggleClass("is-hidden", !preview);
    this.bubbleEl.addClass("is-visible");
    const rootRect = this.rootEl!.getBoundingClientRect();
    const pane = this.view.contentEl.getBoundingClientRect();
    const tickRect = tick.getBoundingClientRect();
    const inset = Math.min(this.bubbleEl.offsetHeight / 2 + 4, pane.height / 2);
    const y = Math.min(pane.bottom - inset, Math.max(pane.top + inset, tickRect.top + tickRect.height / 2));
    this.bubbleEl.style.setProperty("--wave-bubble-y", `${y - rootRect.top}px`);
    this.setWaveTarget(index);
  }

  private clearHover(): void {
    this.tickEls[this.hoverIndex]?.removeClass("is-hovered");
    this.hoverIndex = -1;
    this.rootEl?.removeClass("is-hovering");
    this.bubbleEl?.removeClass("is-visible");
    this.waveActive = false;
    if (this.waveAmplitude || this.waveFrame) this.ensureWaveAnimation();
  }

  private setWaveTarget(index: number): void {
    if (this.view.contentEl.win.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (this.waveAmplitude < 0.01) {
      this.wavePosition = index;
      this.waveVelocity = 0;
    }
    this.waveTarget = index;
    this.waveActive = true;
    this.rootEl?.addClass("is-wave-active");
    this.ensureWaveAnimation();
  }

  private ensureWaveAnimation(): void {
    if (this.waveFrame) return;
    const animate = (time: number) => {
      const elapsed = this.waveLastTime ? time - this.waveLastTime : 1000 / 60;
      const frameScale = Math.min(2, Math.max(0.35, elapsed / (1000 / 60)));
      this.waveLastTime = time;
      const targetAmplitude = this.waveActive ? 1 : 0;
      const amplitudeResponse = this.waveActive ? 0.18 : 0.075;
      const amplitudeEase = 1 - Math.pow(1 - amplitudeResponse, frameScale);
      this.waveAmplitude += (targetAmplitude - this.waveAmplitude) * amplitudeEase;

      if (this.waveActive) {
        const force = (this.waveTarget - this.wavePosition) * 0.16 * frameScale;
        this.waveVelocity = (this.waveVelocity + force) * Math.pow(0.72, frameScale);
        this.wavePosition += this.waveVelocity * frameScale;
      } else {
        this.waveVelocity *= Math.pow(0.8, frameScale);
        this.wavePosition += this.waveVelocity * frameScale;
      }

      const nextTicks = new Set<number>();
      for (let index = Math.max(0, Math.floor(this.wavePosition) - 6);
        index <= Math.min(this.tickEls.length - 1, Math.ceil(this.wavePosition) + 6); index++) {
        const tick = this.tickEls[index];
        nextTicks.add(index);
        const level = this.headings[index]?.level ?? 3;
        const baseWidth = level === 1 ? 27 : level === 2 ? 20 : 15;
        const distance = index - this.wavePosition;
        const influence = Math.exp(-(distance * distance) / (2 * 1.7 * 1.7));
        const strength = influence * this.waveAmplitude;
        const width = baseWidth + (51 - baseWidth) * strength;
        tick.style.transform = `scaleX(${(width / baseWidth).toFixed(4)})`;
        tick.style.opacity = (0.86 + 0.14 * strength).toFixed(3);
        tick.toggleClass("is-wave-colored", strength > 0.012);
        tick.style.setProperty(
          "--wave-highlight-strength",
          `${(27 + 73 * strength).toFixed(1)}%`
        );
      }
      for (const index of this.waveTicks) {
        if (!nextTicks.has(index)) this.clearWaveTick(index);
      }
      this.waveTicks = nextTicks;

      const resting = this.waveActive &&
        Math.abs(1 - this.waveAmplitude) < 0.004 &&
        Math.abs(this.waveTarget - this.wavePosition) < 0.004 &&
        Math.abs(this.waveVelocity) < 0.004;
      const settled = !this.waveActive && this.waveAmplitude < 0.008 && Math.abs(this.waveVelocity) < 0.008;
      if (resting) {
        this.waveAmplitude = 1;
        this.wavePosition = this.waveTarget;
        this.waveVelocity = 0;
        this.waveLastTime = 0;
        this.waveFrame = 0;
        return;
      }
      if (settled) {
        this.waveAmplitude = 0;
        this.waveVelocity = 0;
        this.waveLastTime = 0;
        this.waveTicks.forEach(index => this.clearWaveTick(index));
        this.waveTicks.clear();
        this.rootEl?.removeClass("is-wave-active");
        this.waveFrame = 0;
        return;
      }
      this.waveFrame = this.view.contentEl.win.requestAnimationFrame(animate);
    };
    this.waveFrame = this.view.contentEl.win.requestAnimationFrame(animate);
  }

  private clearWaveTick(index: number): void {
    const tick = this.tickEls[index];
    if (!tick) return;
    tick.style.removeProperty("transform");
    tick.style.removeProperty("opacity");
    tick.style.removeProperty("--wave-highlight-strength");
    tick.removeClass("is-wave-colored");
  }

  private handleClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.pointerDownY = null;
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const index = this.tickAt(event.clientY);
    if (index >= 0) this.navigateTo(index, true);
  }

  private navigateTo(index: number, commit: boolean): void {
    const heading = this.headings[index];
    if (!heading) return;

    jumpToHeading(this.view, heading, commit);
    this.setActive(index);
  }

  private scheduleActiveUpdate(): void {
    if (this.frame) return;
    this.frame = this.view.contentEl.win.requestAnimationFrame(() => {
      this.frame = 0;
      this.updateActive();
    });
  }

  private updateActive(): void {
    if (!this.headings.length) return;
    const reading = this.view.getMode() === "preview";
    const cursorTracking = !reading && this.plugin.settings.activeTrackingMode === "cursor";
    const scroller = cursorTracking ? null : this.view.contentEl.querySelector<HTMLElement>(
      reading ? ".markdown-preview-view" : ".cm-scroller"
    );
    if (scroller && scroller.scrollHeight > scroller.clientHeight + 2 &&
      scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 2) {
      this.setActive(this.headings.length - 1);
      return;
    }
    const line = reading ? this.view.previewMode.getScroll()
      : !cursorTracking
        ? this.getEditorViewportLine()
        : this.view.editor.getCursor("from").line;
    let lo = 0;
    let hi = this.headings.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.headings[mid].line <= line) lo = mid + 1;
      else hi = mid;
    }
    this.setActive(Math.max(0, lo - 1));
  }

  private getEditorViewportLine(): number {
    const editorView = EditorView.findFromDOM(this.view.contentEl);
    if (editorView) {
      const scrollerRect = editorView.scrollDOM.getBoundingClientRect();
      const contentRect = editorView.contentDOM.getBoundingClientRect();
      const anchorY = Math.min(scrollerRect.bottom - 1, scrollerRect.top + 100);
      const anchorX = Math.min(contentRect.right - 1, contentRect.left + 24);
      const position = editorView.posAtCoords({ x: anchorX, y: anchorY }, false);
      if (position !== null) return editorView.state.doc.lineAt(position).number - 1;
    }

    const scroller = this.view.contentEl.querySelector<HTMLElement>(".cm-scroller");
    if (scroller && scroller.scrollHeight > scroller.clientHeight) {
      const progress = scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight);
      return Math.round(progress * Math.max(0, this.view.editor.lineCount() - 1));
    }
    return this.view.editor.getCursor("from").line;
  }

  private setActive(index: number): void {
    if (index === this.activeIndex) return;
    const previous = this.activeIndex;
    this.tickEls[previous]?.removeClass("is-active");
    this.activeIndex = index;
    this.tickEls[index]?.addClass("is-active");
    this.updateActiveGradient(index, previous);
    this.revealActiveTick();
  }

  private revealActiveTick(): void {
    const rail = this.railEl;
    const tick = this.tickEls[this.activeIndex];
    if (!rail || !tick || this.hoverIndex >= 0 || rail.scrollHeight <= rail.clientHeight) return;
    const bounds = rail.getBoundingClientRect();
    const target = tick.getBoundingClientRect();
    if (target.top < bounds.top) rail.scrollTop += target.top - bounds.top - 4;
    else if (target.bottom > bounds.bottom) rail.scrollTop += target.bottom - bounds.bottom + 4;
  }

  private updateActiveGradient(activeIndex: number, previous: number): void {
    const indices = new Set<number>();
    for (const center of [activeIndex, previous]) {
      if (center < 0) continue;
      for (let index = Math.max(0, center - 3); index <= Math.min(this.tickEls.length - 1, center + 3); index++) {
        indices.add(index);
      }
    }
    for (const index of indices) {
      const tick = this.tickEls[index];
      const distance = Math.abs(index - activeIndex);
      const influence = Math.exp(-(distance * distance) / (2 * 1.35 * 1.35));
      const showGradient = distance > 0 && influence > 0.06;
      tick.toggleClass("is-active-gradient", showGradient);
      if (showGradient) {
        tick.style.setProperty(
          "--wave-active-strength",
          `${(27 + 61 * influence).toFixed(1)}%`
        );
      } else {
        tick.style.removeProperty("--wave-active-strength");
      }
    }
  }
}

class FloatingTocSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: WaveTocPlugin) { super(app, plugin); }

  getSettingDefinitions(): WaveSettingDefinitionItem[] {
    const isChinese = this.plugin.settings.uiLanguage === "zh";
    const text = isChinese ? {
      languageName: "界面语言",
      languageDesc: "选择 Wave TOC 设置菜单使用的语言。",
      enabledName: "启用浮动目录",
      positionName: "显示位置",
      automatic: "跟随界面方向",
      left: "左侧",
      right: "右侧",
      depthName: "最大标题层级",
      depthDesc: "Wave TOC 针对一级至三级标题设计，默认显示到三级标题。",
      navigationName: "刻度导航方式",
      navigationDesc: "选择鼠标滑过刻度时正文立即跟随，或仅在点击刻度后定位。",
      navigationHover: "悬停时正文跟随",
      navigationClick: "点击后正文定位",
      previewName: "悬停卡片内容",
      previewDesc: "选择鼠标悬停刻度时显示的正文预览。内容摘要仅在本地提取，不会发送笔记内容。",
      previewTitle: "仅显示标题",
      previewParagraph: "标题 + 第一段正文",
      previewSummary: "标题 + 内容摘要（默认）",
      trackingName: "正文滚动同步方式",
      trackingDesc: "编辑模式下，可随正文滚动或光标位置更新刻度。阅读模式始终跟随正文滚动。",
      trackingViewport: "正文滚动时自动跟随（默认）",
      trackingCursor: "光标点击后跟随",
      highlightName: "自定义高亮颜色",
      highlightDesc: "关闭时保持当前主题颜色；开启后使用右侧颜色，并在高亮刻度两侧显示渐变。",
      heightName: "刻度轨道高度",
      heightDesc: "设置刻度轨道占笔记窗格高度的百分比。"
    } : {
      languageName: "Interface language",
      languageDesc: "Choose the language used in the Wave TOC settings.",
      enabledName: "Enable floating TOC",
      positionName: "Position",
      automatic: "Follow interface direction",
      left: "Left edge",
      right: "Right edge",
      depthName: "Maximum heading depth",
      depthDesc: "Wave TOC is designed for H1–H3 and shows headings through H3 by default.",
      navigationName: "Tick navigation",
      navigationDesc: "Choose whether the note follows tick hover or moves only after a click.",
      navigationHover: "Follow on hover",
      navigationClick: "Navigate on click",
      previewName: "Hover card content",
      previewDesc: "Choose the note preview shown on tick hover. Summaries are extracted locally and note content is never sent anywhere.",
      previewTitle: "Title only",
      previewParagraph: "Title + first paragraph",
      previewSummary: "Title + content summary (default)",
      trackingName: "Content scroll tracking",
      trackingDesc: "In Editing view, track scrolling or the cursor. Reading view always tracks scrolling.",
      trackingViewport: "Follow while scrolling (default)",
      trackingCursor: "Follow after cursor click",
      highlightName: "Custom highlight color",
      highlightDesc: "Keep the current theme color when disabled, or use the selected color with a gradient across neighboring ticks.",
      heightName: "Rail height",
      heightDesc: "Set the rail height as a percentage of the note pane."
    };

    return [
      {
        id: "interface-language",
        name: text.languageName,
        desc: text.languageDesc,
        aliases: isChinese ? ["Interface language"] : ["界面语言"],
        control: {
          type: "dropdown",
          key: "uiLanguage",
          options: { zh: "中文", en: "English" }
        }
      },
      {
        id: "enabled",
        name: text.enabledName,
        aliases: isChinese ? ["Enable floating TOC"] : ["启用浮动目录"],
        control: { type: "toggle", key: "enabled" }
      },
      {
        id: "position",
        name: text.positionName,
        aliases: isChinese ? ["Position"] : ["显示位置"],
        control: {
          type: "dropdown",
          key: "side",
          options: { auto: text.automatic, left: text.left, right: text.right }
        }
      },
      {
        id: "heading-depth",
        name: text.depthName,
        desc: text.depthDesc,
        aliases: isChinese ? ["Maximum heading depth"] : ["最大标题层级"],
        control: {
          type: "dropdown",
          key: "maxDepth",
          options: { "1": "H1", "2": "H1–H2", "3": "H1–H3" }
        }
      },
      {
        id: "tick-navigation",
        name: text.navigationName,
        desc: text.navigationDesc,
        aliases: isChinese ? ["Tick navigation"] : ["刻度导航方式"],
        control: {
          type: "dropdown",
          key: "navigationMode",
          options: {
            hover: text.navigationHover,
            click: text.navigationClick
          }
        }
      },
      {
        id: "hover-card-content",
        name: text.previewName,
        desc: text.previewDesc,
        aliases: isChinese ? ["Hover card content"] : ["悬停卡片内容"],
        control: {
          type: "dropdown",
          key: "bubblePreviewMode",
          options: {
            title: text.previewTitle,
            paragraph: text.previewParagraph,
            summary: text.previewSummary
          }
        }
      },
      {
        id: "scroll-tracking",
        name: text.trackingName,
        desc: text.trackingDesc,
        aliases: isChinese ? ["Content scroll tracking"] : ["正文滚动同步方式"],
        control: {
          type: "dropdown",
          key: "activeTrackingMode",
          options: {
            viewport: text.trackingViewport,
            cursor: text.trackingCursor
          }
        }
      },
      {
        id: "highlight-color",
        name: text.highlightName,
        desc: text.highlightDesc,
        aliases: isChinese ? ["Custom highlight color"] : ["自定义高亮颜色"],
        render: (setting: Setting) => {
          setting
            .addToggle(toggle => toggle
              .setValue(this.plugin.settings.useCustomHighlightColor)
              .onChange(async value => {
                this.plugin.settings.useCustomHighlightColor = value;
                await this.plugin.saveSettings();
              }))
            .addColorPicker(color => color
              .setValue(this.plugin.settings.highlightColor)
              .onChange(async value => {
                this.plugin.settings.highlightColor = value;
                await this.plugin.saveSettings();
              }));
        }
      },
      {
        id: "rail-height",
        name: text.heightName,
        desc: text.heightDesc,
        aliases: isChinese ? ["Rail height"] : ["刻度轨道高度"],
        control: {
          type: "slider",
          key: "verticalSize",
          min: 35,
          max: 85,
          step: 5
        }
      }
    ];
  }

  getControlValue(key: string): unknown {
    const value = this.plugin.settings[key as FloatingTocSettingKey];
    return key === "maxDepth" ? String(value) : value;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    switch (key as FloatingTocSettingKey) {
      case "enabled":
        this.plugin.settings.enabled = Boolean(value);
        break;
      case "maxDepth":
        this.plugin.settings.maxDepth = Number(value);
        break;
      case "side":
        this.plugin.settings.side = value as "auto" | "left" | "right";
        break;
      case "verticalSize":
        this.plugin.settings.verticalSize = Number(value);
        break;
      case "navigationMode":
        this.plugin.settings.navigationMode = value as "hover" | "click";
        break;
      case "activeTrackingMode":
        this.plugin.settings.activeTrackingMode = value as "viewport" | "cursor";
        break;
      case "bubblePreviewMode":
        this.plugin.settings.bubblePreviewMode = value as "title" | "paragraph" | "summary";
        break;
      case "uiLanguage":
        this.plugin.settings.uiLanguage = value as "zh" | "en";
        break;
      case "useCustomHighlightColor":
      case "highlightColor":
        return;
    }

    await this.plugin.saveSettings();
    if (key === "uiLanguage") this.update();
  }
}
