import "effect/ui/html/register"
import { assert, describe, it } from "@effect/vitest"
import { HtmlQuery } from "effect/ui/html/testing"
import type { View } from "effect/ui"
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
import { SearchPageNoDeps } from "./SearchPage.ts"

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
})
