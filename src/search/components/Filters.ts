import { Schema } from "effect"
import { Command, Component, Router } from "effect/ui"
import { Html } from "effect/ui/html"
import { inputClass, labelClass } from "../../design/classes.ts"
import { AppRoute, SearchRoute } from "../../routes.ts"
import { FacetRange, ratingFacet } from "../domain/Search.ts"

const End = Schema.Literals(["min", "max"])

export const FiltersMessage = Schema.TaggedUnion({
  PriceTyped: { end: End, text: Schema.String },
  PriceLeft: { end: End },
  PriceSubmitted: {},
  RatingMoved: { end: End, value: Schema.Number },
  RatingReleased: {},
  Cleared: { filter: Schema.Literals(["price", "rating"]) },
  Done: {},
})
const Message = FiltersMessage

/**
 * What is being typed and dragged, before it is applied. An end that is
 * `null` hasn't been touched, and shows the filter in the URL.
 */
export const FiltersModel = Schema.Struct({
  /** The search these edits were made under. They don't carry to another. */
  forQuery: Schema.String,
  priceMin: Schema.NullOr(Schema.String),
  priceMax: Schema.NullOr(Schema.String),
  ratingMin: Schema.NullOr(Schema.Number),
  ratingMax: Schema.NullOr(Schema.Number),
})
type Model = typeof FiltersModel.Type

const untouched = (forQuery: string): Model => ({
  forQuery,
  priceMin: null,
  priceMax: null,
  ratingMin: null,
  ratingMax: null,
})

const editsFor = (model: Model, route: SearchRoute): Model =>
  model.forQuery === route.query.query ? model : untouched(route.query.query)

const parse = (text: string | null): number | undefined => {
  if (text === null || text.trim() === "") return undefined
  const value = Number(text)
  return Number.isNaN(value) ? undefined : value
}

const minRef = Html.ref("price-min", "input")
const maxRef = Html.ref("price-max", "input")

const done = Command.map(() => Message.make({ _tag: "Done" }))

/**
 * The price and rating filters of a search. Edits stay here until they are
 * applied, which writes the filter to the URL: a price on Enter or on leaving
 * a field, a rating on letting go of the slider.
 */
export const Filters = Component.make({
  name: "Filters",
  props: Schema.Struct({
    route: SearchRoute,
    /** The range of prices in the search. Without one, no price filter. */
    price: Schema.NullOr(FacetRange),
  }),
  model: FiltersModel,
  message: Message,
  init: ($) => untouched($.props.route.query.query),
  update: (model, message, $) => {
    const { price, route } = $.props
    const edits = editsFor(model, route)
    const { priceMax, priceMin, ratingMax, ratingMin } = route.query

    // An end that was never typed is filled in for the search, but its field
    // stays empty: it may be the one being typed in next
    const typedOnly: Model = {
      ...edits,
      priceMin: edits.priceMin ?? (priceMin === undefined ? "" : null),
      priceMax: edits.priceMax ?? (priceMax === undefined ? "" : null),
    }

    const applyPrice = (min: number, max: number) =>
      priceMin === min && priceMax === max
        ? edits
        : $.set(typedOnly).run(
            Router.patchQuery(AppRoute, route, {
              priceMin: min,
              priceMax: max,
            }).pipe(done),
          )

    return Message.match(message, {
      PriceTyped: ({ end, text }) =>
        end === "min"
          ? { ...edits, priceMin: text }
          : { ...edits, priceMax: text },
      PriceLeft: ({ end }) => {
        if (price === null) return edits
        const min = parse(edits.priceMin)
        const max = parse(edits.priceMax)
        // Leaving a field that holds no number applies nothing
        if ((end === "min" ? min : max) === undefined) return edits
        return applyPrice(
          min ?? priceMin ?? Math.floor(price.start),
          max ?? priceMax ?? Math.ceil(price.end),
        )
      },
      PriceSubmitted: () => {
        if (price === null) return edits
        const min = parse(edits.priceMin) ?? priceMin ?? Math.floor(price.start)
        const max = parse(edits.priceMax) ?? priceMax ?? Math.ceil(price.end)
        return $.set(typedOnly).run(
          Router.patchQuery(AppRoute, route, {
            priceMin: min,
            priceMax: max,
          }).pipe(done),
          Html.blur(minRef, () => Message.make({ _tag: "Done" })),
          Html.blur(maxRef, () => Message.make({ _tag: "Done" })),
        )
      },
      RatingMoved: ({ end, value }) => {
        const min = edits.ratingMin ?? ratingMin ?? ratingFacet.start
        const max = edits.ratingMax ?? ratingMax ?? ratingFacet.end
        // One thumb can't pass the other
        return end === "min"
          ? { ...edits, ratingMin: Math.min(value, max), ratingMax: max }
          : { ...edits, ratingMin: min, ratingMax: Math.max(value, min) }
      },
      RatingReleased: () => {
        const min = edits.ratingMin ?? ratingMin ?? ratingFacet.start
        const max = edits.ratingMax ?? ratingMax ?? ratingFacet.end
        return ratingMin === min && ratingMax === max
          ? edits
          : $.set(edits).run(
              Router.patchQuery(AppRoute, route, {
                ratingMin: min,
                ratingMax: max,
              }).pipe(done),
            )
      },
      Cleared: ({ filter }) =>
        filter === "price"
          ? $.set({ ...edits, priceMin: null, priceMax: null }).run(
              Router.patchQuery(AppRoute, route, {
                priceMin: undefined,
                priceMax: undefined,
              }).pipe(done),
            )
          : $.set({ ...edits, ratingMin: null, ratingMax: null }).run(
              Router.patchQuery(AppRoute, route, {
                ratingMin: undefined,
                ratingMax: undefined,
              }).pipe(done),
            ),
      Done: () => edits,
    })
  },
  view: (model, h) => {
    const { price, route } = h.props
    const edits = editsFor(model, route)
    const { priceMax, priceMin, ratingMax, ratingMin } = route.query

    const heading = (name: string, filter: "price" | "rating", set: boolean) =>
      h.div.class("flex min-h-5 items-center justify-between gap-2").children(
        h.div.class(labelClass("text-foreground font-semibold")).children(name),
        set &&
          h.button
            .attr("type", "button")
            .class(
              "cursor-pointer rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            )
            .onClick(Message.make({ _tag: "Cleared", filter }))
            .children("(clear)"),
      )

    const priceInput = (end: "min" | "max", range: FacetRange) => {
      const edit = end === "min" ? edits.priceMin : edits.priceMax
      const applied = end === "min" ? priceMin : priceMax
      return h.input
        .ref(end === "min" ? minRef : maxRef)
        .attr("type", "number")
        .attr("inputmode", "decimal")
        .attr("aria-label", end === "min" ? "Minimum price" : "Maximum price")
        .attr(
          "placeholder",
          end === "min"
            ? `$${Math.floor(range.start)}`
            : `$${Math.ceil(range.end)}`,
        )
        .class(inputClass("tabular-nums"))
        .value(edit ?? (applied === undefined ? "" : String(applied)))
        .onInput(({ value }) =>
          Message.make({ _tag: "PriceTyped", end, text: value }),
        )
        .onBlur(Message.make({ _tag: "PriceLeft", end }))
    }

    const priceFilter = (range: FacetRange) =>
      h.div
        .class("flex flex-col gap-1.5")
        .key("price")
        .children(
          heading(
            "Price",
            "price",
            priceMin !== undefined && priceMax !== undefined,
          ),
          h.div
            .class("flex-1 flex items-center min-h-10 px-1 sm:px-0")
            .children(
              h.form
                .class("w-full")
                .onSubmit(Message.make({ _tag: "PriceSubmitted" }))
                .children(
                  h.div
                    .class("flex gap-3 items-center")
                    .children(
                      priceInput("min", range),
                      h.span
                        .class("shrink-0 text-sm text-muted-foreground")
                        .children("to"),
                      priceInput("max", range),
                    ),
                  // Enter submits a form with two fields only when it has a
                  // submit button
                  h.button
                    .attr("type", "submit")
                    .class("hidden")
                    .children("Submit"),
                ),
            ),
        )

    const low = edits.ratingMin ?? ratingMin ?? ratingFacet.start
    const high = edits.ratingMax ?? ratingMax ?? ratingFacet.end
    const span = ratingFacet.end - ratingFacet.start
    // Where a thumb's centre sits: a native thumb stays inside the track, so
    // it travels the track's width less its own
    const offset = (value: number) => {
      const part = (value - ratingFacet.start) / span
      return { percent: part * 100, pixels: 12 - 24 * part }
    }
    const at = (value: number) => {
      const { percent, pixels } = offset(value)
      return `calc(${percent}% + ${pixels}px)`
    }
    const fromEnd = (value: number) => {
      const { percent, pixels } = offset(value)
      return `calc(${100 - percent}% - ${pixels}px)`
    }

    const ratingThumb = (end: "min" | "max", value: number) => [
      h.input
        .attr("type", "range")
        .attr("min", String(ratingFacet.start))
        .attr("max", String(ratingFacet.end))
        .attr("step", "1")
        .attr("aria-label", end === "min" ? "Minimum rating" : "Maximum rating")
        // With both thumbs at the top end, the lower one has to be on top or
        // neither could move
        .class(end === "min" && low === ratingFacet.end && "z-10")
        .value(String(value))
        .onInput(({ value }) =>
          Message.make({ _tag: "RatingMoved", end, value: Number(value) }),
        )
        .onChange(Message.make({ _tag: "RatingReleased" }))
        .key(end),
      h.output
        .attr("style", `left: ${at(value)}`)
        .key(`${end}-value`)
        .children(String(value)),
    ]

    const ratingFilter = h.div
      .class("flex flex-col gap-1.5")
      .key("rating")
      .children(
        heading(
          "Rating",
          "rating",
          ratingMin !== undefined && ratingMax !== undefined,
        ),
        h.div.class("flex-1 flex items-center min-h-10 px-1 sm:px-0").children(
          h.div
            .attr("role", "group")
            .attr("aria-label", "Rating")
            .class(
              "dual-range relative flex h-6 w-full touch-none items-center select-none",
            )
            .children(
              h.div
                .class(
                  "bg-primary/15 relative h-1.5 w-full grow overflow-hidden rounded-full",
                )
                .children(
                  h.div
                    .class("bg-secondary absolute h-full")
                    .attr("style", `left: ${at(low)}; right: ${fromEnd(high)}`),
                ),
              ratingThumb("min", low),
              ratingThumb("max", high),
            ),
        ),
      )

    return h.div
      .class(
        "grid grid-cols-1 gap-x-8 gap-y-3 rounded-xl bg-card px-4 py-3 sm:grid-cols-2 sm:gap-y-4 sm:px-6 sm:py-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,22rem)]",
      )
      .children(price !== null && priceFilter(price), ratingFilter)
  },
})
