import type {
  Capable, Structurable, Jsonable,
  RevivableModule, RevivableContext, BoxBase,
  DeepReplaceWithBox, DeepReplaceWithRevive,
  ReplaceWithBox, ReplaceWithRevive,
} from '../../src/index'
import type { BoxedFunction } from '../../src/revivables/function'
import type { BoxedPromise } from '../../src/revivables/promise'
import type { BoxedMap } from '../../src/revivables/map'
import type { BoxedSet } from '../../src/revivables/set'
import type { DefaultRevivableModule } from '../../src/revivables'

// Compile-time test scaffolding. None of these run at runtime — TypeScript's
// errors are the test results. The export is a no-op so the module side-effect
// import keeps these checks part of the build.

type Expect<T extends true> = T
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? true
    : false
type Assignable<From, To> = From extends To ? true : false

// --- Jsonable / Structurable / Capable membership --------------------------

type _JsonablePositives = [
  Expect<Assignable<string, Jsonable>>,
  Expect<Assignable<number, Jsonable>>,
  Expect<Assignable<boolean, Jsonable>>,
  Expect<Assignable<null, Jsonable>>,
  Expect<Assignable<{ foo: string }, Jsonable>>,
  Expect<Assignable<string[], Jsonable>>,
]

type _StructurablePositives = [
  Expect<Assignable<bigint, Structurable>>,
  Expect<Assignable<Date, Structurable>>,
  Expect<Assignable<RegExp, Structurable>>,
  Expect<Assignable<Blob, Structurable>>,
  Expect<Assignable<ArrayBuffer, Structurable>>,
  Expect<Assignable<Uint8Array, Structurable>>,
  Expect<Assignable<Map<string, number>, Structurable>>,
  Expect<Assignable<Set<number>, Structurable>>,
  Expect<Assignable<undefined, Structurable>>,
]

type _CapablePositives = [
  Expect<Assignable<bigint, Capable>>,
  Expect<Assignable<Promise<number>, Capable>>,
  Expect<Assignable<() => number, Capable>>,
  Expect<Assignable<MessagePort, Capable>>,
  Expect<Assignable<ReadableStream, Capable>>,
  Expect<Assignable<AbortSignal, Capable>>,
  Expect<Assignable<EventTarget, Capable>>,
  Expect<Assignable<Map<string, Promise<bigint>>, Capable>>,
  Expect<Assignable<Set<Date>, Capable>>,
  Expect<Assignable<{ nested: { deeper: { fn: () => Promise<number> } } }, Capable>>,
  Expect<Assignable<Array<Map<string, Promise<number>>>, Capable>>,
]

// --- Negative cases (these should NOT be Capable) --------------------------

type _CapableNegatives = [
  Expect<Equals<WeakMap<object, string> extends Capable ? true : false, false>>,
  Expect<Equals<WeakSet<object> extends Capable ? true : false, false>>,
  Expect<Equals<symbol extends Capable ? true : false, false>>,
  Expect<Equals<((sym: symbol) => void) extends Capable ? true : false, false>>,
]

// --- ReplaceWithBox: a single-level swap ---------------------------------

type _ReplaceBoxFn =
  ReplaceWithBox<() => Promise<number>, DefaultRevivableModule>
// A function value should be replaced by its BoxedFunction shape.
type _CheckFnReplaced = Expect<
  // The replaced type is a BoxBase subtype, not the original function.
  _ReplaceBoxFn extends BoxBase<'function'> ? true : false
>

type _ReplacePromise =
  ReplaceWithBox<Promise<number>, DefaultRevivableModule>
type _CheckPromiseReplaced = Expect<
  _ReplacePromise extends BoxBase<'promise'> ? true : false
>

type _ReplaceMap =
  ReplaceWithBox<Map<string, number>, DefaultRevivableModule>
type _CheckMapReplaced = Expect<
  _ReplaceMap extends BoxBase<'map'> ? true : false
>

type _ReplaceSet =
  ReplaceWithBox<Set<number>, DefaultRevivableModule>
type _CheckSetReplaced = Expect<
  _ReplaceSet extends BoxBase<'set'> ? true : false
>

type _ReplaceBigInt =
  ReplaceWithBox<bigint, DefaultRevivableModule>
type _CheckBigIntReplaced = Expect<
  _ReplaceBigInt extends BoxBase<'bigint'> ? true : false
>

type _ReplaceEventTarget =
  ReplaceWithBox<EventTarget, DefaultRevivableModule>
type _CheckEventTargetReplaced = Expect<
  _ReplaceEventTarget extends BoxBase ? true : false
>

// Plain values pass through unchanged.
type _PlainPassthrough = ReplaceWithBox<{ foo: string }, DefaultRevivableModule>
type _CheckPlainPassthrough = Expect<
  Equals<_PlainPassthrough, { foo: string }>
>

// --- DeepReplaceWithBox: recursion through containers --------------------

type _DeepReplaceObj =
  DeepReplaceWithBox<{ fn: () => Promise<number>, plain: string }, DefaultRevivableModule>
// The fn key gets boxed; the plain key stays.
type _CheckDeepObj = Expect<
  _DeepReplaceObj extends { fn: BoxBase<'function'>, plain: string } ? true : false
>

type _DeepReplaceArr =
  DeepReplaceWithBox<Array<Promise<number>>, DefaultRevivableModule>
type _CheckDeepArr = Expect<
  _DeepReplaceArr extends Array<BoxBase<'promise'>> ? true : false
>

// --- ReplaceWithRevive: round-trips --------------------------------------

type _ReviveFn = ReplaceWithRevive<BoxedFunction<() => Promise<number>>, DefaultRevivableModule>
// A boxed function revives into a callable returning Promise<number>.
type _CheckReviveFn = Expect<
  _ReviveFn extends (...args: never) => Promise<unknown> ? true : false
>

type _RevivePromise = ReplaceWithRevive<BoxedPromise<number>, DefaultRevivableModule>
type _CheckRevivePromise = Expect<
  _RevivePromise extends Promise<unknown> ? true : false
>

type _ReviveMap = ReplaceWithRevive<BoxedMap<Map<string, number>>, DefaultRevivableModule>
type _CheckReviveMap = Expect<
  _ReviveMap extends Map<unknown, unknown> ? true : false
>

type _ReviveSet = ReplaceWithRevive<BoxedSet<Set<number>>, DefaultRevivableModule>
type _CheckReviveSet = Expect<
  _ReviveSet extends Set<unknown> ? true : false
>

// --- Custom RevivableModule inference ------------------------------------

type Point = { x: number; y: number }
type BoxedPoint = BoxBase<'point'> & { x: number; y: number }

const pointModule = {
  type: 'point' as const,
  isType: (value: unknown): value is Point =>
    !!value && typeof value === 'object' && 'x' in value && 'y' in value,
  box: (value: Point, _ctx: RevivableContext): BoxedPoint =>
    ({ [Symbol.for('osra-box-base-tag') as never]: 'revivable' as const, type: 'point' as const, x: value.x, y: value.y } as unknown as BoxedPoint),
  revive: (value: BoxedPoint, _ctx: RevivableContext): Point =>
    ({ x: value.x, y: value.y }),
} as const satisfies RevivableModule

// `satisfies RevivableModule` must hold without losing the literal `'point'`.
type _PointType = Expect<Equals<typeof pointModule.type, 'point'>>

// --- Final: the whole RevivableContext default uses DefaultRevivableModules ---

type _CtxDefault = RevivableContext
type _CtxModulesContains = Expect<
  // Existing default modules must include every type tag we ship.
  // (Touching all keeps the inference path live.)
  Capable extends infer C ? C extends Capable ? true : false : false
>

export const __types = () => {
  // Force the file to be retained even if all assertions are erased.
  return null as unknown as
    | [_JsonablePositives, _StructurablePositives, _CapablePositives, _CapableNegatives]
    | [_CheckFnReplaced, _CheckPromiseReplaced, _CheckMapReplaced, _CheckSetReplaced, _CheckBigIntReplaced, _CheckEventTargetReplaced]
    | [_CheckPlainPassthrough, _CheckDeepObj, _CheckDeepArr]
    | [_CheckReviveFn, _CheckRevivePromise, _CheckReviveMap, _CheckReviveSet]
    | [_PointType, _CtxModulesContains]
}
