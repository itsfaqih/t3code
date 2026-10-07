import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE pull_request_grouped_reviews (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      host TEXT NOT NULL,
      repository TEXT NOT NULL,
      number INTEGER NOT NULL,
      viewer TEXT NOT NULL,
      head_sha TEXT,
      patch_digest TEXT NOT NULL,
      created_at TEXT NOT NULL,
      result_json TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX pull_request_grouped_reviews_scope
    ON pull_request_grouped_reviews (provider, host, repository, number, viewer, created_at DESC)
  `;
  yield* sql`
    CREATE TABLE pull_request_grouped_review_progress (
      review_id TEXT NOT NULL REFERENCES pull_request_grouped_reviews(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL,
      viewer TEXT NOT NULL,
      PRIMARY KEY (review_id, group_id, viewer)
    ) WITHOUT ROWID
  `;
});
