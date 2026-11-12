# Wave TOC

[English](https://github.com/Hanser0521/Wave-TOC/blob/main/README.md) | [简体中文](https://github.com/Hanser0521/Wave-TOC/blob/main/README.zh-CN.md)

Wave TOC 将当前笔记的标题结构转化为正文旁的紧凑悬浮导航轨道。沿刻度滑动即可预览标题与附近内容，正文滚动时自动跟随当前章节，也可以点击任意标题快速跳转，无需占用侧边栏空间。

它专为长文阅读与编辑设计，在编辑模式和阅读模式下都能准确定位。正文滚动时只通过颜色标记当前章节，鼠标悬停时才呈现流畅的波峰动画，让目录始终清晰而不过度打扰。

需要 Obsidian 1.13.0 或更高版本。

![Wave TOC 动态演示](https://raw.githubusercontent.com/Hanser0521/Wave-TOC/main/assets/wave-toc-demo.gif)

## 主要功能

- 在当前笔记正文旁显示 H1–H3 悬浮刻度轨道
- 鼠标悬停时形成流畅的多刻度波峰，并显示标题胶囊
- 高亮颜色默认跟随主题，也可自定义，并在相邻刻度间呈现渐变
- 可选悬浮卡片内容：仅标题、标题下第一段，或本地提取的章节摘要
- 当前章节仅通过颜色标记，不改变刻度长度
- 可配置导航方式：鼠标滑过时跟随定位，或仅点击后跳转
- 编辑模式下悬停只滚动正文，保留光标和选区
- 无需预先悬停，直接点击或点按刻度即可跳转
- 长目录可以在轨道内滚动；悬停预览按需生成
- 编辑模式可选滚动或光标跟随；阅读模式始终随滚动更新
- 支持本地搜索标题，显示层级和行号，便于区分同名标题
- 设置菜单支持中文和英文
- 所有设置均可通过 Obsidian 原生设置搜索检索
- 为 Obsidian 1.14 设置项提供稳定标识，设置重命名或重新排序后仍能被可靠检索
- 编辑模式和阅读模式均按源文件行准确定位，兼容虚拟渲染的长文
- Obsidian 1.14 打开仓库外 Markdown 文件时，也能通过本地标题解析显示目录
- 动画与事件跟随笔记所属窗口，兼容弹出窗口中的笔记
- 标题变化后自动更新目录
- 悬停卡片跟随系统偏好字号，适配移动端和辅助功能大字号
- 可自定义显示位置、跟随 RTL 界面方向自动放置、标题层级和轨道高度

## 跳转到标题

在命令面板运行 **Wave TOC: 跳转到标题**，也可在 **设置 → 快捷键** 为它绑定按键。输入关键词筛选当前笔记的标题，用上下方向键和回车定位，或直接选择结果。触屏上和目录超出轨道高度时，轨道下方的列表按钮也能打开同一入口。

## 构建

```bash
npm install
npm run build
```

将 `manifest.json`、`main.js` 和 `styles.css` 复制到：

```text
<仓库>/.obsidian/plugins/wave-toc/
```

随后重新加载 Obsidian，并在“第三方插件”中启用 **Wave TOC**。高亮颜色、悬浮卡片内容、导航方式和滚动跟随方式均可在 **设置 → Wave TOC** 中调整，设置界面支持中文和英文。

## 隐私

Wave TOC 完全在 Obsidian 本地运行，不会向外部服务发送笔记内容，不收集遥测数据，不展示广告，也不要求登录账户。

## 致谢

本项目在功能研究阶段参考了 [Next TOC](https://github.com/Raven-Pensieve/obsidian-next-toc) 和 [Floating TOC](https://github.com/PKM-er/obsidian-floating-toc-plugin)。Wave TOC 未包含这些项目的源代码或素材。

Wave TOC 是一个独立项目，与 OpenAI 无附属关系，也未获得 OpenAI 的官方认可或背书。

## 许可证

[MIT](LICENSE) © 2026 Hanser
