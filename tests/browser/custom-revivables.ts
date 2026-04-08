import type { Transport } from '../../src/types'
import type { RevivableContext, RevivableModule } from '../../src/index'

import { expect } from 'chai'

import { expose, BoxBase } from '../../src/index'

class Point {
  constructor(public x: number, public y: number) {}
  distance() {
    return Math.sqrt(this.x ** 2 + this.y ** 2)
  }
}

const pointModule = {
  type: 'point' as const,
  isType: (value: unknown): value is Point => value instanceof Point,
  box: (value: Point, _context: RevivableContext) => ({
    ...BoxBase,
    type: 'point' as const,
    x: value.x,
    y: value.y,
  }),
  revive: (value: { x: number; y: number }, _context: RevivableContext) =>
    new Point(value.x, value.y),
} as const satisfies RevivableModule

export const userPoint = async (transport: Transport) => {
  const value = async (p: Point) => {
    if (!(p instanceof Point)) {
      throw new Error('received value is not a Point instance')
    }
    return new Point(p.x * 2, p.y * 2)
  }
  expose(value, { transport, revivableModules: [pointModule] })

  const test = await expose<typeof value>(
    {},
    { transport, revivableModules: [pointModule] },
  )

  const result = await test(new Point(3, 4))
  expect(result).to.be.instanceOf(Point)
  expect(result.x).to.equal(6)
  expect(result.y).to.equal(8)
  expect(result.distance()).to.equal(10)
}

export const userPointReturn = async (transport: Transport) => {
  const value = async () => new Point(1, 2)
  expose(value, { transport, revivableModules: [pointModule] })

  const test = await expose<typeof value>(
    {},
    { transport, revivableModules: [pointModule] },
  )

  const result = await test()
  expect(result).to.be.instanceOf(Point)
  expect(result.x).to.equal(1)
  expect(result.y).to.equal(2)
}

export const userPointDefaultsStillWork = async (transport: Transport) => {
  const value = async () => new Date('2026-04-08T00:00:00.000Z')
  expose(value, { transport, revivableModules: [pointModule] })

  const test = await expose<typeof value>(
    {},
    { transport, revivableModules: [pointModule] },
  )

  const result = await test()
  expect(result).to.be.instanceOf(Date)
  expect(result.toISOString()).to.equal('2026-04-08T00:00:00.000Z')
}

/**
 * Identity dedup covers user-defined revivables: passing the same class
 * instance twice (as two args to one call) should revive to the same
 * reference on the other side, because the identity layer in recursiveBox
 * applies to every object-like module (not just functions).
 */
export const userPointIdentityPreserved = async (transport: Transport) => {
  const value = {
    compare: async (a: Point, b: Point) => a === b,
  }
  expose(value, { transport, revivableModules: [pointModule] })

  const { compare } = await expose<typeof value>(
    {},
    { transport, revivableModules: [pointModule] },
  )

  const p = new Point(3, 4)
  await expect(compare(p, p)).to.eventually.equal(true)
}
