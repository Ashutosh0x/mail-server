# Search grammar

One parser, in `packages/types/src/search.ts`, shared by the filter chips and
the query layer. That sharing is the point: two parsers would eventually
disagree, and the visible symptom is a chip that says one thing while the
results show another.

46 of the 57 tests in `@mailserver/types` cover this file.

## Operators

| Field | Takes | Example |
|---|---|---|
| `from` `to` `cc` `bcc` | free text | `from:ada` |
| `subject` `body` | free text | `subject:invoice` |
| `filename` | free text | `filename:pdf` |
| `label` `in` | free text | `in:archive` |
| `is` | `unread` `read` `starred` `flagged` `important` `draft` `snoozed` `muted` | `is:unread` |
| `has` | `attachment` `link` `image` `calendar` | `has:attachment` |
| `after` `before` | absolute date | `after:2026-01-01` |
| `newer` `older` | duration | `newer:7d` |
| `larger` `smaller` `size` | byte size | `larger:5mb` |

Plus:

- **Negation** — `-from:ada` excludes rather than requires.
- **Disjunction** — `OR` between terms.
- **Quoting** — `subject:"quarterly report"` keeps the phrase together.
- **Free text** — anything not matching `field:value` is a full-text term.

## Behaviour that is deliberate

**It never throws.** A search box is parsed on every keystroke, which means it
is parsed in a half-typed state far more often than a complete one. `from:` with
no value, an unclosed quote, a trailing `-` — all parse to *something* usable.
A parser that throws here produces a search box that breaks while you type in it.

**Unknown operators are reported, not silently searched.** `frm:ada` is not
quietly treated as free text; it is surfaced in `unknownFields` so the UI can
say the operator was not recognised. Silently searching a typo as free text
returns plausible-looking wrong results, which is worse than an error.

The chip row renders when there is either a parsed term **or** an unknown field.
An earlier version gated on term count alone, so a query consisting only of a
typo produced no feedback at all.

**Round-tripping is exact.** `renderQuery(parseQuery(s))` reproduces the query,
so removing a chip and re-rendering does not mangle the rest of the string.
`removeTermAt` works on offsets from the parse, not on string search.

## API

| Function | Purpose |
|---|---|
| `parseQuery(input)` | Full parse: terms, free text, unknown fields, offsets |
| `renderQuery(parsed)` | Back to a string, exactly |
| `termsOf(parsed)` | Just the `field:value` constraints |
| `freeTextOf(parsed)` | Just the full-text portion |
| `removeTermAt(input, offset)` | Drop one chip by its source offset |
| `durationToMs(value)` | `7d` → milliseconds |
| `sizeToBytes(value)` | `5mb` → bytes |

## Translation to SQL

`lib/server/mail.ts` turns a parsed query into a `WHERE` clause with **bound
parameters**. No user string is interpolated into SQL — `buildWhere` produces
placeholders and a parallel parameter array.

Every generated clause is additionally scoped by `userId`. Search cannot widen
access: the scoping is applied to the query, not to the result set afterwards.

Full-text uses FTS5 on SQLite and `tsvector` + GIN on Postgres. That difference
is confined to this translation layer; the grammar and the UI know nothing about
it.

## Not built

Search covers mail only. Drive and federated storage items are not searchable
yet — `storage_items` carries an `indexed_at` column and the mount carries an
`indexing` mode (`disabled` · `metadata` · `metadata_and_text` · `full_content`),
but nothing populates an index. Extending search across surfaces is stage 4 of
the [roadmap](roadmap.md).
