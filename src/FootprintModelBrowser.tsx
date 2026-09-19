import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Cuboid, LoaderCircle, RotateCcw, Search } from 'lucide-react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { FootprintModel } from './footprint-library'
import { footprintCategoryOf } from './footprint-categories'
import { parseStepArrayBuffer } from './step-model'

export interface PreviewFootprintModel extends FootprintModel {
  object?: THREE.Object3D
}

interface FootprintModelBrowserProps {
  models: PreviewFootprintModel[]
  selectedModelPath?: string | null
  onSelectedModelPathChange?: (sourcePath: string) => void
}

type PreviewState = 'empty' | 'loading' | 'ready' | 'error'

const previewLoader = new GLTFLoader()

/** 行高必须与 `.model-browser-list button` 的 CSS 保持一致，否则虚拟滚动会错位。 */
const listRowHeight = 31
const listOverscan = 10

function modelCategoryLabel(model: FootprintModel): string {
  const category = footprintCategoryOf(model.sourcePath)
  return `${category.groupLabel} · ${category.label}`
}

function disposeModel(root: THREE.Object3D) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => material.dispose())
  })
}

export default function FootprintModelBrowser({
  models,
  selectedModelPath,
  onSelectedModelPathChange,
}: FootprintModelBrowserProps) {
  const sortedModels = useMemo(
    () => [...models].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
    [models],
  )
  const [query, setQuery] = useState('')
  const [internalSelectedPath, setInternalSelectedPath] = useState(sortedModels[0]?.sourcePath ?? '')
  const [previewState, setPreviewState] = useState<PreviewState>('loading')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const resetViewRef = useRef<() => void>(() => undefined)

  const controlled = selectedModelPath !== undefined
  const effectiveSelectedPath = controlled ? selectedModelPath : internalSelectedPath
  const selectedModel = effectiveSelectedPath
    ? sortedModels.find((model) => model.sourcePath === effectiveSelectedPath)
    : controlled ? undefined : sortedModels[0]
  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return sortedModels
    return sortedModels.filter((model) => (
      `${model.name} ${modelCategoryLabel(model)}`.toLocaleLowerCase().includes(normalizedQuery)
    ))
  }, [query, sortedModels])

  const listRef = useRef<HTMLDivElement>(null)
  const [listScrollTop, setListScrollTop] = useState(0)
  const [listViewportHeight, setListViewportHeight] = useState(190)

  useEffect(() => {
    const element = listRef.current
    if (!element) return
    const measure = () => setListViewportHeight(element.clientHeight || 190)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // 切换分类或搜索词时回到列表顶部。
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 })
    setListScrollTop(0)
  }, [filteredModels])

  const firstVisibleIndex = Math.max(0, Math.floor(listScrollTop / listRowHeight) - listOverscan)
  const lastVisibleIndex = Math.min(
    filteredModels.length,
    Math.ceil((listScrollTop + listViewportHeight) / listRowHeight) + listOverscan,
  )
  const windowedModels = filteredModels.slice(firstVisibleIndex, lastVisibleIndex)

  useEffect(() => {
    if (!selectedModel || !canvasRef.current || !previewRef.current) {
      setPreviewState('empty')
      resetViewRef.current = () => undefined
      return
    }

    const canvas = canvasRef.current
    const preview = previewRef.current
    let cancelled = false
    let frameId = 0
    let modelRoot: THREE.Object3D | null = null
    let ownsModelResources = false
    let modelReady = false
    let sampledFrames = 0
    let firstPixelChecksum: number | null = null
    setPreviewState('loading')
    canvas.dataset.pixelCheck = 'pending'
    canvas.dataset.motionCheck = 'pending'

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
    } catch {
      setPreviewState('error')
      return
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    renderer.setClearColor(0x111713, 1)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.001, 10000)
    camera.position.set(3, 2.2, 3)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.07
    controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    controls.autoRotateSpeed = 0.8

    scene.add(new THREE.HemisphereLight(0xdce7df, 0x263029, 2.3))
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2)
    keyLight.position.set(4, 6, 5)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0x9fc7ff, 1.4)
    fillLight.position.set(-5, 2, -3)
    scene.add(fillLight)
    const rimLight = new THREE.DirectionalLight(0xffd990, 1.1)
    rimLight.position.set(2, -4, 4)
    scene.add(rimLight)

    const resize = () => {
      const width = Math.max(1, preview.clientWidth)
      const height = Math.max(1, preview.clientHeight)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(preview)
    resize()

    const samplePixels = () => {
      const gl = renderer.getContext()
      const width = Math.min(96, gl.drawingBufferWidth)
      const height = Math.min(96, gl.drawingBufferHeight)
      const x = Math.max(0, Math.floor((gl.drawingBufferWidth - width) / 2))
      const y = Math.max(0, Math.floor((gl.drawingBufferHeight - height) / 2))
      const background = new Uint8Array(4)
      const pixels = new Uint8Array(width * height * 4)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, background)
      gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      let nonBackground = 0
      let checksum = 0
      for (let index = 0; index < pixels.length; index += 4) {
        const difference = Math.abs(pixels[index] - background[0])
          + Math.abs(pixels[index + 1] - background[1])
          + Math.abs(pixels[index + 2] - background[2])
        if (difference > 18) nonBackground += 1
        checksum = (checksum + (pixels[index] * 3 + pixels[index + 1] * 5 + pixels[index + 2] * 7)
          * (index / 4 + 1)) % 1000000007
      }
      return { checksum, nonBackground }
    }

    const render = () => {
      controls.update()
      renderer.render(scene, camera)
      if (modelReady && (sampledFrames === 2 || sampledFrames === 30)) {
        const sample = samplePixels()
        if (sampledFrames === 2) {
          canvas.dataset.pixelCheck = sample.nonBackground > 12 ? 'complete' : 'blank'
          firstPixelChecksum = sample.checksum
        } else {
          canvas.dataset.motionCheck = !controls.autoRotate
            ? 'reduced-motion'
            : firstPixelChecksum !== sample.checksum ? 'moving' : 'static'
        }
      }
      if (modelReady) sampledFrames += 1
      frameId = window.requestAnimationFrame(render)
    }
    render()

    const loadModel = selectedModel.object
      ? Promise.resolve({ root: selectedModel.object.clone(true), ownsResources: false })
      : selectedModel.stepUrl
        ? fetch(selectedModel.stepUrl).then(async (response) => {
            if (!response.ok) throw new Error(`STEP HTTP ${response.status}`)
            const root = await parseStepArrayBuffer(await response.arrayBuffer(), selectedModel.name)
            return { root, ownsResources: true }
          })
        : previewLoader.loadAsync(selectedModel.url).then((gltf) => ({ root: gltf.scene, ownsResources: true }))

    void loadModel.then(({ root, ownsResources }) => {
      if (cancelled) {
        if (ownsResources) disposeModel(root)
        return
      }

      modelRoot = root
      ownsModelResources = ownsResources
      modelRoot.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.castShadow = true
        mesh.receiveShadow = true
      })

      const bounds = new THREE.Box3().setFromObject(modelRoot)
      const center = bounds.getCenter(new THREE.Vector3())
      modelRoot.position.sub(center)
      scene.add(modelRoot)

      const size = bounds.getSize(new THREE.Vector3())
      const radius = Math.max(size.length() / 2, 0.001)
      const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.08
      const resetView = () => {
        camera.near = Math.max(radius / 120, 0.0001)
        camera.far = Math.max(radius * 120, 10)
        camera.position.set(distance * 0.9, distance * 0.62, distance * 0.9)
        camera.updateProjectionMatrix()
        controls.target.set(0, 0, 0)
        controls.minDistance = radius * 0.55
        controls.maxDistance = radius * 8
        controls.update()
      }
      resetViewRef.current = resetView
      resetView()
      modelReady = true
      setPreviewState('ready')
    }).catch(() => {
      if (!cancelled) {
        canvas.dataset.pixelCheck = 'error'
        canvas.dataset.motionCheck = 'error'
        setPreviewState('error')
      }
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      controls.dispose()
      if (modelRoot) {
        scene.remove(modelRoot)
        if (ownsModelResources) disposeModel(modelRoot)
      }
      renderer.dispose()
      resetViewRef.current = () => undefined
    }
  }, [selectedModel])

  return (
    <section className="model-browser" aria-label="3D模型浏览器">
      <header className="model-browser-heading">
        <div><Cuboid size={15} /><strong>3D 模型浏览器</strong></div>
        <span>{models.length}</span>
      </header>

      <label className="model-browser-search">
        <Search size={13} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索模型"
          aria-label="搜索3D模型"
        />
      </label>

      <div className="model-browser-preview" ref={previewRef} aria-busy={previewState === 'loading'}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={selectedModel ? `${selectedModel.name} 3D预览` : '3D模型预览'}
          data-model-name={selectedModel?.name ?? ''}
          data-model-status={previewState}
        />
        {previewState === 'loading' && (
          <span className="model-browser-preview-state"><LoaderCircle className="spin" size={20} /></span>
        )}
        {previewState === 'error' && (
          <span className="model-browser-preview-state error"><AlertTriangle size={19} /></span>
        )}
        {previewState === 'empty' && (
          <span className="model-browser-preview-state empty">此物料未绑定3D封装</span>
        )}
        <button
          type="button"
          onClick={() => resetViewRef.current()}
          title="重置视角"
          aria-label="重置3D模型视角"
          disabled={previewState !== 'ready'}
        >
          <RotateCcw size={14} />
        </button>
      </div>

      <div className="model-browser-selection">
        <strong title={selectedModel?.name}>{selectedModel?.name ?? '暂无模型'}</strong>
        <span>{selectedModel ? modelCategoryLabel(selectedModel) : '—'}</span>
      </div>

      <div
        aria-label="3D模型列表"
        className="model-browser-list"
        onScroll={(event) => setListScrollTop(event.currentTarget.scrollTop)}
        ref={listRef}
        role="listbox"
      >
        {filteredModels.length === 0 ? (
          <span className="model-browser-empty">没有匹配的模型</span>
        ) : (
          <div
            className="model-browser-list-track"
            role="presentation"
            style={{ height: filteredModels.length * listRowHeight }}
          >
            <div
              className="model-browser-list-window"
              role="presentation"
              style={{ transform: `translateY(${firstVisibleIndex * listRowHeight}px)` }}
            >
              {windowedModels.map((model, index) => (
                <button
                  type="button"
                  role="option"
                  aria-posinset={firstVisibleIndex + index + 1}
                  aria-selected={model.sourcePath === selectedModel?.sourcePath}
                  aria-setsize={filteredModels.length}
                  className={model.sourcePath === selectedModel?.sourcePath ? 'active' : ''}
                  key={model.sourcePath}
                  onClick={() => {
                    setInternalSelectedPath(model.sourcePath)
                    onSelectedModelPathChange?.(model.sourcePath)
                  }}
                  title={`${model.name} · ${modelCategoryLabel(model)}`}
                >
                  <Cuboid size={13} />
                  <span>{model.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
