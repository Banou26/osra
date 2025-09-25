
export const makeNumberAllocator = () => {
  let highest = 0
  const freedUnused = new Set<number>()
  return {
    alloc: () => {
      if (freedUnused.size > 0) {
        const number = freedUnused.values().next().value
        if (number === undefined) {
          throw new Error(`Tried to allocate number from freedUnused but result was undefined`)
        }
        freedUnused.delete(number)
        return number
      }
      highest++
      return highest
    },
    free: (number: number) => {
      freedUnused.add(number)
    }
  }
}

export type NumberAllocator = ReturnType<typeof makeNumberAllocator>

export const makeAllocator = <T>({ numberAllocator }: { numberAllocator: NumberAllocator }) => {
  const channels = new Map<number, T>()

  const alloc = (value: T) => {
    const id = numberAllocator.alloc()
    channels.set(id, value)
    return id
  }
  const get = (id: number) => channels.get(id)
  const free = (id: number) => {
    channels.delete(id)
    numberAllocator.free(id)
  }

  return {
    alloc,
    get,
    free
  }
}

export type Allocator<T> = ReturnType<typeof makeAllocator<T>>
