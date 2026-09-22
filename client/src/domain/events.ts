export type DeckEvent =
  | { type: 'task.created'; taskId: string; projectId: string }
  | { type: 'task.started'; taskId: string }
  | { type: 'task.paused'; taskId: string }
  | { type: 'task.completed'; taskId: string }
  | { type: 'task.failed'; taskId: string }
  | { type: 'task.cancelled'; taskId: string }
  | { type: 'pipeline.step.started'; taskId: string; stepId: string; agentId: string }
  | { type: 'pipeline.step.completed'; taskId: string; stepId: string; agentId: string }
  | { type: 'pipeline.step.failed'; taskId: string; stepId: string; agentId: string }
  | { type: 'agent.started'; agentId: string; taskId: string }
  | { type: 'agent.waiting'; agentId: string; taskId: string }
  | { type: 'agent.reviewing'; agentId: string; taskId: string }
  | { type: 'agent.completed'; agentId: string; taskId: string }
  | { type: 'agent.blocked'; agentId: string; taskId: string }

type Listener = (event: DeckEvent) => void

class DeckEventBus {
  private listeners = new Set<Listener>()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: DeckEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (err) {
        console.error('[DeckEventBus]', err)
      }
    }
  }
}

export const deckEvents = new DeckEventBus()
