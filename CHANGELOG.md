# Changelog

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
