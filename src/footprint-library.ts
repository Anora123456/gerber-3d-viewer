import type { BomItem, ComponentLibraryItem } from './assembly-data'
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

const stepUrlByBasePath = new Map(
  Object.entries(stepAssets).map(([sourcePath, url]) => [sourcePath.replace(/\.(?:step|stp)$/i, ''), url]),
)

export function normalizeFootprintName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\.(?:glb|step|stp)$/i, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '')
}

export const footprintModels: FootprintModel[] = Object.entries(modelAssets).map(([sourcePath, url]) => {
  const name = sourcePath.split('/').pop()?.replace(/\.glb$/i, '') ?? sourcePath
  return {
    name,
    normalizedName: normalizeFootprintName(name),
    sourcePath,
    url,
    stepUrl: stepUrlByBasePath.get(sourcePath.replace(/\.glb$/i, '')),
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

function strongPassiveMatch(parts: string[]): ComponentLibraryFootprintMatch | null {
  const family = parts[0]?.toLocaleUpperCase()
  const packageName = parts[1] ?? ''
  const normalizedPackage = normalizeFootprintName(packageName)
  if (!normalizedPackage || !['C', 'RES', 'L'].includes(family)) return null

  const category = family === 'C'
    ? 'passive/capacitor'
    : family === 'RES'
      ? 'passive/resistor'
      : 'electromechanical/inductor'
  const candidateAliases = family === 'C'
    ? new Set([`c${normalizedPackage}`, `c${normalizedPackage}l`])
    : family === 'RES'
      ? new Set([`r${normalizedPackage}`, `r${normalizedPackage}l`])
      : new Set([normalizedPackage, `${normalizedPackage}l`, `l${normalizedPackage}`])

  const pair = sourceModelPairs.find(({ source }) => (
    source.category === category && candidateAliases.has(source.normalizedAlias)
  ))
  return pair ? { ...pair, packageName, forced: true } : null
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
  const passiveMatch = strongPassiveMatch(parts)
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
