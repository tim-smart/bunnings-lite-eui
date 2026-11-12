import * as Clipboard from "@effect/platform-browser/Clipboard"
import { Effect, Layer, Option, Schema, Stream } from "effect"
import { AsyncResult, Loader } from "effect/reactivity"
import { Command, Component, Subscription } from "effect/ui"
import { buttonClass, inputClass } from "../../design/classes.ts"
import { drawer, drawerFooter, drawerHeader } from "../../design/drawer.ts"
import { icon } from "../../design/icons.ts"
import { skeleton } from "../../design/skeleton.ts"
import { GetSyncSettings } from "../loaders/GetSyncSettings.ts"
import { Invites } from "../services/Invites.ts"
import { SyncRemote } from "../services/SyncRemote.ts"
import { SyncSettings } from "../services/SyncSettings.ts"

const SettingsSnapshot = Loader.Snapshot(GetSyncSettings, "settings")

export const SyncSettingsPanelMessage = Schema.TaggedUnion({
  Closed: {},
  RemoteUrlTyped: { text: Schema.String },
  CopyPressed: {},
  Copied: { copied: Schema.Boolean },
  CopiedExpired: {},
  Done: {},
  SettingsChanged: { snapshot: SettingsSnapshot },
})
const Message = SyncSettingsPanelMessage

export const SyncSettingsPanelEvents = Schema.TaggedUnion({ Closed: {} })

/** Saves the remote to sync with, or none, and connects to it. */
export class SetRemoteUrl extends Command.Service<SetRemoteUrl>()(
  "sync/SetRemoteUrl",
  {
    args: { url: Schema.NullOr(Schema.String) },
    invalidates: () => [GetSyncSettings],
  },
  Effect.gen(function* () {
    const remote = yield* SyncRemote
    return ({ url }) =>
      remote.setUrl(
        Option.map(Option.fromNullishOr(url), (url) => new URL(url)),
      )
  }),
) {}

/**
 * Copies a link that invites another device. It resolves with whether a link
 * was copied. The link holds a private key, so it goes straight to the
 * clipboard and never through the component.
 */
export class CopyInvite extends Command.Service<CopyInvite>()(
  "sync/CopyInvite",
  { args: {}, invalidates: () => [] },
  Effect.gen(function* () {
    const invites = yield* Invites
    const clipboard = yield* Clipboard.Clipboard
    return () =>
      Effect.flatMap(
        invites.link,
        Option.match({
          onNone: () => Effect.succeed(false),
          onSome: (link) =>
            clipboard.writeString(link).pipe(
              Effect.as(true),
              Effect.orElseSucceed(() => false),
            ),
        }),
      )
  }),
) {}

const done = Command.map(() => Message.make({ _tag: "Done" }))

// The URL a remote field holds: none when blank, and nothing to save while
// what is typed isn't a URL yet
const remoteUrlOf = (text: string): string | null | undefined => {
  const trimmed = text.trim()
  if (trimmed === "") return null
  return URL.canParse(trimmed) ? trimmed : undefined
}

/**
 * The sync settings, in a drawer. Mount it while it is open, outside the
 * page it covers. It reports when it is closed.
 */
export const SyncSettingsPanelNoDeps = Component.make({
  name: "SyncSettingsPanel",
  model: Schema.Struct({
    settings: SettingsSnapshot,
    /** What was typed into the remote field. It shows the saved one until then. */
    remoteUrl: Schema.NullOr(Schema.String),
    /** Whether an invite link was just copied. */
    copied: Schema.Boolean,
  }),
  message: Message,
  events: SyncSettingsPanelEvents,
  loaders: {
    settings: () => ({}),
  },
  init: ($) => ({ ...$.empty, remoteUrl: null, copied: false }),
  update: (model, message, $) =>
    Message.match(message, {
      Closed: () =>
        $.set(model).emit(SyncSettingsPanelEvents.make({ _tag: "Closed" })),
      RemoteUrlTyped: ({ text }) => {
        const url = remoteUrlOf(text)
        return url === undefined
          ? { ...model, remoteUrl: text }
          : $.set({ ...model, remoteUrl: text }).run(
              SetRemoteUrl.make({ url }).pipe(done),
            )
      },
      CopyPressed: () =>
        $.run(
          CopyInvite.make().pipe(
            Command.map((copied) => Message.make({ _tag: "Copied", copied })),
          ),
        ),
      Copied: ({ copied }) => ({ ...model, copied }),
      CopiedExpired: () => ({ ...model, copied: false }),
      Done: () => model,
      SettingsChanged: ({ snapshot }) => ({ ...model, settings: snapshot }),
    }),
  subscriptions: (model, _props, $) => [
    $.watch({
      settings: (snapshot) =>
        Message.make({ _tag: "SettingsChanged", snapshot }),
    }),
    ...(model.copied
      ? [
          Subscription.make(
            "sync/copiedExpires",
            Stream.fromEffect(Effect.sleep("2 seconds")).pipe(
              Stream.map(() => Message.make({ _tag: "CopiedExpired" })),
            ),
          ),
        ]
      : []),
  ],
  view: (model, h) => {
    const labelClass = "flex flex-col gap-1.5 text-sm font-medium"

    return drawer(
      h,
      {
        titleId: "sync-settings-title",
        onClose: Message.make({ _tag: "Closed" }),
      },
      drawerHeader(
        h,
        { titleId: "sync-settings-title", title: "Sync settings" },
        "Keep your favourites in step across devices.",
      ),
      AsyncResult.match(h.loaded.settings, {
        onInitial: () =>
          h
            .div(skeleton(h, "h-10 w-full"), skeleton(h, "h-10 w-full"))
            .class("px-4 pb-2 flex flex-col gap-4"),
        onFailure: () => h.div(),
        onSuccess: ({ value: settings }) =>
          h
            .div(
              h
                .label(
                  "Remote URL",
                  h
                    .input()
                    .id("remote-url")
                    .attr("placeholder", "https://")
                    .class(inputClass())
                    .value(model.remoteUrl ?? settings.remoteUrl ?? "")
                    .onInput(({ value }) =>
                      Message.make({ _tag: "RemoteUrlTyped", text: value }),
                    ),
                )
                .class(labelClass),
              h
                .label(
                  "Identity",
                  // Switching identity discards local data, so it goes
                  // through the invite prompt instead
                  h
                    .input()
                    .id("identity")
                    .attr("readonly", "")
                    .class(inputClass())
                    .value(settings.identity),
                )
                .class(labelClass),
              h
                .div(
                  h
                    .p(
                      icon(h, "triangleAlert", {
                        class: "size-4 shrink-0 mt-0.5",
                      }),
                      h.span(
                        "An invite link gives full access to your synced favorites. Whoever has it can read, change and clear them, from any device, and it can't be revoked later. Only send it to people you trust.",
                      ),
                    )
                    .class("flex gap-2 text-amber-900 dark:text-amber-200"),
                  h
                    .button(
                      icon(h, model.copied ? "check" : "copy"),
                      "Copy invite link",
                    )
                    .attr("type", "button")
                    .disabled(settings.remoteUrl === null)
                    .class(buttonClass({ variant: "outline" }))
                    .onClick(Message.make({ _tag: "CopyPressed" })),
                  settings.remoteUrl === null &&
                    h
                      .p("Set a remote URL to create an invite.")
                      .class("text-muted-foreground"),
                  model.copied &&
                    h
                      .p("Copied. Send it privately.")
                      .attr("role", "status")
                      .class("text-muted-foreground"),
                )
                .class(
                  "flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-400/30 dark:bg-amber-400/10",
                ),
            )
            .class("px-4 pb-2 flex flex-col gap-4"),
      }),
      drawerFooter(
        h,
        h
          .button("Close")
          // The fields above load after the sheet opens
          .attr("autofocus", "")
          .attr("type", "button")
          .class(buttonClass({ variant: "outline" }))
          .onClick(Message.make({ _tag: "Closed" })),
      ),
    )
  },
})

export const SyncSettingsPanel = SyncSettingsPanelNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(
      GetSyncSettings.layer,
      SetRemoteUrl.layer,
      CopyInvite.layer,
    ).pipe(
      Layer.provide([SyncSettings.layer, SyncRemote.layer, Invites.layer]),
    ),
  ),
)
