import type { FieldSpec } from "../types";
import { isNumeric } from "../utils/logic";

/** one entry field: numbers by default, text and select when the form says so */
export function Field({ spec, id, value, onChange, readOnly }: {
  spec: FieldSpec; id: string; value: string; onChange?: (v: string) => void; readOnly?: boolean;
}) {
  const label = <label htmlFor={id} className={spec.required ? "req" : ""}>{spec.label}</label>;
  if (spec.type === "select") {
    return (
      <div>
        {label}
        <OptionSelect id={id} options={spec.options || {}} value={value} noneLabel="— select —"
                      onChange={(v) => onChange?.(v)} />
      </div>
    );
  }
  const numeric = isNumeric(spec);
  return (
    <div>
      {label}
      <input id={id} data-key={spec.key} type={numeric ? "number" : "text"} min={numeric ? 0 : undefined}
             step={numeric ? (spec.type === "int" ? "1" : "any") : undefined} readOnly={readOnly} value={value}
             onChange={(e) => onChange?.(e.target.value)} />
    </div>
  );
}

/** a dropdown of {value: label}, with an optional empty first choice */
export function OptionSelect({ id, options, value, onChange, noneLabel }: {
  id: string; options: Record<string, string>; value: string; onChange: (v: string) => void; noneLabel?: string;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {noneLabel !== undefined && <option value="">{noneLabel}</option>}
      {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}

export function Msg({ msg }: { msg: { text: string; ok: boolean } | null }) {
  if (!msg) return null;
  return <div className={"msg " + (msg.ok ? "ok" : "err")} role={msg.ok ? "status" : "alert"}>{msg.text}</div>;
}
