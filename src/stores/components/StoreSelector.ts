import { Effect, Layer, Option, Schema } from "effect"
import { AsyncResult, Loader } from "effect/reactivity"
import { Command, Component } from "effect/ui"
import { Html } from "effect/ui/html"
import {
  SessionLocation,
  type Store,
} from "../../../server/src/domain/Bunnings.ts"
import { buttonClass, inputClass } from "../../design/classes.ts"
import { drawer, drawerHeader } from "../../design/drawer.ts"
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
  Toggled: {},
  Closed: {},
  StoreChosen: { location: SessionLocation },
  SearchOpened: {},
  SearchClosed: {},
  SearchTyped: { text: Schema.String },
  Retried: {},
  Done: {},
  CurrentChanged: { snapshot: CurrentSnapshot },
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

const triggerRef = Html.ref("store-trigger", "button")
const searchRef = Html.ref("store-search", "input")

const done = Command.map(() => Message.make({ _tag: "Done" }))

const optionClass =
  "relative flex w-full cursor-pointer items-center gap-2 rounded-sm py-3 pr-8 pl-2 text-left text-sm outline-none select-none hover:bg-muted hover:text-primary focus-visible:bg-muted focus-visible:text-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&_svg]:size-4 [&_svg]:shrink-0"

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
 */
export const StoreSelectorNoDeps = Component.make({
  name: "StoreSelector",
  model: Schema.Struct({
    /** Whether the list of nearby stores is open. */
    open: Schema.Boolean,
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
    // until the list is opened
    nearby: (model) => (model.open ? {} : undefined),
    all: (model) => (model.searching ? {} : undefined),
  },
  init: ($) => ({ ...$.empty, open: false, searching: false, search: "" }),
  update: (model, message, $) =>
    Message.match(message, {
      Toggled: () => ({ ...model, open: !model.open }),
      Closed: () =>
        $.set({ ...model, open: false }).run(
          Html.focus(triggerRef, () => Message.make({ _tag: "Done" })),
        ),
      StoreChosen: ({ location }) =>
        $.set({ ...model, open: false, searching: false }).run(
          ChooseStore.make({ location }).pipe(done),
          Html.focus(triggerRef, () => Message.make({ _tag: "Done" })),
        ),
      SearchOpened: () =>
        $.set({ ...model, open: false, searching: true, search: "" }).run(
          Html.focus(searchRef, () => Message.make({ _tag: "Done" })),
        ),
      SearchClosed: () =>
        $.set({ ...model, searching: false }).run(
          Html.focus(triggerRef, () => Message.make({ _tag: "Done" })),
        ),
      SearchTyped: ({ text }) => ({ ...model, search: text }),
      Retried: () => $.run(RetryAllStores.make().pipe(done)),
      Done: () => model,
      CurrentChanged: ({ snapshot }) => ({ ...model, current: snapshot }),
      NearbyChanged: ({ snapshot }) => ({ ...model, nearby: snapshot }),
      AllChanged: ({ snapshot }) => ({ ...model, all: snapshot }),
    }),
  subscriptions: (_model, _props, $) => [
    $.watch({
      current: (snapshot) => Message.make({ _tag: "CurrentChanged", snapshot }),
      nearby: (snapshot) => Message.make({ _tag: "NearbyChanged", snapshot }),
      all: (snapshot) => Message.make({ _tag: "AllChanged", snapshot }),
    }),
  ],
  view: (model, h) => {
    const current = Option.flatten(AsyncResult.value(h.loaded.current))
    const isCurrent = (code: string) =>
      Option.exists(current, (location) => location.code === code)

    const option = (label: string, location: SessionLocation) =>
      h
        .button(
          label,
          isCurrent(location.code) &&
            h
              .span(icon(h, "check", { class: "text-primary" }))
              .class(
                "absolute right-2 flex size-3.5 items-center justify-center",
              ),
        )
        .attr("type", "button")
        .attr("role", "option")
        .attr("aria-selected", String(isCurrent(location.code)))
        .class(optionClass)
        .onClick(Message.make({ _tag: "StoreChosen", location }))
        .key(location.code)

    // A store chosen by search stays in the list when it isn't nearby
    const currentOption = (nearby: ReadonlyArray<Store>) =>
      Option.match(current, {
        onNone: () => undefined,
        onSome: (location) =>
          nearby.some((store) => store.name === location.code)
            ? undefined
            : option(location.city, location),
      })

    const note = (text: string) =>
      h
        .p(text)
        .attr("role", "status")
        .class("px-2 py-3 text-sm text-muted-foreground")

    const nearbyOptions = AsyncResult.match(h.loaded.nearby, {
      onInitial: () => [
        currentOption([]),
        ...[0, 1, 2, 3, 4].map((i) =>
          skeleton(h, "h-8 m-2").key(`skeleton-${i}`),
        ),
      ],
      onFailure: () => [
        currentOption([]),
        note("Couldn't find stores near you."),
      ],
      onSuccess: ({ value: stores }) => [
        currentOption(stores),
        stores.length === 0 && note("No stores found near you."),
        ...stores.map((store) =>
          option(store.displayName, SessionLocation.fromStore(store)),
        ),
      ],
    })

    const storeSearch = () => {
      const terms = model.search.toLowerCase().split(/\s+/).filter(Boolean)
      return drawer(
        h,
        {
          titleId: "store-search-title",
          onClose: Message.make({ _tag: "SearchClosed" }),
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
                    const item = (store: Store) =>
                      h
                        .li(
                          h
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
                              isCurrent(store.name) &&
                                icon(h, "check", {
                                  class: "size-4 text-primary",
                                }),
                            )
                            .attr("type", "button")
                            .attr(
                              "aria-current",
                              isCurrent(store.name) ? "true" : undefined,
                            )
                            .class(
                              "flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                            )
                            .onClick(
                              Message.make({
                                _tag: "StoreChosen",
                                location: SessionLocation.fromStore(store),
                              }),
                            ),
                        )
                        .key(store.name)
                    const countries = new Map<string, Array<Store>>()
                    for (const store of found) {
                      const country = store.address.country.name
                      countries.set(country, [
                        ...(countries.get(country) ?? []),
                        store,
                      ])
                    }
                    return Array.from(countries, ([country, stores]) =>
                      h
                        .section(
                          h
                            .h3(country)
                            .class(
                              "sticky top-0 bg-background py-2 text-sm font-semibold text-primary",
                            ),
                          h
                            .ul(
                              [...stores]
                                .sort((a, b) =>
                                  a.displayName.localeCompare(b.displayName),
                                )
                                .map(item),
                            )
                            .class("flex flex-col"),
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
          .button(
            h
              .span(
                icon(h, "mapPin", { class: "size-5 mr-2 text-accent" }),
                Option.match(current, {
                  onNone: () =>
                    h.span("Select your store").class("text-muted-foreground"),
                  onSome: (location) => h.span(location.city),
                }),
              )
              .class("flex items-center"),
            icon(h, "chevronDown", { class: "size-4 opacity-50" }),
          )
          .ref(triggerRef)
          .attr("type", "button")
          .attr("role", "combobox")
          .attr("aria-haspopup", "listbox")
          .attr("aria-expanded", String(model.open))
          .attr("aria-controls", "store-options")
          .class(
            cn(
              "flex h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm font-medium whitespace-nowrap text-foreground outline-none transition-[color,box-shadow] hover:border-primary/40 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15",
              model.open && "border-primary",
            ),
          )
          .onClick(Message.make({ _tag: "Toggled" })),
        model.open && [
          // Catches a press anywhere else, which closes the list
          h
            .div()
            .class("fixed inset-0 z-40")
            .attr("aria-hidden", "true")
            .onClick(Message.make({ _tag: "Closed" }))
            .key("away"),
          h
            .div(
              h
                .div("Select your store")
                .id("store-options-label")
                .class("px-2 py-1.5 text-xs font-bold text-muted-foreground"),
              nearbyOptions,
              h
                .div()
                .attr("role", "separator")
                .class("bg-border pointer-events-none -mx-1 my-1 h-px"),
              h
                .button(
                  icon(h, "search", { class: "text-primary" }),
                  "Search all stores",
                )
                .attr("type", "button")
                .attr("role", "option")
                .attr("aria-selected", "false")
                .class(optionClass)
                .onClick(Message.make({ _tag: "SearchOpened" })),
            )
            .id("store-options")
            .attr("role", "listbox")
            .attr("aria-labelledby", "store-options-label")
            .class(
              "absolute inset-x-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95",
            )
            .key("options"),
        ],
        model.searching && storeSearch(),
      )
      .class("relative w-full")
      .onKeyDown(({ key }) =>
        key === "Escape" && model.open
          ? Message.make({ _tag: "Closed" })
          : undefined,
      )
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
