declare module 'occt-import-js' {
  interface OcctAttribute {
    array: number[]
  }

  interface OcctFace {
    first: number
    last: number
    color?: [number, number, number]
  }

  export interface OcctMesh {
    name: string
    color?: [number, number, number]
    attributes: {
      position: OcctAttribute
      normal?: OcctAttribute
    }
    index: OcctAttribute
    brep_faces?: OcctFace[]
  }

  export interface OcctReadResult {
    success: boolean
    meshes: OcctMesh[]
  }

  interface OcctImporter {
    ReadStepFile(content: Uint8Array, parameters: Record<string, unknown> | null): OcctReadResult
  }

  export default function initialize(options?: {
    locateFile?: (path: string) => string
  }): Promise<OcctImporter>
}
