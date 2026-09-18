import type { BomItem, ComponentLibraryItem } from './assembly-data'

export interface BomLibraryMatch {
  libraryItem: ComponentLibraryItem
  score: number
}

const passivePackages = new Set(['0201', '0402', '0603', '0805', '1206', '1210', '1812', '2512'])

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[μµ]/g, 'u')
    .replace(/[×*]/g, 'x')
    .replace(/ω/g, 'r')
    .replace(/ohms?/g, 'r')
    .replace(/[^a-z0-9\u3400-\u9fff.]+/g, '')
}

function materialNameParts(materialName: string): string[] {
  return materialName
    .replace(/^(?:\s*【[^】]+】)+\s*/, '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
}

function bomPassiveFamily(item: BomItem): 'C' | 'RES' | 'L' | null {
  const designator = item.designators[0]?.match(/^[A-Z]+/i)?.[0]?.toLocaleUpperCase()
  if (designator === 'C') return 'C'
  if (designator === 'R') return 'RES'
  if (designator === 'L') return 'L'
  return null
}

function canonicalQuantity(value: string, passiveFamily: 'C' | 'RES' | 'L' | null): string | null {
  const normalized = normalizeText(value)
  const unitMatch = normalized.match(/^([0-9]+(?:\.[0-9]+)?)([pnumk]?)(f|h|r|v|a|w|hz)$/)
  if (unitMatch) {
    const multipliers: Record<string, number> = {
      p: 1e-12,
      n: 1e-9,
      u: 1e-6,
      m: 1e-3,
      '': 1,
      k: 1e3,
    }
    const quantity = Number(unitMatch[1]) * multipliers[unitMatch[2]]
    return Number.isFinite(quantity) ? `${quantity.toExponential(9)}${unitMatch[3]}` : null
  }

  if (passiveFamily === 'RES') {
    const resistorMatch = normalized.match(/^([0-9]+(?:\.[0-9]+)?)([rkm])$/)
    if (resistorMatch) {
      const multiplier = resistorMatch[2] === 'k' ? 1e3 : resistorMatch[2] === 'm' ? 1e6 : 1
      return `${(Number(resistorMatch[1]) * multiplier).toExponential(9)}r`
    }
  }
  return null
}

function comparableSpecToken(value: string, passiveFamily: 'C' | 'RES' | 'L' | null): string {
  return canonicalQuantity(value, passiveFamily) ?? normalizeText(value)
}

function bomSpecTokens(item: BomItem, passiveFamily: 'C' | 'RES' | 'L' | null): string[] {
  const source = (item.value || item.partNumber).replace(/[（(][^）)]*[）)]/g, ' ')
  if (!source.trim() || /^\s*(?:nc|dnp|no\s*fit)\s*$/i.test(source)) return []
  const chunks = source
    .split(/[\/，,；;\s]+/)
    .map((part) => comparableSpecToken(part, passiveFamily))
    .filter((part) => Boolean(part) && !/^[np]管$/.test(part))
  return [...new Set(chunks)]
}

function canonicalPackage(value: string): string {
  let normalized = normalizeText(value)
  if (!normalized) return ''

  const passive = normalized.match(/^(?:c|r)?(0201|0402|0603|0805|1206|1210|1812|2512)(?:l)?$/)
  if (passive) return `smd${passive[1]}`

  const led = normalized.match(/^led(0201|0402|0603|0805)(?:[rgbwy])?$/)
  if (led) return `led${led[1]}`

  const fuse = normalized.match(/^(?:fu|fuse)(0201|0402|0603|0805|1206|1210)$/)
  if (fuse) return `fuse${fuse[1]}`

  normalized = normalized
    .replace(/^tqfn/, 'qfn')
    .replace(/^uqfn/, 'qfn')
    .replace(/^so0(?=\d)/, 'so')
    .replace(/(?:_)?[nv]$/, '')

  if (/^(?:sc706|sot363)$/.test(normalized)) return 'sc706'
  if (/^sot23\d+l?$/.test(normalized)) return normalized.replace(/l$/, '')
  if (/^sod123fl?$/.test(normalized)) return 'sod123f'
  if (/^(?:qfn|dfn)\d+/.test(normalized)) return normalized.replace(/ep$/, '')
  if (/^lqfp\d+/.test(normalized)) return normalized
  if (/^fxl\d+l$/.test(normalized)) return normalized.slice(0, -1)
  return normalized
}

function packageParts(parts: string[], passiveFamily: 'C' | 'RES' | 'L' | null): string[] {
  if (passiveFamily) return parts[1] ? [parts[1]] : []
  return parts
}

function specTokenScore(
  token: string,
  libraryParts: string[],
  passiveFamily: 'C' | 'RES' | 'L' | null,
): number {
  const comparableParts = libraryParts.map((part) => comparableSpecToken(part, passiveFamily))
  if (comparableParts.includes(token)) return 12
  if (token.length >= 5 && comparableParts.some((part) => part.startsWith(token))) return 8
  if (token.length >= 5 && comparableParts.some((part) => token.startsWith(part) && part.length >= 5)) return 6
  return 0
}

export function scoreBomLibraryCandidate(item: BomItem, libraryItem: ComponentLibraryItem): number {
  if (/【停售】/.test(libraryItem.materialName) || /^(?:是|禁用|disabled)$/i.test(libraryItem.disabledStatus.trim())) {
    return 0
  }
  const passiveFamily = bomPassiveFamily(item)
  const parts = materialNameParts(libraryItem.materialName)
  if (parts.length === 0) return 0
  if (passiveFamily && parts[0].toLocaleUpperCase() !== passiveFamily) return 0

  const specTokens = bomSpecTokens(item, passiveFamily)
  if (specTokens.length === 0) return 0
  const specScores = specTokens.map((token) => specTokenScore(token, parts, passiveFamily))
  if (specScores.some((score) => score === 0)) return 0

  const bomPackage = canonicalPackage(item.footprint)
  if (!bomPackage) return 0
  const rawBomPackage = normalizeText(item.footprint)
  const candidates = packageParts(parts, passiveFamily)
  const packageMatch = candidates.find((part) => canonicalPackage(part) === bomPackage)
  if (!packageMatch) return 0
  const packageScore = normalizeText(packageMatch) === rawBomPackage ? 8 : 5

  return specScores.reduce((sum, score) => sum + score, 0) + packageScore
}

export function matchBomItemToLibrary(
  item: BomItem,
  libraryItems: ComponentLibraryItem[],
): BomLibraryMatch | null {
  const candidates = libraryItems
    .map((libraryItem) => ({ libraryItem, score: scoreBomLibraryCandidate(item, libraryItem) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
  if (candidates.length === 0) return null

  const topScore = candidates[0].score
  const topCandidates = candidates.filter((candidate) => candidate.score === topScore)
  const uniqueSkus = new Set(topCandidates.map(({ libraryItem }) => libraryItem.sku || libraryItem.id))
  return uniqueSkus.size === 1 ? topCandidates[0] : null
}

export function matchBomItemsToLibrary(
  items: BomItem[],
  libraryItems: ComponentLibraryItem[],
): Map<string, BomLibraryMatch> {
  const matches = new Map<string, BomLibraryMatch>()
  items.forEach((item) => {
    const match = matchBomItemToLibrary(item, libraryItems)
    if (match) matches.set(item.id, match)
  })
  return matches
}
