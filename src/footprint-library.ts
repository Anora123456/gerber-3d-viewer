import type { BomItem, ComponentLibraryItem } from './assembly-data'
import { footprintCategoryOf } from './footprint-categories'
import libraryManifestJson from '../footprint/library-manifest.json'

export interface FootprintModel {
  name: string
  normalizedName: string
  sourcePath: string
  url: string
  stepUrl?: string
  modelCorrectionQuaternion?: readonly [number, number, number, number]
}

export interface FootprintSource {
  alias: string
  normalizedAlias: string
  category: string
  file: string
  source: string
  confidence: 'exact' | 'compatible' | 'user'
  note: string
}

export interface ComponentLibraryFootprintMatch {
  source: FootprintSource
  model: FootprintModel
  packageName: string
  forced: boolean
}

interface FootprintLibraryManifest {
  entries: Array<{
    alias: string
    category: string
    file: string | null
    source: string
    confidence: 'exact' | 'compatible' | 'user' | 'manual-needed'
    status: 'copied' | 'missing' | 'manual-needed'
    note: string
  }>
}

const modelAssets = import.meta.glob('/footprint/**/*.glb', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

const stepAssets = import.meta.glob(['/footprint/**/*.step', '/footprint/**/*.stp'], {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

const modelAssetByBasePath = new Map(
  Object.entries(modelAssets).map(([sourcePath, url]) => [
    sourcePath.replace(/\.glb$/i, ''),
    { sourcePath, url },
  ]),
)

const stepAssetByBasePath = new Map(
  Object.entries(stepAssets).map(([sourcePath, url]) => [
    sourcePath.replace(/\.(?:step|stp)$/i, ''),
    { sourcePath, url },
  ]),
)

export function normalizeFootprintName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\.(?:glb|step|stp)$/i, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '')
}

export const footprintModels: FootprintModel[] = [
  ...new Set([...modelAssetByBasePath.keys(), ...stepAssetByBasePath.keys()]),
].map((basePath) => {
  const modelAsset = modelAssetByBasePath.get(basePath)
  const stepAsset = stepAssetByBasePath.get(basePath)
  const name = basePath.split('/').pop() ?? basePath
  return {
    name,
    normalizedName: normalizeFootprintName(name),
    sourcePath: stepAsset?.sourcePath ?? modelAsset?.sourcePath ?? basePath,
    url: modelAsset?.url ?? '',
    stepUrl: stepAsset?.url,
  }
})

const libraryManifest = libraryManifestJson as FootprintLibraryManifest

export const footprintSources: FootprintSource[] = libraryManifest.entries.flatMap((entry) => (
  entry.status === 'copied' && entry.file && entry.confidence !== 'manual-needed'
    ? [{
        alias: entry.alias,
        normalizedAlias: normalizeFootprintName(entry.alias),
        category: entry.category,
        file: entry.file,
        source: entry.source,
        confidence: entry.confidence,
        note: entry.note,
      }]
    : []
))

const modelByName = new Map(footprintModels.map((model) => [model.normalizedName, model]))
const sourceByAlias = new Map(footprintSources.map((source) => [source.normalizedAlias, source]))

const sourceModelPairs = footprintSources.flatMap((source) => {
  const sourceFileName = source.file.split(/[\\/]/).pop() ?? source.file
  const model = modelByName.get(normalizeFootprintName(sourceFileName))
  return model ? [{ source, model }] : []
})

function componentLibraryNameParts(materialName: string): string[] {
  return materialName
    .replace(/^(?:\s*【[^】]+】)+\s*/, '')
    .split('|')
    .map((part) => part.trim())
}

/**
 * 金蝶被动器件物料名固定为 `<族>|<封装>|…`（族 ∈ C / RES / L），
 * 第二段即封装码（英制尺寸，如 0201 / 0402 / 0603 / 1008）——
 * 据此可直接在本库里按 KiCad 标准命名定位模型：
 * `C_0402_1005Metric` / `R_0201_0603Metric` / `L_1008_2520Metric`，
 * 不依赖 `library-manifest.json` 的别名表（那份清单描述的是已移除的旧 `.glb` 扁平目录）。
 */
const passiveFamilyLetters: Record<string, string> = { C: 'C', RES: 'R', L: 'L' }
const kicadPassiveModelNamePattern = /^(C|R|L)_(\d{3,5})_\d{3,5}Metric$/

const passiveModelByFamilySize = new Map<string, FootprintModel>()
const passiveModelsInPathOrder = [...footprintModels]
  .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath))
passiveModelsInPathOrder.forEach((model) => {
  const matched = kicadPassiveModelNamePattern.exec(model.name)
  if (!matched) return
  const key = `${matched[1]}|${matched[2]}`
  if (!passiveModelByFamilySize.has(key)) passiveModelByFamilySize.set(key, model)
})

function passiveFootprintMatch(parts: string[]): ComponentLibraryFootprintMatch | null {
  const letter = passiveFamilyLetters[parts[0]?.toLocaleUpperCase() ?? '']
  const packageName = parts[1] ?? ''
  if (!letter || !packageName) return null

  // 兼容 `0402L` 这类带尾缀的封装写法。
  const size = normalizeFootprintName(packageName).replace(/l$/, '')
  const model = passiveModelByFamilySize.get(`${letter}|${size}`)
  if (!model) return null

  const category = footprintCategoryOf(model.sourcePath)
  return {
    source: {
      alias: packageName,
      normalizedAlias: size,
      category: category.folder,
      file: model.sourcePath.replace(/^\/footprint\//, ''),
      source: model.name,
      confidence: 'exact',
      note: `${parts[0].toLocaleUpperCase()} ${size} 英制封装 → ${model.name}`,
    },
    model,
    packageName,
    forced: true,
  }
}

function itemMatchCandidates(item: BomItem): string[] {
  return [item.footprint, item.partNumber, item.value]
    .map(normalizeFootprintName)
    .filter(Boolean)
}

export function matchFootprintModel(item: BomItem): FootprintModel | null {
  for (const candidate of itemMatchCandidates(item)) {
    const model = modelByName.get(candidate)
    if (model) return model
  }
  return null
}

export function matchFootprintSource(item: BomItem): FootprintSource | null {
  for (const candidate of itemMatchCandidates(item)) {
    const source = sourceByAlias.get(candidate)
    if (source) return source
  }
  return null
}

export function matchBomFootprintModels(items: BomItem[]): Map<string, FootprintModel> {
  const matches = new Map<string, FootprintModel>()
  items.forEach((item) => {
    const model = matchFootprintModel(item)
    if (model) matches.set(item.id, model)
  })
  return matches
}

export function matchBomFootprintSources(items: BomItem[]): Map<string, FootprintSource> {
  const matches = new Map<string, FootprintSource>()
  items.forEach((item) => {
    const source = matchFootprintSource(item)
    if (source) matches.set(item.id, source)
  })
  return matches
}

export function matchComponentLibraryFootprint(
  item: Pick<ComponentLibraryItem, 'materialName'>,
): ComponentLibraryFootprintMatch | null {
  const parts = componentLibraryNameParts(item.materialName)
  const passiveMatch = passiveFootprintMatch(parts)
  if (passiveMatch) return passiveMatch

  const normalizedParts = parts.map(normalizeFootprintName).filter(Boolean)
  const normalizedFullName = normalizeFootprintName(parts.join('|'))
  const pair = [...sourceModelPairs]
    .sort((left, right) => right.source.normalizedAlias.length - left.source.normalizedAlias.length)
    .find(({ source }) => (
      normalizedParts.includes(source.normalizedAlias)
      || (source.normalizedAlias.length >= 6 && normalizedFullName.includes(source.normalizedAlias))
    ))

  return pair
    ? {
        ...pair,
        packageName: parts.find((part) => normalizeFootprintName(part) === pair.source.normalizedAlias)
          ?? pair.source.alias,
        forced: false,
      }
    : null
}
