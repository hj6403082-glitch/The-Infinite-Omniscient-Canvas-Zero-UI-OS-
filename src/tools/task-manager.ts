import { a2ui } from '../a2ui/messages.ts'
import type { ToolRegistry } from './registry.ts'
import type { A2uiMessage, SystemStatus, TaskEndReason, ToolHandle, ToolName } from './types.ts'

export type { TaskEndReason }

export interface TaskEnded {
  surfaceId: string
  tool: ToolName
  reason: TaskEndReason
}

export interface TaskManagerOptions {
  registry: ToolRegistry
  emit(messages: A2uiMessage[]): void
  status(): Omit<SystemStatus, 'activeTasks'>
  onEnded(event: TaskEnded): void
  onError(surfaceId: string, error: unknown): void
  // Budget for a tool to finish streaming its surface (not for the user to respond).
  timeoutMs?: number
  maxSurfaces?: number
}

interface Task {
  surfaceId: string
  tool: ToolName
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  handle: ToolHandle | undefined
  ended: boolean
}

// Owns every tool surface from createSurface to deleteSurface (CLAUDE.md §5.4): each exit
// path emits exactly one deleteSurface, and nothing is emitted for a surface afterwards.
export function createTaskManager({
  registry,
  emit,
  status,
  onEnded,
  onError,
  timeoutMs = 10_000,
  maxSurfaces = 4,
}: TaskManagerOptions) {
  const tasks = new Map<string, Task>()
  let sequence = 0

  function end(task: Task, reason: TaskEndReason): void {
    if (task.ended) return
    task.ended = true
    clearTimeout(task.timer)
    task.controller.abort(new Error(`Task ${reason}`))
    tasks.delete(task.surfaceId)
    emit([a2ui.deleteSurface(task.surfaceId)])
    onEnded({ surfaceId: task.surfaceId, tool: task.tool, reason })
  }

  function fail(task: Task, error: unknown): void {
    if (task.ended) return
    onError(task.surfaceId, error)
    end(task, 'error')
  }

  return {
    get active(): string[] {
      return [...tasks.keys()]
    },

    start(toolName: ToolName, query: string): string {
      const tool = registry.get(toolName)
      for (const task of [...tasks.values()]) if (task.tool === toolName) end(task, 'superseded')
      while (tasks.size >= maxSurfaces) end(tasks.values().next().value!, 'evicted')

      const surfaceId = `${toolName}-${++sequence}`
      const controller = new AbortController()
      const task: Task = {
        surfaceId,
        tool: toolName,
        controller,
        handle: undefined,
        ended: false,
        timer: setTimeout(() => end(task, 'timeout'), timeoutMs),
      }
      tasks.set(surfaceId, task)
      emit([a2ui.createSurface(surfaceId)])

      const context = {
        surfaceId,
        signal: controller.signal,
        emit: (...messages: A2uiMessage[]) => {
          if (!task.ended) emit(messages)
        },
        status: () => ({ ...status(), activeTasks: tasks.size }),
      }
      tool.run(context, { query }).then(
        (handle) => {
          clearTimeout(task.timer)
          if (!task.ended) task.handle = handle
        },
        (error: unknown) => fail(task, error),
      )
      return surfaceId
    },

    // Returns false when the surface is unknown, finished, or still streaming.
    action(surfaceId: string, name: string, context: Readonly<Record<string, unknown>>): boolean {
      const task = tasks.get(surfaceId)
      if (!task?.handle) return false
      try {
        if (task.handle.onAction(name, context) === 'complete') end(task, 'completed')
      } catch (error) {
        fail(task, error)
      }
      return true
    },

    dismiss(surfaceId: string): boolean {
      const task = tasks.get(surfaceId)
      if (!task) return false
      end(task, 'dismissed')
      return true
    },

    endAll(reason: TaskEndReason = 'shutdown'): void {
      for (const task of [...tasks.values()]) end(task, reason)
    },
  }
}

export type TaskManager = ReturnType<typeof createTaskManager>
