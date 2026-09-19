/**
 * 绑定记录的持久化存储。
 *
 * 人工绑定属于「工程知识」，跟着工程走更合理：写入 `footprint/*.json`
 *（与 `library-manifest.json` / `3dmodels-folder-map.csv` 同级，随 git 版本管理），
 * 而不是只锁在某个浏览器的 localStorage 里（还受 origin 隔离影响：
 * `npm run dev` 的 5173 与 `npm run preview` 的 8765 互不相通）。
 *
 * localStorage 降级为「本地缓存 + 服务端不可用时的兜底」，并在首次连通时把
 * 本地已有记录迁移到工程文件，避免用户已有的绑定看起来「丢了」。
 */

const API_ROOT = '/api/kingdee'

export type StringMap = Record<string, string>

export const modelBindingsFileName = 'footprint/model-bindings.json'
export const materialMatchesFileName = 'footprint/material-matches.json'

interface StringMapStore {
  read: () => Promise<StringMap | null>
  write: (entries: StringMap) => Promise<boolean>
}

function toEntries(value: unknown): StringMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '')
      .map(([key, entry]) => [key, entry]),
  )
}

/** 返回 null 表示服务端不可用（网络失败 / 非 2xx），调用方应回落到本地缓存。 */
async function readStore(path: string, field: string): Promise<StringMap | null> {
  try {
    const response = await fetch(`${API_ROOT}${path}`, { headers: { Accept: 'application/json' } })
    if (!response.ok) return null
    const payload = await response.json() as Record<string, unknown>
    return toEntries(payload?.[field])
  } catch {
    return null
  }
}

async function writeStore(path: string, field: string, entries: StringMap): Promise<boolean> {
  try {
    const response = await fetch(`${API_ROOT}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: entries }),
    })
    return response.ok
  } catch {
    return false
  }
}

export const modelBindingsStore: StringMapStore = {
  read: () => readStore('/model-bindings', 'bindings'),
  write: (entries) => writeStore('/model-bindings', 'bindings', entries),
}

export const materialMatchesStore: StringMapStore = {
  read: () => readStore('/material-matches', 'matches'),
  write: (entries) => writeStore('/material-matches', 'matches', entries),
}

export type StoreSource = 'server' | 'local' | 'migrated'

export interface StoreSyncResult {
  entries: StringMap
  /** server = 用的是工程文件；migrated = 把本地记录推到了工程文件；local = 服务端不可用，用本地缓存 */
  source: StoreSource
}

/**
 * 启动时的同步策略：服务端有内容就以服务端为准；服务端为空而本地有记录，
 * 就把本地推上去（一次性迁移）；服务端不可用则用本地缓存。
 */
export async function syncStringMapStore(
  store: StringMapStore,
  local: StringMap,
): Promise<StoreSyncResult> {
  const remote = await store.read()
  if (remote === null) return { entries: local, source: 'local' }
  if (Object.keys(remote).length === 0 && Object.keys(local).length > 0) {
    const pushed = await store.write(local)
    return { entries: local, source: pushed ? 'migrated' : 'local' }
  }
  return { entries: remote, source: 'server' }
}
