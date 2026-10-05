# MRI 对比查看器 — 快速启动

## 启动开发服务器

```bash
cd "/Users/twj/Documents/Obsidian Vault/项目/mri-compare-viewer"
npm run dev
```

启动成功后终端显示 `http://localhost:5173`，浏览器打开即可。

## 关闭开发服务器

在运行 `npm run dev` 的终端中按 `Ctrl+C`，或另开终端执行：

```bash
lsof -tiTCP:5173 | xargs kill
```

## 功能说明

- 鼠标悬停在**图像区域（黑色画面）**上时，上下滚动切换层（多面板同步模式下所有面板同步切换）。
- 鼠标在图像区域**以外**（面板之间的空隙、行与行之间的空白处）时，上下滚动为页面整体滚动。
- 按住 `Shift` 滚轮可大步跳过切片。
- 添加 2 个以上序列时，面板会分行显示，行与行之间的空白区域可以滚动页面。
