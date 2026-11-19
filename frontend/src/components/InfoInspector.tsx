import type { HoverInfo } from './HoverCard';

// A plain panel for map items without their own inspector (GPS cells,
// tension countries, drawings): what the hover card says, plus a note.
export default function InfoInspector({
  info,
  note,
  links = [],
  onBack,
}: {
  info: HoverInfo | null;
  note: string;
  links?: { label: string; url: string }[];
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
          {links.length > 0 && (
            <div className="actions" style={{ marginTop: 10 }}>
              {links.map((l) => (
                <a key={l.url} className="btn small" href={l.url} target="_blank" rel="noreferrer noopener">
                  {l.label} ↗
                </a>
              ))}
            </div>
          )}
        </section>
      ) : (
        <p className="quiet pad">This item is no longer on the map.</p>
      )}
    </div>
  );
}
