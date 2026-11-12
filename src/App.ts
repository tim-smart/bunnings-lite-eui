import { Effect, Layer, Schema } from "effect"
import { Command, Component, Head, Router } from "effect/ui"
import { Reload } from "./browser/services/Reload.ts"
import { buttonClass } from "./design/classes.ts"
import { AppRoute } from "./routes.ts"
import { Shell } from "./Shell.ts"
import { JoinFailed, JoinProgress } from "./sync/domain/Invite.ts"
import { PendingJoin } from "./sync/services/PendingJoin.ts"

export const AppMessage = Schema.TaggedUnion({
  RouteChanged: { route: AppRoute },
  JoinProgressed: { progress: JoinProgress },
  JoinFailed: {},
  Retry: {},
  Reloading: {},
})

/**
 * Applies a join recorded before the last reload. It runs before the shell
 * mounts, because the shell's services open the journal the join replaces.
 */
export class FinishJoin extends Command.Service<FinishJoin>()(
  "App/FinishJoin",
  { args: {}, stream: true, invalidates: () => [] },
  Effect.gen(function* () {
    const join = yield* PendingJoin
    return () => join.finish
  }),
) {}

export class ReloadPage extends Command.Service<ReloadPage>()(
  "App/ReloadPage",
  { args: {}, invalidates: () => [] },
  Effect.gen(function* () {
    const page = yield* Reload
    return () => page.reload
  }),
) {}

export const AppNoDeps = Component.make({
  name: "App",
  props: Schema.Struct({ route: AppRoute }),
  model: Schema.Struct({
    route: AppRoute,
    join: Schema.Literals(["Checking", "Blocked", "Failed", "Ready"]),
  }),
  message: AppMessage,
  init: ($) =>
    $.set({ route: $.props.route, join: "Checking" }).run(
      FinishJoin.make().pipe(
        Command.match({
          onSuccess: (progress) =>
            AppMessage.make({ _tag: "JoinProgressed", progress }),
          onFailure: (_: JoinFailed) => AppMessage.make({ _tag: "JoinFailed" }),
        }),
      ),
    ),
  update: (model, message, $) =>
    AppMessage.match(message, {
      RouteChanged: ({ route }) => ({ ...model, route }),
      JoinProgressed: ({ progress }) => ({
        ...model,
        join:
          progress === "Finished" ? ("Ready" as const) : ("Blocked" as const),
      }),
      JoinFailed: () => ({ ...model, join: "Failed" as const }),
      Retry: () =>
        $.run(
          ReloadPage.make().pipe(
            Command.map(() => AppMessage.make({ _tag: "Reloading" })),
          ),
        ),
      Reloading: () => model,
    }),
  subscriptions: (model) => [
    Router.subscription(AppRoute, model.route, (route) =>
      AppMessage.make({ _tag: "RouteChanged", route }),
    ),
  ],
  head: () => [Head.lang("en")],
  view: (model, h) => {
    switch (model.join) {
      case "Ready":
        return h.child(Shell, { key: "shell", props: { route: model.route } })
      // Checking takes a moment, and says nothing unless it has to wait
      case "Checking":
        return h.div()
      case "Blocked":
        return h
          .main(
            h.h1("Waiting to finish joining").class("text-xl font-semibold"),
            h.p("Close other Bunnings Lite tabs or windows to finish joining."),
            h.p("This page will continue automatically once they are closed."),
          )
          .class("mx-auto max-w-md space-y-4 p-6 text-white")
          .attr("role", "status")
      case "Failed":
        // The journal stays closed until every setting is saved, and the
        // recorded join is removed last, so a reload retries all of it.
        return h
          .main(
            h.h1("Could not finish joining").class("text-xl font-semibold"),
            h.p("Check that browser storage is available, then try again."),
            h
              .button("Retry")
              .attr("type", "button")
              .class(buttonClass())
              .onClick(AppMessage.make({ _tag: "Retry" })),
          )
          .class("mx-auto max-w-md space-y-4 p-6 text-white")
          .attr("role", "alert")
    }
  },
})

export const App = AppNoDeps.pipe(
  Component.provide([
    FinishJoin.layer.pipe(Layer.provide(PendingJoin.layer)),
    ReloadPage.layer,
  ]),
)
