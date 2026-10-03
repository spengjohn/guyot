# TypeScript notes

The TypeScript concepts used in this codebase, each with an example from it. Read alongside the code; the [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/intro.html) has the full story.

TypeScript checks types when you build, then is removed: the browser runs plain JavaScript. Our config (`erasableSyntaxOnly`) only allows TypeScript features that can simply be erased, which is why there are no `enum`s.

## Describing data

**`interface` and `type`.** Both name the shape of some data. `interface` is for object shapes; `type` can also name unions and combinations.

```ts
interface ZonedMoment {
  at: Moment
  timeZone: string
}
type FieldMeta = Record<string, FieldStamp>
```

**Optional properties and `null`.** `maxLength?: number` may be missing. `CalendarDay | null` must be present but may be empty. Strict mode makes you check before use.

**`Record<K, V>`.** An object with keys of type K and values of type V.

**`extends` on interfaces** copies in another interface's properties: `interface PostingData extends HasCustom { ... }`.

**`A & B` (intersection).** Has everything from both: `SyncFields & D` is a record's sync fields plus its table data.

## Unions

**String-literal unions** replace enums. Only these exact strings are allowed:

```ts
type PayPeriod = 'hour' | 'day' | 'week' | 'month' | 'year'
```

**Discriminated unions.** A shared tag property says which variant you have. After checking the tag, TypeScript knows which fields exist:

```ts
type Deadline = { kind: 'day'; day: CalendarDay } | { kind: 'time'; at: ZonedMoment }
if (deadline.kind === 'time') deadline.at // allowed here

type StoredRecord<D> = LiveRecord<D> | Tombstone // tag: purged
if (!record.purged) record.company // a tombstone has no data, so this check is required
```

## Branded types

At runtime a `CalendarDay` is a string, but TypeScript treats it as a different type from a `Uuid`, so mixing them up is a build error:

```ts
type Brand<T, B extends string> = T & { readonly __brand: B }
type CalendarDay = Brand<string, 'CalendarDay'>
```

You get one only from code that checked the value, such as `isCalendarDay`.

## Generics

A type that takes other types as parameters, like a function takes arguments. `T extends TableName` limits T to table names:

```ts
type RecordOf<T extends TableName> = StoredRecord<Tables[T]>
async update<T extends DataTable>(table: T, id: Uuid, changes: Partial<Tables[T]>)
```

Calling `repo.update('applications', id, { company: 42 })` fails the build: `company` must be a string for that table.

## Working with types

- **`keyof X`**: the union of X's keys. `keyof Tables` is every table name.
- **`X[K]` (indexed access)**: the type of a property. `FieldValueByType[FieldType]` is every possible field value type.
- **Mapped types**: build an object type from a union. `{ [T in TableName]: RecordOf<T>[] }` has one property per table, each holding that table's records.
- **`Partial<X>`**: every property optional. Used for updates and profile overrides.
- **`Exclude<A, B>`**: A without B. `DataTable` is every table except the two logs.
- **`Omit<X, K>`**: X without property K. `BackupInfo` is a `Backup` without its large `json`.
- **`Readonly<X>` and `readonly`**: can't be modified or reassigned.
- **`Record<Union, true>` as a checklist**: TypeScript requires every member of the union as a key, so adding a table or field type without updating the checklist fails the build (`TABLE_SET` in constants.ts).

## Narrowing and trust

- **`unknown`**: "could be anything", and TypeScript won't let you use it until you check. Validation takes `unknown` input.
- **Type predicates**: a check function that tells TypeScript the type when it returns true: `function isObj(v: unknown): v is Obj`.
- **Type assertions (`as`)**: "trust me, this is X". Used sparingly, only where code has already checked: a hand-written constant (`'...' as Uuid`) or a record that validation just passed. `as unknown as X` is a double assertion for when the types don't overlap at all; each use has a comment saying why it's safe.
- **Non-null assertion (`!`)**: "this isn't undefined". Only in test helpers, where a missing value should fail the test.
- **`// @ts-expect-error`**: one test deliberately makes a forbidden call to check the runtime guard. If the line ever stops being an error, the build fails, so it can't go stale.

## Classes, modules and async

- **`class`** groups data with the functions that use it. `Repo.open()` creates one; `repo.update(...)` calls a method. `private` members are usable only inside the class.
- **`import type`**: imports used only as types are removed from the built JavaScript. Our config requires saying so.
- **`async` and `Promise<T>`**: an `async` function returns a promise of a value that arrives later; `await` waits for it. `Promise<Live<T>>` is "later, a live record of table T".
