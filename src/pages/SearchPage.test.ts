import "effect/ui/html/register"
import { assert, describe, it } from "@effect/vitest"
import { HtmlQuery } from "effect/ui/html/testing"
import type { Component, View } from "effect/ui"
import { Story } from "effect/ui/testing"
import {
  Facet,
  FacetValue,
  ImageElement,
  ProductBaseInfo,
} from "../../server/src/domain/Bunnings.ts"
import type { SearchRoute } from "../routes.ts"
import { Filters } from "../search/components/Filters.ts"
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

const hasFilters = (view: View.Node<any, any>) =>
  Story.children(view, Filters).length === 1

const filtersProps = (view: View.Node<any, any>) =>
  Story.children(view, Filters)[0]?.props as Component.Props<typeof Filters>

const wentHome = SearchPageMessage.make({ _tag: "WentHome" })
const resultsShown = SearchPageMessage.make({ _tag: "ResultsShown" })

describe("SearchPage", () => {
  it("keeps the last results up while the search text changes", () => {
    Story.make(SearchPageNoDeps, { route: route("hammer") }, (s) =>
      s
        .loaded("results", [page("hammer")])
        .props({ route: route("drill") })
        .check((story) => assert.isUndefined(story.query(loading)))
        .view((view) => assert.isTrue(hasFilters(view))),
    )
  })

  it("starts with the skeleton when searching again after clearing to home", () => {
    Story.make(SearchPageNoDeps, { route: route("hammer") }, (s) =>
      s
        .loaded("results", [page("hammer")])
        .props({ route: route("") })
        .subscriptions((keys) => assert.include(keys, "search/wentHome"))
        // What the subscription sends once home is showing
        .send(wentHome)
        .props({ route: route("drill") })
        .check((story) => assert.isDefined(story.query(loading)))
        .view((view) => assert.isFalse(hasFilters(view)))
        .subscriptions((keys) => assert.notInclude(keys, "search/resultsShown"))
        .loaded("results", [page("drill")])
        .check((story) => assert.isUndefined(story.query(loading)))
        .view((view) => assert.isTrue(hasFilters(view)))
        .subscriptions((keys) => assert.include(keys, "search/resultsShown"))
        .send(resultsShown)
        .model((model) => assert.isFalse(model.stale)),
    )
  })

  it("shows a cached search again with its filters, but no price, after clearing to home", () => {
    const priced: SearchRoute = {
      ...route("hammer"),
      query: { query: "hammer", priceMin: 10, priceMax: 50 },
    }
    Story.make(SearchPageNoDeps, { route: route("hammer") }, (s) =>
      s
        .loaded("results", [page("hammer")])
        // A price is picked, and the search box cleared, which drops it
        .props({ route: priced })
        .props({ route: route("") })
        .send(wentHome)
        // The slot still holds the unfiltered results, so nothing is loaded
        // and `onChange` sends nothing
        .props({ route: route("hammer") })
        .check((story) => assert.isUndefined(story.query(loading)))
        .view((view) => {
          // The controls are back, for the search's whole price range...
          assert.deepStrictEqual(filtersProps(view).price, {
            start: 0,
            end: 500,
          })
          // ...with no price picked
          assert.isUndefined(filtersProps(view).route.query.priceMin)
          assert.isUndefined(filtersProps(view).route.query.priceMax)
        })
        .subscriptions((keys) => assert.include(keys, "search/resultsShown"))
        .send(resultsShown)
        .model((model) => assert.isFalse(model.stale))
        // They are the results on screen, so they stay up for the next text
        .props({ route: route("hammers") })
        .check((story) => assert.isUndefined(story.query(loading))),
    )
  })
})
