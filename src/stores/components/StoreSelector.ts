import { Effect, Layer, Option, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Command, Component } from "effect/ui"
import { Html } from "effect/ui/html"
import {
  SessionLocation,
  type Store,
} from "../../../server/src/domain/Bunnings.ts"
import { icon } from "../../design/icons.ts"
import { SessionTag } from "../../rpc/domain/SessionTag.ts"
import { Session } from "../../rpc/services/Session.ts"
import { CurrentStore } from "../loaders/CurrentStore.ts"
import { NearbyStores } from "../loaders/NearbyStores.ts"
import { StoreSearchPrompt } from "../services/StoreSearchPrompt.ts"

export const StoreSelectorMessage = Schema.TaggedUnion({
  Reached: {},
  StoreChosen: { location: SessionLocation },
  SearchOpened: {},
  /** The store the search came back with, or none when it was closed. */
  SearchAnswered: { store: Schema.Option(SessionLocation) },
  Done: {},
  CurrentChanged: {
    /** The code of the store the session has, once it is known. */
    code: Schema.NullOr(Schema.String),
  },
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

/**
 * Opens the search of every store and waits for what it comes back with:
 * a store, or none when it is closed.
 */
export class SearchAllStores extends Command.Service<SearchAllStores>()(
  "stores/SearchAllStores",
  { args: {}, invalidates: () => [] },
  Effect.gen(function* () {
    const prompt = yield* StoreSearchPrompt
    return () => prompt.ask
  }),
) {}

const searchButtonRef = Html.ref("store-search-open", "button")

const done = Command.map(() => Message.make({ _tag: "Done" }))

/**
 * Chooses the store to shop at: from the ten nearest, which asks for the
 * device's location, or by searching every store by hand.
 *
 * The nearest stores are a native `select`, so the keyboard and a phone's
 * own picker work without any handling here. The chosen store is marked on
 * its `option`: a `value` on the `select` is set before it has options.
 *
 * The search is a drawer, which the shell shows. It is asked for here and
 * comes back with a store or without one.
 */
export const StoreSelectorNoDeps = Component.make({
  name: "StoreSelector",
  model: Schema.Struct({
    /** Whether the nearby stores have been asked for. */
    nearbyWanted: Schema.Boolean,
    /** The store just chosen, until the session has it too. */
    chosen: Schema.NullOr(SessionLocation),
  }),
  message: Message,
  loaders: {
    current: {
      load: CurrentStore,
      args: () => ({}),
      onChange: (result) =>
        Message.make({
          _tag: "CurrentChanged",
          code: Option.match(Option.flatten(AsyncResult.value(result)), {
            onNone: () => null,
            onSome: (location) => location.code,
          }),
        }),
    },
    // Asking for nearby stores asks for the device's location, so it waits
    // until the picker is reached for
    nearby: {
      load: NearbyStores,
      args: (model) => (model.nearbyWanted ? {} : undefined),
    },
  },
  init: () => ({
    nearbyWanted: false,
    chosen: null,
  }),
  update: (model, message, $) =>
    Message.match(message, {
      Reached: () =>
        model.nearbyWanted ? model : { ...model, nearbyWanted: true },
      StoreChosen: ({ location }) =>
        $.set({ ...model, chosen: location }).run(
          ChooseStore.make({ location }).pipe(done),
        ),
      SearchOpened: () =>
        $.run(
          SearchAllStores.make().pipe(
            Command.map((store) =>
              Message.make({ _tag: "SearchAnswered", store }),
            ),
          ),
        ),
      // The page is live again by now, so its button can take focus back
      SearchAnswered: ({ store }) => {
        const refocus = Html.focus(searchButtonRef, () =>
          Message.make({ _tag: "Done" }),
        )
        return Option.match(store, {
          onNone: () => $.run(refocus),
          onSome: (location) =>
            $.set({ ...model, chosen: location }).run(
              ChooseStore.make({ location }).pipe(done),
              refocus,
            ),
        })
      },
      Done: () => model,
      CurrentChanged: ({ code }) => ({
        ...model,
        chosen: model.chosen?.code === code ? null : model.chosen,
      }),
    }),
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

    return h.div.class("w-full").children(
      h.div.class("relative").children(
        icon(h, "mapPin", {
          class:
            "pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-accent",
        }),
        h.select
          .attr("aria-label", "Your store")
          .class(
            "h-11 w-full cursor-pointer appearance-none rounded-md border border-input bg-card py-2 pr-9 pl-10 text-sm font-medium outline-none transition-[color,box-shadow] hover:border-primary/40 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15",
            Option.isNone(shown) ? "text-muted-foreground" : "text-foreground",
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
          })
          .children(
            Option.match(shown, {
              onNone: () =>
                h.option
                  .attr("value", "")
                  .attr("hidden", "")
                  .disabled(true)
                  .selected(true)
                  .key("none")
                  .children("Select your store"),
              // A store chosen by search stays in the list when it isn't nearby
              onSome: (location) =>
                nearby.some((store) => store.name === location.code)
                  ? undefined
                  : h.option
                      .attr("value", location.code)
                      .selected(true)
                      .key(location.code)
                      .children(location.city),
            }),
            // What a list opened too early has to offer
            model.nearbyWanted &&
              AsyncResult.isInitial(h.loaded.nearby) &&
              h.option.disabled(true).key("loading").children("Loading…"),
            nearby.length > 0 &&
              h.optgroup
                .attr("label", "Near you")
                .key("nearby")
                .children(
                  nearby.map((store) =>
                    h.option
                      .attr("value", store.name)
                      .selected(isShown(store.name))
                      .key(store.name)
                      .children(store.displayName),
                  ),
                ),
          ),
        icon(h, "chevronDown", {
          class:
            "pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 opacity-50",
        }),
      ),
      h.div.class("mt-2 flex items-center gap-3").children(
        h.p
          // Always here, so what it comes to say is announced
          .attr("aria-live", "polite")
          .class("text-sm text-muted-foreground")
          .children(nearbyStatus),
        h.button
          .ref(searchButtonRef)
          .attr("type", "button")
          .class(
            "ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-primary/15",
          )
          .onClick(Message.make({ _tag: "SearchOpened" }))
          .children(
            icon(h, "search", { class: "size-4" }),
            "Search all stores",
          ),
      ),
    )
  },
})

export const StoreSelector = StoreSelectorNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(
      CurrentStore.layer,
      NearbyStores.layer,
      ChooseStore.layer,
      SearchAllStores.layer,
    ).pipe(Layer.provide([Session.layer, StoreSearchPrompt.layer])),
  ),
)
