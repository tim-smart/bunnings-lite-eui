import { Cause, Layer, Option, Schema } from "effect"
import { AsyncResult, Loader } from "effect/reactivity"
import { Component } from "effect/ui"
import type { ProductBaseInfo } from "../../server/src/domain/Bunnings.ts"
import { InstallButton } from "../browser/components/InstallButton.ts"
import { bottomReached, scrolledPast } from "../browser/subscriptions.ts"
import { buttonClass } from "../design/classes.ts"
import { icon } from "../design/icons.ts"
import { skeleton } from "../design/skeleton.ts"
import { FavoritesList } from "../favorites/components/FavoritesList.ts"
import { ProductCard } from "../product/components/ProductCard.ts"
import { KnownProducts } from "../product/services/KnownProducts.ts"
import { SearchRoute } from "../routes.ts"
import { Session } from "../rpc/services/Session.ts"
import { Filters } from "../search/components/Filters.ts"
import {
  FacetRange,
  priceFacet,
  searchArgs,
  searchDebounce,
} from "../search/domain/Search.ts"
import { SearchProducts } from "../search/loaders/SearchProducts.ts"
import { StoreSelector } from "../stores/components/StoreSelector.ts"

const ResultsSnapshot = Loader.SnapshotList(SearchProducts, "results")

// What the first page of a search says about its filters
const Facets = Schema.Struct({
  query: Schema.String,
  price: Schema.NullOr(FacetRange),
})

export const SearchPageMessage = Schema.TaggedUnion({
  ResultsChanged: {
    snapshot: ResultsSnapshot,
    facets: Schema.NullOr(Facets),
    /** Whether there is a next page that nothing is loading yet. */
    more: Schema.Boolean,
  },
  BottomReached: {},
  Scrolled: { scrolled: Schema.Boolean },
  SearchWanted: {},
})
const Message = SearchPageMessage

/** Asks whoever holds the search box to bring it back into reach. */
export const SearchPageEvents = Schema.TaggedUnion({ SearchWanted: {} })

const gridClass =
  "grid gap-2 sm:gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4"

/**
 * The home page. With no search text it shows the store and the favourites,
 * otherwise the results of the search in the URL, a page at a time as the
 * page is scrolled.
 */
export const SearchPageNoDeps = Component.make({
  name: "SearchPage",
  props: Schema.Struct({ route: SearchRoute }),
  model: Schema.Struct({
    results: ResultsSnapshot,
    /**
     * The filter ranges of the search, kept from its first results: applying
     * a filter narrows what the server reports next.
     */
    facets: Schema.NullOr(Facets),
    more: Schema.Boolean,
    scrolled: Schema.Boolean,
  }),
  message: Message,
  events: SearchPageEvents,
  loaders: {
    results: Component.debounce(searchDebounce, (_model, props) =>
      searchArgs(props.route),
    ),
  },
  init: ($) => ({ ...$.empty, facets: null, more: false, scrolled: false }),
  update: (model, message, $) =>
    Message.match(message, {
      ResultsChanged: ({ facets, more, snapshot }) => ({
        ...model,
        results: snapshot,
        more,
        facets:
          facets !== null && facets.query !== model.facets?.query
            ? facets
            : model.facets,
      }),
      BottomReached: () => (model.more ? $.loadMore("results") : model),
      Scrolled: ({ scrolled }) => ({ ...model, scrolled }),
      SearchWanted: () =>
        $.set(model).emit(SearchPageEvents.make({ _tag: "SearchWanted" })),
    }),
  subscriptions: (_model, props, $) => [
    $.watch({
      results: (snapshot, loaded) =>
        Message.make({
          _tag: "ResultsChanged",
          snapshot,
          facets: Option.match(AsyncResult.value(loaded), {
            onNone: () => null,
            onSome: ({ pages }) =>
              pages.length === 0
                ? null
                : { query: pages[0].query, price: priceFacet(pages[0]) },
          }),
          more: Option.exists(
            AsyncResult.value(loaded),
            (list) => list.more._tag === "Available",
          ),
        }),
    }),
    ...(searchArgs(props.route) === undefined
      ? []
      : [
          bottomReached(Message.make({ _tag: "BottomReached" })),
          scrolledPast(200, (scrolled) =>
            Message.make({ _tag: "Scrolled", scrolled }),
          ),
        ]),
  ],
  view: (model, h) => {
    const { route } = h.props
    const args = searchArgs(route)

    if (args === undefined) {
      return h
        .div(
          h
            .section(
              h
                .div(
                  h
                    .h2("Your store")
                    .id("store-heading")
                    .class("text-lg font-bold text-primary"),
                  h
                    .p(
                      "Stock levels and aisle locations are shown for this store.",
                    )
                    .class("text-sm text-muted-foreground"),
                )
                .class("flex flex-col gap-1"),
              h.child(StoreSelector, { key: "store" }),
            )
            .attr("aria-labelledby", "store-heading")
            .class(
              "grid gap-4 rounded-xl bg-card p-4 sm:p-6 md:grid-cols-[1fr_minmax(0,24rem)] md:items-center md:gap-8",
            ),
          h.child(FavoritesList, { key: "favorites" }),
          h
            .div(
              h.child(InstallButton, { key: "install" }),
              h.div().class("h-4"),
            )
            .class("fixed bottom-0 right-0 p-4 pb-safe flex flex-col"),
        )
        .class("flex flex-col pt-6 pb-10 gap-8 sm:pt-8 sm:gap-10")
        .key("home")
    }

    const skeletons = () =>
      h
        .div(
          [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
            h
              .div(
                skeleton(h, "h-28 w-full sm:h-44"),
                skeleton(h, "h-4 w-full"),
                skeleton(h, "h-4 w-2/3"),
                skeleton(h, "h-6 w-1/3"),
              )
              .class("flex flex-col gap-3 rounded-xl bg-card p-3 sm:p-4")
              .key(String(i)),
          ),
        )
        .class(gridClass)

    const noResults = () =>
      h
        .div(
          icon(h, "searchX", { class: "size-8 text-primary/60" }),
          h.h2("No results found.").class("text-lg font-bold"),
          h
            .p("Check the spelling or try a broader term.")
            .class("text-sm text-muted-foreground"),
          h
            .button("Try another search")
            .attr("type", "button")
            .class(buttonClass({ class: "mt-3" }))
            .onClick(Message.make({ _tag: "SearchWanted" })),
        )
        .class(
          "flex flex-col items-center gap-2 rounded-xl bg-card px-6 py-14 text-center",
        )

    const grid = (items: ReadonlyArray<ProductBaseInfo>) =>
      items.length === 0
        ? noResults()
        : h
            .div(
              items.map((product) =>
                h.child(ProductCard, {
                  key: product.id,
                  props: { product, query: route.query.query },
                }),
              ),
            )
            .class(gridClass)

    const results = AsyncResult.match(h.loaded.results, {
      // The last results stay up while the next ones load
      onInitial: () =>
        Option.match(h.previous.results, {
          onNone: skeletons,
          onSome: ({ items }) => grid(items),
        }),
      onFailure: ({ cause }) =>
        h
          .div(
            h
              .h2("An error occurred while fetching results.")
              .class("text-lg font-bold text-accent"),
            h
              .pre(Cause.pretty(cause))
              .class(
                "max-w-full overflow-x-auto whitespace-pre-wrap text-left text-xs text-muted-foreground",
              ),
          )
          .class(
            "flex flex-col items-center gap-3 rounded-xl bg-card px-6 py-12 text-center",
          ),
      onSuccess: ({ value }) => grid(value.items),
    })

    return h
      .div(
        h.div().class("h-4 sm:h-6"),
        model.facets !== null &&
          h.child(Filters, {
            key: "filters",
            props: { route, price: model.facets.price },
          }),
        h.div().class("h-3 sm:h-4"),
        results,
        h
          .div(
            model.scrolled &&
              h
                .button(
                  icon(h, "arrowUp", { class: "size-5", strokeWidth: 2.5 }),
                )
                .attr("type", "button")
                .attr("aria-label", "Back to top")
                .class(
                  buttonClass({
                    class:
                      "size-12 cursor-pointer rounded-full shadow-lg shadow-primary/25 animate-in fade-in zoom-in-90",
                  }),
                )
                .onClick(Message.make({ _tag: "SearchWanted" })),
            h.div().class("h-6"),
          )
          .class(
            "fixed bottom-0 right-0 p-6 pb-safe flex flex-col transform-gpu",
          ),
      )
      .key("results")
  },
})

export const SearchPage = SearchPageNoDeps.pipe(
  Component.provide(
    SearchProducts.layer.pipe(
      Layer.provide([Session.layer, KnownProducts.layer]),
    ),
  ),
)
