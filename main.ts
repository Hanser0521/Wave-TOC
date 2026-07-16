import {
  App,
  MarkdownView,
  Plugin,
  PluginSettingTab,
  Setting
} from "obsidian";

const LEGACY_VIEW_TYPE = "codex-toc-view";

interface FloatingTocSettings {
  enabled: boolean;
  maxDepth: number;
  side: "left" | "right";
  verticalSize: number;
  navigationMode: "hover" | "click";
}

const DEFAULT_SETTINGS: FloatingTocSettings = {
  enabled: true,
  maxDepth: 3,
  side: "left",
  verticalSize: 70,
  navigationMode: "hover"
};

interface TocHeading {
  text: string;
  level: number;
  line: number;
}

function cleanHeadingText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(`+|\*\*|__|~~|\*|_)/g, "")
    .replace(/\\([#*_`~\[\]])/g, "$1")
    .trim();
}

export default class CodexTocPlugin extends Plugin {
  settings: FloatingTocSettings = DEFAULT_SETTINGS;
  private overlays = new Map<MarkdownView, FloatingToc>();
  private refreshTimer = 0;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.app.workspace.detachLeavesOfType(LEGACY_VIEW_TYPE);

    this.addCommand({
      id: "toggle-floating-codex-toc",
      name: "Toggle floating TOC",
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

  constructor(private plugin: CodexTocPlugin, private view: MarkdownView) {}

  refresh(): void {
    this.destroyDom();
    if (!this.plugin.settings.enabled || !this.view.file) return;

    const cache = this.plugin.app.metadataCache.getFileCache(this.view.file);
    this.headings = (cache?.headings ?? [])
      .filter(heading => heading.level <= this.plugin.settings.maxDepth)
      .map(heading => ({
        text: cleanHeadingText(heading.heading),
        level: heading.level,
        line: heading.position.start.line
      }));
    if (!this.headings.length) return;

    const host = this.view.contentEl;
    host.addClass("has-codex-floating-toc");

    this.rootEl = host.createDiv({ cls: "codex-floating-toc" });
    this.rootEl.dataset.side = this.plugin.settings.side;
    this.rootEl.style.setProperty("--codex-toc-height", `${this.plugin.settings.verticalSize}vh`);
    this.railEl = this.rootEl.createDiv({ cls: "codex-floating-toc-rail" });
    this.bubbleEl = this.rootEl.createDiv({ cls: "codex-floating-toc-bubble" });

    this.headings.forEach((heading, index) => {
      const tick = this.railEl!.createDiv({ cls: "codex-floating-toc-tick" });
      tick.dataset.index = String(index);
      tick.dataset.level = String(heading.level);
      tick.setAttribute("aria-label", heading.text);
      this.tickEls.push(tick);
    });
    this.railEl.style.setProperty("--codex-heading-count", String(this.headings.length));
    requestAnimationFrame(() => {
      if (!this.railEl) return;
      const available = Math.max(0, this.railEl.clientHeight - 8);
      const count = this.headings.length;
      const gap = count > 1
        ? Math.min(15, Math.max(5, (available - count * 3) / (count - 1)))
        : 15;
      this.railEl.style.setProperty("--codex-tick-gap", `${gap}px`);
    });

    const onMove = (event: MouseEvent) => this.handlePointerMove(event);
    const onDown = (event: MouseEvent) => {
      this.pointerDownY = event.clientY;
      this.suppressClick = false;
    };
    const onLeave = () => this.clearHover();
    const onClick = (event: MouseEvent) => this.handleClick(event);
    const onScroll = () => this.scheduleActiveUpdate();
    const scrollRoot = host.querySelector<HTMLElement>(".cm-scroller, .markdown-preview-view") ?? host;

    this.rootEl.addEventListener("mousemove", onMove);
    this.rootEl.addEventListener("mousedown", onDown);
    this.rootEl.addEventListener("mouseleave", onLeave);
    this.rootEl.addEventListener("click", onClick);
    scrollRoot.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("selectionchange", onScroll, { passive: true });
    this.cleanup.push(
      () => this.rootEl?.removeEventListener("mousemove", onMove),
      () => this.rootEl?.removeEventListener("mousedown", onDown),
      () => this.rootEl?.removeEventListener("mouseleave", onLeave),
      () => this.rootEl?.removeEventListener("click", onClick),
      () => scrollRoot.removeEventListener("scroll", onScroll),
      () => document.removeEventListener("selectionchange", onScroll)
    );
    requestAnimationFrame(() => this.updateActive());
  }

  destroy(): void {
    this.destroyDom();
  }

  private destroyDom(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.waveFrame) cancelAnimationFrame(this.waveFrame);
    this.frame = 0;
    this.waveFrame = 0;
    this.cleanup.forEach(fn => fn());
    this.cleanup = [];
    this.rootEl?.parentElement?.removeClass("has-codex-floating-toc");
    this.rootEl?.remove();
    this.rootEl = null;
    this.railEl = null;
    this.bubbleEl = null;
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
    if (!this.bubbleEl || !this.railEl) return;
    this.tickEls.forEach((tick, tickIndex) => tick.toggleClass("is-hovered", tickIndex === index));
    const tick = this.tickEls[index];
    const heading = this.headings[index];
    if (!tick || !heading) return;

    this.bubbleEl.setText(heading.text);
    this.bubbleEl.addClass("is-visible");
    const railRect = this.railEl.getBoundingClientRect();
    const tickRect = tick.getBoundingClientRect();
    this.bubbleEl.style.setProperty("--codex-bubble-y", `${tickRect.top - railRect.top + tickRect.height / 2}px`);
    this.setWaveTarget(index);
  }

  private clearHover(): void {
    this.tickEls[this.hoverIndex]?.removeClass("is-hovered");
    this.hoverIndex = -1;
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
        tick.style.opacity = `${(0.86 + strength * 0.14).toFixed(3)}`;
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
      this.waveFrame = requestAnimationFrame(animate);
    };
    this.waveFrame = requestAnimationFrame(animate);
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
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.updateActive();
    });
  }

  private updateActive(): void {
    if (!this.headings.length) return;
    const rendered = this.getRenderedHeadings();
    let index = 0;
    if (rendered.length) {
      const anchor = this.view.containerEl.getBoundingClientRect().top + 100;
      rendered.forEach((element, elementIndex) => {
        if (element.getBoundingClientRect().top <= anchor) index = elementIndex;
      });
    } else {
      const line = this.view.editor.getCursor("from").line;
      this.headings.forEach((heading, headingIndex) => {
        if (heading.line <= line) index = headingIndex;
      });
    }
    this.setActive(Math.min(index, this.headings.length - 1));
  }

  private setActive(index: number): void {
    if (index === this.activeIndex) return;
    this.tickEls[this.activeIndex]?.removeClass("is-active");
    this.activeIndex = index;
    this.tickEls[index]?.addClass("is-active");
  }
}

class FloatingTocSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: CodexTocPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Enable floating TOC")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.enabled).onChange(async value => {
        this.plugin.settings.enabled = value;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("Position")
      .addDropdown(dropdown => dropdown
        .addOptions({ left: "Left edge", right: "Right edge" })
        .setValue(this.plugin.settings.side)
        .onChange(async value => {
          this.plugin.settings.side = value as "left" | "right";
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Maximum heading depth")
      .setDesc("Codex TOC is designed for H1–H3. Deeper headings are hidden by default.")
      .addDropdown(dropdown => dropdown
        .addOptions({ "1": "H1", "2": "H1–H2", "3": "H1–H3" })
        .setValue(String(this.plugin.settings.maxDepth))
        .onChange(async value => {
          this.plugin.settings.maxDepth = Number(value);
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("刻度导航方式")
      .setDesc("选择鼠标滑过刻度时正文立即跟随，或仅在点击刻度后定位。")
      .addDropdown(dropdown => dropdown
        .addOptions({
          hover: "悬停时正文跟随",
          click: "点击后正文定位"
        })
        .setValue(this.plugin.settings.navigationMode)
        .onChange(async value => {
          this.plugin.settings.navigationMode = value as "hover" | "click";
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("Rail height")
      .setDesc("Percentage of the window height.")
      .addSlider(slider => slider
        .setLimits(35, 85, 5)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.verticalSize)
        .onChange(async value => {
          this.plugin.settings.verticalSize = value;
          await this.plugin.saveSettings();
        }));
  }
}
