import logoSrc from "../../assets/logo.png";

interface LogoProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  glow?: boolean;
}

export function Logo({ size = 32, className, style, glow = true }: LogoProps) {
  return (
    <img
      src={logoSrc}
      alt="GrowthForge"
      width={size}
      height={size}
      className={className}
      style={{
        objectFit: "contain",
        flexShrink: 0,
        filter: glow ? "drop-shadow(0 0 10px rgba(0,212,255,0.3)) drop-shadow(0 0 4px rgba(0,230,118,0.2))" : undefined,
        ...style,
      }}
    />
  );
}
