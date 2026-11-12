import { Schema } from "effect"
import type { Renderer, View } from "effect/ui"
import { Html } from "effect/ui/html"
import { cn } from "../lib/utils.ts"
import type { H } from "./h.ts"

/**
 * Where focus goes when Tab passes an end of a drawer: to its other end.
 * `retry` allows one more try, from the opposite end, when that control
 * isn't showing.
 */
export const FocusWrap = Schema.Struct({
  edge: Schema.Literals(["first", "last"]),
  retry: Schema.Boolean,
})
export type FocusWrap = typeof FocusWrap.Type

/**
 * A bottom sheet over the page, and a modal. Render it only while it is
 * open, and outside the page: `Shell` makes the page `inert` behind it, and
 * a drawer inside the page would be inert too. Escape and a press on the
 * backdrop both send `onClose`; its component moves focus into it with
 * `Html.focus`.
 *
 * Tab past either end lands on a hidden stop, which sends `onWrap` with the
 * end to carry on from. Answer it by running `wrapFocus`.
 *
 * `titleId` is the id `drawerHeader` gives the title, which names the dialog.
 */
export const drawer = <Msg, const C extends ReadonlyArray<View.Input<Msg>>>(
  h: H<Msg>,
  options: {
    readonly titleId: string
    readonly described?: boolean
    readonly onClose: Msg
    readonly onWrap: (wrap: FocusWrap) => Msg
    readonly class?: string
  },
  ...children: C
) => {
  const stop = (edge: FocusWrap["edge"]) =>
    h
      .span()
      .attr("tabindex", "0")
      .class("pointer-events-none fixed size-px opacity-0 outline-none")
      .onFocus(options.onWrap({ edge, retry: true }))
  return h.div(
    h
      .div()
      .class("fixed inset-0 z-50 bg-black/50 animate-in fade-in-0")
      .attr("aria-hidden", "true")
      .onClick(options.onClose),
    h
      .dialog(
        // Shift+Tab from the first control carries on from the last
        stop("last"),
        h
          .div()
          .class("bg-muted mx-auto mt-4 h-2 w-[100px] shrink-0 rounded-full")
          .attr("aria-hidden", "true"),
        ...children,
        stop("first"),
      )
      .open(true)
      .attr("aria-modal", "true")
      .attr("aria-labelledby", options.titleId)
      .attr(
        "aria-describedby",
        options.described === false
          ? undefined
          : `${options.titleId}-description`,
      )
      .class(
        cn(
          "fixed inset-x-0 top-auto bottom-0 z-50 m-0 mx-auto flex h-auto max-h-[80vh] w-full max-w-md flex-col rounded-t-lg border-0 border-t bg-background p-0 text-foreground animate-in slide-in-from-bottom duration-300",
          options.class,
        ),
      )
      .onKeyDown(({ key }) => (key === "Escape" ? options.onClose : undefined)),
  )
}

/**
 * Moves focus to an end of a drawer, for its `onWrap`. `first` and `last`
 * are the controls at the ends of its tab order.
 */
export const wrapFocus = <
  Msg,
  First extends HTMLElement,
  Last extends HTMLElement,
>(
  wrap: FocusWrap,
  refs: {
    readonly first: Renderer.Ref<First>
    readonly last: Renderer.Ref<Last>
  },
  messages: {
    readonly done: Msg
    readonly onWrap: (wrap: FocusWrap) => Msg
  },
) => {
  const focused = ({ found }: Html.Found) =>
    found || !wrap.retry
      ? messages.done
      : messages.onWrap({
          edge: wrap.edge === "first" ? "last" : "first",
          retry: false,
        })
  return wrap.edge === "first"
    ? Html.focus(refs.first, focused)
    : Html.focus(refs.last, focused)
}

export const drawerHeader = <
  Msg,
  const C extends ReadonlyArray<View.Input<Msg>>,
>(
  h: H<Msg>,
  options: { readonly titleId: string; readonly title: string },
  ...description: C
) =>
  h
    .div(
      h
        .h2(options.title)
        .id(options.titleId)
        .class("text-foreground font-semibold"),
      h
        .p(...description)
        .id(`${options.titleId}-description`)
        .class("text-muted-foreground text-sm"),
    )
    .class("flex flex-col gap-0.5 p-4 text-center md:gap-1.5 md:text-left")

export const drawerFooter = <
  Msg,
  const C extends ReadonlyArray<View.Input<Msg>>,
>(
  h: H<Msg>,
  ...children: C
) => h.div(...children).class("mt-auto flex flex-col gap-2 p-4")
