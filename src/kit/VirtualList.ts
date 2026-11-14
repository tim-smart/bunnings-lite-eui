import { Effect, Option, Schema, Stream } from "effect"
import { Command, Component, Renderer, Subscription } from "effect/ui"
import { Html } from "effect/ui/html"
import { Viewport } from "../browser/services/Viewport.ts"

const Props = Schema.Struct({
  /** How many items the list has. */
  count: Schema.Finite,
  /** The height of a row in pixels, used until a row has been measured. */
  estimatedRowSize: Schema.Finite,
  /** How many rows to render on each side of the ones in view. 3 when omitted. */
  overscan: Schema.optional(Schema.Finite),
  /**
   * How many items to render before the list has been measured: enough to
   * fill the first screen. One row and its overscan when omitted.
   */
  initialCount: Schema.optional(Schema.Finite),
})
type Props = typeof Props.Type

const Model = Schema.Struct({
  /** The first and last rows in view, or `null` until the list is measured. */
  visible: Schema.NullOr(
    Schema.Struct({ first: Schema.Finite, last: Schema.Finite }),
  ),
  /** How many items share a row. */
  lanes: Schema.Finite,
  /** The space between two rows. */
  gap: Schema.Finite,
  /** The width the rows were measured at: their heights don't hold at another. */
  width: Schema.Finite,
  /** The measured height of each row, by row index. */
  sizes: Schema.Record(Schema.String, Schema.Finite),
})
type Model = typeof Model.Type

/** What `Measure` read from the page, in pixels relative to the window. */
const Measurement = Schema.Struct({
  /** The height of the window. */
  viewport: Schema.Finite,
  list: Schema.Struct({ top: Schema.Finite, width: Schema.Finite }),
  /** The rendered items, in order. */
  items: Schema.Array(
    Schema.Struct({
      index: Schema.Finite,
      top: Schema.Finite,
      height: Schema.Finite,
    }),
  ),
})
type Measurement = typeof Measurement.Type

export const VirtualListMessage = Schema.TaggedUnion({
  /** The window scrolled or changed size, or the list got another count. */
  Moved: { viewport: Schema.Finite },
  Measured: Measurement.fields,
})
const Message = VirtualListMessage

const List = Html.ref("VirtualList.list", "div")
const Item = Html.ref("VirtualList.item", "div")

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

const defaultOverscan = 3

// Boxes are fractions of a pixel, and the same box can differ by a rounding
// error from one read to the next.
const same = (a: number, b: number) => Math.abs(a - b) < 0.5

interface Layout {
  readonly rows: number
  /**
   * Where each row starts, from the top of the list. It has one more entry
   * than there are rows: where a row after the last one would start.
   */
  readonly offsets: ReadonlyArray<number>
}

const layoutOf = (model: Model, props: Props): Layout => {
  const rows = Math.ceil(props.count / model.lanes)
  const known = Object.values(model.sizes)
  const estimate =
    known.length === 0
      ? props.estimatedRowSize
      : known.reduce((sum, size) => sum + size, 0) / known.length
  const offsets = [0]
  for (let row = 0; row < rows; row++) {
    offsets.push(offsets[row] + (model.sizes[row] ?? estimate) + model.gap)
  }
  return { rows, offsets }
}

/** The row that `y` falls in, counting the gap under a row as part of it. */
const rowAt = (layout: Layout, y: number): number => {
  let low = 0
  let high = layout.rows - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (layout.offsets[middle] <= y) low = middle
    else high = middle - 1
  }
  return low
}

interface Window {
  /** The first item to render, and the one after the last. */
  readonly start: number
  readonly end: number
  /** The room the rows before and after them take. */
  readonly before: number
  readonly after: number
}

const windowOf = (model: Model, props: Props): Window => {
  const layout = layoutOf(model, props)
  const overscan = props.overscan ?? defaultOverscan
  let startRow = 0
  let endRow: number
  if (model.visible === null) {
    // Until the list is measured there is no telling what is in view, so the
    // top of the list is rendered, which also gives `Measure` items to read
    endRow =
      props.initialCount === undefined
        ? overscan + 1
        : Math.ceil(props.initialCount / model.lanes)
  } else {
    // The list may have shrunk since it was measured
    const lastRow = layout.rows - 1
    startRow = Math.max(0, Math.min(model.visible.first, lastRow) - overscan)
    endRow = Math.min(model.visible.last, lastRow) + overscan + 1
  }
  endRow = Math.min(layout.rows, endRow)
  return {
    start: startRow * model.lanes,
    end: Math.min(props.count, endRow * model.lanes),
    before: layout.offsets[startRow],
    // A gap is counted under every row, and the last row has none
    after:
      endRow === layout.rows
        ? 0
        : layout.offsets[layout.rows] - layout.offsets[endRow],
  }
}

/**
 * The Model after a measurement: the same one when it says nothing new, so
 * measuring again after it stops.
 */
const measured = (
  model: Model,
  props: Props,
  { items, list, viewport }: Measurement,
): Model => {
  // A list that isn't shown has no boxes to learn from
  if (list.width === 0) return model

  let { gap, lanes } = model
  let changed = !same(list.width, model.width)
  let sizes: Record<string, number> = changed ? {} : { ...model.sizes }

  if (items.length > 0) {
    // Items on one row share a top. A single row with no more items than
    // the lanes already known changes nothing: it may be a last row with
    // room left.
    const across = items.findIndex((item) => !same(item.top, items[0].top))
    const measuredLanes = across === -1 ? items.length : across
    if ((across !== -1 || items.length > lanes) && measuredLanes !== lanes) {
      lanes = measuredLanes
      sizes = {}
      changed = true
    }
    // The items only split into the list's rows when the first starts one
    if (items[0].index % lanes === 0) {
      const firstRow = items[0].index / lanes
      const rows: Array<{ readonly top: number; readonly bottom: number }> = []
      for (let i = 0; i < items.length; i += lanes) {
        const row = items.slice(i, i + lanes)
        rows.push({
          top: row[0].top,
          bottom: Math.max(...row.map((item) => item.top + item.height)),
        })
      }
      if (rows.length > 1 && !same(rows[1].top - rows[0].bottom, gap)) {
        gap = rows[1].top - rows[0].bottom
        changed = true
      }
      rows.forEach((row, i) => {
        const size = row.bottom - row.top
        const current = sizes[firstRow + i]
        if (current === undefined || !same(current, size)) {
          sizes[firstRow + i] = size
          changed = true
        }
      })
    }
  }

  const next: Model = { ...model, gap, lanes, sizes, width: list.width }
  const layout = layoutOf(next, props)
  const visible =
    layout.rows === 0
      ? null
      : {
          first: rowAt(layout, -list.top),
          last: rowAt(layout, viewport - list.top),
        }
  return !changed &&
    visible?.first === model.visible?.first &&
    visible?.last === model.visible?.last
    ? model
    : { ...next, visible }
}

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------

/**
 * Reads the boxes of the list and of the items from `start` up to `end`,
 * once the render that asked for it is committed. It answers with nothing
 * when the list isn't rendered.
 */
export const Measure = Command.make(
  "VirtualList.measure",
  {
    args: {
      viewport: Schema.Finite,
      start: Schema.Finite,
      end: Schema.Finite,
    },
  },
  Effect.fnUntraced(function* ({ end, start, viewport }) {
    const refs = yield* Renderer.Refs
    const host = yield* Html.Host
    const list = yield* refs.lookup(List)
    if (Option.isNone(list)) return Component.noop
    const { top, width } = host.measure(list.value)
    const items: Array<Measurement["items"][number]> = []
    for (let index = start; index < end; index++) {
      const item = yield* refs.lookup(Item.at(index))
      if (Option.isNone(item)) continue
      const box = host.measure(item.value)
      items.push({ index, top: box.top, height: box.height })
    }
    return Message.make({
      _tag: "Measured",
      viewport,
      list: { top, width },
      items,
    })
  }),
)

const measure = (model: Model, props: Props, viewport: number) => {
  const { end, start } = windowOf(model, props)
  return Measure({ viewport, start, end })
}

/**
 * A list that renders only the items near the window, and leaves room for
 * the others so the page is as tall as the whole list. It scrolls with the
 * page.
 *
 * It is headless. The consumer applies `list` to a `div` around the items
 * and `item` to a `div` for each index in `items`, in order and with nothing
 * between them, and looks up what to draw in each by its index.
 *
 * The list element can be a block, a flex column or a CSS grid. Nothing
 * about its layout is passed in: the component reads it from the boxes of
 * the items it rendered. That gives how many sit side by side, how tall each
 * row is and the gap between rows, so a grid needs no column count. A row
 * that hasn't been rendered yet takes the average of the ones that have.
 *
 * The `list` part sets the element's `style`, so the padding above and below
 * the items is the part's. An item's index changes when items are added
 * before it, so key each item's element by the item's own id.
 *
 * It follows the window through `Viewport`, and measures on a scroll, a
 * resize and a change of `count`. A row that changes height at any other
 * time is noticed at the next of those.
 */
export const VirtualList = Component.define({
  name: "VirtualList",
  props: Props,
  model: Model,
  message: Message,
  elements: Html,
}).make({
  init: () => ({ visible: null, lanes: 1, gap: 0, width: 0, sizes: {} }),
  update: (model, message, $) =>
    Message.match(message, {
      Moved: ({ viewport }) => $.run(measure(model, $.props, viewport)),
      // The new Model renders other rows, at their estimated heights, so
      // they are measured in turn until a measurement changes nothing
      Measured: (measurement) => {
        const next = measured(model, $.props, measurement)
        return next === model
          ? model
          : $.set(next).run(measure(next, $.props, measurement.viewport))
      },
    }),
  // Keyed on the count, so that a list that grows or shrinks starts over and
  // gets the current window, which measures the items it now renders
  subscriptions: (_model, props) => [
    props.count > 0 &&
      Subscription.make("VirtualList.viewport", props.count, () =>
        Stream.unwrap(
          Effect.map(Viewport, (viewport) =>
            viewport.changes.pipe(
              Stream.map(({ height }) =>
                Message.make({ _tag: "Moved", viewport: height }),
              ),
            ),
          ),
        ),
      ),
  ],
  parts: (model, p) => {
    const { after, before, end, start } = windowOf(model, p.props)
    return {
      /** The indices of the items to render, in order. */
      items: Array.from({ length: end - start }, (_, i) => start + i),
      list: p.part("div", (b) =>
        b
          .ref(List)
          .attr("role", "list")
          .attr("style", `padding-top:${before}px;padding-bottom:${after}px`),
      ),
      // Only some of the items are in the document, so each one says where
      // it is in the whole list
      item: p.part("div", (b, index: number) =>
        b
          .ref(Item.at(index))
          .attr("role", "listitem")
          .attr("aria-posinset", String(index + 1))
          .attr("aria-setsize", String(p.props.count)),
      ),
    }
  },
})
