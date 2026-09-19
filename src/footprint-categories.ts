/**
 * 3D 封装分类表（单一数据源）
 *
 * `footprint/3dmodels` 下的目录命名已固定为 `<中文大类>_<细分>.3dshapes`，
 * 因此这里把 105 个目录显式登记到 6 个大类，供封装选择器与模型浏览器共用。
 *
 * 目录名即稳定契约：新增目录若未登记，会回落到「其他」大类，
 * 并沿用去掉 `.3dshapes` 后缀后的目录名，不会抛错。
 */

export interface FootprintCategoryGroupDefinition {
  key: string
  label: string
  hint: string
}

export const footprintCategoryGroups: readonly FootprintCategoryGroupDefinition[] = [
  { key: 'passive', label: '无源元件', hint: '电阻 · 电容 · 电感 · 磁性 · 保护' },
  { key: 'semiconductor', label: '半导体与光电', hint: '芯片封装 · 二极管 · 晶体管 · LED' },
  { key: 'connector', label: '连接器与端子', hint: '连接器 · 排针排母 · 接线端子' },
  { key: 'electromechanical', label: '机电与电源', hint: '开关 · 继电器 · 蜂鸣器 · 电池 · 电源' },
  { key: 'sensor', label: '传感器与射频', hint: '传感器 · 射频 · 显示 · 模块' },
  { key: 'mechanical', label: '结构与安装件', hint: '散热器 · 安装件 · 标识 · 测试点' },
] as const

/** 未登记目录的兜底大类，始终排在最后。 */
export const footprintFallbackGroup: FootprintCategoryGroupDefinition = {
  key: 'other',
  label: '其他',
  hint: '未登记的分类目录',
}

export const footprintModelRoot = '/footprint/3dmodels'
export const footprintCategoryFolderSuffix = '.3dshapes'

interface FolderCategory {
  group: string
  label: string
}

const folderCategories: Record<string, FolderCategory> = {
  // 无源元件
  '电阻_贴片.3dshapes': { group: 'passive', label: '贴片电阻' },
  '电阻_通孔.3dshapes': { group: 'passive', label: '通孔电阻' },
  '电容_贴片.3dshapes': { group: 'passive', label: '贴片电容' },
  '电容_通孔.3dshapes': { group: 'passive', label: '通孔电容' },
  '钽电容_贴片.3dshapes': { group: 'passive', label: '贴片钽电容' },
  '电感_贴片.3dshapes': { group: 'passive', label: '贴片电感' },
  '电感_贴片_伍尔特Wuerth.3dshapes': { group: 'passive', label: '贴片电感 · 伍尔特' },
  '电感_通孔.3dshapes': { group: 'passive', label: '通孔电感' },
  '电感_通孔_伍尔特Wuerth.3dshapes': { group: 'passive', label: '通孔电感 · 伍尔特' },
  '压敏电阻.3dshapes': { group: 'passive', label: '压敏电阻' },
  '铁氧体磁芯_通孔.3dshapes': { group: 'passive', label: '通孔铁氧体磁芯' },
  '保险丝.3dshapes': { group: 'passive', label: '保险丝' },
  '晶体与谐振器.3dshapes': { group: 'passive', label: '晶体与谐振器' },
  '振荡器.3dshapes': { group: 'passive', label: '振荡器' },
  '滤波器.3dshapes': { group: 'passive', label: '滤波器' },
  '变压器_贴片.3dshapes': { group: 'passive', label: '贴片变压器' },
  '变压器_通孔.3dshapes': { group: 'passive', label: '通孔变压器' },
  '电位器_贴片.3dshapes': { group: 'passive', label: '贴片电位器' },
  '电位器_通孔.3dshapes': { group: 'passive', label: '通孔电位器' },

  // 半导体与光电
  '芯片封装_BGA.3dshapes': { group: 'semiconductor', label: '封装 BGA' },
  '芯片封装_CSP.3dshapes': { group: 'semiconductor', label: '封装 CSP' },
  '芯片封装_DFN-QFN.3dshapes': { group: 'semiconductor', label: '封装 DFN / QFN' },
  '芯片封装_DIP.3dshapes': { group: 'semiconductor', label: '封装 DIP' },
  '芯片封装_DirectFET.3dshapes': { group: 'semiconductor', label: '封装 DirectFET' },
  '芯片封装_LCC.3dshapes': { group: 'semiconductor', label: '封装 LCC' },
  '芯片封装_LGA.3dshapes': { group: 'semiconductor', label: '封装 LGA' },
  '芯片封装_QFP.3dshapes': { group: 'semiconductor', label: '封装 QFP' },
  '芯片封装_SIP.3dshapes': { group: 'semiconductor', label: '封装 SIP' },
  '芯片封装_SO.3dshapes': { group: 'semiconductor', label: '封装 SO' },
  '芯片封装_SON.3dshapes': { group: 'semiconductor', label: '封装 SON' },
  '芯片封装_TO-SOT_贴片.3dshapes': { group: 'semiconductor', label: '封装 TO / SOT · 贴片' },
  '芯片封装_TO-SOT_通孔.3dshapes': { group: 'semiconductor', label: '封装 TO / SOT · 通孔' },
  '二极管_贴片.3dshapes': { group: 'semiconductor', label: '贴片二极管' },
  '二极管_通孔.3dshapes': { group: 'semiconductor', label: '通孔二极管' },
  '晶体管_功率模块.3dshapes': { group: 'semiconductor', label: '功率模块' },
  'LED_贴片.3dshapes': { group: 'semiconductor', label: '贴片 LED' },
  'LED_通孔.3dshapes': { group: 'semiconductor', label: '通孔 LED' },
  '光电器件.3dshapes': { group: 'semiconductor', label: '光电器件' },
  '电子管.3dshapes': { group: 'semiconductor', label: '电子管' },

  // 连接器与端子
  '连接器_通用.3dshapes': { group: 'connector', label: '连接器 · 通用' },
  '连接器_插针.3dshapes': { group: 'connector', label: '连接器 · 插针' },
  '连接器_USB.3dshapes': { group: 'connector', label: '连接器 · USB' },
  '连接器_D-Sub.3dshapes': { group: 'connector', label: '连接器 · D-Sub' },
  '连接器_DC圆孔电源.3dshapes': { group: 'connector', label: '连接器 · DC 电源座' },
  '连接器_DIN.3dshapes': { group: 'connector', label: '连接器 · DIN' },
  '连接器_FFC-FPC.3dshapes': { group: 'connector', label: '连接器 · FFC / FPC' },
  '连接器_IDC.3dshapes': { group: 'connector', label: '连接器 · IDC' },
  '连接器_JST.3dshapes': { group: 'connector', label: '连接器 · JST' },
  '连接器_RJ.3dshapes': { group: 'connector', label: '连接器 · RJ 网口' },
  '连接器_SATA-SAS.3dshapes': { group: 'connector', label: '连接器 · SATA / SAS' },
  '连接器_卡座.3dshapes': { group: 'connector', label: '连接器 · 卡座' },
  '连接器_同轴射频.3dshapes': { group: 'connector', label: '连接器 · 同轴射频' },
  '连接器_视频.3dshapes': { group: 'connector', label: '连接器 · 视频' },
  '连接器_音频.3dshapes': { group: 'connector', label: '连接器 · 音频' },
  '连接器_伍尔特Wuerth.3dshapes': { group: 'connector', label: '连接器 · 伍尔特' },
  '连接器_斯托科Stocko.3dshapes': { group: 'connector', label: '连接器 · 斯托科' },
  '连接器_泰科TE.3dshapes': { group: 'connector', label: '连接器 · 泰科 TE' },
  '连接器_申泰Samtec.3dshapes': { group: 'connector', label: '连接器 · 申泰 Samtec' },
  '连接器_申泰Samtec_HPM通孔.3dshapes': { group: 'connector', label: '连接器 · 申泰 HPM' },
  '连接器_艾迈斯AMASS.3dshapes': { group: 'connector', label: '连接器 · 艾迈斯 AMASS' },
  '连接器_莫仕Molex.3dshapes': { group: 'connector', label: '连接器 · 莫仕 Molex' },
  '连接器_菲尼克斯_MC.3dshapes': { group: 'connector', label: '连接器 · 菲尼克斯 MC' },
  '连接器_菲尼克斯_MC高压.3dshapes': { group: 'connector', label: '连接器 · 菲尼克斯 MC 高压' },
  '连接器_菲尼克斯_MSTB.3dshapes': { group: 'connector', label: '连接器 · 菲尼克斯 MSTB' },
  '连接器_菲尼克斯_GMSTB.3dshapes': { group: 'connector', label: '连接器 · 菲尼克斯 GMSTB' },
  '连接器_菲尼克斯_SPT.3dshapes': { group: 'connector', label: '连接器 · 菲尼克斯 SPT' },
  '排针_1.00mm.3dshapes': { group: 'connector', label: '排针 1.00mm' },
  '排针_1.27mm.3dshapes': { group: 'connector', label: '排针 1.27mm' },
  '排针_2.00mm.3dshapes': { group: 'connector', label: '排针 2.00mm' },
  '排针_2.54mm.3dshapes': { group: 'connector', label: '排针 2.54mm' },
  '排母_1.00mm.3dshapes': { group: 'connector', label: '排母 1.00mm' },
  '排母_1.27mm.3dshapes': { group: 'connector', label: '排母 1.27mm' },
  '排母_2.00mm.3dshapes': { group: 'connector', label: '排母 2.00mm' },
  '排母_2.54mm.3dshapes': { group: 'connector', label: '排母 2.54mm' },
  '接线端子_Altech.3dshapes': { group: 'connector', label: '端子 · Altech' },
  '接线端子_伍尔特Wuerth.3dshapes': { group: 'connector', label: '端子 · 伍尔特' },
  '接线端子_宁波Kagnex.3dshapes': { group: 'connector', label: '端子 · 宁波 Kagnex' },
  '接线端子_菲尼克斯.3dshapes': { group: 'connector', label: '端子 · 菲尼克斯' },

  // 机电与电源
  '按键开关_贴片.3dshapes': { group: 'electromechanical', label: '贴片按键开关' },
  '按键开关_通孔.3dshapes': { group: 'electromechanical', label: '通孔按键开关' },
  '继电器_贴片.3dshapes': { group: 'electromechanical', label: '贴片继电器' },
  '继电器_通孔.3dshapes': { group: 'electromechanical', label: '通孔继电器' },
  '蜂鸣器.3dshapes': { group: 'electromechanical', label: '蜂鸣器' },
  '电池.3dshapes': { group: 'electromechanical', label: '电池' },
  '电源转换器_AC-DC.3dshapes': { group: 'electromechanical', label: 'AC-DC 电源' },
  '电源转换器_DC-DC.3dshapes': { group: 'electromechanical', label: 'DC-DC 电源' },

  // 传感器与射频
  '传感器_通用.3dshapes': { group: 'sensor', label: '传感器 · 通用' },
  '传感器_压力.3dshapes': { group: 'sensor', label: '传感器 · 压力' },
  '传感器_湿度.3dshapes': { group: 'sensor', label: '传感器 · 湿度' },
  '传感器_电压.3dshapes': { group: 'sensor', label: '传感器 · 电压' },
  '传感器_电流.3dshapes': { group: 'sensor', label: '传感器 · 电流' },
  '传感器_距离.3dshapes': { group: 'sensor', label: '传感器 · 距离' },
  '传感器_音频.3dshapes': { group: 'sensor', label: '传感器 · 音频' },
  '射频_天线.3dshapes': { group: 'sensor', label: '射频 · 天线' },
  '射频_模块.3dshapes': { group: 'sensor', label: '射频 · 模块' },
  '射频_GSM.3dshapes': { group: 'sensor', label: '射频 · GSM' },
  '射频_转换器.3dshapes': { group: 'sensor', label: '射频 · 转换器' },
  '模块.3dshapes': { group: 'sensor', label: '功能模块' },
  '显示器件_通用.3dshapes': { group: 'sensor', label: '显示器件' },
  '数码管_七段.3dshapes': { group: 'sensor', label: '七段数码管' },

  // 结构与安装件
  '散热器.3dshapes': { group: 'mechanical', label: '散热器' },
  '安装件_通用.3dshapes': { group: 'mechanical', label: '安装件 · 通用' },
  '安装件_伍尔特Wuerth.3dshapes': { group: 'mechanical', label: '安装件 · 伍尔特' },
  '标识符号.3dshapes': { group: 'mechanical', label: '标识符号' },
  '测试点.3dshapes': { group: 'mechanical', label: '测试点' },
}

export interface FootprintCategoryInfo {
  /** 稳定的分类键，即模型所在目录名；未分类时为 `uncategorized`。 */
  key: string
  /** 原始目录名，可用于写回文件系统；未分类时为空串。 */
  folder: string
  /** 面向用户的细分中文名。 */
  label: string
  groupKey: string
  groupLabel: string
}

export const uncategorizedFootprintCategory: FootprintCategoryInfo = {
  key: 'uncategorized',
  folder: '',
  label: '未分类',
  groupKey: footprintFallbackGroup.key,
  groupLabel: footprintFallbackGroup.label,
}

const groupByKey = new Map<string, FootprintCategoryGroupDefinition>(
  [...footprintCategoryGroups, footprintFallbackGroup].map((group) => [group.key, group]),
)

function fallbackLabel(folder: string): string {
  const stripped = folder.replace(/\.3dshapes$/i, '')
  return stripped || folder
}

/**
 * 从模型的 `sourcePath` 解析分类，例如
 * `/footprint/3dmodels/电容_贴片.3dshapes/C_0603_L.step` → 无源元件 / 贴片电容。
 */
export function footprintCategoryOf(sourcePath: string): FootprintCategoryInfo {
  const segments = sourcePath.replace(/\\/g, '/').split('/').filter(Boolean)
  const folder = segments.length >= 2 ? segments[segments.length - 2] : ''
  if (!folder) return uncategorizedFootprintCategory

  const registered = folderCategories[folder]
  const groupKey = registered?.group ?? footprintFallbackGroup.key
  const group = groupByKey.get(groupKey) ?? footprintFallbackGroup
  return {
    key: folder,
    folder,
    label: registered?.label ?? fallbackLabel(folder),
    groupKey: group.key,
    groupLabel: group.label,
  }
}

export interface FootprintCategorySummary {
  key: string
  label: string
  folder: string
  count: number
}

export interface FootprintCategoryGroupSummary extends FootprintCategoryGroupDefinition {
  count: number
  categories: FootprintCategorySummary[]
}

/**
 * 按 `sourcePath` 列表统计分类并归入大类，用于选择器的分类导航。
 * 大类顺序固定，`其他` 兜底大类仅在存在未登记目录时出现。
 */
export function summarizeFootprintCategories(sourcePaths: Iterable<string>): FootprintCategoryGroupSummary[] {
  const counts = new Map<string, { info: FootprintCategoryInfo; count: number }>()
  for (const sourcePath of sourcePaths) {
    const info = footprintCategoryOf(sourcePath)
    const existing = counts.get(info.key)
    if (existing) existing.count += 1
    else counts.set(info.key, { info, count: 1 })
  }

  const buckets = new Map<string, FootprintCategoryGroupSummary>()
  const order = [...footprintCategoryGroups, footprintFallbackGroup]
  counts.forEach(({ info, count }, key) => {
    const bucketKey = info.groupKey
    let bucket = buckets.get(bucketKey)
    if (!bucket) {
      const definition = groupByKey.get(bucketKey) ?? footprintFallbackGroup
      bucket = { ...definition, count: 0, categories: [] }
      buckets.set(bucketKey, bucket)
    }
    bucket.count += count
    bucket.categories.push({ key, label: info.label, folder: info.folder, count })
  })

  buckets.forEach((bucket) => {
    bucket.categories.sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
  })

  return order
    .map((group) => buckets.get(group.key))
    .filter((bucket): bucket is FootprintCategoryGroupSummary => Boolean(bucket && bucket.categories.length > 0))
}

/** 供选择器使用的大类图标键，未登记大类回落到 `other`。 */
export function footprintCategoryGroupIconKey(groupKey: string): string {
  return groupByKey.has(groupKey) ? groupKey : footprintFallbackGroup.key
}
