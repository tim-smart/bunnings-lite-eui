import "effect/ui/html/register"
import { assert, describe, it } from "@effect/vitest"
import { Query, Story } from "effect/ui/testing"
import { HtmlQuery } from "effect/ui/html/testing"
import { AppNoDeps, FinishJoin, ReloadPage } from "./App.ts"
import type { AppRoute } from "./routes.ts"
import { JoinFailed } from "./sync/domain/Invite.ts"

const route: AppRoute = { _tag: "Search", params: {}, query: { query: "" } }

describe("App", () => {
  it("holds the shell back until a pending join has finished", () => {
    Story.make(AppNoDeps, { route }, (s) =>
      s
        .expectExact(FinishJoin)
        .model((model) => assert.strictEqual(model.join, "Checking"))
        // Another tab still has the old journal open
        .next(FinishJoin, "Blocked")
        .check((story) =>
          assert.match(
            Query.textOf(story.get(HtmlQuery.role("heading"))),
            /Waiting to finish joining/,
          ),
        )
        .next(FinishJoin, "Finished")
        .model((model) => assert.strictEqual(model.join, "Ready"))
        .end(FinishJoin),
    )
  })

  it("offers a retry when the join can't be saved", () => {
    Story.make(AppNoDeps, { route }, (s) =>
      s
        .fail(FinishJoin, new JoinFailed())
        .model((model) => assert.strictEqual(model.join, "Failed"))
        .click(HtmlQuery.role("button", { name: "Retry" }))
        .expectExact(ReloadPage)
        .resolve(ReloadPage, undefined),
    )
  })
})
