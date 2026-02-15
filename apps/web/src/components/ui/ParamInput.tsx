'use client';

interface ParamInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  tooltip?: string;
}

export function ParamInput({ label, value, onChange, min, max, step = 0.01, unit, tooltip }: ParamInputProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-txt-muted uppercase tracking-wider">
          {label}
          {tooltip && (
            <span className="ml-1 text-txt-disabled cursor-help" title={tooltip}>
              <svg className="inline w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5a5.5 5.5 0 110-11 5.5 5.5 0 010 11zM8 5a1 1 0 00-1 1v.5a.5.5 0 001 0V6a1 1 0 000 0zm-.5 3.5a.5.5 0 001 0v-1a.5.5 0 00-1 0v1zM8 10a.75.75 0 100 1.5A.75.75 0 008 10z"/>
              </svg>
            </span>
          )}
        </label>
        <span className="font-mono text-xs text-txt-disabled">
          {min}–{max}{unit ? ` ${unit}` : ''}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="flex-1 h-1 bg-border-subtle rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-eigen-violet [&::-webkit-slider-thumb]:cursor-pointer"
        />
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v) && v >= min && v <= max) onChange(v);
            }}
            className="w-20 bg-bg-elevated border border-border-subtle rounded-lg px-2.5 py-1.5
              font-mono text-xs text-txt-primary text-right
              focus:outline-none focus:border-border-hover transition-colors"
          />
          {unit && <span className="text-xs text-txt-disabled font-mono">{unit}</span>}
        </div>
      </div>
    </div>
  );
}
