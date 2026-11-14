import { Context, Effect, Layer, Queue, Stream } from "effect"

/**
 * The size of an element, so a component can follow it from a Command and a
 * test can drive it.
 */
export class ElementSize extends Context.Service<
  ElementSize,
  {
    /**
     * Emits once when it starts, then each time the element's content box
     * changes size.
     */
    readonly changes: (element: Element) => Stream.Stream<void>
  }
>()("browser/ElementSize") {
  static readonly layer = Layer.sync(ElementSize, () => ({
    changes: (element) =>
      Stream.callback<void>(
        (queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const observer = new ResizeObserver(() => {
                Queue.offerUnsafe(queue, undefined)
              })
              observer.observe(element)
              return observer
            }),
            (observer) => Effect.sync(() => observer.disconnect()),
          ),
        // Changes that weren't read yet are one change
        { bufferSize: 1, strategy: "sliding" },
      ),
  }))
}
