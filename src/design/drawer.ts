import type { View } from "effect/ui"
import type { H } from "./h.ts"

/**
 * A bottom sheet over the page, as a modal `dialog`: the browser shows it
 * in the top layer, makes everything else inert and keeps focus inside.
 * Render it only while it is open. Escape and a press on the backdrop both
 * send `onClose`.
 *
 * Focus starts on the control marked `autofocus`, or the first one. A sheet
 * that is removed has nowhere to hand focus back to, so whoever closes it
 * says where focus goes next.
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
  h.dialog
    .modal(true)
    .onCancel(options.onClose)
    .attr("aria-labelledby", options.titleId)
    .attr(
      "aria-describedby",
      options.described === false
        ? undefined
        : `${options.titleId}-description`,
    )
    .class(
      "fixed inset-0 m-0 size-full max-h-none max-w-none overflow-hidden border-0 bg-transparent p-0 text-foreground backdrop:bg-transparent",
    )
    .children(
      // The dialog fills the screen so that its own backdrop can be pressed.
      // `::backdrop` takes no handler, and `closedby` isn't in every browser.
      h.div
        .class("absolute inset-0 bg-black/50 animate-in fade-in-0")
        .attr("aria-hidden", "true")
        .onClick(options.onClose),
      h.div
        .class(
          "absolute inset-x-0 bottom-0 mx-auto flex max-h-[80vh] w-full max-w-md flex-col rounded-t-lg border-t bg-background animate-in slide-in-from-bottom duration-300",
          options.class,
        )
        .children(
          h.div
            .class("bg-muted mx-auto mt-4 h-2 w-[100px] shrink-0 rounded-full")
            .attr("aria-hidden", "true"),
          ...children,
        ),
    )

export const drawerHeader = <
  Msg,
  const C extends ReadonlyArray<View.Input<Msg>>,
>(
  h: H<Msg>,
  options: { readonly titleId: string; readonly title: string },
  ...description: C
) =>
  h.div
    .class("flex flex-col gap-0.5 p-4 text-center md:gap-1.5 md:text-left")
    .children(
      h.h2
        .id(options.titleId)
        .class("text-foreground font-semibold")
        .children(options.title),
      h.p
        .id(`${options.titleId}-description`)
        .class("text-muted-foreground text-sm")
        .children(...description),
    )

export const drawerFooter = <
  Msg,
  const C extends ReadonlyArray<View.Input<Msg>>,
>(
  h: H<Msg>,
  ...children: C
) => h.div.class("mt-auto flex flex-col gap-2 p-4").children(...children)
