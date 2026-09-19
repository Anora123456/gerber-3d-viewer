import { useMemo, useRef, useState } from 'react'
import { CheckCircle2, RefreshCw, Search, X } from 'lucide-react'
import type { BomItem, ComponentLibraryItem } from './assembly-data'
import type { ComponentLibraryFootprintMatch } from './footprint-library'

export interface BomReplaceCandidate {
  libraryItem: ComponentLibraryItem
  score: number
}

interface BomItemReplacePickerProps {
  item: BomItem
  /** 由 `scoreBomLibraryCandidate` 打分的候选，已按分数倒序。 */
  candidates: BomReplaceCandidate[]
  libraryItems: ComponentLibraryItem[]
  footprintMatches: ReadonlyMap<string, ComponentLibraryFootprintMatch>
  /** pending = 待处理行（替换后移入核对表格）；checked = 已核对行（就地换物料）。 */
  mode: 'pending' | 'checked'
  /** 已核对行当前绑定的物料编码，用于在列表里标出「当前」。 */
  currentSku: string
  onClose: () => void
  onPick: (libraryItem: ComponentLibraryItem, score: number) => void
}

/** 与 App 的 `componentLibraryDisplayName` 保持一致。 */
function displayName(materialName: string): string {
  return materialName.replaceAll('【停售】', '').trim()
}

export default function BomItemReplacePicker({
  item,
  candidates,
  libraryItems,
  footprintMatches,
  mode,
  currentSku,
  onClose,
  onPick,
}: BomItemReplacePickerProps) {
  const [query, setQuery] = useState('')
  const dialogRef = useRef<HTMLElement>(null)
  const trimmedQuery = query.trim().toLocaleLowerCase()
  const normalizedCurrentSku = currentSku.trim()

  const scoreById = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.libraryItem.id, candidate.score])),
    [candidates],
  )

  const visible = useMemo(() => {
    if (trimmedQuery) {
      return libraryItems
        .filter((libraryItem) => [
          libraryItem.sku,
          displayName(libraryItem.materialName),
          libraryItem.specification,
        ].some((value) => value.toLocaleLowerCase().includes(trimmedQuery)))
        .map((libraryItem) => ({ libraryItem, score: scoreById.get(libraryItem.id) ?? 0 }))
    }
    // 有自动候选时先给候选；一条都没有（典型是规格里多写了参数）时退回全库，让用户手挑。
    return candidates.length > 0
      ? candidates
      : libraryItems.map((libraryItem) => ({ libraryItem, score: 0 }))
  }, [candidates, libraryItems, scoreById, trimmedQuery])

  const showingCandidates = !trimmedQuery && candidates.length > 0

  return (
    <div
      className="step-picker-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        aria-label={`替换 ${item.designators.join(', ') || '该行'} 的物料`}
        aria-modal="true"
        className="step-picker-dialog replace-picker-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          // 阻断冒泡，避免 App 的全局 Escape 监听顺手关掉别的面板。
          event.stopPropagation()
          onClose()
        }}
      >
        <header className="step-picker-header">
          <div className="step-picker-title">
            <span><RefreshCw size={19} /></span>
            <div>
              <strong>替换元件</strong>
              <small title={[item.materialName, item.value || item.partNumber, item.footprint].filter(Boolean).join(' · ')}>
                {item.designators[0] ?? '—'}
                {item.designators.length > 1 ? ` 等 ${item.designators.length} 个位号` : ''}
                {' · '}
                {item.materialName || '—'}
                {' · '}
                {item.value || item.partNumber || '—'}
                {' · '}
                {item.footprint || '—'}
              </small>
            </div>
          </div>
          <button type="button" onClick={onClose} title="关闭" aria-label="关闭替换元件面板">
            <X size={17} />
          </button>
        </header>

        <div className="replace-picker-body">
          <label className="replace-picker-search">
            <Search size={14} />
            <input
              autoFocus
              aria-label="搜索金蝶物料"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索金蝶物料（编码 / 名称 / 规格），留空看自动候选"
              value={query}
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} title="清空搜索" aria-label="清空搜索">
                <X size={13} />
              </button>
            )}
          </label>

          <p className="replace-picker-summary">
            {showingCandidates ? (
              <>按当前行评分排序的匹配候选 <strong>{candidates.length}</strong> 条</>
            ) : trimmedQuery ? (
              <>全库搜索结果 <strong>{visible.length}</strong> 条</>
            ) : (
              <>没有自动候选，下面列出全库 <strong>{visible.length}</strong> 条，请手动挑选</>
            )}
          </p>

          <ul className="replace-picker-list">
            {visible.map(({ libraryItem, score }) => {
              const footprint = footprintMatches.get(libraryItem.id)
              const name = displayName(libraryItem.materialName)
              const isCurrent = normalizedCurrentSku !== '' && libraryItem.sku.trim() === normalizedCurrentSku
              const meta = [libraryItem.specification, libraryItem.dataStatus, libraryItem.disabledStatus]
                .filter(Boolean)
                .join(' · ')
              return (
                <li key={libraryItem.id}>
                  <button
                    className={`replace-picker-option${isCurrent ? ' current' : ''}`}
                    type="button"
                    onClick={() => onPick(libraryItem, score)}
                    title={`${libraryItem.sku || '无编码'} · ${name}`}
                  >
                    <span className="replace-picker-sku">
                      <span>{libraryItem.sku || '—'}</span>
                      {isCurrent && <em className="replace-picker-current">当前</em>}
                    </span>
                    <span className="replace-picker-name">
                      <strong>{name || '—'}</strong>
                      <small>{meta || '—'}</small>
                    </span>
                    <span className={`replace-picker-model${footprint ? ' matched' : ''}`}>
                      {footprint
                        ? <><CheckCircle2 size={12} />{footprint.model.name}</>
                        : '无 3D 封装'}
                    </span>
                    <span className="replace-picker-score">{score > 0 ? score : '—'}</span>
                  </button>
                </li>
              )
            })}
            {visible.length === 0 && (
              <li className="replace-picker-empty">没有匹配的金蝶物料</li>
            )}
          </ul>
        </div>

        <footer className="step-picker-footer">
          <div>
            <strong>
              {mode === 'pending' ? '替换后该行会移入「核对元件」表格' : '替换后就地换掉该行绑定的金蝶物料'}
            </strong>
            <span>
              {mode === 'pending'
                ? '记为已通过数据库核对，不会自动勾选确认，请自行复核。'
                : '该行仍留在核对表格，并清除它原有的「确认」勾选。'}
            </span>
          </div>
          <button className="replace-picker-cancel" type="button" onClick={onClose}>取消</button>
        </footer>
      </section>
    </div>
  )
}
