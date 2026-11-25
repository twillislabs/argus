import { BASE_COLOR, BASE_KINDS, type Base, FUEL_COLOR, type Plant } from '../map/infraLayer';

export function PlantInspector({ plant, onBack, onFly }: { plant: Plant; onBack: () => void; onFly: () => void }) {
  const [name, country, fuel, mw, lon, lat] = plant;
  return (
    <div className="inspector-body">
      <div className="isec tight">
        <button className="backlink" onClick={onBack}>
          ← Situation
        </button>
      </div>
      <section className="isec">
        <div className="badges">
          <span className="badge" style={{ ['--c' as string]: FUEL_COLOR[fuel] ?? FUEL_COLOR.Other }}>
            {fuel}
          </span>
          <span className="badge mono">{country}</span>
        </div>
        <h1 className="etitle">{name}</h1>
        <div className="sub">Power plant</div>
        <div className="actions">
          <button className="btn" onClick={onFly}>
            Fly to
          </button>
        </div>
      </section>
      <section className="isec">
        <dl className="kv">
          <div>
            <dt>Capacity</dt>
            <dd>{mw.toLocaleString()} MW</dd>
          </div>
          <div>
            <dt>Fuel</dt>
            <dd>{fuel}</dd>
          </div>
          <div className="wide">
            <dt>Position</dt>
            <dd>
              {lat.toFixed(4)}, {lon.toFixed(4)}
            </dd>
          </div>
        </dl>
        <p className="quiet small">
          WRI Global Power Plant Database (CC BY 4.0), last updated 2021: newer plants are missing and some have closed.{' '}
          {country} is the ISO country code.
        </p>
      </section>
    </div>
  );
}

export function CableInspector({ cable, onBack }: { cable: { id: string; name: string }; onBack: () => void }) {
  return (
    <div className="inspector-body">
      <div className="isec tight">
        <button className="backlink" onClick={onBack}>
          ← Situation
        </button>
      </div>
      <section className="isec">
        <div className="badges">
          <span className="badge" style={{ ['--c' as string]: '#7fd1c7' }}>
            Submarine cable
          </span>
        </div>
        <h1 className="etitle">{cable.name}</h1>
        <div className="actions">
          <a
            className="btn"
            href={'https://www.submarinecablemap.com/submarine-cable/' + encodeURIComponent(cable.id)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Owners, length and landings ↗
          </a>
        </div>
      </section>
      <section className="isec">
        <p className="quiet small">
          Route from TeleGeography&apos;s submarine cable map (CC BY-NC-SA 4.0). Routes are indicative.
        </p>
      </section>
    </div>
  );
}

export function BaseInspector({ base, onBack, onFly }: { base: Base; onBack: () => void; onFly: () => void }) {
  const [name, kind, lon, lat, operator] = base;
  return (
    <div className="inspector-body">
      <div className="isec tight">
        <button className="backlink" onClick={onBack}>
          ← Situation
        </button>
      </div>
      <section className="isec">
        <div className="badges">
          <span className="badge" style={{ ['--c' as string]: BASE_COLOR }}>
            {BASE_KINDS[kind] ?? kind}
          </span>
        </div>
        <h1 className="etitle">{name}</h1>
        {operator && <div className="sub">{operator}</div>}
        <div className="actions">
          <button className="btn" onClick={onFly}>
            Fly to
          </button>
          <a
            className="btn"
            href={'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon + '#map=13/' + lat + '/' + lon}
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenStreetMap ↗
          </a>
        </div>
      </section>
      <section className="isec">
        <p className="quiet small">
          From OpenStreetMap (ODbL), as mapped by volunteers: names and extents vary, and some sites are missing.
        </p>
      </section>
    </div>
  );
}
