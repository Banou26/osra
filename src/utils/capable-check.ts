export declare const ErrorMessage: unique symbol
export declare const BadValue: unique symbol
export declare const Path: unique symbol
export declare const ParentObject: unique symbol

type IsPlainObject<T> =
  T extends object
    ? T extends readonly unknown[]
      ? false
      : T extends (...args: any[]) => any
        ? false
        : T extends Date | RegExp | Blob | File | FileList | ArrayBuffer | ArrayBufferView | ImageBitmap | ImageData | Map<any, any> | Set<any> | Promise<any>
          ? false
          : true
    : false

type FindBadField<T, TConstraint, TPath extends string = '', TParent = T> =
  T extends TConstraint
    ? never
    : T extends readonly unknown[]
      ? {
          [K in Extract<keyof T, `${number}`>]:
            T[K] extends TConstraint
              ? never
              : FindBadField<T[K], TConstraint, `${TPath}[${K}]`, T>
        }[Extract<keyof T, `${number}`>] extends infer R
          ? [R] extends [never]
            ? { value: T; path: TPath; parent: TParent }
            : R
          : never
      : IsPlainObject<T> extends true
        ? {
            [K in Extract<keyof T, string>]:
              T[K] extends TConstraint
                ? never
                : FindBadField<T[K], TConstraint, TPath extends '' ? K : `${TPath}.${K}`, T>
          }[Extract<keyof T, string>] extends infer R
            ? [R] extends [never]
              ? { value: T; path: TPath; parent: TParent }
              : R
            : never
        : { value: T; path: TPath; parent: TParent }

/**
 * The first non-conforming value found by deep traversal of `T` against
 * `TConstraint`. Falls back to `T` if no traversal is applicable.
 */
export type BadFieldValue<T, TConstraint> =
  FindBadField<T, TConstraint> extends { value: infer V } ? V : T

/**
 * Dotted/bracketed path to the first non-conforming value (e.g. `"a.b[2]"`).
 * Empty string if the root itself fails the check.
 */
export type BadFieldPath<T, TConstraint> =
  FindBadField<T, TConstraint> extends { path: infer P extends string } ? P : ''

/**
 * The immediate parent object/array containing the first non-conforming
 * value. Equals `T` when the root itself fails.
 */
export type BadFieldParent<T, TConstraint> =
  FindBadField<T, TConstraint> extends { parent: infer P } ? P : T
