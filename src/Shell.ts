import { Effect, Layer, Schema } from "effect"
import { EventLog } from "effect/eventlog"
import { AsyncResult, Loader } from "effect/reactivity"
import { Command, Component, Router } from "effect/ui"
import { Html } from "effect/ui/html"
import { Viewport } from "./browser/services/Viewport.ts"
import { buttonClass, inputClass } from "./design/classes.ts"
import { icon } from "./design/icons.ts"
import { ListFavoritesRefresh } from "./favorites/loaders/ListFavorites.ts"
import { Favorites } from "./favorites/services/Favorites.ts"
import { FavoritesRepo } from "./favorites/services/FavoritesRepo.ts"
import { cn } from "./lib/utils.ts"
import { ProductPage } from "./pages/product/ProductPage.ts"
import { SearchPage } from "./pages/SearchPage.ts"
import { KnownProducts } from "./product/services/KnownProducts.ts"
import { AppRoute, queryOf } from "./routes.ts"
import { Session } from "./rpc/services/Session.ts"
import { searchArgs, searchDebounce } from "./search/domain/Search.ts"
import { SearchProducts } from "./search/loaders/SearchProducts.ts"
import { InviteDialog } from "./sync/components/InviteDialog.ts"
import { SyncSettingsPanel } from "./sync/components/SyncSettingsPanel.ts"
import { Invites } from "./sync/services/Invites.ts"
import { SyncRemote } from "./sync/services/SyncRemote.ts"
import { SyncSettings } from "./sync/services/SyncSettings.ts"

const ResultsSnapshot = Loader.SnapshotList(SearchProducts, "results")

export const ShellMessage = Schema.TaggedUnion({
  SearchTyped: { text: Schema.String },
  SearchSubmitted: {},
  SearchWanted: {},
  Done: {},
  ResultsChanged: { snapshot: ResultsSnapshot },
})
const Message = ShellMessage

/** Scrolls the page back to its top. */
export class ScrollToTop extends Command.Service<ScrollToTop>()(
  "Shell/ScrollToTop",
  { args: {}, invalidates: () => [] },
  Effect.gen(function* () {
    const viewport = yield* Viewport
    return () => viewport.scrollToTop
  }),
) {}

const searchRef = Html.ref("search", "input")

const done = Command.map(() => Message.make({ _tag: "Done" }))

/**
 * The frame around every page: the header with the logo, the search box and
 * the sync settings, and the page the route names. It is mounted once any
 * pending join is finished, and provides the services its pages share.
 */
export const ShellNoDeps = Component.make({
  name: "Shell",
  props: Schema.Struct({ route: AppRoute }),
  // The search itself belongs to the search page. It is watched here as
  // well, for the search box to show while it is running.
  model: Schema.Struct({ results: ResultsSnapshot }),
  message: Message,
  loaders: {
    results: Component.debounce(searchDebounce, (_model, props) =>
      searchArgs(props.route),
    ),
  },
  init: ($) => $.empty,
  update: (model, message, $) =>
    Message.match(message, {
      SearchTyped: ({ text }) => {
        const { route } = $.props
        return route._tag === "Search"
          ? // A new search starts without the last one's filters
            $.run(
              Router.patchQuery(AppRoute, route, {
                query: text,
                priceMin: undefined,
                priceMax: undefined,
                ratingMin: undefined,
                ratingMax: undefined,
              }).pipe(done),
            )
          : $.run(
              Router.push(
                AppRoute,
                AppRoute.make({ _tag: "Search", query: { query: text } }),
              ).pipe(done),
            )
      },
      SearchSubmitted: () =>
        $.run(Html.blur(searchRef, () => Message.make({ _tag: "Done" }))),
      SearchWanted: () =>
        $.run(
          Html.focus(searchRef, () => Message.make({ _tag: "Done" }), {
            preventScroll: true,
          }),
          ScrollToTop.make().pipe(done),
        ),
      Done: () => model,
      ResultsChanged: ({ snapshot }) => ({ results: snapshot }),
    }),
  subscriptions: (_model, _props, $) => [
    $.watch({
      results: (snapshot) => Message.make({ _tag: "ResultsChanged", snapshot }),
    }),
  ],
  view: (_model, h) => {
    const { route } = h.props
    const query = queryOf(route)
    // The header shrinks once there is something else to look at
    const minimize = route._tag !== "Search" || query.trim() !== ""
    const loading =
      searchArgs(route) !== undefined &&
      (AsyncResult.isInitial(h.loaded.results) || h.loaded.results.waiting)

    // A page that fails stays failed until the app starts again, so the way
    // out is a full page load, which a link with a `target` is.
    const failed = () =>
      h
        .div(
          h.h1("Something went wrong").class("text-lg font-bold"),
          h
            .p("This page hit a problem and couldn't be shown.")
            .class("text-sm text-muted-foreground"),
          h
            .a("Reload")
            .attr("href", AppRoute.print(route))
            .attr("target", "_top")
            .class(buttonClass({ class: "mt-3" })),
        )
        .attr("role", "alert")
        .class(
          "mt-6 flex flex-col items-center gap-2 rounded-xl bg-card px-6 py-14 text-center",
        )

    const page = AppRoute.match(route, {
      Search: (route) =>
        h.child(SearchPage, {
          key: "search",
          props: { route },
          onEmit: () => Message.make({ _tag: "SearchWanted" }),
          fallback: failed,
        }),
      Product: (route) =>
        h.child(ProductPage, {
          key: `product:${route.params.id}`,
          props: { id: route.params.id },
          fallback: failed,
        }),
      NotFound: () =>
        h
          .div(
            h.h1("Page not found").class("text-lg font-bold"),
            h
              .p("That address doesn't lead anywhere.")
              .class("text-sm text-muted-foreground"),
            h
              .a("Back to search")
              .attr("href", "/")
              .class(buttonClass({ class: "mt-3" })),
          )
          .class(
            "mt-6 flex flex-col items-center gap-2 rounded-xl bg-card px-6 py-14 text-center",
          )
          .key("not-found"),
    })

    return h
      .div(
        h
          .header(
            h.child(InviteDialog, { key: "invite" }),
            h
              .div(
                h
                  .div(
                    h
                      .a(
                        h
                          .img()
                          .attr("src", "/logo.svg")
                          .attr("alt", "Bunnings Logo")
                          .attr("width", "150")
                          .attr("height", "50")
                          .class(
                            cn(
                              "block w-auto transition-[height,opacity] hover:opacity-90 active:opacity-80",
                              minimize
                                ? "h-[30px] md:h-[34px]"
                                : "h-[50px] md:h-[60px]",
                            ),
                          ),
                      )
                      .attr("href", "/")
                      .class(
                        "block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                      ),
                  )
                  .class(
                    cn(
                      "row-start-1",
                      minimize
                        ? "col-start-1 justify-self-start"
                        : "col-start-2 justify-self-center pt-8 md:pt-12",
                    ),
                  ),
                h
                  .div(h.child(SyncSettingsPanel, { key: "sync-settings" }))
                  .class("col-start-3 row-start-1 self-start justify-self-end"),
                h
                  .div(
                    h
                      .div(
                        icon(h, loading ? "loaderCircle" : "search", {
                          class: cn(
                            "pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-primary",
                            loading && "animate-spin",
                          ),
                        }),
                        h
                          .form(
                            h
                              .input()
                              .ref(searchRef)
                              .attr("type", "search")
                              .attr("aria-label", "Search for products")
                              .attr("placeholder", "Search for products...")
                              .attr("autofocus", "")
                              .class(
                                inputClass(
                                  cn(
                                    "w-full pl-12 pr-4 border-2 border-card rounded-lg bg-card text-base md:text-base hover:border-card focus-visible:border-secondary focus-visible:ring-3 focus-visible:ring-secondary/20",
                                    minimize
                                      ? "h-11 md:h-12"
                                      : "h-13 md:h-14 md:text-lg",
                                  ),
                                ),
                              )
                              .value(query)
                              .onInput(({ value }) =>
                                Message.make({
                                  _tag: "SearchTyped",
                                  text: value,
                                }),
                              ),
                          )
                          .attr("role", "search")
                          .onSubmit(Message.make({ _tag: "SearchSubmitted" })),
                      )
                      .class(
                        cn(
                          "relative w-full mx-auto",
                          minimize ? "max-w-2xl" : "max-w-xl",
                        ),
                      ),
                  )
                  .class(
                    cn(
                      "col-span-3 row-start-2",
                      minimize && "md:col-span-1 md:col-start-2 md:row-start-1",
                    ),
                  ),
              )
              .class(
                cn(
                  "container mx-auto max-w-7xl grid grid-cols-[1fr_auto_1fr] items-center gap-x-6",
                  minimize
                    ? "py-3 gap-y-3 md:grid-cols-[auto_minmax(0,1fr)_auto] md:py-4"
                    : "pt-4 pb-12 gap-y-10 md:pb-16 md:gap-y-12",
                ),
              ),
          )
          .class("px-3 sm:px-6 text-white"),
        h
          .main(h.div(page).class("container mx-auto max-w-7xl"))
          .class("flex-1 bg-canvas px-3 sm:px-6 pb-24"),
      )
      .class("flex min-h-screen flex-col bg-brand")
  },
})

// One of each for the whole app. A component below that provides the same
// Layer gets the one built here: the session's login, the open journal and
// the connection to the sync remote aren't made twice.
const Shared = Layer.mergeAll(
  Session.layer,
  KnownProducts.layer,
  SyncSettings.layer,
  FavoritesRepo.layer,
  EventLog.layerRegistry,
  Favorites.layer,
  SyncRemote.layer,
  Invites.layer,
)

export const Shell = ShellNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(
      SearchProducts.layer,
      ScrollToTop.layer,
      ListFavoritesRefresh,
    ).pipe(Layer.provideMerge(Shared)),
  ),
)
