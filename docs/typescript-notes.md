# TypeScript notes

The TypeScript concepts used in this codebase, each with an example from it, followed by [React notes](#react-notes). Read alongside the code; the [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/intro.html) has the full story.

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
- **`Pick<X, K>`**: X with only properties K. `effectiveTargets` takes `Pick<SearchProfileData, 'overrides' | 'customOverrides'>`, so it can't depend on anything else in a profile.

## Conditional types

**`A extends B ? X : Y`** is an if/else for types: if A fits B, the result is X, otherwise Y. Inside a mapped type it runs once per key, so each property can get a different type:

```ts
type SharedTargetOverrides = {
  [K in keyof SharedTargetsFields]?: SharedTargetsFields[K] extends string[]
    ? ListOverride // roleTypes, mustHaveKeywords, ...
    : SharedTargetsFields[K] // excludeRule, eligibilityNotes: string
}
```

**Picking keys by their type.** Map each key to itself or to `never` (the empty type), then index the result with `[keyof X]` to collect the values. `never` disappears from a union, leaving only the keys you kept:

```ts
type ListKey = {
  [K in keyof SharedTargetsFields]: SharedTargetsFields[K] extends string[] ? K : never
}[keyof SharedTargetsFields] // 'roleTypes' | 'industries' | ...
```

**A filter that narrows.** `array.filter` with a type predicate returns the narrower type, so `LIST_KEYS` in targets.ts is a `ListKey[]` and `profile.overrides[key]` is known to be a `ListOverride`:

```ts
const LIST_KEYS = KEYS.filter((key): key is ListKey => KINDS[key] === 'list')
```

## Constants as types

- **`as const`** keeps a value's exact literal types and makes it read-only. Without it, `{ applied: { label: 'Applied' } }` would be typed as `{ applied: { label: string } }`.
- **`satisfies X`** checks a value against a type without widening it to that type. `STATUS_CHOICES` (builtinFields.ts) is checked to be a valid choice list, but keeps its exact keys:

  ```ts
  export const STATUS_CHOICES = {
    applied: { label: 'Applied', order: 1, hidden: false },
    // ...
  } as const satisfies Record<string, ChoiceOption>
  ```

- **`typeof value`** in a type position gives the type of a value. `keyof typeof STATUS_CHOICES` is `'applied' | 'screening' | ...`.
- **`(typeof ARRAY)[number]`** is the type of any element: from `EDITABLE_KEYS = ['company', 'role', ...] as const`, the union `'company' | 'role' | ...` (applicationForm.ts).

**Exhaustive `switch` with `never`.** `never` is the type with no values. If every case of a union is handled, what's left in `default` is `never`; if a case is added to the union and forgotten here, assigning it to `never` fails the build (`pageFor` in Shell.tsx):

```ts
default: {
  const unhandled: never = route
  return unhandled
}
```

**Generic helpers that pair a key with its value type.** `draft[key] = record[key]` fails when `key` is a union, because TypeScript can't tell both sides use the same key. A small generic function fixes the key to one type parameter `K` (`setKey` in applicationForm.ts):

```ts
function setKey<K extends EditableKey>(draft: ApplicationDraft, key: K, value: ApplicationData[K]) {
  draft[key] = value
}
```

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
- **Triple-slash reference (`/// <reference types="node" />`)**: adds a set of type definitions to one file only. App code is typed for the browser, which has no file system; `tokens.test.ts` runs in Node and reads the CSS file, so it opts in to Node's types (`node:fs`) on its first line instead of giving them to the whole app.

# React notes

React builds the page from **components**: functions that take **props** (inputs) and return what to show. When a component's state changes, React calls it again and updates only the parts of the page that differ.

## Components and JSX

- **`.tsx` and JSX.** `.tsx` files may contain HTML-like syntax (JSX), which compiles to function calls. Differences from HTML: `className` instead of `class`, `htmlFor` instead of `for`, and `{...}` for any JavaScript expression.
- **Typed props.** A component's props are one object, typed like any other:

  ```tsx
  export function Page({ title, children }: { title: string; children: ReactNode }) { ... }
  ```

  `ReactNode` is "anything React can show": text, elements, lists, or nothing. `children` is whatever is written between the opening and closing tags.

- **Lists need `key`.** When rendering an array, each item gets a stable `key` (a record `id`), so React can tell which item moved or changed instead of rebuilding them all. Rows use `key={app.id}`; columns use the field key.
- **Changing `key` resets a component.** A new key makes React discard the old component and start a fresh one, with fresh state. The Edit form uses this on purpose (`controlKey` in applicationForm.ts): when a save elsewhere replaces the value an untouched field shows, its input gets a new key and starts over from the new value.
- **Live regions inside a modal dialog.** While a dialog is open with `showModal()`, everything outside it is inert, including the app's live region, so screen readers ignore it. Each dialog renders its own `role="status"` regions (`ChangesNotice` in `src/forms/FormParts.tsx`).
- **Conditional rendering.** `{notice && <div>...</div>}` shows the element only when `notice` is set.

## State and effects

- **`useState`** keeps a value between calls and re-renders when it's set: `const [open, setOpen] = useState(false)`. Passing a function, `useState(() => draftOf(editing))`, runs it only on the first render. Passing a function to the setter, `setDraft((current) => ...)`, updates from the latest value.
- **Controlled inputs.** The input's `value` comes from state, and `onChange` updates the state, so the state is always what's on screen. Event handlers get typed events: `ChangeEvent<HTMLInputElement>` has `e.target.value`.
- **`useEffect`** runs code after React updates the page: talking to the browser (`document.title`, focus, `showModal()`) or starting a load. The array at the end lists what it depends on; it runs again when one changes. The function it returns is the **cleanup**, run before the next run or when the component goes away (`App.tsx` closes the database there).
- **Strict mode** (main.tsx) runs effects twice in development, to catch effects without proper cleanup. That's why `App.tsx` handles being cancelled and why `ApplicationDialog` only calls `showModal()` if the dialog isn't open yet.
- **`useRef`** holds a value that survives re-renders without causing one. Two uses here: a handle on a page element (`<dialog ref={dialogRef}>`, then `dialogRef.current.showModal()`), and remembering something for the next effect (`pendingFocus` in TrackerPage).
- **`useId`** makes an ID unique to one component instance, so `<label htmlFor={id}>` and `<input id={id}>` match even when the same component appears many times.
- **`useMemo` and `useCallback`** keep a computed value or a function the same between renders unless its inputs change, so effects that depend on it don't re-run needlessly (`RepoProvider`).

## Sharing data down the tree

- **Context** passes a value to every component below without threading props through each level. `createContext` makes one; in React 19 the context itself is the provider, `<RepoContext value={...}>`; `useContext(RepoContext)` reads it. We use it for the open `Repo` and for `announce()`.
- **Custom hooks** are functions starting with `use` that call other hooks, so components share logic. `useRepoQuery(load)` loads data and reloads after every write; `useRepoWrite()` runs a write and triggers that reload; `useHashRoute()` gives the current page.
- **`useSyncExternalStore`** connects state that lives outside React (here, the URL hash) to a component: given a way to subscribe to changes (`hashchange`) and a way to read the current value, it re-renders when the value changes (`useHashRoute.ts`).
- **Rules of hooks.** Hooks are called at the top of a component, in the same order every render: never inside `if`, loops or after an early `return`. That's why `TrackerPage` calls all its hooks before returning the loading message. ESLint checks this.
- **Fast refresh.** In development, Vite swaps edited components in place. It only works if a `.tsx` file exports nothing but components, so contexts and hooks live in `.ts` files (`repoContext.ts`, `announce.ts`) next to their provider components.
- **A generic custom hook.** `useEditForm<R extends SavedRecord>(options)` takes a type parameter like any generic function, so one hook serves applications, profiles and shared targets, each with its own record type: `useEditForm<SavedProfile>({ ... })`.
- **One name per form, wherever the parts live.** `useEditForm` returns everything a form needs; the parts (`ChangesNotice`, `ConflictList`, `ErrorSummary` in `FormParts.tsx`) take that whole object as a `form` prop. Its type is written once with `ReturnType<typeof useEditForm>` (the type of whatever the function returns), so it never drifts from the hook.

## Browser features

- **`Blob` and object URLs** (`src/ui/download.ts`): a `Blob` is file-like data held in memory. `URL.createObjectURL(blob)` gives it a temporary `blob:` address; a link with that `href` and a `download` attribute, clicked from code, saves it as a file. Nothing is uploaded. `URL.revokeObjectURL` frees the memory afterwards.
- **Reading a chosen file**: `<input type="file">` gives `event.target.files`, a list of `File` objects. `await file.text()` reads one as text in the browser (`DataPage.tsx`).
- **`<details>` and `<summary>`**: a disclosure built into HTML (Recently deleted profiles). It opens and closes with the keyboard and tells screen readers whether it's expanded, with no script.
- **`Extract<Union, Shape>`** (TypeScript): the members of a union that fit a shape. `Extract<ImportCheck, { ok: true }>` is just the successful import check, with its `file` and `preview`.
- **Web Crypto** (`crypto.subtle`, in `src/data/crypto.ts`): the browser's own encryption. Its functions are `async` and work on bytes, not strings: `TextEncoder` turns text into a `Uint8Array` (a list of bytes) and `TextDecoder` turns it back. Files are text, so the bytes are stored as base64 (`btoa` / `atob`). TypeScript writes the byte type as `Uint8Array<ArrayBuffer>`.
- **Password fields**: `type="password"` hides what's typed; `autoComplete="new-password"` lets a password manager suggest and save a new one, and `"current-password"` lets it fill in an existing one.
- **A `<details>` the parent controls** (`src/forms/CollapsibleField.tsx`): React sets `open` from state, and `onToggle` reports when the user opens or closes it, so "Expand all" can open every row by changing state.
- **Keyboard and clipboard events** (`src/fields/ListEditor.tsx`): `onKeyDown` with `event.key === 'Enter'` and `event.preventDefault()` makes Enter add an item instead of submitting the form; `onPaste` reads `event.clipboardData.getData('text')` to split a pasted list into items.
