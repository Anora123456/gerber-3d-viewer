import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import initializeOcct, { type OcctMesh } from 'occt-import-js'
import occtWasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url'

let importerPromise: ReturnType<typeof initializeOcct> | null = null
const gltfLoader = new GLTFLoader()

function getImporter() {
  if (!importerPromise) {
    importerPromise = initializeOcct({ locateFile: () => occtWasmUrl })
  }
  return importerPromise
}

function createMaterial(color?: [number, number, number]) {
  return new THREE.MeshStandardMaterial({
    color: color ? new THREE.Color(...color) : new THREE.Color(0xb8bcb8),
    metalness: 0.18,
    roughness: 0.56,
  })
}

function createMesh(source: OcctMesh): THREE.Mesh {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.attributes.position.array, 3))
  if (source.attributes.normal) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(source.attributes.normal.array, 3))
  } else {
    geometry.computeVertexNormals()
  }
  geometry.setIndex(new THREE.Uint32BufferAttribute(source.index.array, 1))
  geometry.name = source.name

  const materials: THREE.Material[] = []
  const materialIndexes = new Map<string, number>()
  const getMaterialIndex = (color?: [number, number, number]) => {
    const effectiveColor = color ?? source.color
    const key = effectiveColor
      ? effectiveColor.map((channel) => Math.round(channel * 255)).join(':')
      : 'default'
    const existing = materialIndexes.get(key)
    if (existing !== undefined) return existing
    const index = materials.length
    materials.push(createMaterial(effectiveColor))
    materialIndexes.set(key, index)
    return index
  }
  const defaultMaterialIndex = getMaterialIndex(source.color)
  const addMaterialGroup = (start: number, count: number, index: number) => {
    const previous = geometry.groups.at(-1)
    if (previous && previous.materialIndex === index && previous.start + previous.count === start) {
      previous.count += count
    } else {
      geometry.addGroup(start, count, index)
    }
  }
  if (source.brep_faces?.length) {
    const triangleCount = source.index.array.length / 3
    let triangleIndex = 0
    let faceIndex = 0
    while (triangleIndex < triangleCount) {
      const first = triangleIndex
      let last: number
      let groupMaterialIndex: number
      const face = source.brep_faces[faceIndex]
      if (!face) {
        last = triangleCount
        groupMaterialIndex = defaultMaterialIndex
      } else if (triangleIndex < face.first) {
        last = face.first
        groupMaterialIndex = defaultMaterialIndex
      } else {
        last = face.last + 1
        groupMaterialIndex = getMaterialIndex(face.color)
        faceIndex += 1
      }
      addMaterialGroup(first * 3, (last - first) * 3, groupMaterialIndex)
      triangleIndex = last
    }
  }

  const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials)
  mesh.name = source.name
  return mesh
}

export async function parseStepArrayBuffer(buffer: ArrayBuffer, name = 'STEP model'): Promise<THREE.Group> {
  const importer = await getImporter()
  const result = importer.ReadStepFile(new Uint8Array(buffer), {
    linearUnit: 'millimeter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.001,
    angularDeflection: 0.5,
  })
  if (!result.success || result.meshes.length === 0) {
    throw new Error('STEP 文件中没有可显示的实体')
  }

  const group = new THREE.Group()
  group.name = name.replace(/\.(?:step|stp)$/i, '')
  result.meshes.forEach((mesh) => group.add(createMesh(mesh)))
  return group
}

export async function parseStepModel(file: File): Promise<THREE.Group> {
  return parseStepArrayBuffer(await file.arrayBuffer(), file.name)
}

export async function parsePreviewModelFile(file: File): Promise<THREE.Object3D> {
  if (/\.glb$/i.test(file.name)) {
    const buffer = await file.arrayBuffer()
    return new Promise((resolve, reject) => {
      gltfLoader.parse(buffer, '', (gltf) => resolve(gltf.scene), reject)
    })
  }
  return parseStepModel(file)
}

export function disposeObject3D(root: THREE.Object3D) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => material.dispose())
  })
}
