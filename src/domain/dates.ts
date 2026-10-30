// Local calendar days (audit task 17). A day the family means (today, a pause until, a trial until, a
// date picked in a form) is the Chromebook's local day, never the UTC day `toISOString()` gives.

export const localDate = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The local day of a stored ISO timestamp. */
export const localDay = (iso: string) => localDate(new Date(iso));
