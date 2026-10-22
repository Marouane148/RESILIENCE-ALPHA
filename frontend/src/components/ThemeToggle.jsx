import { useTheme } from '../theme';
import { MonitorIcon, MoonIcon, SunIcon } from './Icons';

const options = [
  { value: 'light', label: 'Clair', Icon: SunIcon },
  { value: 'dark', label: 'Sombre', Icon: MoonIcon },
  { value: 'system', label: 'Auto', Icon: MonitorIcon },
];

export default function ThemeToggle() {
  const [mode, setMode] = useTheme();

  return (
    <div aria-label="Thème de l’interface" className="inline-flex rounded-full border border-line bg-surface-2 p-0.5" role="radiogroup">
      {options.map(({ value, label, Icon }) => {
        const active = mode === value;
        return (
          <button
            aria-checked={active}
            aria-label={label}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
              active ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'
            }`}
            key={value}
            onClick={() => setMode(value)}
            role="radio"
            title={label}
            type="button"
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
