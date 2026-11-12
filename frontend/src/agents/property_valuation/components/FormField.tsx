import type { FieldDef } from "../config/forms";

/** one field of the outgoing / vendor forms; a checkbox is a clickable label, the others a labelled control */
export function FormField({ def, id, value, onChange, wrapCheck }: {
  def: FieldDef; id: string; value: string | boolean; onChange: (v: string | boolean) => void; wrapCheck?: boolean;
}) {
  if (def.kind === "check") {
    const box = (
      <label className="check">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {def.label}
      </label>
    );
    return wrapCheck ? <div className="field">{box}</div> : box;
  }
  const v = typeof value === "string" ? value : "";
  let control;
  if (def.kind === "select") {
    control = (
      <select id={id} value={v} onChange={(e) => onChange(e.target.value)}>
        {!def.noBlank && <option value="">Select</option>}
        {(def.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (def.kind === "textarea") {
    control = <textarea id={id} rows={3} value={v} onChange={(e) => onChange(e.target.value)} />;
  } else {
    const type = def.kind === "number" || def.kind === "date" ? def.kind : undefined;
    control = (
      <input id={id} type={type} min={def.min} step={def.step} maxLength={def.kind === "tel" ? 10 : undefined} value={v}
             onChange={(e) => onChange(e.target.value)} />
    );
  }
  return (
    <div className="field" style={def.wide ? { gridColumn: "1/-1" } : undefined}>
      <label htmlFor={id}>{def.label}</label>
      {control}
    </div>
  );
}
