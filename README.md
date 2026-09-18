# FABVIEW Gerber 3D

FABVIEW Gerber 3D 是一个面向 PCB 贴片生产资料核对的本地 Web 应用。它在浏览器中解析 Gerber、BOM 和贴片坐标文件，将 PCB、焊盘及元件封装组合成可交互的 3D 视图，并使用企业物料库补全 BOM 编码和名称。

项目当前用于验证类似 SMT 下单前“元件选型确认”的工作流。所有导入文件均在浏览器本地处理，不会自动上传到服务器。

## 主要功能

- 导入单个或多个 Gerber/Excellon 文件，也可直接导入包含生产文件的 ZIP。
- 识别 KiCad、Altium、Eagle 的常见文件名和 Gerber X2 `FileFunction` 图层信息。
- 兼容 Altium 旧式后缀，包括 `GTL`、`GBL`、`GTS`、`GBS`、`GTO`、`GBO`、`GKO`、`GMn`、`GDn`、`GGn`、`GPT`、`GPB` 和 Excellon `.TXT`。
- 显示板框、基材、顶底铜层、阻焊、丝印、钻孔和网格，并支持等轴、顶层、底层视图。
- 导入 XLSX/XLS/CSV/TSV 格式的 BOM 与贴片坐标文件，自动识别中英文列名。
- 根据位号自动对齐 BOM、贴片坐标和 PCB 板框，支持顶层、底层及旋转角度。
- 导入企业元件库，使用“规格 + 封装”匹配 BOM，自动补全编码和物料名称。
- 无唯一匹配结果的 BOM 行自动进入“待处理元件”，可人工恢复或替换。
- BOM 支持确认勾选、行删除/恢复、列宽拖拽，以及物料名称和规格双击编辑。
- BOM 行可定位并高亮 3D 元件；点击 3D 元件也会自动高亮并滚动到对应 BOM 行。
- 自动匹配本地 3D 封装，支持 STEP/STP 和 GLB；STEP 模型可保留原始零件颜色。
- 只有已通过数据库匹配且存在 3D 封装的电子元件才会显示在 PCB 上。
- 元件库页面支持字段导航、搜索、3D 封装状态检查和手动模型导入。

## 技术栈

- React 19 + TypeScript
- Vite 7
- Three.js
- `web-gerber`：Gerber 图形解析与渲染
- `occt-import-js`：浏览器端 STEP/STP 解析
- SheetJS：BOM、坐标和元件库表格解析
- JSZip：ZIP 生产资料读取

## 环境要求

- Node.js 20.19 或更高版本
- npm 10 或更高版本
- 支持 WebGL 2 的现代浏览器
- 可选：FreeCAD 1.0，用于批量将 STEP 模型转换为 GLB

## 本地运行

安装依赖：

```powershell
npm install
```

启动开发服务器：

```powershell
npm run dev
```

Vite 默认地址为 `http://127.0.0.1:5173/`。生产构建与本地预览：

```powershell
npm run build
npm run preview
```

预览服务默认地址为 `http://127.0.0.1:4173/`。

## 推荐使用流程

1. 点击“元件库导入”，导入企业物料数据库。
2. 导入 Gerber 文件或生产资料 ZIP。
3. 导入 BOM 文件。
4. 导入贴片坐标文件。
5. 检查“核对元件”和“待处理元件”两个表格。
6. 在 BOM 表格与 PCB 3D 视图之间点击定位，确认封装、位号、板面和方向。
7. 对未匹配物料补充数据库记录或手动绑定 3D 模型。

重新导入 BOM 或元件库时，程序会重新执行数据库匹配。匹配要求规格字段和封装字段同时成立；候选结果不唯一时不会自动采用，以免错误绑定物料编码。

## 支持的输入

| 数据 | 格式 | 关键字段 |
| --- | --- | --- |
| Gerber/钻孔 | Gerber、Excellon、ZIP | 图层类型、板框、单位 |
| BOM | XLSX、XLS、CSV、TSV | 位号、规格/参数、封装、数量 |
| 贴片坐标 | XLSX、XLS、CSV、TSV、TXT、POS | 位号、X、Y、角度、板面 |
| 元件库 | XLSX、XLS、CSV、TSV | 编码、物料名称、规格、状态 |
| 手动 3D 模型 | STEP、STP、GLB | 与目标物料人工绑定 |

坐标解析支持毫米、mil 和英寸。无法识别板框时，程序会使用全部生产图层的外接矩形作为临时板体并显示提示。

## BOM 与元件库匹配

程序会规范化大小写、空格、常见单位写法和封装别名，再对规格及封装进行联合匹配。电阻、电容和电感还会结合位号前缀及物料名称中第一个 `|` 后的封装字段进行判断。

- 标记为 `【停售】` 或禁用的数据库物料不会参与自动匹配。
- 只有唯一的最高分候选项才会自动绑定。
- 匹配成功后，BOM 会写入数据库中的编码和物料名称。
- 匹配失败或结果有歧义时，该行进入“待处理元件”。
- 3D 展示只使用已匹配 BOM 行中的位号。

## 3D 封装库

项目内的 [`footprint`](./footprint) 目录是版本管理中的模型源库，按 `passive`、`semiconductor`、`connector`、`electromechanical`、`opto` 和 `mechanical` 分类。详细命名、坐标原点和方向规范见 [`footprint/README.md`](./footprint/README.md)。

网页模型索引以 `.glb` 文件为入口。推荐同时保留同名 STEP/STP 和 GLB：

```text
footprint/passive/resistor/R_0603_L.step
footprint/passive/resistor/R_0603_L.glb
```

当同名 STEP 与 GLB 同时存在时，程序优先解析 STEP，以保留模型中的原始颜色；GLB 用于建立构建时模型索引。新增模型后需要重启开发服务器或重新构建。

从本机 KiCad 10 模型库同步当前清单中的标准模型：

```powershell
& .\scripts\sync-kicad-footprints.ps1
```

使用 FreeCAD 批量转换 STEP 为 GLB：

```powershell
npm run models:convert
```

转换脚本默认寻找 `D:\Program Files\FreeCAD 1.0\bin\freecadcmd.exe`。其他安装位置可直接调用脚本并传入参数：

```powershell
& .\scripts\convert-step-models.ps1 -FreeCadCmd "C:\Program Files\FreeCAD 1.0\bin\freecadcmd.exe"
```

## 项目结构

```text
gerber-3d-viewer/
├─ footprint/                 3D 封装源库及匹配清单
├─ scripts/                   KiCad 模型同步和 STEP 转换脚本
├─ src/
│  ├─ App.tsx                页面、导入流程和 BOM 交互
│  ├─ PcbViewer.tsx          Three.js PCB/元件 3D 渲染与拾取
│  ├─ gerber.ts              Gerber/Excellon 读取及图层识别
│  ├─ assembly-data.ts       BOM、坐标和元件库表格解析
│  ├─ placement-alignment.ts 坐标与 PCB 板框对齐
│  ├─ component-library-matching.ts 物料数据库匹配
│  ├─ footprint-library.ts   3D 封装索引与匹配
│  └─ step-model.ts          STEP 模型解析及材质转换
├─ package.json
└─ vite.config.ts
```

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 执行 TypeScript 检查并生成生产构建 |
| `npm run preview` | 预览生产构建 |
| `npm run models:convert` | 使用 FreeCAD 将模型清单中的 STEP 转为 GLB |

## Git 工作方式

仓库默认分支为 `main`。建议每个完整功能或修复使用一次提交：

```powershell
git status
git add src README.md
git commit -m "feat: describe the change"
```

`node_modules`、`dist`、本地环境变量和日志文件不会进入版本库。`footprint` 中的 STEP/GLB 模型会随源码提交，修改模型库前请注意仓库体积。

## 当前限制

- 3D 钻孔目前使用深色几何模拟，未对板体执行布尔减孔。
- 复杂负片、特殊光圈宏和刚挠结合板仍需更多生产文件验证。
- 数据库与手动 3D 模型绑定目前仅保存在当前浏览器会话中，刷新页面后需要重新导入。
- 模型贴装原点、单位或 0° 方向不符合规范时，仍需修正源模型。
