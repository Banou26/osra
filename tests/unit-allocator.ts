import { expect } from 'chai'

import {
  makeAllocator,
  makeMessageChannelAllocator
} from '../src/utils/allocator'

// ============ Generic Allocator Tests ============

export const testAllocatorBasicOperations = () => {
  const allocator = makeAllocator<string>()

  // Alloc should return a UUID
  const uuid1 = allocator.alloc('value1')
  expect(uuid1).to.match(/^[a-f0-9-]{36}$/)

  // Has should return true for allocated UUIDs
  expect(allocator.has(uuid1)).to.be.true

  // Get should return the allocated value
  expect(allocator.get(uuid1)).to.equal('value1')

  // Free should remove the allocation
  allocator.free(uuid1)
  expect(allocator.has(uuid1)).to.be.false
  expect(allocator.get(uuid1)).to.be.undefined
}

export const testAllocatorUniqueUuids = () => {
  const allocator = makeAllocator<number>()
  const uuids = new Set<string>()

  // Allocate 100 items and verify uniqueness
  for (let i = 0; i < 100; i++) {
    const uuid = allocator.alloc(i)
    expect(uuids.has(uuid)).to.be.false
    uuids.add(uuid)
  }

  // Verify all allocations exist
  expect(uuids.size).to.equal(100)
}

export const testAllocatorSetOperation = () => {
  const allocator = makeAllocator<string>()

  // Set with specific UUID
  allocator.set('custom-uuid', 'custom-value')
  expect(allocator.has('custom-uuid')).to.be.true
  expect(allocator.get('custom-uuid')).to.equal('custom-value')

  // Update existing value
  allocator.set('custom-uuid', 'updated-value')
  expect(allocator.get('custom-uuid')).to.equal('updated-value')
}

export const testAllocatorObjectValues = () => {
  const allocator = makeAllocator<{ name: string; count: number }>()

  const obj = { name: 'test', count: 42 }
  const uuid = allocator.alloc(obj)

  const retrieved = allocator.get(uuid)
  expect(retrieved).to.deep.equal(obj)
  expect(retrieved).to.equal(obj) // Same reference
}

// ============ MessageChannel Allocator Tests ============

export const testMessageChannelAllocatorBasicOperations = () => {
  const allocator = makeMessageChannelAllocator()

  // Alloc without UUID should generate one
  const channel1 = allocator.alloc()
  expect(channel1.uuid).to.match(/^[a-f0-9-]{36}$/)
  expect(channel1.port1).to.be.instanceOf(MessagePort)
  expect(channel1.port2).to.be.instanceOf(MessagePort)

  // Has should return true
  expect(allocator.has(channel1.uuid)).to.be.true

  // Get should return the channel
  const retrieved = allocator.get(channel1.uuid)
  expect(retrieved).to.deep.equal(channel1)

  // Free should remove it
  allocator.free(channel1.uuid)
  expect(allocator.has(channel1.uuid)).to.be.false

  // Clean up
  channel1.port1.close()
  channel1.port2?.close()
}

export const testMessageChannelAllocatorWithCustomUuid = () => {
  const allocator = makeMessageChannelAllocator()
  const customUuid = '12345678-1234-1234-1234-123456789012' as const

  const channel = allocator.alloc(customUuid)
  expect(channel.uuid).to.equal(customUuid)
  expect(allocator.has(customUuid)).to.be.true

  // Clean up
  allocator.free(customUuid)
  channel.port1.close()
  channel.port2?.close()
}

export const testMessageChannelAllocatorWithExistingPorts = () => {
  const allocator = makeMessageChannelAllocator()
  const { port1: existingPort1, port2: existingPort2 } = new MessageChannel()

  const channel = allocator.alloc(undefined, { port1: existingPort1, port2: existingPort2 })

  expect(channel.port1).to.equal(existingPort1)
  expect(channel.port2).to.equal(existingPort2)
  expect(allocator.has(channel.uuid)).to.be.true

  // Clean up
  allocator.free(channel.uuid)
  existingPort1.close()
  existingPort2.close()
}

export const testMessageChannelAllocatorGetOrAlloc = () => {
  const allocator = makeMessageChannelAllocator()
  const customUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' as const

  // First call should allocate
  const channel1 = allocator.getOrAlloc(customUuid)
  expect(channel1.uuid).to.equal(customUuid)

  // Second call should return same channel
  const channel2 = allocator.getOrAlloc(customUuid)
  expect(channel2).to.equal(channel1)

  // Clean up
  allocator.free(customUuid)
  channel1.port1.close()
  channel1.port2?.close()
}

export const testMessageChannelAllocatorGetUniqueUuid = () => {
  const allocator = makeMessageChannelAllocator()
  const uuids = new Set<string>()

  // Generate 100 unique UUIDs
  for (let i = 0; i < 100; i++) {
    const uuid = allocator.getUniqueUuid()
    expect(uuids.has(uuid)).to.be.false
    uuids.add(uuid)
    // Allocate it so it's taken
    allocator.alloc(uuid)
  }

  expect(uuids.size).to.equal(100)
}

export const testMessageChannelAllocatorSetOperation = () => {
  const allocator = makeMessageChannelAllocator()
  const { port1, port2 } = new MessageChannel()
  const customUuid = 'cccccccc-dddd-eeee-ffff-111111111111' as const

  // Set with specific ports
  allocator.set(customUuid, { port1, port2 })
  expect(allocator.has(customUuid)).to.be.true

  const retrieved = allocator.get(customUuid)
  expect(retrieved?.port1).to.equal(port1)
  expect(retrieved?.port2).to.equal(port2)

  // Clean up
  allocator.free(customUuid)
  port1.close()
  port2.close()
}

export const testMessageChannelAllocatorPartialPorts = () => {
  const allocator = makeMessageChannelAllocator()
  const { port1 } = new MessageChannel()
  const customUuid = 'dddddddd-eeee-ffff-0000-222222222222' as const

  // Allocate with only port1 (simulating received remote port)
  const channel = allocator.alloc(customUuid, { port1 })

  expect(channel.port1).to.equal(port1)
  expect(channel.port2).to.be.undefined

  // Clean up
  allocator.free(customUuid)
  port1.close()
}
