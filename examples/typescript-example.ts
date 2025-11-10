// TypeScript Example with Full Type Safety
// This example demonstrates Osra's TypeScript support

// === types.ts ===
export interface User {
  id: string
  name: string
  email: string
  createdAt: Date
  lastLogin: Date | null
}

export interface TodoItem {
  id: string
  userId: string
  title: string
  completed: boolean
  dueDate: Date | null
  tags: string[]
}

// === worker.ts ===
import { expose } from 'osra'
import type { User, TodoItem } from './types'

class UserService {
  private users = new Map<string, User>()
  private todos = new Map<string, TodoItem[]>()

  async createUser(name: string, email: string): Promise<User> {
    const user: User = {
      id: crypto.randomUUID(),
      name,
      email,
      createdAt: new Date(),
      lastLogin: null
    }

    this.users.set(user.id, user)
    this.todos.set(user.id, [])

    return user
  }

  async getUser(userId: string): Promise<User | null> {
    return this.users.get(userId) || null
  }

  async updateLastLogin(userId: string): Promise<void> {
    const user = this.users.get(userId)
    if (user) {
      user.lastLogin = new Date()
    }
  }

  async addTodo(userId: string, title: string, tags: string[] = []): Promise<TodoItem> {
    const userTodos = this.todos.get(userId) || []

    const todo: TodoItem = {
      id: crypto.randomUUID(),
      userId,
      title,
      completed: false,
      dueDate: null,
      tags
    }

    userTodos.push(todo)
    this.todos.set(userId, userTodos)

    return todo
  }

  async getTodos(userId: string): Promise<TodoItem[]> {
    return this.todos.get(userId) || []
  }

  async completeTodo(todoId: string): Promise<boolean> {
    for (const [, todos] of this.todos) {
      const todo = todos.find(t => t.id === todoId)
      if (todo) {
        todo.completed = true
        return true
      }
    }
    return false
  }

  // Return a function that filters todos
  async createTodoFilter(userId: string) {
    const todos = this.todos.get(userId) || []

    return {
      byTag: async (tag: string) => todos.filter(t => t.tags.includes(tag)),
      byCompleted: async (completed: boolean) => todos.filter(t => t.completed === completed),
      byOverdue: async () => {
        const now = new Date()
        return todos.filter(t => t.dueDate && t.dueDate < now && !t.completed)
      }
    }
  }

  // Stream todos as they're added (generator function)
  async *streamTodos(userId: string) {
    const todos = this.todos.get(userId) || []
    for (const todo of todos) {
      yield todo
      // Simulate some async processing
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}

// Create an instance and expose it
const userService = new UserService()

// Export the type for use in main thread
export type UserServiceAPI = typeof userService

// Expose the service
expose(userService, { transport: self })


// === main.ts ===
import { expose } from 'osra'
import type { UserServiceAPI } from './worker'
import type { User, TodoItem } from './types'

async function main() {
  // Create worker
  const worker = new Worker('./worker.js', { type: 'module' })

  // Connect with full type safety
  const userService = await expose<UserServiceAPI>({}, { transport: worker })

  // All methods are fully typed!

  // Create a user - return type is inferred as Promise<User>
  const user: User = await userService.createUser('John Doe', 'john@example.com')
  console.log('Created user:', user)
  console.log('Created at is a Date:', user.createdAt instanceof Date) // true!

  // Update last login
  await userService.updateLastLogin(user.id)

  // Add some todos - return type is inferred as Promise<TodoItem>
  const todo1 = await userService.addTodo(user.id, 'Learn OSRA', ['programming', 'typescript'])
  const todo2 = await userService.addTodo(user.id, 'Build something cool', ['project'])
  const todo3 = await userService.addTodo(user.id, 'Write documentation', ['docs'])

  // Get todos - return type is inferred as Promise<TodoItem[]>
  const todos: TodoItem[] = await userService.getTodos(user.id)
  console.log(`User has ${todos.length} todos`)

  // Complete a todo
  const completed = await userService.completeTodo(todo1.id)
  console.log('Todo completed:', completed)

  // Get a filter function - this returns functions that can be called!
  const filter = await userService.createTodoFilter(user.id)

  // Use the filter functions
  const programmingTodos = await filter.byTag('programming')
  console.log('Programming todos:', programmingTodos)

  const incompleteTodos = await filter.byCompleted(false)
  console.log('Incomplete todos:', incompleteTodos.length)

  // Stream todos using async generator
  console.log('Streaming todos:')
  for await (const todo of userService.streamTodos(user.id)) {
    console.log(`  - ${todo.title} (${todo.completed ? '✓' : '○'})`)
  }

  // TypeScript will catch errors at compile time:
  // await userService.nonExistentMethod() // Error: Property 'nonExistentMethod' does not exist
  // await userService.createUser(123, true) // Error: Argument of type 'number' is not assignable to parameter of type 'string'

  // Clean up
  worker.terminate()
}

main().catch(console.error)