import type { HoverInfo } from './HoverCard';

// A plain panel for map items without their own inspector (GPS cells,
// tension countries, drawings): what the hover card says, plus a note.
export default function InfoInspector({
  info,
  note,
  onBack,
}: {
  info: HoverInfo | null;
  note: string;
  onBack: () => void;
}) {
  return (
    <div className="inspector-body">
      <div className="isec tight">
        <button className="backlink" onClick={onBack}>
          ← Situation
        </button>
      </div>
      {info ? (
        <section className="isec">
          <h1 className="etitle">
            {info.color && <span className="acdot" style={{ background: info.color }} />}
            {info.title}
          </h1>
          {info.lines.filter(Boolean).map((l, i) => (
            <div key={i} className="sub">
              {l}
            </div>
          ))}
          <p className="quiet small" style={{ marginTop: 10 }}>
            {note}
          </p>
        </section>
      ) : (
        <p className="quiet pad">This item is no longer on the map.</p>
      )}
    </div>
  );
}
