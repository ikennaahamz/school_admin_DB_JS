/**
 * Form primitives.
 *
 * Streamlit's `st.form` groups fields and defers every rerun until submit.
 * A plain HTML `<form>` does the same thing natively, so these are
 * uncontrolled inputs with no client state -- the browser holds the values
 * and posts them once. That is why there is no `"use client"` here.
 *
 * The `_flash`/`flash` pair from `screens.py` becomes the `withFlash` query
 * parameter: every action redirects back with the message attached.
 */

const FIELD =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm " +
  "focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500";

const LABEL = "block text-sm font-medium text-slate-700";

export function Field({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
  placeholder,
  min,
  max,
  step,
  maxLength,
  autoComplete,
  hint,
}: {
  label: string;
  name: string;
  type?: "text" | "password" | "email" | "number" | "date";
  required?: boolean;
  defaultValue?: string | number;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className={LABEL} htmlFor={name}>
        {label}
      </label>
      <input
        className={FIELD}
        defaultValue={defaultValue}
        id={name}
        max={max}
        maxLength={maxLength}
        min={min}
        name={name}
        placeholder={placeholder}
        required={required}
        step={step}
        type={type}
        {...(autoComplete ? { autoComplete } : {})}
        {...(type === "number" ? { inputMode: "decimal" as const } : {})}
      />
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function TextArea({
  label,
  name,
  rows = 3,
  defaultValue,
}: {
  label: string;
  name: string;
  rows?: number;
  defaultValue?: string;
}) {
  return (
    <div className="space-y-1">
      <label className={LABEL} htmlFor={name}>
        {label}
      </label>
      <textarea
        className={`${FIELD} font-normal`}
        defaultValue={defaultValue}
        id={name}
        name={name}
        rows={rows}
      />
    </div>
  );
}

/**
 * A single-choice select over a fixed list of strings.
 *
 * Separate from `EntityPicker` because this one picks a *literal* -- a
 * term name, an attendance status, a rank title -- rather than an id drawn
 * from a lookup table. Two components rather than one with a flag, because
 * the id case needs an options array and the literal case does not.
 */
export function SelectField({
  label,
  name,
  choices,
  defaultValue,
  required = false,
  hint,
}: {
  label: string;
  name: string;
  choices: readonly string[];
  defaultValue?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className={LABEL} htmlFor={name}>
        {label}
      </label>
      <select
        className={`${FIELD} bg-white`}
        defaultValue={defaultValue ?? choices[0]}
        id={name}
        name={name}
        required={required}
      >
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
}: {
  children: React.ReactNode;
  variant?: "primary" | "danger" | "plain";
}) {
  const styles = {
    primary: "bg-sky-600 text-white hover:bg-sky-700",
    danger: "bg-red-600 text-white hover:bg-red-700",
    plain: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  } as const;

  return (
    <button className={`rounded-md px-4 py-2 text-sm font-semibold ${styles[variant]}`} type="submit">
      {children}
    </button>
  );
}

/**
 * The tab strip, replacing `st.tabs`.
 *
 * Streamlit's tabs all render and swap on rerun; here they are links with
 * query parameters, so a tab is a real URL, survives a refresh, and the
 * server decides what to render. That is a closer match to how the pages
 * actually behave than a client-side tab switch would be.
 */
export function Tabs({
  tabs,
  active,
}: {
  tabs: { key: string; label: string }[];
  active: string;
}) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <a
            aria-selected={selected}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              selected
                ? "border-sky-600 font-medium text-sky-700"
                : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"
            }`}
            href={`?tab=${tab.key}`}
            key={tab.key}
            role="tab"
          >
            {tab.label}
          </a>
        );
      })}
    </nav>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}
