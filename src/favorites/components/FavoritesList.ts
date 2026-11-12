import { Effect, Layer, Schema } from "effect"
import { AsyncResult, Loader } from "effect/reactivity"
import { Command, Component } from "effect/ui"
import { icon } from "../../design/icons.ts"
import { ProductCard } from "../../product/components/ProductCard.ts"
import { KnownProducts } from "../../product/services/KnownProducts.ts"
import { ListFavorites } from "../loaders/ListFavorites.ts"
import { Favorites } from "../services/Favorites.ts"

const FavoritesSnapshot = Loader.Snapshot(ListFavorites, "favorites")

export const FavoritesListMessage = Schema.TaggedUnion({
  Cleared: {},
  Done: {},
  FavoritesChanged: { snapshot: FavoritesSnapshot },
})
const Message = FavoritesListMessage

/** Removes every favourite, on every device that syncs with this one. */
export class ClearFavorites extends Command.Service<ClearFavorites>()(
  "favorites/ClearFavorites",
  {
    args: {},
    // The favourites refetch themselves after every change
    invalidates: () => [],
  },
  Effect.gen(function* () {
    const favorites = yield* Favorites
    return () => favorites.clear
  }),
) {}

/** The favourites as a grid of product cards, newest first. */
export const FavoritesListNoDeps = Component.make({
  name: "FavoritesList",
  model: Schema.Struct({ favorites: FavoritesSnapshot }),
  message: Message,
  loaders: {
    favorites: () => ({}),
  },
  init: ($) => $.empty,
  update: (model, message, $) =>
    Message.match(message, {
      Cleared: () =>
        $.run(
          ClearFavorites.make().pipe(
            Command.map(() => Message.make({ _tag: "Done" })),
          ),
        ),
      Done: () => model,
      FavoritesChanged: ({ snapshot }) => ({ favorites: snapshot }),
    }),
  subscriptions: (_model, _props, $) => [
    $.watch({
      favorites: (snapshot) =>
        Message.make({ _tag: "FavoritesChanged", snapshot }),
    }),
  ],
  view: (_model, h) => {
    const favorites = AsyncResult.getOrElse(h.loaded.favorites, () => [])
    if (favorites.length === 0) {
      return h.section
        .attr("aria-labelledby", "favourites-heading")
        .class(
          "flex flex-col items-center gap-2 rounded-xl bg-card/60 px-6 py-10 text-center",
        )
        .children(
          icon(h, "star", { class: "size-7 text-accent" }),
          h.h2
            .id("favourites-heading")
            .class("font-bold")
            .children("No favourites yet"),
          h.p
            .class("max-w-xs text-sm text-muted-foreground")
            .children(
              "Tap the star on any product to keep it here for your next trip.",
            ),
        )
    }
    return h.section
      .attr("aria-labelledby", "favourites-heading")
      .class("w-full flex flex-col gap-4")
      .children(
        h.div.class("flex items-center justify-between gap-4").children(
          h.h2
            .id("favourites-heading")
            .class("flex items-center gap-2 text-lg font-bold text-primary")
            .children(
              "Favourites ",
              h.span
                .class(
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-xs font-semibold tabular-nums",
                )
                .children(String(favorites.length)),
            ),
          h.button
            .attr("type", "button")
            .class(
              "cursor-pointer rounded-sm text-sm font-medium text-muted-foreground underline-offset-4 hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            )
            .onClick(Message.make({ _tag: "Cleared" }))
            .children("Clear all"),
        ),
        h.div
          .class(
            "grid gap-2 sm:gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
          )
          .children(
            favorites.map((product) =>
              h.child(ProductCard, {
                key: product.id,
                props: { product, query: "" },
              }),
            ),
          ),
      )
  },
})

export const FavoritesList = FavoritesListNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(ClearFavorites.layer, ListFavorites.layer).pipe(
      Layer.provide([Favorites.layer, KnownProducts.layer]),
    ),
  ),
)
