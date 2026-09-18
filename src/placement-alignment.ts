import type { PlacementRecord } from './assembly-data'
import type { ParsedBoard } from './gerber'

export type PlacementAlignmentStatus = 'aligned' | 'estimated' | 'out-of-range'

export interface AlignedPlacement extends PlacementRecord {
  boardXmm: number
  boardYmm: number
  isInsideBoard: boolean
}

export interface PlacementAlignment {
  mode: 'shared-origin' | 'board-origin' | 'board-origin-y-down' | 'inverted-y' | 'estimated-center'
  methodLabel: string
  status: PlacementAlignmentStatus
  insideCount: number
  totalCount: number
  insideRatio: number
  offsetXmm: number
  offsetYmm: number
  placements: AlignedPlacement[]
}

interface AlignmentCandidate {
  mode: PlacementAlignment['mode']
  methodLabel: string
  priority: number
  estimated?: boolean
  transform: (placement: PlacementRecord) => [number, number]
}

interface ScoredCandidate {
  candidate: AlignmentCandidate
  insideCount: number
  overflow: number
  transformed: Array<[number, number]>
}

const BOARD_TOLERANCE_MM = 0.8

function axisOverflow(value: number, minimum: number, maximum: number): number {
  if (value < minimum) return minimum - value
  if (value > maximum) return value - maximum
  return 0
}

function scoreCandidate(
  candidate: AlignmentCandidate,
  placements: PlacementRecord[],
  bounds: ParsedBoard['boundsMm'],
): ScoredCandidate {
  const [x1, y1, x2, y2] = bounds
  const transformed = placements.map(candidate.transform)
  let insideCount = 0
  let overflow = 0

  transformed.forEach(([x, y]) => {
    const xOverflow = axisOverflow(x, x1 - BOARD_TOLERANCE_MM, x2 + BOARD_TOLERANCE_MM)
    const yOverflow = axisOverflow(y, y1 - BOARD_TOLERANCE_MM, y2 + BOARD_TOLERANCE_MM)
    if (xOverflow === 0 && yOverflow === 0) insideCount += 1
    overflow += xOverflow * xOverflow + yOverflow * yOverflow
  })

  return { candidate, insideCount, overflow, transformed }
}

function placementCenter(placements: PlacementRecord[]): [number, number] {
  let x1 = Number.POSITIVE_INFINITY
  let y1 = Number.POSITIVE_INFINITY
  let x2 = Number.NEGATIVE_INFINITY
  let y2 = Number.NEGATIVE_INFINITY
  placements.forEach((placement) => {
    x1 = Math.min(x1, placement.xMm)
    y1 = Math.min(y1, placement.yMm)
    x2 = Math.max(x2, placement.xMm)
    y2 = Math.max(y2, placement.yMm)
  })
  return [(x1 + x2) / 2, (y1 + y2) / 2]
}

export function alignPlacements(
  board: ParsedBoard,
  placements: PlacementRecord[],
): PlacementAlignment | null {
  if (placements.length === 0) return null
  const [x1, y1, x2, y2] = board.boundsMm
  const candidates: AlignmentCandidate[] = [
    {
      mode: 'shared-origin',
      methodLabel: 'Gerber 与坐标共用原点',
      priority: 50,
      transform: ({ xMm, yMm }) => [xMm, yMm],
    },
    {
      mode: 'board-origin',
      methodLabel: '坐标以板框左下角为原点',
      priority: 40,
      transform: ({ xMm, yMm }) => [x1 + xMm, y1 + yMm],
    },
    {
      mode: 'board-origin-y-down',
      methodLabel: '坐标以板框左上角为原点',
      priority: 30,
      transform: ({ xMm, yMm }) => [x1 + xMm, y2 - yMm],
    },
    {
      mode: 'inverted-y',
      methodLabel: 'Gerber 共用原点，Y 轴反向',
      priority: 20,
      transform: ({ xMm, yMm }) => [xMm, -yMm],
    },
  ]

  let scored = candidates.map((candidate) => scoreCandidate(candidate, placements, board.boundsMm))
  const strongestKnown = Math.max(...scored.map((result) => result.insideCount / placements.length))

  if (strongestKnown < 0.8) {
    const [placementX, placementY] = placementCenter(placements)
    const offsetX = (x1 + x2) / 2 - placementX
    const offsetY = (y1 + y2) / 2 - placementY
    const estimate: AlignmentCandidate = {
      mode: 'estimated-center',
      methodLabel: '按板框与坐标范围中心估算',
      priority: 0,
      estimated: true,
      transform: ({ xMm, yMm }) => [xMm + offsetX, yMm + offsetY],
    }
    scored = [...scored, scoreCandidate(estimate, placements, board.boundsMm)]
  }

  scored.sort((left, right) => (
    right.insideCount - left.insideCount
    || left.overflow - right.overflow
    || right.candidate.priority - left.candidate.priority
  ))

  const best = scored[0]
  const insideRatio = best.insideCount / placements.length
  const firstPlacement = placements[0]
  const firstTransformed = best.transformed[0]
  const offsetXmm = firstTransformed[0] - firstPlacement.xMm
  const offsetYmm = firstTransformed[1] - firstPlacement.yMm
  const status: PlacementAlignmentStatus = best.candidate.estimated
    ? 'estimated'
    : insideRatio >= 0.98 ? 'aligned' : 'out-of-range'

  return {
    mode: best.candidate.mode,
    methodLabel: best.candidate.methodLabel,
    status,
    insideCount: best.insideCount,
    totalCount: placements.length,
    insideRatio,
    offsetXmm,
    offsetYmm,
    placements: placements.map((placement, index) => {
      const [boardXmm, boardYmm] = best.transformed[index]
      return {
        ...placement,
        boardXmm,
        boardYmm,
        isInsideBoard: (
          boardXmm >= x1 - BOARD_TOLERANCE_MM
          && boardXmm <= x2 + BOARD_TOLERANCE_MM
          && boardYmm >= y1 - BOARD_TOLERANCE_MM
          && boardYmm <= y2 + BOARD_TOLERANCE_MM
        ),
      }
    }),
  }
}
