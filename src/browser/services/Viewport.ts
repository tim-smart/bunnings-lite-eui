import { Context, Effect, Layer, Stream } from "effect"

export interface ViewportState {
  /** How far the page is scrolled, in CSS pixels. */
  readonly scrollY: number
  readonly width: number
  readonly height: number
  /** The height of the whole page. */
  readonly pageHeight: number
}

/**
 * The window's scroll position and size, so a component can follow them from
 * a Subscription and a test can drive them.
 */
export class Viewport extends Context.Service<
  Viewport,
  {
    /** The current state, then one for each scroll and resize. */
    readonly changes: Stream.Stream<ViewportState>
    /** Scrolls smoothly back to the top of the page. */
    readonly scrollToTop: Effect.Effect<void>
  }
>()("browser/Viewport") {
  static readonly layer = Layer.sync(Viewport, () => {
    const read = (): ViewportState => ({
      scrollY: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
      pageHeight: document.body.scrollHeight,
    })
    return {
      changes: Stream.concat(
        Stream.sync(read),
        Stream.merge(
          Stream.fromEventListener(window, "scroll", { passive: true }),
          Stream.fromEventListener(window, "resize"),
        ).pipe(Stream.map(read)),
      ),
      scrollToTop: Effect.sync(() =>
        window.scroll({ top: 0, behavior: "smooth" }),
      ),
    }
  })
}
