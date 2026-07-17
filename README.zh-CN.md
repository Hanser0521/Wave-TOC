# Wave TOC

[English](https://github.com/Hanser0521/Wave-TOC/blob/main/README.md) | [简体中文](https://github.com/Hanser0521/Wave-TOC/blob/main/README.zh-CN.md)

Wave TOC 将当前笔记的标题结构转化为正文旁的紧凑悬浮导航轨道。沿刻度滑动即可预览标题与附近内容，正文滚动时自动跟随当前章节，也可以点击任意标题快速跳转，无需占用侧边栏空间。

它专为长文阅读与编辑设计，在编辑模式和阅读模式下都能准确定位。正文滚动时只通过颜色标记当前章节，鼠标悬停时才呈现流畅的波峰动画，让目录始终清晰而不过度打扰。

![Wave TOC 动态演示](https://raw.githubusercontent.com/Hanser0521/Wave-TOC/main/assets/wave-toc-demo.gif)

## 主要功能

- 在当前笔记正文旁显示 H1–H3 悬浮刻度轨道
- 鼠标悬停时形成流畅的多刻度波峰，并显示标题胶囊
- 可选悬浮卡片内容：仅标题、标题下第一段，或本地提取的章节摘要
- 当前章节仅通过颜色标记，不改变刻度长度
- 可配置导航方式：鼠标滑过时跟随定位，或仅点击后跳转
- 可配置章节跟随方式：随正文滚动自动跟随，或使用光标点击后跟随
- 设置菜单支持中文和英文
- 在编辑模式和阅读模式下均可准确定位标题
- 标题变化后自动更新目录
- 可自定义显示位置、标题层级和轨道高度

## 构建

```bash
npm install
npm run build
```

将 `manifest.json`、`main.js` 和 `styles.css` 复制到：

```text
<仓库>/.obsidian/plugins/wave-toc/
```

随后重新加载 Obsidian，并在“第三方插件”中启用 **Wave TOC**。悬浮卡片内容、导航方式和滚动跟随方式均可在 **设置 → Wave TOC** 中调整，设置界面支持中文和英文。

## 隐私

Wave TOC 完全在 Obsidian 本地运行，不会向外部服务发送笔记内容，不收集遥测数据，不展示广告，也不要求登录账户。

## 致谢

本项目在功能研究阶段参考了 [Next TOC](https://github.com/Raven-Pensieve/obsidian-next-toc) 和 [Floating TOC](https://github.com/PKM-er/obsidian-floating-toc-plugin)。Wave TOC 未包含这些项目的源代码或素材。

Wave TOC 是一个独立项目，与 OpenAI 无附属关系，也未获得 OpenAI 的官方认可或背书。

## 许可证

[MIT](LICENSE) © 2026 Hanser
