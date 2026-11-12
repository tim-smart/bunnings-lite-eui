import { DateTime, Effect, Layer, Option, Schema } from "effect"
import { AsyncResult, Loader } from "effect/reactivity"
import { Command, Component, Router } from "effect/ui"
import type { ProductReview } from "../../../server/src/domain/Bazaar.ts"
import type {
  ProductBaseInfo,
  ProductPriceInfo,
} from "../../../server/src/domain/Bunnings.ts"
import { Share } from "../../browser/services/Share.ts"
import { bottomReached } from "../../browser/subscriptions.ts"
import { buttonClass, cardClass } from "../../design/classes.ts"
import { icon } from "../../design/icons.ts"
import { richText } from "../../design/richText.ts"
import { skeleton } from "../../design/skeleton.ts"
import { starRating } from "../../design/starRating.ts"
import { FavoriteButton } from "../../favorites/components/FavoriteButton.ts"
import { cn, formatPrice } from "../../lib/utils.ts"
import { FulfillmentBadge } from "../../product/components/FulfillmentBadge.ts"
import { parseRichText } from "../../product/domain/RichText.ts"
import { GetKnownProduct } from "../../product/loaders/GetKnownProduct.ts"
import { GetProduct } from "../../product/loaders/GetProduct.ts"
import { GetReviewStats } from "../../product/loaders/GetReviewStats.ts"
import { ListReviews } from "../../product/loaders/ListReviews.ts"
import { KnownProducts } from "../../product/services/KnownProducts.ts"
import { ReviewFeed } from "../../product/services/ReviewFeed.ts"
import { Session } from "../../rpc/services/Session.ts"

const ProductSnapshot = Loader.Snapshot(GetProduct, "product")
const KnownSnapshot = Loader.Snapshot(GetKnownProduct, "known")
const StatsSnapshot = Loader.Snapshot(GetReviewStats, "stats")
const ReviewsSnapshot = Loader.SnapshotList(ListReviews, "reviews")

export const ProductPageMessage = Schema.TaggedUnion({
  ImageChosen: { index: Schema.Number },
  BackPressed: {},
  SharePressed: { title: Schema.String },
  BottomReached: {},
  Done: {},
  ProductChanged: { snapshot: ProductSnapshot },
  KnownChanged: { snapshot: KnownSnapshot },
  StatsChanged: { snapshot: StatsSnapshot },
  ReviewsChanged: {
    snapshot: ReviewsSnapshot,
    /** Whether there are more reviews that nothing is loading yet. */
    more: Schema.Boolean,
  },
})
const Message = ProductPageMessage

/** Offers the product's page to the device's share sheet. */
export class ShareProduct extends Command.Service<ShareProduct>()(
  "product/ShareProduct",
  { args: { title: Schema.String }, invalidates: () => [] },
  Effect.gen(function* () {
    const share = yield* Share
    return ({ title }) => share.sharePage(title)
  }),
) {}

const done = Command.map(() => Message.make({ _tag: "Done" }))

/**
 * A product: its photos, price, stock at the chosen store, description,
 * specifications and reviews. It opens with what a search or the favourites
 * already said about the product while the rest loads.
 */
export const ProductPageNoDeps = Component.make({
  name: "ProductPage",
  props: Schema.Struct({ id: Schema.String }),
  model: Schema.Struct({
    product: ProductSnapshot,
    known: KnownSnapshot,
    stats: StatsSnapshot,
    reviews: ReviewsSnapshot,
    /** Which photo is showing. */
    image: Schema.Number,
    moreReviews: Schema.Boolean,
  }),
  message: Message,
  loaders: {
    product: (_model, props) => ({ id: props.id }),
    known: (_model, props) => ({ id: props.id }),
    stats: (_model, props) => ({ id: props.id }),
    reviews: (_model, props) => ({ id: props.id }),
  },
  init: ($) => ({ ...$.empty, image: 0, moreReviews: false }),
  update: (model, message, $) =>
    Message.match(message, {
      ImageChosen: ({ index }) => ({ ...model, image: index }),
      BackPressed: () => $.run(Router.Back.make().pipe(done)),
      SharePressed: ({ title }) =>
        $.run(ShareProduct.make({ title }).pipe(done)),
      BottomReached: () => (model.moreReviews ? $.loadMore("reviews") : model),
      Done: () => model,
      ProductChanged: ({ snapshot }) => ({ ...model, product: snapshot }),
      KnownChanged: ({ snapshot }) => ({ ...model, known: snapshot }),
      StatsChanged: ({ snapshot }) => ({ ...model, stats: snapshot }),
      ReviewsChanged: ({ more, snapshot }) => ({
        ...model,
        reviews: snapshot,
        moreReviews: more,
      }),
    }),
  subscriptions: (_model, _props, $) => [
    $.watch({
      product: (snapshot) => Message.make({ _tag: "ProductChanged", snapshot }),
      known: (snapshot) => Message.make({ _tag: "KnownChanged", snapshot }),
      stats: (snapshot) => Message.make({ _tag: "StatsChanged", snapshot }),
      reviews: (snapshot, loaded) =>
        Message.make({
          _tag: "ReviewsChanged",
          snapshot,
          more: Option.exists(
            AsyncResult.value(loaded),
            (list) => list.more._tag === "Available",
          ),
        }),
    }),
    bottomReached(Message.make({ _tag: "BottomReached" })),
  ],
  view: (model, h) => {
    const fullInfo: Option.Option<ProductPriceInfo> = AsyncResult.value(
      h.loaded.product,
    )
    const base: Option.Option<ProductBaseInfo> = Option.orElse(
      Option.map(fullInfo, (info) => info.asBaseInfo),
      () => Option.flatten(AsyncResult.value(h.loaded.known)),
    )

    if (Option.isNone(base)) {
      return AsyncResult.isFailure(h.loaded.product)
        ? h
            .div(
              h.p("Couldn't load this product.").attr("role", "status"),
              h
                .a("Back to search")
                .attr("href", "/")
                .class(buttonClass({ variant: "outline" })),
            )
            .class(
              "flex flex-col items-center gap-4 pt-20 text-lg text-muted-foreground",
            )
        : h
            .div("Loading product...")
            .class(
              "flex h-full items-center justify-center text-lg text-muted-foreground pt-20 animate-pulse",
            )
    }
    const product = base.value

    const stats = Option.map(
      Option.flatten(AsyncResult.value(h.loaded.stats)),
      (stats) => stats.ReviewStatistics,
    )
    const rating = Option.match(stats, {
      onNone: () => product.rating,
      onSome: (stats) => stats.AverageOverallRating,
    })
    const reviewCount = Option.match(stats, {
      onNone: () => product.numberOfReviews,
      onSome: (stats) => stats.TotalReviewCount,
    })

    const description = Option.match(fullInfo, {
      onNone: () =>
        h
          .div(
            skeleton(h, "h-4 w-full"),
            skeleton(h, "h-4 w-full"),
            skeleton(h, "h-4 w-full"),
          )
          .class("flex flex-col space-y-2"),
      onSome: (info) => {
        const pointers = info.info.feature.pointers ?? []
        return h
          .div(
            pointers.length > 0 &&
              h.ul(pointers.map((pointer, i) => h.li(pointer).key(String(i)))),
            richText(
              h,
              parseRichText(info.info.feature.description, { html: true }),
            ),
          )
          .class(
            "prose prose-sm sm:prose-base max-w-none prose-p:text-foreground prose-li:text-foreground prose-li:marker:text-accent prose-a:text-primary dark:prose-invert",
          )
      },
    })

    const specificationRow =
      "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 rounded-lg px-2 even:bg-canvas lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] sm:px-3"
    const specifications = Option.map(
      fullInfo,
      (info) => info.info.specifications,
    )
    const specificationsSection =
      Option.isSome(specifications) && specifications.value.length === 0
        ? undefined
        : h
            .section(
              h
                .h2("Specifications")
                .id("specifications-heading")
                .class("text-lg font-bold tracking-tight mb-3"),
              Option.match(specifications, {
                onNone: () =>
                  h
                    .div(
                      [0, 1, 2, 3, 4, 5].map((i) =>
                        h
                          .div(
                            skeleton(h, "h-3.5 w-3/4"),
                            skeleton(h, "h-3.5 w-1/2"),
                          )
                          .class(cn(specificationRow, "py-3"))
                          .key(String(i)),
                      ),
                    )
                    .class("-mx-2 flex flex-col sm:-mx-3"),
                onSome: (specifications) =>
                  h
                    .dl(
                      specifications.map((spec, i) =>
                        h
                          .div(
                            h.dt(spec.name).class("text-muted-foreground"),
                            h
                              .dd(spec.value)
                              .class("font-medium break-words tabular-nums"),
                          )
                          .class(
                            cn(
                              specificationRow,
                              "py-2.5 text-sm leading-snug sm:text-[15px]",
                            ),
                          )
                          .key(String(i)),
                      ),
                    )
                    .class("-mx-2 flex flex-col sm:-mx-3"),
              }),
            )
            .attr("aria-labelledby", "specifications-heading")
            .class("rounded-xl bg-card p-4 sm:p-6")

    const image = product.images[model.image] ?? product.images[0]
    const images = h
      .div(
        h
          .div(
            h
              .img()
              .attr("src", image.url)
              .attr("alt", product.title)
              .class(
                "max-h-full max-w-full object-contain animate-in fade-in duration-300 dark:brightness-90",
              )
              .key(image.url),
          )
          .class(
            "rounded-xl bg-image-well text-image-well-foreground flex items-center justify-center aspect-square overflow-hidden p-6 sm:p-10",
          ),
        h
          .div(
            product.images.map((image, i) =>
              h
                .button(
                  h
                    .img()
                    .attr("src", image.thumbnailUrl)
                    .attr("alt", "")
                    .class("size-full object-contain dark:brightness-90"),
                )
                .attr("type", "button")
                .attr("aria-label", `Show image ${i + 1}`)
                .attr("aria-current", i === model.image ? "true" : undefined)
                .class(
                  cn(
                    "aspect-square cursor-pointer rounded-lg bg-image-well p-2 text-image-well-foreground ring-inset transition-shadow hover:ring-2 hover:ring-brand/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                    i === model.image && "ring-2 ring-brand hover:ring-brand",
                  ),
                )
                .onClick(Message.make({ _tag: "ImageChosen", index: i }))
                .key(String(i)),
            ),
          )
          .class("grid grid-cols-4 gap-2 sm:gap-3 lg:grid-cols-5"),
      )
      .class(
        "flex flex-col gap-2 sm:gap-3 md:col-start-1 md:row-start-1 md:row-span-2 md:sticky md:top-6 md:self-start",
      )

    const reviewsOverview = Option.match(stats, {
      onNone: () =>
        h
          .div(
            h
              .div(
                skeleton(h, "h-32 w-32 rounded-xl"),
                h.div().class("w-4"),
                h
                  .div(
                    [0, 1, 2, 3, 4].map((i) =>
                      skeleton(h, "h-4 w-full").key(String(i)),
                    ),
                  )
                  .class("space-y-2 flex-1"),
              )
              .class("flex w-full space-y-3"),
          )
          .class(
            "flex items-center gap-4 mb-4 sm:mb-6 rounded-xl bg-card p-4 sm:p-6 md:max-w-xl",
          ),
      onSome: (stats) =>
        h
          .div(
            h
              .div(
                h
                  .span(stats.AverageOverallRating.toFixed(1))
                  .class("text-5xl font-bold tracking-tight tabular-nums"),
                h
                  .div(starRating(h, { rating: stats.AverageOverallRating }))
                  .class("flex"),
                h
                  .span(`${stats.TotalReviewCount} reviews`)
                  .class("text-sm text-muted-foreground tabular-nums"),
              )
              .class("flex flex-col items-center gap-1"),
            h
              .div(
                [5, 4, 3, 2, 1].map((stars) => {
                  const rating = stats.RatingDistribution.find(
                    (rating) => rating.RatingValue === stars,
                  )
                  const percentage =
                    rating === undefined || stats.TotalReviewCount === 0
                      ? 0
                      : Math.round(
                          100 * (rating.Count / stats.TotalReviewCount),
                        )
                  return h
                    .div(
                      h.span(String(stars)).class("w-2 text-muted-foreground"),
                      h
                        .div(
                          h
                            .div()
                            .class("bg-secondary h-2 rounded-full")
                            .attr("style", `width: ${percentage}%`),
                        )
                        .class(
                          "w-full bg-muted rounded-full h-2 overflow-hidden",
                        ),
                    )
                    .class("flex items-center gap-3 text-sm tabular-nums")
                    .key(String(stars))
                }),
              )
              .class("flex flex-1 flex-col gap-1.5"),
          )
          .class(
            "flex items-center gap-6 mb-4 sm:mb-6 rounded-xl bg-card p-4 sm:p-6 md:max-w-xl",
          ),
    })

    const reviewCard = (review: ProductReview) =>
      h
        .div(
          h
            .div(
              h
                .div(
                  h
                    .div(
                      starRating(h, { size: "sm", rating: review.Rating }),
                      h
                        .h3(review.Title ?? "")
                        .class("font-semibold leading-snug"),
                    )
                    .class("flex flex-col gap-1.5"),
                  h
                    .span(
                      DateTime.formatLocal(review.SubmissionTime, {
                        dateStyle: "short",
                      }),
                    )
                    .class(
                      "shrink-0 text-sm text-muted-foreground tabular-nums",
                    ),
                )
                .class("flex justify-between items-start gap-4"),
              h
                .div(
                  richText(
                    h,
                    parseRichText(review.ReviewText, { html: false }),
                  ),
                )
                .class(
                  "mt-2 prose prose-sm max-w-none dark:prose-invert prose-p:text-foreground/85",
                ),
            )
            .class("px-5"),
        )
        .class(cardClass("gap-0 py-5"))
        .key(review.Id)

    const reviews = Option.match(
      Option.orElse(
        AsyncResult.value(h.loaded.reviews),
        () => h.previous.reviews,
      ),
      { onNone: () => [], onSome: (list) => list.items },
    )

    return h.div(
      h
        .div(
          h
            .button(icon(h, "arrowLeft"), "Back")
            .attr("type", "button")
            .class(
              buttonClass({ variant: "link", class: "-ml-3 cursor-pointer" }),
            )
            .onClick(Message.make({ _tag: "BackPressed" })),
        )
        .class("py-3 sm:py-4"),
      h
        .div(
          h
            .div(
              h
                .div(
                  h
                    .h1(product.title)
                    .class(
                      "text-2xl md:text-3xl font-bold leading-tight tracking-tight text-balance",
                    ),
                  h
                    .div(
                      h.child(FulfillmentBadge, {
                        key: "fulfillment",
                        props: {
                          id: product.id,
                          showAvailable: false,
                          class: "empty:hidden",
                        },
                      }),
                      h
                        .span(`I/N: ${product.id}`)
                        .class("text-sm text-muted-foreground tabular-nums"),
                    )
                    .class("flex flex-wrap gap-3 items-center"),
                )
                .class("flex flex-col gap-3"),
              h
                .div(
                  h
                    .div(
                      h
                        .span(formatPrice(product.price))
                        .class(
                          "text-4xl font-bold tracking-tight tabular-nums text-primary",
                        ),
                      h.span("inc. GST").class("text-sm text-muted-foreground"),
                    )
                    .class("flex items-baseline gap-2"),
                  h
                    .div(
                      starRating(h, { rating }),
                      h
                        .span(`(${reviewCount} reviews)`)
                        .class("text-sm text-muted-foreground tabular-nums"),
                    )
                    .class("flex items-center gap-2"),
                )
                .class("flex flex-wrap items-center gap-x-6 gap-y-2"),
              h
                .div(
                  h
                    .a("Open in Bunnings", icon(h, "arrowRight"))
                    .attr("href", product.url)
                    .attr("target", "_blank")
                    .attr("rel", "noopener noreferrer")
                    .class(
                      buttonClass({
                        variant: "secondary",
                        size: "lg",
                        class: "col-span-2",
                      }),
                    ),
                  h.child(FavoriteButton, {
                    key: "favorite",
                    props: { product, variant: "button" },
                  }),
                  h
                    .button(icon(h, "share"), "Share")
                    .attr("type", "button")
                    .class(buttonClass({ variant: "outline", size: "lg" }))
                    .onClick(
                      Message.make({
                        _tag: "SharePressed",
                        title: product.title,
                      }),
                    ),
                )
                .class(
                  "grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center",
                ),
            )
            .class("flex flex-col gap-5 md:col-start-2 md:row-start-1 md:pt-2"),
          images,
          h
            .div(
              h.div(description).class("rounded-xl bg-card p-4 sm:p-6"),
              specificationsSection,
            )
            .class(
              "flex flex-col gap-4 md:col-start-2 md:row-start-2 md:gap-5",
            ),
        )
        .class(
          "grid grid-cols-1 gap-4 md:grid-cols-2 md:grid-rows-[auto_1fr] md:gap-x-8 md:gap-y-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,6fr)] lg:gap-x-12",
        ),
      h.div().class("h-10 md:h-16"),
      h
        .section(
          h
            .h2("Customer Reviews")
            .id("reviews-heading")
            .class("text-xl md:text-2xl font-bold tracking-tight mb-4"),
          reviewsOverview,
          h
            .div(reviews.map(reviewCard))
            .class(
              "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4",
            ),
        )
        .attr("aria-labelledby", "reviews-heading"),
    )
  },
})

export const ProductPage = ProductPageNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(
      GetProduct.layer,
      GetKnownProduct.layer,
      GetReviewStats.layer,
      ListReviews.layer.pipe(Layer.provide(ReviewFeed.layer)),
      ShareProduct.layer,
    ).pipe(Layer.provide([Session.layer, KnownProducts.layer])),
  ),
)
