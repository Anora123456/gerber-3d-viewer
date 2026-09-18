import JSZip from 'jszip'
import {
  identifyLayers,
  parse,
  plot,
  type GerberSide,
  type GerberType,
  type ImageTree,
} from 'web-gerber'

export interface SourceFile {
  name: string
  content: string
  size: number
}

export type LayerType = GerberType | 'unknown'
export type LayerRole =
  | 'standard'
  | 'profile'
  | 'keepout'
  | 'mechanical'
  | 'drill-drawing'
  | 'drill-guide'
  | 'pad-master'
  | 'panel'
  | 'auxiliary'
  | 'unknown'

export interface ParsedLayer {
  id: string
  name: string
  type: LayerType
  side?: GerberSide
  role: LayerRole
  roleName: string
  profilePriority: number
  image: ImageTree
  boundsMm: [number, number, number, number] | null
  unitScale: number
}

export interface ParseIssue {
  file?: string
  message: string
  level: 'warning' | 'error'
}

export interface ParsedBoard {
  name: string
  layers: ParsedLayer[]
  sources: SourceFile[]
  boundsMm: [number, number, number, number]
  widthMm: number
  heightMm: number
  hasOutline: boolean
  profileLayerId?: string
  profileCandidates: string[]
  issues: ParseIssue[]
}

const MAX_FILE_COUNT = 80
const MAX_SINGLE_FILE_BYTES = 24 * 1024 * 1024
const MAX_TOTAL_BYTES = 120 * 1024 * 1024

const knownExtensions = /\.(?:gbr|ger|pho|art|gtl|gbl|gts|gbs|gto|gbo|gtp|gbp|gpt|gpb|gko|gm\d+|gd\d+|gg\d+|gp\d+|g\d+|p\d+|drl|xln|exc)$/i

function isLikelyGerber(name: string, content: string): boolean {
  if (knownExtensions.test(name)) return true
  return /%FS[LTD]|%MO(?:MM|IN)|%TF\.FileFunction|(?:^|\r?\n)M48(?:\r?\n|$)/m.test(content)
}

interface DetectedIdentity {
  type: LayerType
  side?: GerberSide
  role: LayerRole
  roleName: string
  profilePriority: number
}

function standardRoleName(type: LayerType): string {
  switch (type) {
    case 'copper': return '铜层'
    case 'soldermask': return '阻焊'
    case 'silkscreen': return '丝印'
    case 'solderpaste': return '锡膏'
    case 'drill': return '钻孔'
    case 'outline': return '板框'
    case 'drawing': return '辅助图'
    default: return '未识别'
  }
}

function inferContentIdentity(content: string): DetectedIdentity | null {
  if (/(?:^|\r?\n)M48(?:\r?\n|$)/m.test(content)) {
    return { type: 'drill', side: 'all', role: 'standard', roleName: 'NC 钻孔', profilePriority: 0 }
  }

  const fileFunction = content.match(/%TF\.FileFunction,([^*]+)\*%/i)?.[1] ?? ''
  if (!fileFunction) return null
  if (/Profile/i.test(fileFunction)) {
    return { type: 'outline', side: 'all', role: 'profile', roleName: 'X2 板框', profilePriority: 100 }
  }
  if (/Copper/i.test(fileFunction)) {
    const side = /(?:Bot|Bottom)/i.test(fileFunction) ? 'bottom' : /Top/i.test(fileFunction) ? 'top' : 'inner'
    return { type: 'copper', side, role: 'standard', roleName: '铜层', profilePriority: 0 }
  }
  if (/Soldermask/i.test(fileFunction)) {
    return {
      type: 'soldermask',
      side: /Bot/i.test(fileFunction) ? 'bottom' : 'top',
      role: 'standard',
      roleName: '阻焊',
      profilePriority: 0,
    }
  }
  if (/(?:Legend|Silkscreen)/i.test(fileFunction)) {
    return {
      type: 'silkscreen',
      side: /Bot/i.test(fileFunction) ? 'bottom' : 'top',
      role: 'standard',
      roleName: '丝印',
      profilePriority: 0,
    }
  }
  if (/Paste/i.test(fileFunction)) {
    return {
      type: 'solderpaste',
      side: /Bot/i.test(fileFunction) ? 'bottom' : 'top',
      role: 'standard',
      roleName: '锡膏',
      profilePriority: 0,
    }
  }
  return null
}

export function classifyLayer(
  name: string,
  content: string,
  libraryIdentity?: { type?: GerberType; side?: GerberSide },
): DetectedIdentity {
  const contentIdentity = inferContentIdentity(content)
  if (contentIdentity) return contentIdentity

  const extension = name.match(/(\.[^.]+)$/)?.[1].toLowerCase() ?? ''
  let match: RegExpMatchArray | null

  if ((match = extension.match(/^\.gd(\d+)$/))) {
    return { type: 'drawing', side: 'all', role: 'drill-drawing', roleName: `钻孔图 ${match[1]}`, profilePriority: 0 }
  }
  if ((match = extension.match(/^\.gg(\d+)$/))) {
    return { type: 'drawing', side: 'all', role: 'drill-guide', roleName: `钻孔导引 ${match[1]}`, profilePriority: 0 }
  }
  if (extension === '.gpt' || extension === '.gpb') {
    const side = extension === '.gpt' ? 'top' : 'bottom'
    return { type: 'drawing', side, role: 'pad-master', roleName: '焊盘母版', profilePriority: 0 }
  }
  if (extension === '.gko') {
    return { type: 'outline', side: 'all', role: 'keepout', roleName: '禁止布线层 / 板框', profilePriority: 80 }
  }
  if ((match = extension.match(/^\.gm(\d+)$/))) {
    return { type: 'drawing', side: 'all', role: 'mechanical', roleName: `机械层 ${match[1]}`, profilePriority: 40 }
  }
  if ((match = extension.match(/^\.p(\d+)$/))) {
    return { type: 'drawing', side: 'all', role: 'panel', roleName: `Gerber 面板 ${match[1]}`, profilePriority: 0 }
  }

  const type = libraryIdentity?.type ?? 'unknown'
  return {
    type,
    side: libraryIdentity?.side,
    role: type === 'outline' ? 'profile' : type === 'drawing' ? 'auxiliary' : type === 'unknown' ? 'unknown' : 'standard',
    roleName: standardRoleName(type),
    profilePriority: type === 'outline' ? 60 : 0,
  }
}

export async function readSourceFiles(inputFiles: File[]): Promise<SourceFile[]> {
  const sources: SourceFile[] = []

  for (const file of inputFiles) {
    if (file.size > MAX_SINGLE_FILE_BYTES) {
      throw new Error(`${file.name} 超过单文件 24 MB 限制`)
    }

    if (/\.zip$/i.test(file.name)) {
      const zip = await JSZip.loadAsync(file)
      const entries = Object.values(zip.files).filter(
        (entry) => !entry.dir && !entry.name.startsWith('__MACOSX/') && !entry.name.includes('../'),
      )

      for (const entry of entries) {
        const content = await entry.async('string')
        const name = entry.name.split('/').pop() ?? entry.name
        if (!isLikelyGerber(name, content)) continue
        const size = new Blob([content]).size
        if (size > MAX_SINGLE_FILE_BYTES) throw new Error(`${name} 解压后超过 24 MB 限制`)
        sources.push({ name, content, size })
      }
    } else {
      const content = await file.text()
      if (isLikelyGerber(file.name, content)) {
        sources.push({ name: file.name, content, size: file.size })
      }
    }
  }

  if (sources.length === 0) throw new Error('没有找到可识别的 Gerber 或 Excellon 钻孔文件')
  if (sources.length > MAX_FILE_COUNT) throw new Error(`文件数量超过 ${MAX_FILE_COUNT} 个限制`)

  const totalBytes = sources.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error('解压后的文件总量超过 120 MB 限制')
  return sources
}

function normalizeBounds(image: ImageTree, unitScale: number): [number, number, number, number] | null {
  if (image.size.length !== 4) return null
  return image.size.map((value) => value * unitScale) as [number, number, number, number]
}

function unionBounds(bounds: Array<[number, number, number, number]>): [number, number, number, number] {
  return bounds.reduce(
    (result, current) => [
      Math.min(result[0], current[0]),
      Math.min(result[1], current[1]),
      Math.max(result[2], current[2]),
      Math.max(result[3], current[3]),
    ],
    [...bounds[0]] as [number, number, number, number],
  )
}

function projectName(sources: SourceFile[]): string {
  const filename = sources.find((source) => /(?:Edge_Cuts|outline|profile|\.gm\d+)/i.test(source.name))?.name
    ?? sources[0].name
  return filename.replace(/-(?:F|B)_(?:Cu|Mask|Silkscreen).*$/i, '').replace(/\.[^.]+$/, '')
}

export async function parseBoard(
  sources: SourceFile[],
  onProgress?: (progress: number, filename: string) => void,
): Promise<ParsedBoard> {
  const identities = identifyLayers(sources.map((source) => source.name))
  const layers: ParsedLayer[] = []
  const issues: ParseIssue[] = []

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]
    onProgress?.(Math.round((index / sources.length) * 100), source.name)
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))

    try {
      const identity = classifyLayer(source.name, source.content, identities[source.name])
      const { type, side } = identity
      const tree = parse(source.content)
      const image = plot(tree, identity.profilePriority > 0)
      const unitScale = image.units === 'in' ? 25.4 : 1
      const boundsMm = normalizeBounds(image, unitScale)

      if (!boundsMm) {
        issues.push({ file: source.name, message: '图层为空或没有可绘制图形', level: 'warning' })
      }
      if (type === 'unknown') {
        issues.push({ file: source.name, message: '无法识别图层用途，已保留但不参与 3D 合成', level: 'warning' })
      }

      layers.push({
        id: `${index}-${source.name}`,
        name: source.name,
        type,
        side,
        role: identity.role,
        roleName: identity.roleName,
        profilePriority: identity.profilePriority,
        image,
        boundsMm,
        unitScale,
      })
    } catch (error) {
      issues.push({
        file: source.name,
        message: error instanceof Error ? error.message : '解析失败',
        level: 'error',
      })
    }
  }

  onProgress?.(100, '完成')
  const drawableBounds = layers.flatMap((layer) => (layer.boundsMm ? [layer.boundsMm] : []))
  if (drawableBounds.length === 0) throw new Error('文件中没有可绘制的 Gerber 图形')

  const profileLayers = layers
    .filter((layer) => layer.profilePriority > 0 && layer.boundsMm)
    .sort((left, right) => right.profilePriority - left.profilePriority)
  const profileLayer = profileLayers[0]
  const boundsMm = profileLayer?.boundsMm ?? unionBounds(drawableBounds)
  const hasOutline = Boolean(profileLayer)

  if (!hasOutline) {
    issues.unshift({
      message: '未识别到板框层，当前使用所有图层的外接矩形生成板体',
      level: 'warning',
    })
  }
  if (profileLayer?.role === 'mechanical') {
    issues.unshift({
      file: profileLayer.name,
      message: '未找到明确板框，已暂用机械层；请在“板框来源”中确认',
      level: 'warning',
    })
  }

  return {
    name: projectName(sources),
    layers,
    sources,
    boundsMm,
    widthMm: boundsMm[2] - boundsMm[0],
    heightMm: boundsMm[3] - boundsMm[1],
    hasOutline,
    profileLayerId: profileLayer?.id,
    profileCandidates: profileLayers.map((layer) => layer.id),
    issues,
  }
}

export function selectBoardProfile(board: ParsedBoard, layerId: string): ParsedBoard {
  const layer = board.layers.find((candidate) => candidate.id === layerId)
  if (!layer?.boundsMm) return board
  const boundsMm = layer.boundsMm
  return {
    ...board,
    boundsMm,
    widthMm: boundsMm[2] - boundsMm[0],
    heightMm: boundsMm[3] - boundsMm[1],
    hasOutline: true,
    profileLayerId: layer.id,
  }
}

export const layerNames: Record<string, string> = {
  copper: '铜层',
  soldermask: '阻焊',
  silkscreen: '丝印',
  solderpaste: '锡膏',
  drill: '钻孔',
  outline: '板框',
  drawing: '辅助图',
  unknown: '未识别',
  top: '顶层',
  bottom: '底层',
  inner: '内层',
  all: '全板',
}
