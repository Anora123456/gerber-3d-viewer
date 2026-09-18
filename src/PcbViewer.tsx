import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { renderSVG, renderThree } from 'web-gerber'
import type { PathSegment, SvgElement } from 'web-gerber'
import type { BomItem } from './assembly-data'
import { matchFootprintModel, type FootprintModel } from './footprint-library'
import type { ParsedBoard, ParsedLayer } from './gerber'
import type { PlacementAlignment } from './placement-alignment'
import { parseStepArrayBuffer } from './step-model'

export type CameraPreset = 'iso' | 'top' | 'bottom'

export interface LayerVisibility {
  board: boolean
  copper: boolean
  mask: boolean
  silkscreen: boolean
  drill: boolean
  components: boolean
  grid: boolean
}

interface PcbViewerProps {
  board: ParsedBoard | null
  thickness: number
  boardColor: string
  visibility: LayerVisibility
  cameraPreset: CameraPreset
  cameraRevision: number
  alignment: PlacementAlignment | null
  bomItems: BomItem[]
  selectedDesignators: string[]
  onComponentSelect: (designator: string) => void
}

type LayerKind = Exclude<keyof LayerVisibility, 'grid' | 'components'>
type SurfaceSide = 'top' | 'bottom'

const copperColor = 0xd0a84f
const silkColor = 0xf0eee6
const drillColor = 0x090c0a
const substrateColor = 0xd8ad4f
const RASTER_LAYER_THRESHOLD = 500
const FOOTPRINT_MODEL_SCALE = 1000
const footprintLoader = new GLTFLoader()
const footprintTemplateCache = new Map<string, Promise<THREE.Group>>()

function loadFootprintTemplate(model: FootprintModel): Promise<THREE.Group> {
  const cacheKey = model.stepUrl ?? model.url
  const cached = footprintTemplateCache.get(cacheKey)
  if (cached) return cached

  const request = (model.stepUrl
    ? fetch(model.stepUrl).then(async (response) => {
        if (!response.ok) throw new Error(`STEP HTTP ${response.status}`)
        const template = await parseStepArrayBuffer(await response.arrayBuffer(), model.name)
        template.userData.stepModel = true
        return template
      })
    : footprintLoader.loadAsync(model.url).then((gltf) => gltf.scene)
  ).then((template) => {
    template.name = `footprint-template:${model.name}`
    template.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData.sharedFootprintResource = true
    })
    return template
  })
  footprintTemplateCache.set(cacheKey, request)
  return request
}

function cloneFootprintTemplate(template: THREE.Group): THREE.Group {
  const instance = template.clone(true)
  instance.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.sharedFootprintResource = true
  })
  return instance
}

function replaceMaterial(
  object: THREE.Object3D,
  color: THREE.ColorRepresentation,
  options: Partial<THREE.MeshStandardMaterialParameters> = {},
) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    if (mesh.userData.keepMaterial) return
    mesh.material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.58,
      metalness: 0.05,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      ...options,
    })
    mesh.castShadow = true
    mesh.receiveShadow = true
  })
}

function setKind(object: THREE.Object3D, kind: LayerKind) {
  object.userData.layerKind = kind
  return object
}

function setSurfaceSide(object: THREE.Object3D, side: SurfaceSide) {
  object.userData.surfaceSide = side
  return object
}

function applyBoardVisibility(
  root: THREE.Group,
  visibility: LayerVisibility,
  cameraZ: number,
) {
  const visibleSide: SurfaceSide = cameraZ >= 0 ? 'top' : 'bottom'
  for (const child of root.children) {
    const kind = child.userData.layerKind as LayerKind | undefined
    if (!kind) continue
    const surfaceSide = child.userData.surfaceSide as SurfaceSide | undefined
    const facesCamera = !surfaceSide || surfaceSide === visibleSide
    child.visible = visibility[kind]
      && facesCamera
      && (!child.userData.underMask || !visibility.mask)
  }
}

function applyComponentVisibility(root: THREE.Group, visible: boolean, cameraZ: number) {
  const visibleSide: SurfaceSide = cameraZ >= 0 ? 'top' : 'bottom'
  root.children.forEach((child) => {
    const surfaceSide = child.userData.surfaceSide as SurfaceSide | undefined
    child.visible = visible && (!surfaceSide || surfaceSide === visibleSide)
  })
}

interface ComponentDimensions {
  width: number
  depth: number
  height: number
}

const imperialPackageSizes: Record<string, [number, number]> = {
  '0201': [0.6, 0.3],
  '0402': [1, 0.5],
  '0603': [1.6, 0.8],
  '0805': [2, 1.25],
  '1206': [3.2, 1.6],
  '1210': [3.2, 2.5],
  '1812': [4.5, 3.2],
  '2512': [6.3, 3.2],
}

function componentDimensions(item: BomItem | undefined): ComponentDimensions {
  const source = `${item?.footprint ?? ''} ${item?.value ?? ''} ${item?.materialName ?? ''} ${item?.description ?? ''}`.toUpperCase()
  let width = 1.8
  let depth = 1.1

  const metricSize = source.match(/(?:^|[^0-9])(\d+(?:\.\d+)?)\s*[X*×]\s*(\d+(?:\.\d+)?)(?:[^0-9]|$)/)
  if (metricSize) {
    width = Number(metricSize[1])
    depth = Number(metricSize[2])
  } else {
    const packageCode = source.match(/(?:^|[^0-9])(0201|0402|0603|0805|1206|1210|1812|2512)(?:[^0-9]|$)/)?.[1]
    if (packageCode) [width, depth] = imperialPackageSizes[packageCode]
    else if (/SOT-?23/.test(source)) [width, depth] = [3, 1.5]
    else if (/SOD-?123/.test(source)) [width, depth] = [3.7, 1.8]
    else if (/SOD-?923/.test(source)) [width, depth] = [1, 0.6]
    else if (/SO-?0?8|SOP-?8/.test(source)) [width, depth] = [5, 4]
    else if (/LQFP64/.test(source)) [width, depth] = [10, 10]
    else if (/QFN/.test(source)) [width, depth] = [4, 4]
  }

  width = THREE.MathUtils.clamp(width, 0.55, 16)
  depth = THREE.MathUtils.clamp(depth, 0.4, 16)
  const height = /LCD|BUZZ|USB|SWITCH|开关|电解/.test(source)
    ? 2.4
    : /CONNECTOR|HEADER|接插件|HDR|FPC/.test(source) ? 1.8 : 0.8
  return { width, depth, height }
}

function createPlacementObject(
  board: ParsedBoard,
  thickness: number,
  alignment: PlacementAlignment,
  bomItems: BomItem[],
  selectedDesignators: string[],
  onModelProgress: () => void,
): THREE.Group {
  const root = new THREE.Group()
  const [x1, y1, x2, y2] = board.boundsMm
  root.name = 'placement-root'
  root.position.set(-(x1 + x2) / 2, -(y1 + y2) / 2, 0)
  root.userData.alignmentMode = alignment.mode
  root.userData.insideCount = alignment.insideCount
  root.userData.placementCount = alignment.totalCount
  root.userData.modelMatchedCount = 0
  root.userData.modelLoadedCount = 0
  root.userData.modelFailedCount = 0
  root.userData.disposed = false
  root.userData.outsideDesignators = alignment.placements
    .filter((placement) => !placement.isInsideBoard)
    .map((placement) => placement.designator)
    .join(',')

  const itemByDesignator = new Map<string, BomItem>()
  bomItems.forEach((item) => item.designators.forEach((designator) => {
    itemByDesignator.set(designator.toUpperCase(), item)
  }))
  const selected = new Set(selectedDesignators.map((designator) => designator.toUpperCase()))

  alignment.placements.forEach((placement) => {
    const designator = placement.designator.toUpperCase()
    const item = itemByDesignator.get(designator)
    if (!item) return
    const model = matchFootprintModel(item)
    if (!model) return
    const dimensions = componentDimensions(item)
    const isSelected = selected.has(designator)
    const side: SurfaceSide = placement.side === 'bottom' ? 'bottom' : 'top'

    const marker = new THREE.Group()
    const sideRoot = new THREE.Group()
    const surfaceOffset = thickness / 2 + 0.09
    marker.position.set(
      placement.boardXmm,
      placement.boardYmm,
      side === 'bottom' ? -surfaceOffset : surfaceOffset,
    )
    marker.rotation.z = THREE.MathUtils.degToRad(placement.rotation)
    marker.userData.surfaceSide = side
    marker.userData.designator = designator
    marker.userData.placementMarker = true
    sideRoot.rotation.x = side === 'bottom' ? Math.PI : 0
    marker.add(sideRoot)
    root.add(marker)

    let selectionRing: THREE.Mesh | null = null

    if (isSelected) {
      const radius = Math.max(dimensions.width, dimensions.depth) * 0.72 + 0.45
      selectionRing = new THREE.Mesh(
        new THREE.RingGeometry(radius, radius + 0.22, 32),
        new THREE.MeshBasicMaterial({
          color: 0x6be0aa,
          depthTest: true,
          side: THREE.DoubleSide,
        }),
      )
      selectionRing.position.z = dimensions.height + 0.2
      selectionRing.userData.designator = designator
      sideRoot.add(selectionRing)
    }

    root.userData.modelMatchedCount += 1
    void loadFootprintTemplate(model).then((template) => {
      if (root.userData.disposed) return

      const instance = cloneFootprintTemplate(template)
      instance.name = `footprint:${model.name}:${designator}`
      if (!template.userData.stepModel) {
        instance.scale.setScalar(FOOTPRINT_MODEL_SCALE)
        instance.rotation.x = Math.PI / 2
      }
      instance.updateMatrixWorld(true)

      const bounds = new THREE.Box3().setFromObject(instance)
      const size = bounds.getSize(new THREE.Vector3())
      const largestDimension = Math.max(size.x, size.y, size.z)
      if (!Number.isFinite(largestDimension) || largestDimension < 0.05 || largestDimension > 100) {
        throw new Error(`模型尺寸异常: ${largestDimension.toFixed(3)} mm`)
      }

      sideRoot.add(instance)
      if (selectionRing) selectionRing.position.z = size.z + 0.2
      root.userData.modelLoadedCount += 1
      onModelProgress()
    }).catch((error: unknown) => {
      if (root.userData.disposed) return
      root.userData.modelFailedCount += 1
      marker.userData.modelError = error instanceof Error ? error.message : String(error)
      onModelProgress()
    })
  })

  return root
}

function createFallbackBoard(board: ParsedBoard, thickness: number): THREE.Group {
  const [x1, y1, x2, y2] = board.boundsMm
  const radius = Math.min(1.5, (x2 - x1) * 0.03, (y2 - y1) * 0.03)
  const shape = new THREE.Shape()
  shape.moveTo(x1 + radius, y1)
  shape.lineTo(x2 - radius, y1)
  shape.quadraticCurveTo(x2, y1, x2, y1 + radius)
  shape.lineTo(x2, y2 - radius)
  shape.quadraticCurveTo(x2, y2, x2 - radius, y2)
  shape.lineTo(x1 + radius, y2)
  shape.quadraticCurveTo(x1, y2, x1, y2 - radius)
  shape.lineTo(x1, y1 + radius)
  shape.quadraticCurveTo(x1, y1, x1 + radius, y1)

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: true,
    bevelSize: 0.12,
    bevelThickness: 0.08,
    bevelSegments: 2,
  })
  geometry.translate(0, 0, -0.5)
  const group = new THREE.Group()
  group.add(new THREE.Mesh(geometry))
  return group
}

interface SvgNodeLike {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: SvgNodeLike[]
  value?: string
}

function escapeXml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function svgAttributeName(name: string): string {
  if (name === 'xmlnsXLink') return 'xmlns:xlink'
  if (name === 'viewBox' || name === 'preserveAspectRatio') return name
  if (name === 'className') return 'class'
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

function serializeSvgNode(node: SvgNodeLike): string {
  if (node.type === 'text') return escapeXml(node.value ?? '')
  if (node.type !== 'element' || !node.tagName) return ''
  const attributes = Object.entries(node.properties ?? {})
    .filter(([, value]) => value !== null && value !== undefined && value !== false)
    .map(([name, value]) => {
      const normalized = Array.isArray(value) ? value.join(' ') : value === true ? '' : value
      return normalized === ''
        ? ` ${svgAttributeName(name)}`
        : ` ${svgAttributeName(name)}="${escapeXml(normalized)}"`
    })
    .join('')
  const children = (node.children ?? []).map(serializeSvgNode).join('')
  return `<${node.tagName}${attributes}>${children}</${node.tagName}>`
}

function textureDimensions(board: ParsedBoard): [number, number] {
  const pixelsPerMm = 10
  const targetWidth = Math.max(board.widthMm * pixelsPerMm, 256)
  const targetHeight = Math.max(board.heightMm * pixelsPerMm, 256)
  const scale = Math.min(1, 2048 / Math.max(targetWidth, targetHeight))
  return [Math.round(targetWidth * scale), Math.round(targetHeight * scale)]
}

function createLayerTexture(
  board: ParsedBoard,
  layer: ParsedLayer,
  color: THREE.ColorRepresentation,
  onLoad: () => void,
): THREE.Texture {
  const [x1, y1, x2, y2] = board.boundsMm
  const viewBox: [number, number, number, number] = [
    x1 / layer.unitScale,
    -y2 / layer.unitScale,
    (x2 - x1) / layer.unitScale,
    (y2 - y1) / layer.unitScale,
  ]
  const tree = renderSVG(layer.image, viewBox) as SvgElement & { properties: Record<string, unknown> }
  const [width, height] = textureDimensions(board)
  tree.properties = {
    ...tree.properties,
    color: `#${new THREE.Color(color).getHexString()}`,
    width,
    height,
    preserveAspectRatio: 'none',
  }

  const svg = serializeSvgNode(tree as unknown as SvgNodeLike)
  const objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  const image = new Image()
  image.decoding = 'async'
  const texture = new THREE.Texture(image)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  image.addEventListener('load', () => {
    texture.needsUpdate = true
    URL.revokeObjectURL(objectUrl)
    onLoad()
  }, { once: true })
  image.addEventListener('error', () => {
    URL.revokeObjectURL(objectUrl)
    console.warn(`Unable to rasterize ${layer.name}`)
  }, { once: true })
  image.src = objectUrl
  return texture
}

function createRasterizedLayers(
  board: ParsedBoard,
  layers: ParsedLayer[],
  color: THREE.ColorRepresentation,
  z: number,
  depth: number,
  onTextureLoad: () => void,
): THREE.Group {
  const group = new THREE.Group()
  const [x1, y1, x2, y2] = board.boundsMm
  const geometry = new THREE.PlaneGeometry(board.widthMm, board.heightMm)
  const zPositions = z === 0 ? [depth / 2, -depth / 2] : [z]

  layers.forEach((layer, layerIndex) => {
    const texture = createLayerTexture(board, layer, color, onTextureLoad)
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      alphaTest: 0.02,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      side: THREE.DoubleSide,
      transparent: true,
    })
    zPositions.forEach((surfaceZ) => {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(
        (x1 + x2) / 2,
        (y1 + y2) / 2,
        surfaceZ + Math.sign(surfaceZ || 1) * layerIndex * 0.0005,
      )
      mesh.renderOrder = 3
      mesh.userData.keepMaterial = true
      group.add(mesh)
    })
  })
  return group
}

interface DirectedSegment {
  segment: PathSegment
  reversed: boolean
}

interface ProfileContour {
  points: THREE.Vector2[]
  area: number
  parent: number | null
  depth: number
}

function segmentPoint(segment: DirectedSegment, start: boolean): THREE.Vector2 {
  const useStart = start !== segment.reversed
  const position = useStart ? segment.segment.start : segment.segment.end
  return new THREE.Vector2(position[0], position[1])
}

function pointsMeet(left: THREE.Vector2, right: THREE.Vector2, tolerance: number): boolean {
  return left.distanceToSquared(right) <= tolerance * tolerance
}

function collectProfileSegments(layer: ParsedLayer): PathSegment[] {
  const segments: PathSegment[] = []
  for (const child of layer.image.children) {
    if (child.type === 'imagePath' || child.type === 'imageRegion') {
      segments.push(...child.segments)
    } else if (child.type === 'imageShape' && child.shape.type === 'outline') {
      segments.push(...child.shape.segments)
    }
  }
  return segments.filter((segment) => (
    Number.isFinite(segment.start[0])
    && Number.isFinite(segment.start[1])
    && Number.isFinite(segment.end[0])
    && Number.isFinite(segment.end[1])
  ))
}

function connectProfileSegments(layer: ParsedLayer): DirectedSegment[][] {
  const tolerance = 0.02 / layer.unitScale
  const pending = collectProfileSegments(layer).map((segment) => ({ segment, reversed: false }))
  const contours: DirectedSegment[][] = []

  while (pending.length > 0) {
    const chain = [pending.shift()!]
    const firstPoint = segmentPoint(chain[0], true)
    let endPoint = segmentPoint(chain[0], false)

    while (!pointsMeet(firstPoint, endPoint, tolerance) && pending.length > 0) {
      const matchIndex = pending.findIndex((candidate) => (
        pointsMeet(segmentPoint(candidate, true), endPoint, tolerance)
        || pointsMeet(segmentPoint(candidate, false), endPoint, tolerance)
      ))
      if (matchIndex < 0) break

      const next = pending.splice(matchIndex, 1)[0]
      if (!pointsMeet(segmentPoint(next, true), endPoint, tolerance)) next.reversed = true
      chain.push(next)
      endPoint = segmentPoint(next, false)
    }

    if (pointsMeet(firstPoint, endPoint, tolerance)) contours.push(chain)
  }

  return contours
}

function sampleSegment(directed: DirectedSegment, unitScale: number): THREE.Vector2[] {
  const { segment, reversed } = directed
  const endPoint = segmentPoint(directed, false)
  if (segment.type === 'line') return [endPoint]

  const startAngle = reversed ? segment.end[2] : segment.start[2]
  const endAngle = reversed ? segment.start[2] : segment.end[2]
  const clockwise = reversed ? segment.start[2] <= segment.end[2] : segment.start[2] > segment.end[2]
  const fullCircle = Math.abs(startAngle - endAngle) < 1e-8
  let sweep = Math.abs(endAngle - startAngle)
  if (fullCircle) sweep = Math.PI * 2
  else if (sweep > Math.PI * 2) sweep %= Math.PI * 2
  const arcLengthMm = Math.max(segment.radius * sweep * unitScale, 0.1)
  const divisions = THREE.MathUtils.clamp(Math.ceil(arcLengthMm / 0.35), 8, 160)
  const curve = new THREE.EllipseCurve(
    segment.center[0],
    segment.center[1],
    segment.radius,
    segment.radius,
    startAngle,
    endAngle,
    clockwise,
  )
  const points = curve.getPoints(divisions).slice(1)
  points[points.length - 1] = endPoint
  return points
}

function polygonArea(points: THREE.Vector2[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }
  return area / 2
}

function pointInPolygon(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  let inside = false
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current]
    const b = polygon[previous]
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (crosses) inside = !inside
  }
  return inside
}

function interiorPoint(points: THREE.Vector2[]): THREE.Vector2 {
  const triangles = THREE.ShapeUtils.triangulateShape(points, [])
  const triangle = triangles[0]
  if (triangle) {
    return points[triangle[0]].clone()
      .add(points[triangle[1]])
      .add(points[triangle[2]])
      .multiplyScalar(1 / 3)
  }
  return points.reduce((sum, point) => sum.add(point), new THREE.Vector2()).multiplyScalar(1 / points.length)
}

function buildProfileContours(layer: ParsedLayer): ProfileContour[] {
  const minimumArea = 0.01 / (layer.unitScale * layer.unitScale)
  const contours: ProfileContour[] = connectProfileSegments(layer).flatMap((chain): ProfileContour[] => {
    const points = [segmentPoint(chain[0], true)]
    for (const segment of chain) points.push(...sampleSegment(segment, layer.unitScale))
    if (pointsMeet(points[0], points[points.length - 1], 0.02 / layer.unitScale)) points.pop()

    const compact = points.filter((point, index) => (
      index === 0 || !pointsMeet(point, points[index - 1], 1e-7)
    ))
    const area = polygonArea(compact)
    return compact.length >= 3 && Math.abs(area) >= minimumArea
      ? [{ points: compact, area: Math.abs(area), parent: null, depth: 0 }]
      : []
  })

  const interiorPoints = contours.map((contour) => interiorPoint(contour.points))
  for (let index = 0; index < contours.length; index += 1) {
    let parent: number | null = null
    for (let candidate = 0; candidate < contours.length; candidate += 1) {
      if (candidate === index || contours[candidate].area <= contours[index].area) continue
      if (!pointInPolygon(interiorPoints[index], contours[candidate].points)) continue
      if (parent === null || contours[candidate].area < contours[parent].area) parent = candidate
    }
    contours[index].parent = parent
  }

  const resolveDepth = (index: number, seen = new Set<number>()): number => {
    if (seen.has(index)) return 0
    const parent = contours[index].parent
    if (parent === null) return 0
    seen.add(index)
    return resolveDepth(parent, seen) + 1
  }
  contours.forEach((contour, index) => {
    contour.depth = resolveDepth(index)
  })
  return contours
}

function normalizeWinding(points: THREE.Vector2[], clockwise: boolean): THREE.Vector2[] {
  const copy = points.map((point) => point.clone())
  return THREE.ShapeUtils.isClockWise(copy) === clockwise ? copy : copy.reverse()
}

function createProfileBoard(layer: ParsedLayer): THREE.Group | null {
  const contours = buildProfileContours(layer)
  const shapes: THREE.Shape[] = []

  contours.forEach((contour, index) => {
    if (contour.depth % 2 !== 0) return
    const shape = new THREE.Shape(normalizeWinding(contour.points, true))
    contours.forEach((hole, holeIndex) => {
      if (holeIndex === index || hole.parent !== index || hole.depth !== contour.depth + 1) return
      shape.holes.push(new THREE.Path(normalizeWinding(hole.points, false)))
    })
    shapes.push(shape)
  })

  if (shapes.length === 0) return null
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth: 1,
    bevelEnabled: false,
    curveSegments: 8,
  })
  geometry.translate(0, 0, -0.5)
  geometry.computeVertexNormals()

  const capGeometry = new THREE.ShapeGeometry(shapes, 8)
  const topCap = new THREE.Mesh(capGeometry)
  topCap.position.z = 0.5002
  const bottomCap = new THREE.Mesh(capGeometry.clone())
  bottomCap.position.z = -0.5002

  const group = new THREE.Group()
  group.scale.set(layer.unitScale, layer.unitScale, 1)
  group.userData.profileContours = contours.length
  group.userData.profileSolids = shapes.length
  group.add(new THREE.Mesh(geometry), topCap, bottomCap)
  return group
}

function renderGerberLayer(layer: ParsedLayer, color: number, outline = false): THREE.Group | null {
  try {
    const object = renderThree(layer.image, color, undefined, outline)
    object.scale.x = layer.unitScale
    object.scale.y = layer.unitScale
    return object
  } catch (error) {
    console.warn(`Unable to render ${layer.name}`, error)
    return null
  }
}

function mergeRenderedLayers(layers: ParsedLayer[], color: number): THREE.Group {
  const group = new THREE.Group()
  for (const layer of layers) {
    const rendered = renderGerberLayer(layer, color)
    if (rendered) group.add(rendered)
  }
  return group
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    if (mesh.userData.sharedFootprintResource) return
    mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => {
      const mappedMaterial = material as THREE.Material & { map?: THREE.Texture | null }
      mappedMaterial.map?.dispose()
      material.dispose()
    })
  })
}

function buildBoardObject(
  board: ParsedBoard,
  thickness: number,
  maskColor: string,
  onTextureLoad: () => void,
): THREE.Group {
  const root = new THREE.Group()
  root.name = 'pcb-root'
  const [x1, y1, x2, y2] = board.boundsMm
  root.position.set(-(x1 + x2) / 2, -(y1 + y2) / 2, 0)

  const outlineLayer = board.layers.find((layer) => layer.id === board.profileLayerId)
  let body = outlineLayer ? createProfileBoard(outlineLayer) : null
  if (!body || body.children.length === 0) body = createFallbackBoard(board, thickness)
  body.scale.z = thickness
  replaceMaterial(body, substrateColor, {
    depthWrite: true,
    metalness: 0,
    opacity: 1,
    roughness: 0.68,
    transparent: false,
  })
  setKind(body, 'board')
  root.add(body)

  const topMaskBody = body.clone(true)
  topMaskBody.scale.z = 0.018
  topMaskBody.position.z = thickness / 2 + 0.012
  replaceMaterial(topMaskBody, maskColor, {
    depthWrite: true,
    emissive: maskColor,
    emissiveIntensity: 0.12,
    metalness: 0,
    opacity: 1,
    roughness: 0.42,
    transparent: false,
  })
  setSurfaceSide(topMaskBody, 'top')
  setKind(topMaskBody, 'mask')
  root.add(topMaskBody)

  const bottomMaskBody = body.clone(true)
  bottomMaskBody.scale.z = 0.018
  bottomMaskBody.position.z = -thickness / 2 - 0.012
  replaceMaterial(bottomMaskBody, maskColor, {
    depthWrite: true,
    emissive: maskColor,
    emissiveIntensity: 0.12,
    metalness: 0,
    opacity: 1,
    roughness: 0.42,
    transparent: false,
  })
  setSurfaceSide(bottomMaskBody, 'bottom')
  setKind(bottomMaskBody, 'mask')
  root.add(bottomMaskBody)

  const byRole = (type: string, side?: string) =>
    board.layers.filter((layer) => layer.type === type && (!side || layer.side === side))

  const addSurface = (
    layers: ParsedLayer[],
    kind: LayerKind,
    color: number,
    z: number,
    depth: number,
    material: Partial<THREE.MeshStandardMaterialParameters> = {},
    underMask = false,
  ) => {
    if (layers.length === 0) return
    const rasterize = layers.reduce((sum, layer) => sum + layer.image.children.length, 0) > RASTER_LAYER_THRESHOLD
    const object = rasterize
      ? createRasterizedLayers(board, layers, color, z, depth, onTextureLoad)
      : mergeRenderedLayers(layers, color)
    if (!rasterize) {
      object.scale.z = depth
      object.position.z = z
      replaceMaterial(object, color, material)
    }
    object.userData.underMask = underMask
    const surfaceSide = layers[0]?.side
    if (surfaceSide === 'top' || surfaceSide === 'bottom') setSurfaceSide(object, surfaceSide)
    setKind(object, kind)
    root.add(object)
  }

  const topMaskLayers = byRole('soldermask', 'top')
  const bottomMaskLayers = byRole('soldermask', 'bottom')

  addSurface(byRole('copper', 'top'), 'copper', copperColor, thickness / 2 + 0.031, 0.035, {
    roughness: 0.32,
    metalness: 0.62,
  }, topMaskLayers.length > 0)
  addSurface(byRole('copper', 'bottom'), 'copper', copperColor, -thickness / 2 - 0.031, 0.035, {
    roughness: 0.32,
    metalness: 0.62,
  }, bottomMaskLayers.length > 0)
  addSurface(topMaskLayers, 'copper', copperColor, thickness / 2 + 0.057, 0.014, {
    roughness: 0.3,
    metalness: 0.5,
  })
  addSurface(bottomMaskLayers, 'copper', copperColor, -thickness / 2 - 0.057, 0.014, {
    roughness: 0.3,
    metalness: 0.5,
  })
  addSurface(byRole('silkscreen', 'top'), 'silkscreen', silkColor, thickness / 2 + 0.071, 0.018, {
    roughness: 0.78,
    metalness: 0,
  })
  addSurface(byRole('silkscreen', 'bottom'), 'silkscreen', silkColor, -thickness / 2 - 0.071, 0.018, {
    roughness: 0.78,
    metalness: 0,
  })
  addSurface(byRole('drill'), 'drill', drillColor, 0, thickness + 0.22, {
    roughness: 1,
    metalness: 0,
  })

  return root
}

export default function PcbViewer({
  board,
  thickness,
  boardColor,
  visibility,
  cameraPreset,
  cameraRevision,
  alignment,
  bomItems,
  selectedDesignators,
  onComponentSelect,
}: PcbViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const boardRootRef = useRef<THREE.Group | null>(null)
  const componentRootRef = useRef<THREE.Group | null>(null)
  const gridRef = useRef<THREE.GridHelper | null>(null)
  const animationRef = useRef<number | null>(null)
  const pixelCheckRequestedRef = useRef(true)
  const visibilityRef = useRef(visibility)
  const onComponentSelectRef = useRef(onComponentSelect)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [viewportRevision, setViewportRevision] = useState(0)

  useEffect(() => {
    onComponentSelectRef.current = onComponentSelect
  }, [onComponentSelect])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    try {
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x111613)

      const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 2000)
      camera.up.set(0, 0, 1)
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.05
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      host.appendChild(renderer.domElement)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.075
      controls.screenSpacePanning = true
      controls.minDistance = 10
      controls.maxDistance = 10000
      controls.addEventListener('end', () => {
        pixelCheckRequestedRef.current = true
      })

      const raycaster = new THREE.Raycaster()
      const pointer = new THREE.Vector2()
      let pointerStart: { id: number; x: number; y: number } | null = null
      const findPlacementDesignator = (object: THREE.Object3D, root: THREE.Object3D) => {
        let current: THREE.Object3D | null = object
        while (current && current !== root) {
          if (!current.visible) return null
          const designator = current.userData.designator
          if (typeof designator === 'string' && designator) return designator
          current = current.parent
        }
        return null
      }
      const handlePointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return
        pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY }
      }
      const handlePointerUp = (event: PointerEvent) => {
        const start = pointerStart
        pointerStart = null
        if (!start || start.id !== event.pointerId) return
        if ((event.clientX - start.x) ** 2 + (event.clientY - start.y) ** 2 > 36) return

        const componentRoot = componentRootRef.current
        if (!componentRoot || !componentRoot.visible || !visibilityRef.current.components) return
        const bounds = renderer.domElement.getBoundingClientRect()
        if (bounds.width <= 0 || bounds.height <= 0) return
        pointer.set(
          ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
          -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
        )
        raycaster.setFromCamera(pointer, camera)
        for (const intersection of raycaster.intersectObject(componentRoot, true)) {
          const designator = findPlacementDesignator(intersection.object, componentRoot)
          if (!designator) continue
          renderer.domElement.dataset.selectedDesignator = designator
          onComponentSelectRef.current(designator)
          break
        }
      }
      const clearPointerStart = () => {
        pointerStart = null
      }
      renderer.domElement.title = '点击元件以定位 BOM 行'
      renderer.domElement.addEventListener('pointerdown', handlePointerDown)
      renderer.domElement.addEventListener('pointerup', handlePointerUp)
      renderer.domElement.addEventListener('pointercancel', clearPointerStart)
      renderer.domElement.addEventListener('pointerleave', clearPointerStart)

      scene.add(new THREE.HemisphereLight(0xf7f4e8, 0x16211b, 2.1))
      const keyLight = new THREE.DirectionalLight(0xffffff, 3.2)
      keyLight.position.set(-55, -60, 95)
      keyLight.castShadow = true
      scene.add(keyLight)
      const fillLight = new THREE.DirectionalLight(0xd8e7ff, 1.35)
      fillLight.position.set(80, 30, 45)
      scene.add(fillLight)

      const grid = new THREE.GridHelper(300, 60, 0x314239, 0x202a25)
      grid.rotation.x = Math.PI / 2
      grid.position.z = -4
      grid.renderOrder = -10
      const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material]
      gridMaterials.forEach((material) => {
        material.depthTest = true
        material.depthWrite = false
        material.transparent = false
        material.opacity = 1
      })
      scene.add(grid)

      sceneRef.current = scene
      cameraRef.current = camera
      rendererRef.current = renderer
      controlsRef.current = controls
      gridRef.current = grid

      const resize = () => {
        const width = Math.max(host.clientWidth, 1)
        const height = Math.max(host.clientHeight, 1)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
        renderer.setSize(width, height, false)
        setViewportRevision((revision) => revision + 1)
      }
      const observer = new ResizeObserver(resize)
      observer.observe(host)
      resize()

      const animate = () => {
        controls.update()
        grid.position.z = camera.position.z >= 0 ? -4 : 4
        renderer.domElement.dataset.gridZ = String(grid.position.z)
        renderer.domElement.dataset.gridVisible = String(grid.visible)
        const boardRoot = boardRootRef.current
        if (boardRoot) {
          applyBoardVisibility(boardRoot, visibilityRef.current, camera.position.z)
          const visibleSurfaceGroups = boardRoot.children.filter(
            (child) => child.visible && child.userData.surfaceSide,
          )
          renderer.domElement.dataset.viewSide = camera.position.z >= 0 ? 'top' : 'bottom'
          renderer.domElement.dataset.visibleTopGroups = String(
            visibleSurfaceGroups.filter((child) => child.userData.surfaceSide === 'top').length,
          )
          renderer.domElement.dataset.visibleBottomGroups = String(
            visibleSurfaceGroups.filter((child) => child.userData.surfaceSide === 'bottom').length,
          )
        }
        const componentRoot = componentRootRef.current
        if (componentRoot) {
          applyComponentVisibility(componentRoot, visibilityRef.current.components, camera.position.z)
          renderer.domElement.dataset.alignmentMode = String(componentRoot.userData.alignmentMode)
          renderer.domElement.dataset.placementCount = String(componentRoot.userData.placementCount)
          renderer.domElement.dataset.placementInside = String(componentRoot.userData.insideCount)
          renderer.domElement.dataset.placementOutside = String(componentRoot.userData.outsideDesignators)
          renderer.domElement.dataset.modelMatched = String(componentRoot.userData.modelMatchedCount)
          renderer.domElement.dataset.modelLoaded = String(componentRoot.userData.modelLoadedCount)
          renderer.domElement.dataset.modelFailed = String(componentRoot.userData.modelFailedCount)
          renderer.domElement.dataset.visiblePlacements = String(
            componentRoot.children.filter((child) => child.visible && child.userData.placementMarker).length,
          )
        } else {
          renderer.domElement.dataset.placementCount = '0'
          renderer.domElement.dataset.placementInside = '0'
          renderer.domElement.dataset.modelMatched = '0'
          renderer.domElement.dataset.modelLoaded = '0'
          renderer.domElement.dataset.modelFailed = '0'
          renderer.domElement.dataset.visiblePlacements = '0'
        }
        renderer.render(scene, camera)
        if (pixelCheckRequestedRef.current) {
          const context = renderer.getContext()
          const width = context.drawingBufferWidth
          const height = context.drawingBufferHeight
          const pixels = new Uint8Array(width * height * 4)
          context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels)
          const step = Math.max(1, Math.floor((width * height) / 24000))
          const colors = new Set<number>()
          let nonDark = 0
          let samples = 0
          for (let index = 0; index < width * height; index += step) {
            const offset = index * 4
            const red = pixels[offset]
            const green = pixels[offset + 1]
            const blue = pixels[offset + 2]
            colors.add((Math.round(red / 16) << 8) | (Math.round(green / 16) << 4) | Math.round(blue / 16))
            if (red + green + blue > 90) nonDark += 1
            samples += 1
          }
          renderer.domElement.dataset.pixelSamples = String(samples)
          renderer.domElement.dataset.pixelNonDark = String(nonDark)
          renderer.domElement.dataset.pixelColors = String(colors.size)
          renderer.domElement.dataset.renderObjects = String(scene.children.length)
          renderer.domElement.dataset.pixelCheck = 'complete'
          pixelCheckRequestedRef.current = false
        }
        animationRef.current = requestAnimationFrame(animate)
      }
      animate()

      return () => {
        observer.disconnect()
        renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
        renderer.domElement.removeEventListener('pointerup', handlePointerUp)
        renderer.domElement.removeEventListener('pointercancel', clearPointerStart)
        renderer.domElement.removeEventListener('pointerleave', clearPointerStart)
        if (animationRef.current !== null) cancelAnimationFrame(animationRef.current)
        controls.dispose()
        renderer.dispose()
        renderer.domElement.remove()
        scene.clear()
      }
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : 'WebGL 初始化失败')
    }
  }, [])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    if (boardRootRef.current) {
      scene.remove(boardRootRef.current)
      disposeObject(boardRootRef.current)
      boardRootRef.current = null
    }
    if (!board) return

    try {
      const object = buildBoardObject(board, thickness, boardColor, () => {
        pixelCheckRequestedRef.current = true
      })
      scene.add(object)
      boardRootRef.current = object
      pixelCheckRequestedRef.current = true
      setRenderError(null)
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : '3D 几何生成失败')
    }
  }, [board, thickness, boardColor])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    if (componentRootRef.current) {
      componentRootRef.current.userData.disposed = true
      scene.remove(componentRootRef.current)
      disposeObject(componentRootRef.current)
      componentRootRef.current = null
    }
    if (!board || !alignment) return

    const object = createPlacementObject(
      board,
      thickness,
      alignment,
      bomItems,
      selectedDesignators,
      () => {
        pixelCheckRequestedRef.current = true
      },
    )
    scene.add(object)
    componentRootRef.current = object
    if (cameraRef.current) applyComponentVisibility(object, visibility.components, cameraRef.current.position.z)
    pixelCheckRequestedRef.current = true
  }, [board, thickness, alignment, bomItems, selectedDesignators, visibility.components])

  useEffect(() => {
    visibilityRef.current = visibility
    const root = boardRootRef.current
    if (root && cameraRef.current) applyBoardVisibility(root, visibility, cameraRef.current.position.z)
    const components = componentRootRef.current
    if (components && cameraRef.current) {
      applyComponentVisibility(components, visibility.components, cameraRef.current.position.z)
    }
    if (gridRef.current) gridRef.current.visible = visibility.grid
    pixelCheckRequestedRef.current = true
  }, [visibility, board, thickness, boardColor])

  useEffect(() => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls || !board) return
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2)
    const fitHeight = board.heightMm / (2 * Math.tan(halfFov))
    const fitWidth = board.widthMm / (2 * Math.tan(halfFov) * Math.max(camera.aspect, 0.1))
    const distance = Math.max(Math.max(fitHeight, fitWidth) * (cameraPreset === 'iso' ? 1.55 : 1.2), 48)

    if (cameraPreset === 'top') {
      camera.position.set(0, 0, distance)
      camera.up.set(0, 1, 0)
    } else if (cameraPreset === 'bottom') {
      camera.position.set(0, 0, -distance)
      camera.up.set(0, 1, 0)
    } else {
      camera.position.set(0.76, -1, 0.82).normalize().multiplyScalar(distance)
      camera.up.set(0, 0, 1)
    }
    controls.target.set(0, 0, 0)
    camera.near = Math.max(distance / 1000, 0.05)
    camera.far = distance * 12
    camera.updateProjectionMatrix()
    controls.update()
    pixelCheckRequestedRef.current = true
  }, [board, cameraPreset, cameraRevision, viewportRevision])

  return (
    <div className="viewer-host" ref={hostRef}>
      {renderError && (
        <div className="viewer-error" role="alert">
          <strong>无法生成 3D 视图</strong>
          <span>{renderError}</span>
        </div>
      )}
    </div>
  )
}
