# 3D 封装命名规则

## 文件名

1. 使用 BOM 的“封装”字段作为文件名，不使用位号或元件参数。
2. 文件格式统一使用自包含的 `.glb`。
3. 空格可改为下划线；Windows 文件名不支持的字符可删除或改为下划线。
4. 匹配时忽略大小写、空格、下划线、横线和标点。
5. 保留封装中的尺寸、引脚数及方向后缀，例如 `4x4`、`24`、`L`、`N`、`EP`。
6. 不在文件名后附加版本号、颜色或厂商备注。确实属于不同外形时，应在 BOM 封装名中区分。
7. 可以按 `passive`、`ic`、`connector`、`mechanical` 建立子目录，匹配时只读取文件名。
8. `.step` 或 `.stp` 可作为源模型保留，但网页实际加载需要同名的 `.glb`。

例如：

- BOM `C 0603_L` 对应 `C_0603_L.glb`
- BOM `QFN24 4x4_N` 对应 `QFN24_4x4_N.glb`
- BOM `DFN-8-3*3-EP` 对应 `DFN-8-3_3-EP.glb`
- BOM `CM D(6.3*5.4)` 对应 `CM_D_6.3_5.4.glb`

## 模型坐标

- 模型保持真实尺寸，推荐按 glTF 标准使用米作为单位；加载时程序统一换算为毫米。
- 原点 `(0, 0, 0)` 应为封装的贴装原点。
- `Z=0` 应为元件与 PCB 接触的贴装平面，元件本体位于 `+Z`。
- 顶视图中 `+X` 向右、`+Y` 向上，模型的 `0°` 必须与 Altium 封装的 `0°` 一致。
- IC、二极管、电解电容等有方向器件必须保留 1 脚或极性标记。
- 顶层和底层共用同一个模型，程序根据坐标文件自动处理板面和旋转。

## 当前 HexaCharger BOM

### 电阻、电容、保险丝和 LED

- `C_0402_L.glb`
- `C_0603_L.glb`
- `C_0805_L.glb`
- `C_1206_L.glb`
- `R_0402_L.glb`
- `R_0805_L.glb`
- `R_1206_L.glb`
- `R_2512_L.glb`
- `FU_1206.glb`
- `LED_0402G.glb`
- `LED_0402R.glb`
- `CM_D_6.3_5.4.glb`

### IC、晶体管和二极管

- `DFN-8-3_3-EP.glb`
- `LQFP64_N.glb`
- `QFN20_3x3_EP.glb`
- `QFN24_4x4_N.glb`
- `QFN32_4X4.glb`
- `SC70-6.glb`
- `SO-08.glb`
- `SOD-123F.glb`
- `SOD-923.glb`
- `SOT-723.glb`
- `SOT23-3L.glb`
- `SOT23-3N.glb`
- `SOT23-5L.glb`
- `SOT23-6.glb`

### 电感、晶振、蜂鸣器和开关

- `FXL0530-L.glb`
- `HC0420.glb`
- `SMD_13x13.glb`
- `OSC_3225-4P.glb`
- `MLT-8530.glb`
- `TSW_SMD-6_6_4.3.glb`

### 接插件和结构件

- `BT2.0-M.glb`
- `FPC0.5_2H-WS-12P.glb`
- `GCT-USB4105-XX-A_V.glb`
- `HDR1.27-LI-4P.glb`
- `JST-SM02B-SRSS-TB_V.glb`
- `PH2.0-LI-2P_1.6mm.glb`
- `M2_4.0x6.0_2.5x1.2.glb`

`ICO1` 是 Logo，`TEST 0.8` 是测试点，通常不需要实体 3D 模型。

添加模型后需重启开发服务器或重新构建，使 Vite 重新生成模型索引。

## 从 KiCad 10 同步

项目使用 `scripts/sync-kicad-footprints.ps1` 从本机 KiCad 模型库复制当前 BOM 所需的标准 STEP，并生成 `library-manifest.json`。脚本不会删除已有模型。

```powershell
& .\scripts\sync-kicad-footprints.ps1
```

生成的清单会区分：

- `exact`：封装系列和主要尺寸一致。
- `user`：优先采用用户提供的模型。
- `compatible`：外形接近，正式生产前需要确认尺寸和贴装原点。
- `manual-needed`：没有可靠的 KiCad 模型，不会自动使用替代品。

## 转换为网页模型

同步 STEP 后运行以下命令，使用本机 FreeCAD 将清单中的模型批量转换为同名 GLB：

```powershell
npm run models:convert
```

转换器只更新比 STEP 旧的 GLB；需要全部重建时运行：

```powershell
& .\scripts\convert-step-models.ps1 -Force
```

网页会按 BOM 的封装字段自动查找同名 GLB，并根据坐标文件中的位号、板面和旋转角度放置模型。未找到模型或加载失败的元件继续显示尺寸占位块。
