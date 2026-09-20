import type { ComponentLibraryItem, ParsedComponentLibraryFile } from './assembly-data'

export interface KingdeeConfig {
  base_url: string
  dbid: string
  username: string
  appid: string
  app_secret: string
  protocol: 'v2' | 'v4'
  lcid: '2052' | '1033' | '3076'
  org_number: string
}

export interface PublicKingdeeConfig extends Omit<KingdeeConfig, 'app_secret'> {
  has_app_secret: boolean
}

export interface KingdeeMaterial {
  id: number | string | null
  number: string | null
  name: string | null
  specification: string | null
  group_number: string | null
  group_name: string | null
  unit_name: string | null
  document_status: string | null
  forbid_status: string | null
}

interface KingdeeSyncResult {
  items: KingdeeMaterial[]
  total: number
  elapsed_ms: number
}

interface KingdeeProbeResult {
  ok: boolean
  elapsed_ms: number
  material_access: boolean
  sample_count: number
}

const API_ROOT = '/api/kingdee'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    })
  } catch {
    throw new Error('无法连接本机 API，请先启动 npm run api（端口 8765）')
  }
  const payload = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) {
    if (!payload.error && response.status >= 500) {
      throw new Error('本机 API 未响应，请检查 npm run api（端口 8765）')
    }
    throw new Error(payload.error || `金蝶接口请求失败 (${response.status})`)
  }
  return payload as T
}

export function fetchKingdeeConfig(): Promise<PublicKingdeeConfig> {
  return request<PublicKingdeeConfig>('/config')
}

export function saveKingdeeConfig(config: KingdeeConfig): Promise<PublicKingdeeConfig> {
  return request<PublicKingdeeConfig>('/config', {
    method: 'POST',
    body: JSON.stringify(config),
  })
}

export function probeKingdeeConnection(config: KingdeeConfig): Promise<KingdeeProbeResult> {
  return request<KingdeeProbeResult>('/probe', {
    method: 'POST',
    body: JSON.stringify(config),
  })
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function documentStatus(value: string | null): string {
  return ({ Z: '暂存', A: '已创建', B: '审核中', C: '已审核', D: '重新审核' } as Record<string, string>)[text(value)]
    ?? text(value)
}

function forbidStatus(value: string | null): string {
  return ({ A: '启用', B: '禁用' } as Record<string, string>)[text(value)] ?? text(value)
}

function toComponentLibraryItem(material: KingdeeMaterial, index: number): ComponentLibraryItem {
  const sku = text(material.number)
  const group = [text(material.group_number), text(material.group_name)].filter(Boolean).join(' · ')
  return {
    id: `kingdee-${text(material.id) || sku || index}`,
    sku,
    materialName: text(material.name),
    specification: text(material.specification),
    dataStatus: documentStatus(material.document_status),
    disabledStatus: forbidStatus(material.forbid_status),
    materialProperty: group,
    unit: text(material.unit_name),
    used: '',
  }
}

export async function syncKingdeeComponentLibrary(): Promise<ParsedComponentLibraryFile> {
  const result = await request<KingdeeSyncResult>('/sync')
  const items = result.items.map(toComponentLibraryItem)
  const disabledCount = items.filter((item) => item.disabledStatus === '禁用').length
  return {
    items,
    sourceRows: result.total,
    sheetName: '金蝶 ERP',
    warnings: disabledCount > 0 ? [`${disabledCount} 条禁用物料不会参与自动匹配`] : [],
  }
}
