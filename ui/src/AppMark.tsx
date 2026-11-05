import "./app-mark.css";

/** The mirrored ribbon and bead, shared by every app identity. */
export function AppMark({ size = 28, className = "", dark = false }: { size?: number | string; className?: string; dark?: boolean }) {
  return <picture className={`app-mark ${className}`} style={{ width: size, height: size }}>
    {!dark && <source media="(prefers-color-scheme: dark)" srcSet="/icons/icon-dark.svg" />}
    <img src={dark ? "/icons/icon-dark.svg" : "/icon.svg"} alt="E2A2O" width="32" height="32" />
  </picture>;
}
