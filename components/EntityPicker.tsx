/**
 * The entity picker.
 *
 * Port of `screens.py::_options()` and `screens.py::_pick()` -- a selectbox
 * over a lookup table whose option *values* are ids but whose displayed
 * text is a human label.
 *
 * The one genuinely awkward thing about this in a browser form is that
 * React and the DOM have no equivalent of Streamlit's `format_func`, which
 * let a list of ids be rendered through a label map. The fix is to put the
 * id in the `value` attribute and the label in the element text, which is
 * what a `<select>` is for. After that it needs no client-side JavaScript
 * at all: no state, no hydration beyond what the form already requires.
 */

export type Option = { value: string; label: string };

/**
 * Build an option list from a result set.
 *
 * The `_options()` equivalent: pair each id with its label, preserving the
 * order the query returned, because that order is the one the caller chose
 * (alphabetical, by employee number, and so on).
 */
export function optionsFrom<T extends Record<string, unknown>>(
  rows: T[],
  idKey: string,
  labelKey: string,
): Option[] {
  return rows.map((row) => ({ value: String(row[idKey]), label: String(row[labelKey]) }));
}

export function EntityPicker({
  name,
  label,
  options,
  required = false,
  defaultValue,
  hint,
}: {
  name: string;
  label: string;
  options: Option[];
  required?: boolean;
  defaultValue?: string;
  hint?: string;
}) {
  if (options.length === 0) {
    // `_pick()` showed a warning and returned None rather than rendering an
    // empty control, because an empty selectbox offers no way to tell an
    // empty lookup from a forgotten filter.
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        No rows available to choose from for {label.toLowerCase()}.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-slate-700" htmlFor={name}>
        {label}
        {!required ? <span className="font-normal text-slate-500"> (optional)</span> : null}
      </label>
      <select
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        defaultValue={defaultValue ?? ""}
        id={name}
        name={name}
        required={required}
      >
        {/* The "(none)" sentinel, matching Streamlit's leading "(none)"
            option. Empty string rather than a magic value, and read back
            as null by the action. */}
        {!required ? <option value="">(none)</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
