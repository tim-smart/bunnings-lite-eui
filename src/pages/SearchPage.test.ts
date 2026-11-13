import "effect/ui/html/register"
import { assert, describe, it } from "@effect/vitest"
import { HtmlQuery } from "effect/ui/html/testing"
import { Story } from "effect/ui/testing"
import {
  Facet,
  FacetValue,
  ImageElement,
  ProductBaseInfo,
} from "../../server/src/domain/Bunnings.ts"
import type { SearchRoute } from "../routes.ts"
import type { ResultsPage } from "../search/domain/Search.ts"
import { SearchPageMessage, SearchPageNoDeps } from "./SearchPage.ts"

const route = (query: string): SearchRoute => ({
  _tag: "Search",
  params: {},
  query: { query },
})

const page = (query: string): ResultsPage => ({
  query,
  totalCount: 1,
  facets: [
    new Facet({
      facetId: "@price",
      values: [new FacetValue({ start: 0, end: 500, endInclusive: true })],
    }),
  ],
  results: [
    new ProductBaseInfo({
      id: `${query}-1`,
      title: `A ${query}`,
      url: `https://example.com/${query}-1`,
      images: [
        new ImageElement({
          url: "https://example.com/i.jpg",
          thumbnailUrl: "https://example.com/t.jpg",
          mime: "image/jpeg",
          sequence: "0",
        }),
      ],
      price: 20,
      numberOfReviews: 1,
      rating: 4,
    }),
  ],
})

const loading = HtmlQuery.role("status", { name: "Loading results" })

describe("SearchPage", () => {
  it("keeps the last results up while the search text changes", () => {
    Story.make(SearchPageNoDeps, { route: route("hammer") }, (s) =>
      s
        .loaded("results", [page("hammer")])
        .props({ route: route("drill") })
        .check((story) => assert.isUndefined(story.query(loading))),
    )
  })

  it("starts with the skeleton when searching again after clearing to home", () => {
    Story.make(SearchPageNoDeps, { route: route("hammer") }, (s) =>
      s
        .loaded("results", [page("hammer")])
        .props({ route: route("") })
        .subscriptions((keys) => assert.include(keys, "search/wentHome"))
        // What the subscription sends once home is showing
        .send(SearchPageMessage.make({ _tag: "WentHome" }))
        .props({ route: route("drill") })
        .model((model) => assert.isNull(model.facets))
        .check((story) => assert.isDefined(story.query(loading)))
        .loaded("results", [page("drill")])
        .model((model) => assert.isFalse(model.stale))
        .check((story) => assert.isUndefined(story.query(loading))),
    )
  })
})
