import { Effect, Schema, Stream } from "effect"
import { Command, Component, Subscription } from "effect/ui"
import { buttonClass } from "../../design/classes.ts"
import { icon } from "../../design/icons.ts"
import { InstallPrompt } from "../services/InstallPrompt.ts"

export const InstallButtonMessage = Schema.TaggedUnion({
  AvailabilityChanged: { available: Schema.Boolean },
  Pressed: {},
  Done: {},
})
const Message = InstallButtonMessage

/** Shows the browser's prompt to install the app. */
export class PromptInstall extends Command.Service<PromptInstall>()(
  "browser/PromptInstall",
  { args: {}, invalidates: () => [] },
  Effect.gen(function* () {
    const install = yield* InstallPrompt
    return () => install.prompt
  }),
) {}

const installAvailable = Subscription.make(
  "browser/installAvailable",
  Stream.unwrap(
    Effect.map(InstallPrompt, (install) =>
      install.available.pipe(
        Stream.map((available) =>
          Message.make({ _tag: "AvailabilityChanged", available }),
        ),
      ),
    ),
  ),
)

/** Offers to install the app, once the browser says it can be. */
export const InstallButtonNoDeps = Component.make({
  name: "InstallButton",
  model: Schema.Struct({ available: Schema.Boolean }),
  message: Message,
  init: () => ({ available: false }),
  update: (model, message, $) =>
    Message.match(message, {
      AvailabilityChanged: ({ available }) => ({ available }),
      Pressed: () =>
        $.run(
          PromptInstall.make().pipe(
            Command.map(() => Message.make({ _tag: "Done" })),
          ),
        ),
      Done: () => model,
    }),
  subscriptions: () => [installAvailable],
  view: (model, h) =>
    h.div(
      model.available &&
        h.button
          .attr("type", "button")
          .class(buttonClass({ class: "cursor-pointer" }))
          .onClick(Message.make({ _tag: "Pressed" }))
          .children(icon(h, "house"), "Add to home screen"),
    ),
})

export const InstallButton = InstallButtonNoDeps.pipe(
  Component.provide(PromptInstall.layer),
)
