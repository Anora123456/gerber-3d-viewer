import type { WorkBook } from 'xlsx'

type SpreadsheetModule = typeof import('xlsx')

export type PlacementSide = 'top' | 'bottom' | 'unknown'

export interface BomItem {
  id: string
  designators: string[]
  quantity: number
  sku: string
  materialName: string
  value: string
  footprint: string
  partNumber: string
  manufacturer: string
  description: string
}

export interface PlacementRecord {
  designator: string
  xMm: number
  yMm: number
  rotation: number
  side: PlacementSide
}

export interface ParsedBomFile {
  items: BomItem[]
  sourceRows: number
  sheetName: string
  warnings: string[]
}

export interface ParsedPlacementFile {
  placements: PlacementRecord[]
  sourceRows: number
  sheetName: string
  warnings: string[]
}

export interface ComponentLibraryItem {
  id: string
  sku: string
  materialName: string
  specification: string
  dataStatus: string
  disabledStatus: string
  materialProperty: string
  unit: string
  used: string
}

export interface ParsedComponentLibraryFile {
  items: ComponentLibraryItem[]
  sourceRows: number
  sheetName: string
  warnings: string[]
}

type TableKind = 'bom' | 'placement' | 'library'
type FieldKey =
  | 'designator'
  | 'quantity'
  | 'sku'
  | 'materialName'
  | 'value'
  | 'footprint'
  | 'partNumber'
  | 'manufacturer'
  | 'description'
  | 'x'
  | 'y'
  | 'rotation'
  | 'side'
  | 'specification'
  | 'dataStatus'
  | 'disabledStatus'
  | 'materialProperty'
  | 'unit'
  | 'used'

type ColumnMap = Partial<Record<FieldKey, number>>

interface TableCandidate {
  sheetName: string
  rows: unknown[][]
  headerRow: number
  columns: ColumnMap
  score: number
}

const BOM_ALIASES: Partial<Record<FieldKey, string[]>> = {
  designator: [
    'designator', 'designators', 'reference', 'references', 'refdes', 'ref',
    'componentdesignator', '位号', '元件位号', '器件位号', '参考标号',
  ],
  quantity: ['quantity', 'qty', 'count', 'amount', '数量', '用量', '元件数量'],
  sku: ['sku', '金蝶sku', '金蝶物料编码', '金蝶物料号', 'erp物料编码', 'erp物料号'],
  materialName: [
    'description', 'desc', 'componentdescription', 'materialname', 'itemname', 'componentname',
    '物料名称', '品名', '物料名',
  ],
  value: ['comment', 'value', 'partvalue', 'componentvalue', '参数', '规格', '型号', '元件值', '值'],
  footprint: ['footprint', 'package', 'pattern', 'pcbfootprint', '封装', '封装名称'],
  partNumber: [
    'manufacturerpartnumber', 'manufacturerpartno', 'mfrpart', 'mpn', 'partnumber',
    'partno', 'model', 'bomcode', 'supplierpartnumber', 'lcscpart', 'lcscpartnumber',
    'lcscpart#', 'jlcpcbpart', '物料编码', '物料号', '料号', '制造商料号', '厂商料号',
    '嘉立创编号', '元件编号',
  ],
  manufacturer: ['manufacturer', 'mfr', 'brand', 'vendor', '制造商', '厂商', '品牌'],
  description: [
    'materialdescription', 'itemdescription', 'note', 'notes', 'remark', 'remarks',
    '物料描述', '描述', '元件描述', '备注', '说明',
  ],
}

const PLACEMENT_ALIASES: Partial<Record<FieldKey, string[]>> = {
  designator: BOM_ALIASES.designator,
  x: [
    'centerx', 'centre x', 'center-x', 'mid x', 'midx', 'ref x', 'refx', 'pos x',
    'posx', 'locationx', 'x', '坐标x', 'x坐标', '中心x',
  ],
  y: [
    'centery', 'centre y', 'center-y', 'mid y', 'midy', 'ref y', 'refy', 'pos y',
    'posy', 'locationy', 'y', '坐标y', 'y坐标', '中心y',
  ],
  rotation: ['rotation', 'rotate', 'angle', 'rot', '旋转', '旋转角度', '角度'],
  side: ['layer', 'side', 'board side', 'boardside', '面', '层', '板面'],
}

const COMPONENT_LIBRARY_ALIASES: Partial<Record<FieldKey, string[]>> = {
  sku: ['sku', '编码', '物料编码', '物料号', '金蝶sku', '金蝶物料编码', 'erp物料编码'],
  materialName: ['name', '名称', '物料名称', '品名', '物料名'],
  specification: ['specification', 'spec', '规格型号', '规格', '型号'],
  dataStatus: ['数据状态', '审核状态'],
  disabledStatus: ['禁用状态', '是否禁用'],
  materialProperty: ['物料属性', '属性'],
  unit: ['基本单位', '单位'],
  used: ['已使用', '是否使用'],
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[（）]/g, (character) => character === '（' ? '(' : ')')
    .replace(/[\s_\-./\\#:：№]+/g, '')
    .replace(/[()[\]]/g, '')
}

function normalizedAliases(aliases: Partial<Record<FieldKey, string[]>>) {
  return Object.fromEntries(
    Object.entries(aliases).map(([key, values]) => [
      key,
      values?.map(normalizeHeader) ?? [],
    ]),
  ) as Partial<Record<FieldKey, string[]>>
}

const NORMALIZED_BOM_ALIASES = normalizedAliases(BOM_ALIASES)
const NORMALIZED_PLACEMENT_ALIASES = normalizedAliases(PLACEMENT_ALIASES)
const NORMALIZED_COMPONENT_LIBRARY_ALIASES = normalizedAliases(COMPONENT_LIBRARY_ALIASES)

function headerMatches(header: string, alias: string): boolean {
  if (header === alias) return true
  if (alias.length < 3) return false
  return header.startsWith(alias) || header.endsWith(alias)
}

function mapColumns(row: unknown[], aliases: Partial<Record<FieldKey, string[]>>): ColumnMap {
  const columns: ColumnMap = {}
  row.forEach((cell, columnIndex) => {
    const header = normalizeHeader(cell)
    if (!header) return
    for (const [key, candidates] of Object.entries(aliases) as Array<[FieldKey, string[]]>) {
      if (columns[key] !== undefined) continue
      if (candidates.some((candidate) => headerMatches(header, candidate))) {
        columns[key] = columnIndex
        break
      }
    }
  })
  return columns
}

function scoreColumns(kind: TableKind, columns: ColumnMap): number {
  const count = Object.keys(columns).length
  if (kind === 'placement') {
    if (columns.designator === undefined || columns.x === undefined || columns.y === undefined) return -1
    return count + 6
  }
  if (kind === 'library') {
    if (columns.sku === undefined || columns.materialName === undefined) return -1
    return count + 6
  }
  const hasIdentity = columns.designator !== undefined
    || columns.partNumber !== undefined
    || columns.sku !== undefined
    || columns.materialName !== undefined
    || columns.value !== undefined
  return hasIdentity && count >= 2 ? count : -1
}

function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('gb18030').decode(bytes)
  }
}

function detectDelimiter(text: string): string | undefined {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 12)
  const candidates = ['\t', ',', ';']
  let best: { delimiter: string; score: number } | null = null
  for (const delimiter of candidates) {
    const counts = lines.map((line) => line.split(delimiter).length - 1).filter((count) => count > 0)
    if (counts.length === 0) continue
    const score = counts.reduce((sum, count) => sum + count, 0) + counts.length * 4
    if (!best || score > best.score) best = { delimiter, score }
  }
  return best?.delimiter
}

function workbookFromFile(XLSX: SpreadsheetModule, file: File, buffer: ArrayBuffer): WorkBook {
  if (/\.xlsx?$/i.test(file.name)) {
    return XLSX.read(buffer, { type: 'array', dense: true, cellDates: false })
  }
  const text = decodeText(buffer)
  const delimiter = detectDelimiter(text)
  return XLSX.read(text, {
    type: 'string',
    dense: true,
    cellDates: false,
    PRN: delimiter === undefined,
    FS: delimiter,
  })
}

function selectTable(XLSX: SpreadsheetModule, workbook: WorkBook, kind: TableKind): TableCandidate {
  const aliases = kind === 'bom'
    ? NORMALIZED_BOM_ALIASES
    : kind === 'placement'
      ? NORMALIZED_PLACEMENT_ALIASES
      : NORMALIZED_COMPONENT_LIBRARY_ALIASES
  let selected: TableCandidate | null = null

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    })
    const limit = Math.min(rows.length, 30)
    for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
      const columns = mapColumns(rows[rowIndex], aliases)
      const columnScore = scoreColumns(kind, columns)
      if (columnScore < 0) continue
      const score = columnScore * 100 - rowIndex
      if (!selected || score > selected.score) {
        selected = { sheetName, rows, headerRow: rowIndex, columns, score }
      }
    }
  }

  if (!selected) {
    throw new Error(kind === 'bom'
      ? '未找到 BOM 标题行，请确认文件包含位号、数量、型号或封装列'
      : kind === 'placement'
        ? '未找到坐标标题行，请确认文件包含位号、X 坐标和 Y 坐标列'
        : '未找到元件库标题行，请确认文件包含编码和名称列')
  }
  return selected
}

function cellText(row: unknown[], column: number | undefined): string {
  if (column === undefined) return ''
  return String(row[column] ?? '').trim()
}

function expandDesignatorToken(token: string): string[] {
  const cleaned = token.trim().toUpperCase()
  const range = cleaned.match(/^([A-Z]+)(\d+)\s*-\s*(?:[A-Z]+)?(\d+)$/)
  if (!range) return cleaned ? [cleaned] : []
  const start = Number(range[2])
  const end = Number(range[3])
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || end - start > 1000) {
    return [cleaned]
  }
  return Array.from({ length: end - start + 1 }, (_, offset) => `${range[1]}${start + offset}`)
}

export function parseDesignators(value: string): string[] {
  const tokens = value
    .replace(/["']/g, '')
    .split(/[,;，；\s]+/)
    .flatMap(expandDesignatorToken)
    .filter(Boolean)
  return [...new Set(tokens)].sort((left, right) => left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base',
  }))
}

function parseQuantity(value: string, designatorCount: number): number {
  const parsed = Number.parseInt(value.replace(/[^\d-]/g, ''), 10)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return Math.max(designatorCount, 1)
}

function parseNumeric(value: string): number | null {
  const normalized = value.trim().replace(/,/g, value.includes('.') ? '' : '.')
  const match = normalized.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function coordinateScale(header: unknown): number {
  const unitHeader = String(header ?? '')
  if (/mil/i.test(unitHeader)) return 0.0254
  if (/(?:^|[^a-z])(?:in|inch|inches)(?:[^a-z]|$)/i.test(unitHeader)) return 25.4
  return 1
}

function normalizeSide(value: string): PlacementSide {
  const side = normalizeHeader(value)
  if (/bottom|bot|back|b\.cu|bottomlayer|底|下|背/.test(side)) return 'bottom'
  if (/top|front|f\.cu|toplayer|顶|上|正/.test(side)) return 'top'
  return 'unknown'
}

function isEmptyRow(row: unknown[]): boolean {
  return row.every((cell) => String(cell ?? '').trim() === '')
}

export async function parseBomFile(file: File): Promise<ParsedBomFile> {
  const XLSX = await import('xlsx')
  const workbook = workbookFromFile(XLSX, file, await file.arrayBuffer())
  const table = selectTable(XLSX, workbook, 'bom')
  const items: BomItem[] = []
  const warnings: string[] = []

  if (table.columns.designator === undefined) warnings.push('未找到位号列，无法与坐标文件逐项匹配')

  table.rows.slice(table.headerRow + 1).forEach((row, rowOffset) => {
    if (isEmptyRow(row)) return
    const designators = parseDesignators(cellText(row, table.columns.designator))
    const sku = cellText(row, table.columns.sku)
    const materialName = cellText(row, table.columns.materialName)
    const value = cellText(row, table.columns.value)
    const footprint = cellText(row, table.columns.footprint)
    const partNumber = cellText(row, table.columns.partNumber)
    const manufacturer = cellText(row, table.columns.manufacturer)
    const description = cellText(row, table.columns.description)
    if (designators.length === 0 && !sku && !materialName && !value && !footprint && !partNumber && !description) return

    const sourceRow = table.headerRow + rowOffset + 2
    items.push({
      id: `${table.sheetName}-${sourceRow}-${designators.join('-') || sku || partNumber || value || materialName || 'item'}`,
      designators,
      quantity: parseQuantity(cellText(row, table.columns.quantity), designators.length),
      sku,
      materialName,
      value,
      footprint,
      partNumber,
      manufacturer,
      description,
    })
  })

  if (items.length === 0) throw new Error('BOM 中没有可用的物料行')
  return {
    items,
    sourceRows: table.rows.length - table.headerRow - 1,
    sheetName: table.sheetName,
    warnings,
  }
}

export async function parsePlacementFile(file: File): Promise<ParsedPlacementFile> {
  const XLSX = await import('xlsx')
  const workbook = workbookFromFile(XLSX, file, await file.arrayBuffer())
  const table = selectTable(XLSX, workbook, 'placement')
  const placements: PlacementRecord[] = []
  let invalidRows = 0
  const xScale = coordinateScale(table.rows[table.headerRow][table.columns.x!])
  const yScale = coordinateScale(table.rows[table.headerRow][table.columns.y!])

  table.rows.slice(table.headerRow + 1).forEach((row) => {
    if (isEmptyRow(row)) return
    const designators = parseDesignators(cellText(row, table.columns.designator))
    const x = parseNumeric(cellText(row, table.columns.x))
    const y = parseNumeric(cellText(row, table.columns.y))
    if (designators.length === 0 || x === null || y === null) {
      invalidRows += 1
      return
    }
    const rotation = parseNumeric(cellText(row, table.columns.rotation)) ?? 0
    const side = normalizeSide(cellText(row, table.columns.side))
    designators.forEach((designator) => {
      placements.push({
        designator,
        xMm: x * xScale,
        yMm: y * yScale,
        rotation,
        side,
      })
    })
  })

  if (placements.length === 0) throw new Error('坐标文件中没有有效的位号与 X/Y 坐标')
  return {
    placements,
    sourceRows: table.rows.length - table.headerRow - 1,
    sheetName: table.sheetName,
    warnings: invalidRows > 0 ? [`已忽略 ${invalidRows} 行缺少位号或坐标的数据`] : [],
  }
}

export async function parseComponentLibraryFile(file: File): Promise<ParsedComponentLibraryFile> {
  const XLSX = await import('xlsx')
  const workbook = workbookFromFile(XLSX, file, await file.arrayBuffer())
  const table = selectTable(XLSX, workbook, 'library')
  const items: ComponentLibraryItem[] = []
  const skuCounts = new Map<string, number>()

  table.rows.slice(table.headerRow + 1).forEach((row, rowOffset) => {
    if (isEmptyRow(row)) return
    const sku = cellText(row, table.columns.sku)
    const materialName = cellText(row, table.columns.materialName)
    if (!sku && !materialName) return

    const sourceRow = table.headerRow + rowOffset + 2
    items.push({
      id: `${table.sheetName}-${sourceRow}-${sku || materialName}`,
      sku,
      materialName,
      specification: cellText(row, table.columns.specification),
      dataStatus: cellText(row, table.columns.dataStatus),
      disabledStatus: cellText(row, table.columns.disabledStatus),
      materialProperty: cellText(row, table.columns.materialProperty),
      unit: cellText(row, table.columns.unit),
      used: cellText(row, table.columns.used),
    })
    if (sku) skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1)
  })

  if (items.length === 0) throw new Error('元件库中没有可用的物料行')

  const missingSkuCount = items.filter((item) => !item.sku).length
  const duplicateSkuCount = [...skuCounts.values()].filter((count) => count > 1).length
  const warnings = [
    missingSkuCount > 0 ? `${missingSkuCount} 条物料缺少编码` : '',
    duplicateSkuCount > 0 ? `${duplicateSkuCount} 个物料编码存在重复记录` : '',
  ].filter(Boolean)

  return {
    items,
    sourceRows: table.rows.length - table.headerRow - 1,
    sheetName: table.sheetName,
    warnings,
  }
}
