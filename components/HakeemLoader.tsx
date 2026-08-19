import styles from "./HakeemLoader.module.css";

type Props = {
  label?: string;
  fullscreen?: boolean;
  compact?: boolean;
  theme?: "light" | "dark";
};

export default function HakeemLoader({
  label = "Opening Hakeem…",
  fullscreen = false,
  compact = false,
  theme = "light",
}: Props) {
  return (
    <div
      className={[
        styles.wrap,
        fullscreen ? styles.fullscreen : "",
        compact ? styles.compact : "",
        theme === "dark" ? styles.dark : "",
      ].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className={styles.capsuleLoader} aria-hidden="true">
        <span className={styles.capsule} />
        <span className={styles.capsule} />
        <span className={styles.capsule} />
      </div>
      <p className={styles.label}>{label}</p>
    </div>
  );
}
