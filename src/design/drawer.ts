import type { View } from "effect/ui"
import { cn } from "../lib/utils.ts"
import type { H } from "./h.ts"

/**
 * A bottom sheet over the page. Render it only while it is open. Escape and
 * a press on the backdrop both send `onClose`; the component that opens it
 * moves focus into it with `Html.focus`.
 *
 * `titleId` is the id `drawerHeader` gives the title, which names the dialog.
 */
export const drawer = <Msg, const C extends ReadonlyArray<View.Input<Msg>>>(
  h: H<Msg>,
  options: {
    readonly titleId: string
    readonly described?: boolean
    readonly onClose: Msg
    readonly class?: string
  },
  ...children: C
) =>
  h.div(
    h
      .div()
      .class("fixed inset-0 z-50 bg-black/50 animate-in fade-in-0")
      .attr("aria-hidden", "true")
      .onClick(options.onClose),
    h
      .dialog(
        h
          .div()
          .class("bg-muted mx-auto mt-4 h-2 w-[100px] shrink-0 rounded-full")
          .attr("aria-hidden", "true"),
        ...children,
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
