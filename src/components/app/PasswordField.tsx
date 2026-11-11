"use client";

import { useState } from "react";

/**
 * A password box with a 显示 switch, so one typed on a phone can be looked at before it is kept (there is
 * no second box to type it again). autoComplete tells password managers which it is: current-password
 * to fill one in, new-password to offer a strong one and keep it.
 */
export default function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  required?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label className="field">
      {label}
      <span className="pw-box">
        <input
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required={required}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="pw-eye" aria-pressed={shown} onClick={() => setShown((s) => !s)}>
          {shown ? "隐藏" : "显示"}
        </button>
      </span>
    </label>
  );
}

/**
 * The account's email, not shown, in a form that sets a password: password managers keep the new one
 * under it (Chrome and iCloud Keychain look for a username field in the same form)
 */
export function HiddenUsername({ email }: { email: string }) {
  return <input type="email" name="username" autoComplete="username" value={email} readOnly hidden tabIndex={-1} aria-hidden />;
}
