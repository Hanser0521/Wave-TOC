import {
  App,
  MarkdownView,
  Plugin,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem
} from "obsidian";
import { EditorView } from "@codemirror/view";

const LEGACY_VIEW_TYPE = "codex-toc-view";
const PLUGIN_DISPLAY_NAME = "Wave TOC";

interface FloatingTocSettings {
  enabled: boolean;
  maxDepth: number;
  side: "left" | "right";
  verticalSize: number;
  useCustomHighlightColor: boolean;
  highlightColor: string;
  navigationMode: "hover" | "click";
  activeTrackingMode: "viewport" | "cursor";
  bubblePreviewMode: "title" | "paragraph" | "summary";
  uiLanguage: "zh" | "en";
}

type FloatingTocSettingKey = keyof FloatingTocSettings;

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
  private waveLastTime = 0;
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
    this.rootEl.style.setProperty(
      "--wave-highlight-color",
      this.plugin.settings.useCustomHighlightColor
        ? this.plugin.settings.highlightColor
        : "var(--text-normal)"
    );
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
    this.waveLastTime = 0;
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

      this.tickEls.forEach((tick, index) => {
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
      });

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
        this.tickEls.forEach(tick => {
          tick.style.removeProperty("transform");
          tick.style.removeProperty("opacity");
          tick.style.removeProperty("--wave-highlight-strength");
          tick.removeClass("is-wave-colored");
        });
        this.rootEl?.removeClass("is-wave-active");
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

  private navigateTo(index: number, commit: boolean): void {
    const heading = this.headings[index];
    if (!heading) return;

    if (this.view.getMode() === "preview") {
      // Reading mode virtualizes long notes. Source-line navigation renders the
      // correct section on demand and remains unambiguous for duplicate titles.
      this.view.previewMode.applyScroll(heading.line);
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
    let index = 0;
    if (this.view.getMode() === "preview") {
      const line = this.view.previewMode.getScroll();
      this.headings.forEach((heading, headingIndex) => {
        if (heading.line <= line) index = headingIndex;
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
    this.updateActiveGradient(index);
  }

  private updateActiveGradient(activeIndex: number): void {
    this.tickEls.forEach((tick, index) => {
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
    });
  }
}

class FloatingTocSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: WaveTocPlugin) { super(app, plugin); }

  getSettingDefinitions(): SettingDefinitionItem<FloatingTocSettingKey>[] {
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
      highlightName: "自定义高亮颜色",
      highlightDesc: "关闭时保持当前主题颜色；开启后使用右侧颜色，并在高亮刻度两侧显示渐变。",
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
      highlightName: "Custom highlight color",
      highlightDesc: "Keep the current theme color when disabled, or use the selected color with a gradient across neighboring ticks.",
      heightName: "Rail height",
      heightDesc: "Set the rail height as a percentage of the window."
    };

    return [
      {
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
        name: text.enabledName,
        aliases: isChinese ? ["Enable floating TOC"] : ["启用浮动目录"],
        control: { type: "toggle", key: "enabled" }
      },
      {
        name: text.positionName,
        aliases: isChinese ? ["Position"] : ["显示位置"],
        control: {
          type: "dropdown",
          key: "side",
          options: { left: text.left, right: text.right }
        }
      },
      {
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
        this.plugin.settings.side = value as "left" | "right";
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
