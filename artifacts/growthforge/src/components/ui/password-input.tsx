import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Password field with a show/hide (eye) toggle. Renders the input inside a
 * relative wrapper so the eye button sits inside the field on the right.
 */
export function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
  minLength,
  className = "",
  style,
}: PasswordInputProps) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative w-full">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        className={`${className} pr-10`}
        style={style}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7a8fa6] hover:text-white transition-colors"
        aria-label={show ? "Hide password" : "Show password"}
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
