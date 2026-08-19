type LogoMarkProps = {
  className?: string;
  decorative?: boolean;
};

export default function LogoMark({ className = "", decorative = false }: LogoMarkProps) {
  return (
    <img
      src="/grounded-ddi-logo.png"
      className={`logo-mark ${className}`.trim()}
      alt={decorative ? "" : "Grounded DDI logo"}
      aria-hidden={decorative ? true : undefined}
      draggable={false}
    />
  );
}
