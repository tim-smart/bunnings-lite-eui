import { Effect, Layer, Option, Schema } from "effect"
import { AsyncResult, Loader } from "effect/reactivity"
import { Command, Component } from "effect/ui"
import { Html } from "effect/ui/html"
import {
  SessionLocation,
  type Store,
} from "../../../server/src/domain/Bunnings.ts"
import { buttonClass, inputClass } from "../../design/classes.ts"
import {
  drawer,
  drawerHeader,
  FocusWrap,
  wrapFocus,
} from "../../design/drawer.ts"
import { icon } from "../../design/icons.ts"
import { skeleton } from "../../design/skeleton.ts"
import { cn } from "../../lib/utils.ts"
import { SessionTag } from "../../rpc/domain/SessionTag.ts"
import { Session } from "../../rpc/services/Session.ts"
import { AllStores } from "../loaders/AllStores.ts"
import { CurrentStore } from "../loaders/CurrentStore.ts"
import { NearbyStores } from "../loaders/NearbyStores.ts"

const CurrentSnapshot = Loader.Snapshot(CurrentStore, "current")
const NearbySnapshot = Loader.Snapshot(NearbyStores, "nearby")
const AllSnapshot = Loader.Snapshot(AllStores, "all")

export const StoreSelectorMessage = Schema.TaggedUnion({
  Reached: {},
  StoreChosen: { location: SessionLocation },
  SearchOpened: {},
  SearchClosed: {},
  SearchTyped: { text: Schema.String },
  Retried: {},
  FocusWrapped: { wrap: FocusWrap },
  Done: {},
  CurrentChanged: {
    snapshot: CurrentSnapshot,
    /** The code of the store the session has, once it is known. */
    code: Schema.NullOr(Schema.String),
  },
  NearbyChanged: { snapshot: NearbySnapshot },
  AllChanged: { snapshot: AllSnapshot },
})
const Message = StoreSelectorMessage

/** Shops at a store: saves it and logs the session in with it. */
export class ChooseStore extends Command.Service<ChooseStore>()(
  "stores/ChooseStore",
  {
    args: { location: SessionLocation },
    // Prices and stock are per store
    invalidates: () => [SessionTag],
  },
  Effect.gen(function* () {
    const session = yield* Session
    return ({ location }) => session.setLocation(location)
  }),
) {}

/** Loads the list of every store again, after it failed. */
export class RetryAllStores extends Command.Service<RetryAllStores>()(
  "stores/RetryAllStores",
  { args: {}, invalidates: () => [AllStores] },
  Effect.succeed(() => Effect.void),
) {}

const searchButtonRef = Html.ref("store-search-open", "button")
const searchRef = Html.ref("store-search", "input")
const lastRef = Html.ref("store-search-last", "button")

const done = Command.map(() => Message.make({ _tag: "Done" }))
const focusWrapped = (wrap: FocusWrap) =>
  Message.make({ _tag: "FocusWrapped", wrap })

const matches = (store: Store, terms: ReadonlyArray<string>) => {
  const text = [
    store.displayName,
    store.address.town,
    store.address.postalCode,
    store.storeRegion,
    store.address.country.name,
  ]
    .join(" ")
    .toLowerCase()
  return terms.every((term) => text.includes(term))
}

/**
 * Chooses the store to shop at: from the ten nearest, which asks for the
 * device's location, or by searching every store by hand.
 *
 * The nearest stores are a native `select`, so the keyboard and a phone's
 * own picker work without any handling here. The chosen store is marked on
 * its `option`: a `value` on the `select` is set before it has options.
 */
export const StoreSelectorNoDeps = Component.make({
  name: "StoreSelector",
  model: Schema.Struct({
    /** Whether the nearby stores have been asked for. */
    nearbyWanted: Schema.Boolean,
    /** The store just chosen, until the session has it too. */
    chosen: Schema.NullOr(SessionLocation),
    /** Whether the search of every store is open. */
    searching: Schema.Boolean,
    search: Schema.String,
    current: CurrentSnapshot,
    nearby: NearbySnapshot,
    all: AllSnapshot,
  }),
  message: Message,
  loaders: {
    current: () => ({}),
    // Asking for nearby stores asks for the device's location, so it waits
    // until the picker is reached for
    nearby: (model) => (model.nearbyWanted ? {} : undefined),
    all: (model) => (model.searching ? {} : undefined),
  },
  init: ($) => ({
    ...$.empty,
    nearbyWanted: false,
    chosen: null,
    searching: false,
    search: "",
  }),
  update: (model, message, $) =>
    Message.match(message, {
      Reached: () =>
        model.nearbyWanted ? model : { ...model, nearbyWanted: true },
      StoreChosen: ({ location }) => {
        const next = { ...model, chosen: location, searching: false }
        const choose = ChooseStore.make({ location }).pipe(done)
        return model.searching
          ? $.set(next).run(
              choose,
              Html.focus(searchButtonRef, () => Message.make({ _tag: "Done" })),
            )
          : $.set(next).run(choose)
      },
      SearchOpened: () =>
        $.set({ ...model, searching: true, search: "" }).run(
          Html.focus(searchRef, () => Message.make({ _tag: "Done" })),
        ),
      SearchClosed: () =>
        $.set({ ...model, searching: false }).run(
          Html.focus(searchButtonRef, () => Message.make({ _tag: "Done" })),
        ),
      SearchTyped: ({ text }) => ({ ...model, search: text }),
      Retried: () => $.run(RetryAllStores.make().pipe(done)),
      FocusWrapped: ({ wrap }) =>
        $.run(
          wrapFocus(
            wrap,
            { first: searchRef, last: lastRef },
            { done: Message.make({ _tag: "Done" }), onWrap: focusWrapped },
          ),
        ),
      Done: () => model,
      CurrentChanged: ({ snapshot, code }) => ({
        ...model,
        current: snapshot,
        chosen: model.chosen?.code === code ? null : model.chosen,
      }),
      NearbyChanged: ({ snapshot }) => ({ ...model, nearby: snapshot }),
      AllChanged: ({ snapshot }) => ({ ...model, all: snapshot }),
    }),
  subscriptions: (_model, _props, $) => [
    $.watch({
      current: (snapshot, loaded) =>
        Message.make({
          _tag: "CurrentChanged",
          snapshot,
          code: Option.match(Option.flatten(AsyncResult.value(loaded)), {
            onNone: () => null,
            onSome: (location) => location.code,
          }),
        }),
      nearby: (snapshot) => Message.make({ _tag: "NearbyChanged", snapshot }),
      all: (snapshot) => Message.make({ _tag: "AllChanged", snapshot }),
    }),
  ],
  view: (model, h) => {
    const current = Option.flatten(AsyncResult.value(h.loaded.current))
    const shown = model.chosen === null ? current : Option.some(model.chosen)
    const isShown = (code: string) =>
      Option.exists(shown, (location) => location.code === code)

    const nearby = Option.getOrElse(
      AsyncResult.value(h.loaded.nearby),
      (): ReadonlyArray<Store> => [],
    )
    const nearbyStatus = !model.nearbyWanted
      ? ""
      : AsyncResult.match(h.loaded.nearby, {
          onInitial: () => "Finding stores near you…",
          onFailure: () => "Couldn't find stores near you.",
          onSuccess: ({ value }) =>
            value.length === 0 ? "No stores found near you." : "",
        })

    const storeSearch = () => {
      const terms = model.search.toLowerCase().split(/\s+/).filter(Boolean)
      return drawer(
        h,
        {
          titleId: "store-search-title",
          onClose: Message.make({ _tag: "SearchClosed" }),
          onWrap: focusWrapped,
          class: "h-[80vh]",
        },
        drawerHeader(
          h,
          { titleId: "store-search-title", title: "Find your store" },
          "Search Bunnings stores in New Zealand and Australia.",
        ),
        h
          .div(
            h
              .div(
                icon(h, "search", {
                  class:
                    "absolute left-7 top-1/2 -translate-y-1/2 -mt-1 size-4 text-muted-foreground",
                }),
                h
                  .input()
                  .ref(searchRef)
                  .attr("type", "search")
                  .attr("aria-label", "Search stores")
                  .attr("placeholder", "Store, suburb or postcode")
                  .class(inputClass("pl-9"))
                  .value(model.search)
                  .onInput(({ value }) =>
                    Message.make({ _tag: "SearchTyped", text: value }),
                  ),
              )
              .class("px-4 pb-2 relative"),
            h
              .div(
                AsyncResult.match(h.loaded.all, {
                  onInitial: () =>
                    [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
                      skeleton(h, "h-12 my-2").key(`skeleton-${i}`),
                    ),
                  onFailure: () =>
                    h
                      .div(
                        h.p("Couldn't load stores.").attr("role", "status"),
                        h
                          .button("Try again")
                          .ref(lastRef)
                          .attr("type", "button")
                          .class(buttonClass({ variant: "outline" }))
                          .onClick(Message.make({ _tag: "Retried" })),
                      )
                      .class(
                        "flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground",
                      ),
                  onSuccess: ({ value: stores }) => {
                    const found = stores.filter((store) =>
                      matches(store, terms),
                    )
                    if (found.length === 0) {
                      return h
                        .p(`No stores match “${model.search.trim()}”.`)
                        .attr("role", "status")
                        .class("py-8 text-center text-sm text-muted-foreground")
                    }
                    const countries = new Map<string, Array<Store>>()
                    for (const store of found) {
                      const country = store.address.country.name
                      countries.set(country, [
                        ...(countries.get(country) ?? []),
                        store,
                      ])
                    }
                    for (const stores of countries.values()) {
                      stores.sort((a, b) =>
                        a.displayName.localeCompare(b.displayName),
                      )
                    }
                    // Where Shift+Tab from the search box carries on from
                    const lastCountry = Array.from(countries.values()).pop()
                    const last = lastCountry?.[lastCountry.length - 1]
                    const item = (store: Store) => {
                      const button = h
                        .button(
                          icon(h, "mapPin", {
                            class: "size-4 shrink-0 text-accent",
                          }),
                          h
                            .span(
                              h
                                .span(store.displayName)
                                .class("font-medium text-primary"),
                              h
                                .span(store.address.formattedAddress)
                                .class(
                                  "truncate text-xs text-muted-foreground",
                                ),
                            )
                            .class("flex min-w-0 flex-1 flex-col"),
                          isShown(store.name) &&
                            icon(h, "check", { class: "size-4 text-primary" }),
                        )
                        .attr("type", "button")
                        .attr(
                          "aria-current",
                          isShown(store.name) ? "true" : undefined,
                        )
                        .class(
                          "flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                        )
                        .onClick(
                          Message.make({
                            _tag: "StoreChosen",
                            location: SessionLocation.fromStore(store),
                          }),
                        )
                      return h
                        .li(store === last ? button.ref(lastRef) : button)
                        .key(store.name)
                    }
                    return Array.from(countries, ([country, stores]) =>
                      h
                        .section(
                          h
                            .h3(country)
                            .class(
                              "sticky top-0 bg-background py-2 text-sm font-semibold text-primary",
                            ),
                          h.ul(stores.map(item)).class("flex flex-col"),
                        )
                        .attr("aria-label", country)
                        .class("pb-4")
                        .key(country),
                    )
                  },
                }),
              )
              .class("overflow-y-auto flex-1 px-4 pb-safe"),
          )
          .class("flex flex-col min-h-0 flex-1"),
      )
    }

    return h
      .div(
        h
          .div(
            icon(h, "mapPin", {
              class:
                "pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-accent",
            }),
            h
              .select(
                Option.match(shown, {
                  onNone: () =>
                    h
                      .option("Select your store")
                      .attr("value", "")
                      .attr("hidden", "")
                      .disabled(true)
                      .selected(true)
                      .key("none"),
                  // A store chosen by search stays in the list when it isn't nearby
                  onSome: (location) =>
                    nearby.some((store) => store.name === location.code)
                      ? undefined
                      : h
                          .option(location.city)
                          .attr("value", location.code)
                          .selected(true)
                          .key(location.code),
                }),
                // What a list opened too early has to offer
                model.nearbyWanted &&
                  AsyncResult.isInitial(h.loaded.nearby) &&
                  h.option("Loading…").disabled(true).key("loading"),
                nearby.length > 0 &&
                  h
                    .optgroup(
                      nearby.map((store) =>
                        h
                          .option(store.displayName)
                          .attr("value", store.name)
                          .selected(isShown(store.name))
                          .key(store.name),
                      ),
                    )
                    .attr("label", "Near you")
                    .key("nearby"),
              )
              .attr("aria-label", "Your store")
              .class(
                cn(
                  "h-11 w-full cursor-pointer appearance-none rounded-md border border-input bg-card py-2 pr-9 pl-10 text-sm font-medium text-foreground outline-none transition-[color,box-shadow] hover:border-primary/40 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15",
                  Option.isNone(shown) && "text-muted-foreground",
                ),
              )
              .onFocus(Message.make({ _tag: "Reached" }))
              .onChange(({ value }) => {
                const store = nearby.find((store) => store.name === value)
                return store === undefined
                  ? undefined
                  : Message.make({
                      _tag: "StoreChosen",
                      location: SessionLocation.fromStore(store),
                    })
              }),
            icon(h, "chevronDown", {
              class:
                "pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 opacity-50",
            }),
          )
          .class("relative"),
        h
          .div(
            h
              .p(nearbyStatus)
              // Always here, so what it comes to say is announced
              .attr("aria-live", "polite")
              .class("text-sm text-muted-foreground"),
            h
              .button(
                icon(h, "search", { class: "size-4" }),
                "Search all stores",
              )
              .ref(searchButtonRef)
              .attr("type", "button")
              .class(
                "ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-primary/15",
              )
              .onClick(Message.make({ _tag: "SearchOpened" })),
          )
          .class("mt-2 flex items-center gap-3"),
        model.searching && storeSearch(),
      )
      .class("w-full")
  },
})

export const StoreSelector = StoreSelectorNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(
      CurrentStore.layer,
      NearbyStores.layer,
      AllStores.layer,
      ChooseStore.layer,
      RetryAllStores.layer,
    ).pipe(Layer.provide(Session.layer)),
  ),
)
