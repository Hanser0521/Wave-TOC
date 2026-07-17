import {
  App,
  MarkdownView,
  Plugin,
  PluginSettingTab,
  Setting
} from "obsidian";
import { EditorView } from "@codemirror/view";

const LEGACY_VIEW_TYPE = "codex-toc-view";
const PLUGIN_DISPLAY_NAME = "Wave TOC";

interface FloatingTocSettings {
  enabled: boolean;
  maxDepth: number;
  side: "left" | "right";
  verticalSize: number;
  navigationMode: "hover" | "click";
  activeTrackingMode: "viewport" | "cursor";
  bubblePreviewMode: "title" | "paragraph" | "summary";
  uiLanguage: "zh" | "en";
}

const DEFAULT_SETTINGS: FloatingTocSettings = {
  enabled: true,
  maxDepth: 3,
  side: "left",
  verticalSize: 70,
  navigationMode: "hover",
  activeTrackingMode: "viewport",
  bubblePreviewMode: "summary",
  uiLanguage: "zh"
};

interface TocHeading {
  text: string;
  level: number;
  line: number;
  firstParagraph: string;
  summary: string;
}

function cleanHeadingText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(`+|\*\*|__|~~|\*|_)/g, "")
    .replace(/\\([#*_`~[\]])/g, "$1")
    .trim();
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

function extractParagraphs(lines: string[], startLine: number, endLine: number): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let insideFence = false;
  const flush = () => {
    const paragraph = current.join(" ").replace(/\s+/g, " ").trim();
    if (paragraph) paragraphs.push(paragraph);
    current = [];
  };

  for (let lineIndex = startLine; lineIndex < Math.min(endLine, lines.length); lineIndex++) {
    const raw = lines[lineIndex].trim();
    if (/^(```|~~~)/.test(raw)) {
      flush();
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;
    if (!raw || /^#{1,6}\s+/.test(raw) || /^(?:-{3,}|\*{3,}|_{3,})$/.test(raw)) {
      flush();
      continue;
    }
    if (/^\|.*\|$/.test(raw) || /^\|?[\s:|-]+\|?$/.test(raw)) {
      flush();
      continue;
    }
    const cleaned = cleanPreviewLine(raw);
    if (cleaned) current.push(cleaned);
  }
  flush();
  return paragraphs;
}

function createFirstParagraph(lines: string[], startLine: number, endLine: number): string {
  return truncatePreview(extractParagraphs(lines, startLine, endLine)[0] ?? "", 220);
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

export default class WaveTocPlugin extends Plugin {
  settings: FloatingTocSettings = DEFAULT_SETTINGS;
  private overlays = new Map<MarkdownView, FloatingToc>();
  private refreshTimer = 0;

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
    this.addSettingTab(new FloatingTocSettingTab(this.app, this));

    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("changed", file => {
      if (file === this.app.workspace.getActiveFile()) this.scheduleRefresh();
    }));
    this.app.workspace.onLayoutReady(() => this.refreshAll());
  }

  onunload(): void {
    window.clearTimeout(this.refreshTimer);
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
}

class FloatingToc {
  private rootEl: HTMLElement | null = null;
  private railEl: HTMLElement | null = null;
  private bubbleEl: HTMLElement | null = null;
  private bubbleTitleEl: HTMLElement | null = null;
  private bubblePreviewEl: HTMLElement | null = null;
  private tickEls: HTMLElement[] = [];
  private headings: TocHeading[] = [];
  private activeIndex = -1;
  private hoverIndex = -1;
  private frame = 0;
  private waveFrame = 0;
  private wavePosition = 0;
  private waveVelocity = 0;
  private waveAmplitude = 0;
  private waveTarget = 0;
  private waveActive = false;
  private pointerDownY: number | null = null;
  private suppressClick = false;
  private cleanup: Array<() => void> = [];

  constructor(private plugin: WaveTocPlugin, private view: MarkdownView) {}

  refresh(): void {
    this.destroyDom();
    if (!this.plugin.settings.enabled || !this.view.file) return;

    const cache = this.plugin.app.metadataCache.getFileCache(this.view.file);
    const sourceLines = this.view.editor.getValue().split(/\r?\n/);
    const cachedHeadings = cache?.headings ?? [];
    this.headings = cachedHeadings
      .map((heading, headingIndex) => {
        const startLine = heading.position.start.line + 1;
        const nextHeadingLine = cachedHeadings[headingIndex + 1]?.position.start.line ?? sourceLines.length;
        const nextPeerIndex = cachedHeadings.findIndex((candidate, candidateIndex) =>
          candidateIndex > headingIndex && candidate.level <= heading.level
        );
        const sectionEndLine = nextPeerIndex >= 0
          ? cachedHeadings[nextPeerIndex].position.start.line
          : sourceLines.length;
        return {
        text: cleanHeadingText(heading.heading),
        level: heading.level,
        line: heading.position.start.line,
        firstParagraph: createFirstParagraph(sourceLines, startLine, nextHeadingLine),
        summary: createLocalSummary(sourceLines, startLine, sectionEndLine)
        };
      })
      .filter(heading => heading.level <= this.plugin.settings.maxDepth);
    if (!this.headings.length) return;

    const host = this.view.contentEl;
    host.addClass("has-wave-floating-toc");

    this.rootEl = host.createDiv({ cls: "wave-floating-toc" });
    this.rootEl.dataset.side = this.plugin.settings.side;
    this.rootEl.style.setProperty("--wave-toc-height", `${this.plugin.settings.verticalSize}vh`);
    this.railEl = this.rootEl.createDiv({ cls: "wave-floating-toc-rail" });
    this.bubbleEl = this.rootEl.createDiv({ cls: "wave-floating-toc-bubble" });
    this.bubbleTitleEl = this.bubbleEl.createDiv({ cls: "wave-floating-toc-bubble-title" });
    this.bubblePreviewEl = this.bubbleEl.createDiv({ cls: "wave-floating-toc-bubble-preview" });

    this.headings.forEach((heading, index) => {
      const tick = this.railEl!.createDiv({ cls: "wave-floating-toc-tick" });
      tick.dataset.index = String(index);
      tick.dataset.level = String(heading.level);
      tick.setAttribute("aria-label", heading.text);
      this.tickEls.push(tick);
    });
    this.railEl.style.setProperty("--wave-heading-count", String(this.headings.length));
    window.requestAnimationFrame(() => {
      if (!this.railEl) return;
      const available = Math.max(0, this.railEl.clientHeight - 8);
      const count = this.headings.length;
      const gap = count > 1
        ? Math.min(15, Math.max(5, (available - count * 3) / (count - 1)))
        : 15;
      this.railEl.style.setProperty("--wave-tick-gap", `${gap}px`);
    });

    const onMove = (event: MouseEvent) => this.handlePointerMove(event);
    const onDown = (event: MouseEvent) => {
      this.pointerDownY = event.clientY;
      this.suppressClick = false;
    };
    const onLeave = () => this.clearHover();
    const onClick = (event: MouseEvent) => this.handleClick(event);
    const onScroll = () => this.scheduleActiveUpdate();

    this.rootEl.addEventListener("mousemove", onMove);
    this.rootEl.addEventListener("mousedown", onDown);
    this.rootEl.addEventListener("mouseleave", onLeave);
    this.rootEl.addEventListener("click", onClick);
    host.addEventListener("scroll", onScroll, { capture: true, passive: true });
    host.addEventListener("wheel", onScroll, { passive: true });
    document.addEventListener("selectionchange", onScroll, { passive: true });
    this.cleanup.push(
      () => this.rootEl?.removeEventListener("mousemove", onMove),
      () => this.rootEl?.removeEventListener("mousedown", onDown),
      () => this.rootEl?.removeEventListener("mouseleave", onLeave),
      () => this.rootEl?.removeEventListener("click", onClick),
      () => host.removeEventListener("scroll", onScroll, { capture: true }),
      () => host.removeEventListener("wheel", onScroll),
      () => document.removeEventListener("selectionchange", onScroll)
    );
    window.requestAnimationFrame(() => this.updateActive());
  }

  destroy(): void {
    this.destroyDom();
  }

  private destroyDom(): void {
    if (this.frame) window.cancelAnimationFrame(this.frame);
    if (this.waveFrame) window.cancelAnimationFrame(this.waveFrame);
    this.frame = 0;
    this.waveFrame = 0;
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
    this.activeIndex = -1;
    this.hoverIndex = -1;
    this.waveVelocity = 0;
    this.waveAmplitude = 0;
    this.waveActive = false;
  }

  private handlePointerMove(event: MouseEvent): void {
    if (!this.railEl || !this.headings.length) return;
    if (this.pointerDownY !== null && Math.abs(event.clientY - this.pointerDownY) > 4) {
      this.suppressClick = true;
    }
    let index = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    this.tickEls.forEach((tick, tickIndex) => {
      const rect = tick.getBoundingClientRect();
      const distance = Math.abs(event.clientY - (rect.top + rect.height / 2));
      if (distance < nearestDistance) {
        nearestDistance = distance;
        index = tickIndex;
      }
    });
    if (index === this.hoverIndex) return;
    this.hoverIndex = index;
    this.renderHover(index);
    if (this.plugin.settings.navigationMode === "hover") {
      this.navigateTo(index, false);
    }
  }

  private renderHover(index: number): void {
    if (!this.bubbleEl || !this.bubbleTitleEl || !this.bubblePreviewEl || !this.railEl) return;
    this.rootEl?.addClass("is-hovering");
    this.tickEls.forEach((tick, tickIndex) => tick.toggleClass("is-hovered", tickIndex === index));
    const tick = this.tickEls[index];
    const heading = this.headings[index];
    if (!tick || !heading) return;

    const previewMode = this.plugin.settings.bubblePreviewMode;
    const preview = previewMode === "paragraph"
      ? heading.firstParagraph
      : previewMode === "summary" ? heading.summary : "";
    this.bubbleTitleEl.setText(heading.text);
    this.bubblePreviewEl.setText(preview);
    this.bubbleEl.toggleClass("has-preview", Boolean(preview));
    this.bubblePreviewEl.toggleClass("is-hidden", !preview);
    this.bubbleEl.addClass("is-visible");
    const railRect = this.railEl.getBoundingClientRect();
    const tickRect = tick.getBoundingClientRect();
    this.bubbleEl.style.setProperty("--wave-bubble-y", `${tickRect.top - railRect.top + tickRect.height / 2}px`);
    this.setWaveTarget(index);
  }

  private clearHover(): void {
    this.tickEls[this.hoverIndex]?.removeClass("is-hovered");
    this.hoverIndex = -1;
    this.rootEl?.removeClass("is-hovering");
    this.bubbleEl?.removeClass("is-visible");
    this.waveActive = false;
    this.ensureWaveAnimation();
  }

  private setWaveTarget(index: number): void {
    if (this.waveAmplitude < 0.01) {
      this.wavePosition = index;
      this.waveVelocity = 0;
    }
    this.waveTarget = index;
    this.waveActive = true;
    this.ensureWaveAnimation();
  }

  private ensureWaveAnimation(): void {
    if (this.waveFrame) return;
    const animate = () => {
      const targetAmplitude = this.waveActive ? 1 : 0;
      this.waveAmplitude += (targetAmplitude - this.waveAmplitude) * (this.waveActive ? 0.2 : 0.11);

      if (this.waveActive) {
        const force = (this.waveTarget - this.wavePosition) * 0.2;
        this.waveVelocity = (this.waveVelocity + force) * 0.68;
        this.wavePosition += this.waveVelocity;
      } else {
        this.waveVelocity *= 0.78;
        this.wavePosition += this.waveVelocity;
      }

      this.tickEls.forEach((tick, index) => {
        const level = this.headings[index]?.level ?? 3;
        const baseWidth = level === 1 ? 27 : level === 2 ? 20 : 15;
        const distance = index - this.wavePosition;
        const influence = Math.exp(-(distance * distance) / (2 * 1.55 * 1.55));
        const strength = influence * this.waveAmplitude;
        const width = baseWidth + (51 - baseWidth) * strength;
        tick.style.width = `${width.toFixed(2)}px`;
        tick.style.opacity = tick.classList.contains("is-hovered") ? "1" : "0.86";
      });

      const settled = !this.waveActive && this.waveAmplitude < 0.008 && Math.abs(this.waveVelocity) < 0.008;
      if (settled) {
        this.waveAmplitude = 0;
        this.waveVelocity = 0;
        this.tickEls.forEach(tick => {
          tick.style.removeProperty("width");
          tick.style.removeProperty("opacity");
        });
        this.waveFrame = 0;
        return;
      }
      this.waveFrame = window.requestAnimationFrame(animate);
    };
    this.waveFrame = window.requestAnimationFrame(animate);
  }

  private handleClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.pointerDownY = null;
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    if (this.hoverIndex >= 0) this.navigateTo(this.hoverIndex, true);
  }

  private getRenderedHeadings(): HTMLElement[] {
    return Array.from(this.view.containerEl.querySelectorAll<HTMLElement>(
      ".markdown-preview-view h1, .markdown-preview-view h2, .markdown-preview-view h3, " +
      ".markdown-preview-view h4, .markdown-preview-view h5, .markdown-preview-view h6"
    )).filter(element => Number(element.tagName.slice(1)) <= this.plugin.settings.maxDepth);
  }

  private navigateTo(index: number, commit: boolean): void {
    const heading = this.headings[index];
    if (!heading) return;
    const rendered = this.getRenderedHeadings();
    const target = rendered[index];
    if (target) {
      target.scrollIntoView({ behavior: commit ? "smooth" : "auto", block: "start" });
    } else {
      this.view.editor.setCursor({ line: heading.line, ch: 0 });
      this.view.editor.scrollIntoView({
        from: { line: heading.line, ch: 0 },
        to: { line: heading.line, ch: 0 }
      }, true);
      if (commit) this.view.editor.focus();
    }
    this.setActive(index);
  }

  private scheduleActiveUpdate(): void {
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.updateActive();
    });
  }

  private updateActive(): void {
    if (!this.headings.length) return;
    const rendered = this.getRenderedHeadings();
    let index = 0;
    if (this.view.getMode() === "preview" && rendered.length) {
      const anchor = this.view.containerEl.getBoundingClientRect().top + 100;
      rendered.forEach((element, elementIndex) => {
        if (element.getBoundingClientRect().top <= anchor) index = elementIndex;
      });
    } else {
      const line = this.plugin.settings.activeTrackingMode === "viewport"
        ? this.getEditorViewportLine()
        : this.view.editor.getCursor("from").line;
      this.headings.forEach((heading, headingIndex) => {
        if (heading.line <= line) index = headingIndex;
      });
    }
    this.setActive(Math.min(index, this.headings.length - 1));
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
    this.tickEls[this.activeIndex]?.removeClass("is-active");
    this.activeIndex = index;
    this.tickEls[index]?.addClass("is-active");
  }
}

class FloatingTocSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: WaveTocPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const isChinese = this.plugin.settings.uiLanguage === "zh";
    const text = isChinese ? {
      languageName: "界面语言",
      languageDesc: "选择 Wave TOC 设置菜单使用的语言。",
      enabledName: "启用浮动目录",
      positionName: "显示位置",
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
      trackingDesc: "选择滚动正文时刻度自动跟随，或保留点击正文后才更新刻度的旧版方式。",
      trackingViewport: "正文滚动时自动跟随（默认）",
      trackingCursor: "光标点击后跟随",
      heightName: "刻度轨道高度",
      heightDesc: "设置刻度轨道占窗口高度的百分比。"
    } : {
      languageName: "Interface language",
      languageDesc: "Choose the language used in the Wave TOC settings.",
      enabledName: "Enable floating TOC",
      positionName: "Position",
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
      trackingDesc: "Choose automatic viewport tracking while scrolling or the legacy cursor/click behavior.",
      trackingViewport: "Follow while scrolling (default)",
      trackingCursor: "Follow after cursor click",
      heightName: "Rail height",
      heightDesc: "Set the rail height as a percentage of the window."
    };

    new Setting(containerEl)
      .setName(text.languageName)
      .setDesc(text.languageDesc)
      .addDropdown(dropdown => dropdown
        .addOptions({ zh: "中文", en: "English" })
        .setValue(this.plugin.settings.uiLanguage)
        .onChange(async value => {
          this.plugin.settings.uiLanguage = value as "zh" | "en";
          await this.plugin.saveSettings();
          this.display();
        }));
    new Setting(containerEl)
      .setName(text.enabledName)
      .addToggle(toggle => toggle.setValue(this.plugin.settings.enabled).onChange(async value => {
        this.plugin.settings.enabled = value;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName(text.positionName)
      .addDropdown(dropdown => dropdown
        .addOptions({ left: text.left, right: text.right })
        .setValue(this.plugin.settings.side)
        .onChange(async value => {
          this.plugin.settings.side = value as "left" | "right";
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName(text.depthName)
      .setDesc(text.depthDesc)
      .addDropdown(dropdown => dropdown
        .addOptions({ "1": "H1", "2": "H1–H2", "3": "H1–H3" })
        .setValue(String(this.plugin.settings.maxDepth))
        .onChange(async value => {
          this.plugin.settings.maxDepth = Number(value);
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName(text.navigationName)
      .setDesc(text.navigationDesc)
      .addDropdown(dropdown => dropdown
        .addOptions({
          hover: text.navigationHover,
          click: text.navigationClick
        })
        .setValue(this.plugin.settings.navigationMode)
        .onChange(async value => {
          this.plugin.settings.navigationMode = value as "hover" | "click";
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName(text.previewName)
      .setDesc(text.previewDesc)
      .addDropdown(dropdown => dropdown
        .addOptions({
          title: text.previewTitle,
          paragraph: text.previewParagraph,
          summary: text.previewSummary
        })
        .setValue(this.plugin.settings.bubblePreviewMode)
        .onChange(async value => {
          this.plugin.settings.bubblePreviewMode = value as "title" | "paragraph" | "summary";
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName(text.trackingName)
      .setDesc(text.trackingDesc)
      .addDropdown(dropdown => dropdown
        .addOptions({
          viewport: text.trackingViewport,
          cursor: text.trackingCursor
        })
        .setValue(this.plugin.settings.activeTrackingMode)
        .onChange(async value => {
          this.plugin.settings.activeTrackingMode = value as "viewport" | "cursor";
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName(text.heightName)
      .setDesc(text.heightDesc)
      .addSlider(slider => slider
        .setLimits(35, 85, 5)
        .setValue(this.plugin.settings.verticalSize)
        .onChange(async value => {
          this.plugin.settings.verticalSize = value;
          await this.plugin.saveSettings();
        }));
  }
}
