import { cn } from "@/lib/utils"
import type { H } from "./h"
import { icon } from "./icons"

/** Five stars, filled up to `rating`, with a half star for a fraction. */
export const starRating = <Msg>(
  h: H<Msg>,
  options: { readonly rating: number; readonly size?: "sm" | "md" },
) => {
  const { rating } = options
  const size = options.size === "sm" ? "h-4 w-4" : "h-5 w-5"
  const empty = () =>
    icon(h, "star", {
      class: cn(size, "transition-colors fill-none text-foreground/25"),
    })
  return h
    .div(
      [0, 1, 2, 3, 4].map((index) => {
        const half = rating % 1 !== 0 && index + 1 === Math.ceil(rating)
        const star = icon(h, half ? "starHalf" : "star", {
          class: cn(
            half ? "absolute top-0 left-0" : "relative",
            size,
            "transition-colors",
            index < rating
              ? "fill-accent text-accent"
              : "fill-none text-foreground/25",
          ),
        })
        return half
          ? h.div(star, empty()).class("relative", size).key(String(index))
          : star.key(String(index))
      }),
    )
    .class("flex items-center")
    .attr("aria-label", `Rating: ${rating} out of 5 stars`)
}
