import { Effect, Layer, Option, Schema, Stream } from "effect"
import { AsyncResult, Loader } from "effect/reactivity"
import { Command, Component, Subscription } from "effect/ui"
import { Html } from "effect/ui/html"
import { buttonClass } from "../../design/classes.ts"
import {
  drawer,
  drawerFooter,
  drawerHeader,
  FocusWrap,
  wrapFocus,
} from "../../design/drawer.ts"
import { PendingInvite } from "../domain/Invite.ts"
import { GetSyncSettings } from "../loaders/GetSyncSettings.ts"
import { Invites } from "../services/Invites.ts"
import { SyncSettings } from "../services/SyncSettings.ts"

const SettingsSnapshot = Loader.Snapshot(GetSyncSettings, "settings")

export const InviteDialogMessage = Schema.TaggedUnion({
  InviteOpened: { invite: PendingInvite },
  Dismissed: {},
  Joined: {},
  FocusWrapped: { wrap: FocusWrap },
  Done: {},
  SettingsChanged: { snapshot: SettingsSnapshot },
})
const Message = InviteDialogMessage

/** Whether the dialog is showing, for its owner to make the page inert. */
export const InviteDialogEvents = Schema.TaggedUnion({
  Opened: {},
  Closed: {},
})

/**
 * Joins through the invite that was opened. The page reloads to finish it,
 * so this only resolves if there was nothing to join.
 */
export class JoinSync extends Command.Service<JoinSync>()(
  "sync/JoinSync",
  { args: {}, invalidates: () => [] },
  Effect.gen(function* () {
    const invites = yield* Invites
    return () => invites.join
  }),
) {}

const invitesOpened = Subscription.make(
  "sync/invitesOpened",
  Stream.unwrap(
    Effect.map(Invites, (invites) =>
      invites.opened.pipe(
        Stream.map((invite) => Message.make({ _tag: "InviteOpened", invite })),
      ),
    ),
  ),
)

const dismissRef = Html.ref("invite-dismiss", "button")
const joinRef = Html.ref("invite-join", "button")
const focusWrapped = (wrap: FocusWrap) =>
  Message.make({ _tag: "FocusWrapped", wrap })

/**
 * Asks before joining through an invite link the page was opened with, and
 * says so when the link can't be read. It is a drawer, so it is mounted
 * outside the page it covers.
 */
export const InviteDialogNoDeps = Component.make({
  name: "InviteDialog",
  model: Schema.Struct({
    settings: SettingsSnapshot,
    /** The invite waiting for an answer. */
    invite: Schema.NullOr(PendingInvite),
  }),
  message: Message,
  events: InviteDialogEvents,
  loaders: {
    settings: () => ({}),
  },
  init: ($) => ({ ...$.empty, invite: null }),
  update: (model, message, $) =>
    Message.match(message, {
      InviteOpened: ({ invite }) =>
        $.set({ ...model, invite })
          .run(Html.focus(dismissRef, () => Message.make({ _tag: "Done" })))
          .emit(InviteDialogEvents.make({ _tag: "Opened" })),
      Dismissed: () =>
        $.set({ ...model, invite: null }).emit(
          InviteDialogEvents.make({ _tag: "Closed" }),
        ),
      Joined: () =>
        $.set({ ...model, invite: null })
          .run(
            JoinSync.make().pipe(
              Command.map(() => Message.make({ _tag: "Done" })),
            ),
          )
          .emit(InviteDialogEvents.make({ _tag: "Closed" })),
      FocusWrapped: ({ wrap }) =>
        $.run(
          wrapFocus(
            wrap,
            // A link that isn't valid has no Join button
            { first: dismissRef, last: joinRef },
            { done: Message.make({ _tag: "Done" }), onWrap: focusWrapped },
          ),
        ),
      Done: () => model,
      SettingsChanged: ({ snapshot }) => ({ ...model, settings: snapshot }),
    }),
  subscriptions: (_model, _props, $) => [
    $.watch({
      settings: (snapshot) =>
        Message.make({ _tag: "SettingsChanged", snapshot }),
    }),
    invitesOpened,
  ],
  view: (model, h) => {
    const { invite } = model
    if (invite === null) return h.div()
    const dismissed = Message.make({ _tag: "Dismissed" })

    if (invite._tag === "Invalid") {
      return drawer(
        h,
        { titleId: "invite-title", onClose: dismissed, onWrap: focusWrapped },
        drawerHeader(
          h,
          { titleId: "invite-title", title: "Invite link not valid" },
          "This link is incomplete or damaged, so your sync settings were left unchanged. Ask for a new invite.",
        ),
        drawerFooter(
          h,
          h
            .button("Close")
            .ref(dismissRef)
            .attr("type", "button")
            .class(buttonClass({ variant: "outline" }))
            .onClick(dismissed),
        ),
      )
    }

    const currentRemote = Option.flatMapNullishOr(
      AsyncResult.value(h.loaded.settings),
      (settings) => settings.remoteHost,
    )
    return drawer(
      h,
      { titleId: "invite-title", onClose: dismissed, onWrap: focusWrapped },
      drawerHeader(
        h,
        { titleId: "invite-title", title: "Join shared sync?" },
        "This invite connects this device to ",
        h.span(invite.host).class("font-medium text-foreground"),
        " using the identity of whoever created it.",
      ),
      h
        .div(
          h
            .ul(
              h.li(
                "Everyone with this invite shares one set of favorites, with full access to read, change and clear them.",
              ),
              h.li(
                "Joining discards this device's favorites and shows the shared ones instead. Favorites already synced stay on the server under this device's old identity, but you won't see them again unless you copy an invite link for it first.",
              ),
              h.li("Access can't be revoked later."),
              h.li(
                "This replaces this device's identity",
                Option.match(currentRemote, {
                  onNone: () => "",
                  onSome: (host) => ` and its current remote (${host})`,
                }),
                ".",
              ),
            )
            .class("list-disc pl-5 flex flex-col gap-1"),
          h
            .p(
              "Bunnings Lite can't check who made an invite. Only join if you know the sender and were expecting it.",
            )
            .class("text-muted-foreground"),
        )
        .class("px-4 text-sm flex flex-col gap-3"),
      drawerFooter(
        h,
        h
          .button("Cancel")
          .ref(dismissRef)
          .attr("type", "button")
          .class(buttonClass({ variant: "outline" }))
          .onClick(dismissed),
        h
          .button("Join")
          .ref(joinRef)
          .attr("type", "button")
          .class(buttonClass())
          .onClick(Message.make({ _tag: "Joined" })),
      ),
    )
  },
})

export const InviteDialog = InviteDialogNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(GetSyncSettings.layer, JoinSync.layer).pipe(
      Layer.provide([SyncSettings.layer, Invites.layer]),
    ),
  ),
)
