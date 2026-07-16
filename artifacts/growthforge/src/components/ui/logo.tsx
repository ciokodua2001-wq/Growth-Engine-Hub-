import logoSrc from "../../assets/logo.png";

/**
 * GrowthForge logo badge.
 *
 * The source PNG has significant transparent padding around the hex badge.
 * We use background-image with backgroundSize ~270% to zoom into the badge
 * so it fills the rendered area visibly, instead of appearing tiny.
 */
interface LogoProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  glow?: boolean;
}

export function Logo({ size = 40, className, style, glow = true }: LogoProps) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        backgroundImage: `url(${logoSrc})`,
        backgroundSize: "270%",
        backgroundPosition: "50% 50%",
        backgroundRepeat: "no-repeat",
        filter: glow
          ? "drop-shadow(0 0 12px rgba(0,212,255,0.4)) drop-shadow(0 0 5px rgba(0,230,118,0.25))"
          : undefined,
        ...style,
      }}
      aria-label="GrowthForge"
      role="img"
    />
  );
}
