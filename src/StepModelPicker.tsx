import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Cuboid, Folder, Layers3, X } from 'lucide-react'
import type { ComponentLibraryItem } from './assembly-data'
import type { FootprintModel } from './footprint-library'
import FootprintModelBrowser from './FootprintModelBrowser'

interface StepModelPickerProps {
  item: ComponentLibraryItem
  models: FootprintModel[]
  initialModelPath?: string | null
  onBind: (model: FootprintModel) => void
  onClose: () => void
  onUnbind?: () => void
}

const categoryLabels: Record<string, string> = {
  connector: '连接器',
  electromechanical: '机电',
  mechanical: '结构件',
  opto: '光电',
  passive: '无源器件',
  semiconductor: '半导体',
  buzzer: '蜂鸣器',
  capacitor: '电容',
  crystal: '晶振',
  diode: '二极管',
  fuse: '保险丝',
  ic: '集成电路',
  inductor: '电感',
  led: 'LED',
  resistor: '电阻',
  switch: '开关',
  transistor: '晶体管',
}

function modelCategoryKey(model: FootprintModel): string {
  const parts = model.sourcePath.replace(/\\/g, '/').split('/').filter(Boolean)
  const footprintIndex = parts.indexOf('footprint')
  const directories = parts.slice(footprintIndex >= 0 ? footprintIndex + 1 : 0, -1)
  return directories.join('/') || 'uncategorized'
}

function categoryLabel(category: string): string {
  if (category === 'uncategorized') return '未分类'
  return category
    .split('/')
    .map((part) => categoryLabels[part] ?? part)
    .join(' / ')
}

export default function StepModelPicker({
  item,
  models,
  initialModelPath,
  onBind,
  onClose,
  onUnbind,
}: StepModelPickerProps) {
  const sortedModels = useMemo(
    () => [...models].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
    [models],
  )
  const initialModel = sortedModels.find((model) => model.sourcePath === initialModelPath)
  const [activeCategory, setActiveCategory] = useState(
    initialModel ? modelCategoryKey(initialModel) : 'all',
  )
  const [selectedPath, setSelectedPath] = useState(
    initialModel?.sourcePath ?? sortedModels[0]?.sourcePath ?? '',
  )
  const dialogRef = useRef<HTMLElement>(null)

  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    sortedModels.forEach((model) => {
      const category = modelCategoryKey(model)
      counts.set(category, (counts.get(category) ?? 0) + 1)
    })
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count, label: categoryLabel(key) }))
      .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
  }, [sortedModels])

  const visibleModels = useMemo(
    () => activeCategory === 'all'
      ? sortedModels
      : sortedModels.filter((model) => modelCategoryKey(model) === activeCategory),
    [activeCategory, sortedModels],
  )
  const selectedModel = sortedModels.find((model) => model.sourcePath === selectedPath)

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  const chooseCategory = (category: string) => {
    setActiveCategory(category)
    const nextModels = category === 'all'
      ? sortedModels
      : sortedModels.filter((model) => modelCategoryKey(model) === category)
    if (!nextModels.some((model) => model.sourcePath === selectedPath)) {
      setSelectedPath(nextModels[0]?.sourcePath ?? '')
    }
  }

  return (
    <div className="step-picker-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        aria-label={`为物料 ${item.sku || item.materialName} 选择 STEP 模型`}
        aria-modal="true"
        className="step-picker-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="step-picker-header">
          <div className="step-picker-title">
            <span><Cuboid size={19} /></span>
            <div>
              <strong>选择 STEP 3D 封装</strong>
              <small title={item.materialName}>{item.sku || '未编码'} · {item.materialName}</small>
            </div>
          </div>
          <button type="button" onClick={onClose} title="关闭" aria-label="关闭 STEP 模型浏览器">
            <X size={17} />
          </button>
        </header>

        <div className="step-picker-body">
          <nav className="step-picker-categories" aria-label="STEP 模型分类">
            <div className="step-picker-category-heading">
              <Layers3 size={14} />
              <span>模型分类</span>
            </div>
            <button
              aria-pressed={activeCategory === 'all'}
              className={activeCategory === 'all' ? 'active' : ''}
              onClick={() => chooseCategory('all')}
              type="button"
            >
              <Folder size={13} />
              <span>全部模型</span>
              <strong>{sortedModels.length}</strong>
            </button>
            {categories.map((category) => (
              <button
                aria-pressed={activeCategory === category.key}
                className={activeCategory === category.key ? 'active' : ''}
                key={category.key}
                onClick={() => chooseCategory(category.key)}
                type="button"
              >
                <Folder size={13} />
                <span title={category.label}>{category.label}</span>
                <strong>{category.count}</strong>
              </button>
            ))}
          </nav>

          <div className="step-picker-browser">
            <FootprintModelBrowser
              models={visibleModels}
              onSelectedModelPathChange={setSelectedPath}
              selectedModelPath={selectedPath}
            />
          </div>
        </div>

        <footer className="step-picker-footer">
          <div>
            <span>当前选择</span>
            <strong title={selectedModel?.sourcePath}>{selectedModel?.name ?? '未选择模型'}</strong>
          </div>
          <div className="step-picker-actions">
            {onUnbind && (
              <button className="step-picker-unbind" onClick={onUnbind} type="button">解除绑定</button>
            )}
            <button className="step-picker-cancel" onClick={onClose} type="button">取消</button>
            <button
              className="step-picker-bind"
              disabled={!selectedModel}
              onClick={() => selectedModel && onBind(selectedModel)}
              type="button"
            >
              <Check size={15} />
              <span>绑定所选模型</span>
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
