/** Adds a compile-time-only label so two kinds of string (or number) can't be mixed up. */
export type Brand<T, B extends string> = T & { readonly __brand: B }

export type Uuid = Brand<string, 'Uuid'>
export type DeviceId = Brand<string, 'DeviceId'>
/** Display label like 'R001'. Never used as identity. */
export type RoleId = Brand<string, 'RoleId'>
export type FieldId = Uuid
export type ChoiceId = Brand<string, 'ChoiceId'>

/** A moment: UTC milliseconds since 1970-01-01. */
export type Moment = Brand<number, 'Moment'>
/** A calendar day, 'YYYY-MM-DD'. Same day everywhere; never converted through a time zone. */
export type CalendarDay = Brand<string, 'CalendarDay'>
/** A deadline with a time: the moment plus the posting's IANA time zone, e.g. 'America/Los_Angeles'. */
export interface ZonedMoment {
  at: Moment
  timeZone: string
}

/** Anything JSON can represent. Used for logged old values. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
