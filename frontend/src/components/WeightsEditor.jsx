import { DEFAULT_WEIGHTS, validWeights } from '../features'

export default function WeightsEditor({ weights = DEFAULT_WEIGHTS, onChange }) {
    return <fieldset className="block"><legend>Pesos de la decisión</legend>
        <div className="context-form">{Object.keys(DEFAULT_WEIGHTS).map((key) => <label className="field" key={key}>{key.replaceAll('_', ' ')}
            <input type="number" min="0" max="1" step="0.01" value={weights[key]} onChange={(e) => onChange({ ...weights, [key]: e.target.value === '' ? '' : Number(e.target.value) })} />
        </label>)}</div>
        <p role="status">{validWeights(weights) ? 'Suma: 1' : 'Los pesos deben estar entre 0 y 1 y sumar 1 para analizar.'}</p>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => onChange({ ...DEFAULT_WEIGHTS })}>Restablecer pesos</button>
    </fieldset>
}
