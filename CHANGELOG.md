# Changelog

## 1.0.7 — 2026-08-18

### 中文

- 新增高亮刻度颜色设置：默认继续跟随当前主题，也可以选择自定义颜色。
- 当前章节及鼠标悬停刻度的两侧新增由近到远的颜色渐变，保留清晰焦点并增强层次感。
- 重构波峰动画的跟随、回弹与复位节奏，并改用变换动画减少布局计算，使快速滑动更流畅、优雅、灵动。
- 保持既有交互规则：正文滚动只改变刻度颜色，刻度长度波峰仍仅在鼠标悬停时出现。

### English

- Added a highlight-color setting that keeps the current theme color by default and supports a custom color.
- Added a fading color gradient across neighboring ticks around the active section and hovered tick.
- Refined wave following, rebound, and settling with transform-based animation for smoother, more graceful pointer movement.
- Preserved the established interaction: content scrolling changes tick color only, while the length wave remains hover-driven.

## 1.0.6 — 2026-07-31

### 中文

- 修复阅读模式下点击或悬停远端刻度时，无法准确定位到对应标题行的问题。
- 兼容 Obsidian 对长文阅读视图的虚拟渲染：阅读模式统一使用 Markdown 源文件行号精确跳转，也可正确区分同名标题。
- 阅读模式下的当前刻度跟随改为依据预览视图的源文件行号计算，避免渲染区段变化造成刻度错位。

### English

- Fixed inaccurate heading positioning when clicking or hovering distant ticks in Reading view.
- Added support for Obsidian's virtualized long-note rendering by using precise Markdown source-line navigation throughout Reading view, including for duplicate heading titles.
- Updated active-tick tracking in Reading view to follow the preview's source line, preventing drift as rendered sections change.

## 1.0.5 — 2026-07-17

### 中文

- 为发布文件生成新的校验摘要，避免插件市场继续关联 1.0.3 中无法验证的旧来源证明。
- 保持浮动目录交互和视觉行为不变，并延续全部审核兼容性修复。

### English

- Generated new release-asset digests so the marketplace no longer associates the files with the unverifiable 1.0.3 provenance record.
- Kept the floating TOC interactions and visual behavior unchanged while preserving all review compatibility fixes.

## 1.0.4 — 2026-07-17

### 中文

- 移除当前插件市场验证器无法通过校验的 GitHub 构建来源证明，避免非必需建议项阻塞上架。
- 保留 1.0.3 中全部审核修复：清单描述、弹出窗口兼容性、命令标识、依赖声明、正则表达式和 CSS 规则。

### English

- Removed GitHub build provenance attestations that the current marketplace verifier could not validate, preventing an optional recommendation from blocking publication.
- Preserved all 1.0.3 review fixes for the manifest description, popout compatibility, command naming, dependency declarations, regular expressions, and CSS rules.

## 1.0.3 — 2026-07-17

### 中文

- 修复插件市场审核阻断项：清理清单描述中的冗余产品名称。
- 按审核建议改善弹出窗口兼容性、命令标识、依赖声明、正则表达式和样式规则。
- 为 GitHub Release 构建产物增加来源证明，方便校验发布文件来自本仓库工作流。
- 保留 1.0.2 的悬停强调修复：编辑模式下仅当前最长刻度加深。

### English

- Fixed the marketplace review blocker by removing the redundant product name from the manifest description.
- Improved popout compatibility, command naming, dependency declarations, regular expressions, and CSS rules following review feedback.
- Added build provenance attestations for GitHub Release assets.
- Preserved the 1.0.2 hover emphasis fix so only the centered longest tick is darkened in Editing view.

## 1.0.2 — 2026-07-17

### 中文

- 新增悬停卡片内容选项：仅标题、标题 + 第一段正文、标题 + 本地摘要。
- 悬停卡片区分标题与摘要字体层级，更接近正文预览卡片效果。
- 摘要在本地从当前笔记内容提取，不会发送笔记内容到外部服务。

### English

- Added hover-card content modes: title only, title plus first paragraph, and title plus locally extracted summary.
- Separated title and preview typography in the hover card for a clearer preview-card layout.
- Summaries are extracted locally from the current note and note content is not sent to external services.

## 1.0.1 — 2026-07-17

### 中文

- 新增正文滚动自动同步：使用鼠标滚轮浏览笔记时，当前标题对应的刻度会实时跟随，无需先点击正文。
- 新增正文滚动同步方式选项：默认使用“正文滚动时自动跟随”，也可切换为“光标点击后跟随”。
- 提升编辑模式下的定位准确度：根据正文视口中的真实文档行判断当前标题，并使用逐帧调度保持滚动流畅。
- 保持原有视觉规则：正文滚动只改变当前刻度的颜色深浅，不改变刻度长度；波峰动画仍只在鼠标悬停刻度时出现。
- 设置菜单完成汉化，并提供中文与 English 两种界面语言，可随时切换。

### English

- Added automatic scroll tracking so the active tick follows the current section while the note is scrolled, without requiring a click first.
- Added a content scroll tracking option: “Follow while scrolling” is the default, with “Follow after cursor click” also available.
- Improved Editing view accuracy by resolving the document line at the viewport anchor and throttling updates with animation frames for smooth scrolling.
- Preserved the visual behavior: scrolling changes only the active tick color, while tick length and the wave animation remain hover-only.
- Localized the settings menu and added switchable Chinese and English interfaces.
